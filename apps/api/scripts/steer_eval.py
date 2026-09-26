"""Does steering follow, and does re-steering work? Drives the real WebSocket
API end to end (start, readings, alternatives, steer, branch) against the Qwen
and sidecar URLs in apps/api/.env. Start the API first, then from apps/api:

    uvicorn app.main:app --port 8000 &
    .venv/bin/python -m scripts.steer_eval

Cases, all steered from real readings and alternatives:
A  first car, Step 1: toward one alternative (A1), re-steer the same point
   toward another (A2, a sibling), steer A1's branch again at its next section
   (A3, stacked), and steer away from the reading (A4).
B  vegetable garden, Step 1: two typed directions, including "the opposite".
C  first car, the plan: steer the whole answer toward an alternative.

Each steered section is shown beside the original and beside an unsteered
greedy continuation of the same prefix from the sidecar (the control: the
live answer is sampled by SGLang). A blind Qwen judge says whether the section
follows the target, still covers the reading's focus, and reads fluently.
Alternatives the original answer reaches anyway are skipped as targets. The
report is written to scripts/out/steer_eval.md.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import httpx
import websockets
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from app.av_text import similar_focus  # noqa: E402
from scripts.predict_eval import qwen  # noqa: E402

WS_URL = os.environ.get("STEER_EVAL_WS", "ws://127.0.0.1:8000/ws/stream")
SIDECAR = os.environ.get("AV_API_BASE", "http://127.0.0.1:30003").rstrip("/")
SIDECAR_HEADERS = {"Authorization": f"Bearer {os.environ['AV_API_KEY']}"} if os.environ.get("AV_API_KEY") else {}
OUT = Path(__file__).parent / "out" / "steer_eval.md"
CAR = "I'm buying my first car. Walk me through the process step by step."
GARDEN = "Give me 4 numbered steps to start a vegetable garden."
SETTLE = 12.0  # Seconds without events after done before a run counts as settled.
SECTION_CHARS = 600


@dataclass
class Run:
    run_id: str
    prompt: str
    position: int = 0  # where its own text starts (a branch's checkpoint)
    parent: "Run | None" = None
    label: str = "original"
    text: str = ""
    readings: dict[int, dict] = field(default_factory=dict)
    alternatives: dict[int, list[dict]] = field(default_factory=dict)
    branch: dict | None = None
    ack: dict | None = None
    score: dict | None = None
    status: str = "streaming"
    last_ack: dict | None = None
    direction: dict = field(default_factory=dict)


class Session:
    def __init__(self, socket) -> None:
        self.socket = socket
        self.runs: dict[str, Run] = {}
        self.leaks = 0  # events for a run other than the one streaming
        self.pending: Run | None = None  # the branch a steer started

    async def events(self, until, current: str | None):
        """Apply events until ``until()`` holds and SETTLE seconds pass quietly."""
        while True:
            try:
                raw = await asyncio.wait_for(self.socket.recv(), timeout=SETTLE if until() else 120)
            except asyncio.TimeoutError:
                if until():
                    return
                raise
            event = json.loads(raw)
            run = self.runs.get(event.get("run_id", ""))
            if event["type"] == "branch":
                parent = self.runs[event["parent_run_id"]]
                child = Run(event["run_id"], parent.prompt, event["position"], parent,
                            text=parent.text[: event["position"]], branch=event)
                self.runs[child.run_id] = child
                self.pending = child
                current = child.run_id
                continue
            if run is None:
                continue
            if current and run.run_id != current and event["type"] != "steer_ack":
                self.leaks += 1
            if event["type"] == "token":
                run.text = run.text[: event["position"]] + event["text"]
            elif event["type"] in ("av", "av_error"):
                run.readings[event["checkpoint_id"]] = event
            elif event["type"] == "av_alternatives":
                run.alternatives[event["checkpoint_id"]] = event["alternatives"]
            elif event["type"] == "steer_ack":
                run.last_ack = event
            elif event["type"] == "steer_score":
                run.score = event
            elif event["type"] == "status" and event["state"] in ("done", "error"):
                run.status = event["state"]

    async def start(self, prompt: str) -> Run:
        run = Run(uuid.uuid4().hex, prompt)
        self.runs[run.run_id] = run
        await self.socket.send(json.dumps({"type": "start", "prompt": prompt, "model": "qwen2.5-7b",
                                           "run_id": run.run_id}))
        # Alternatives still landing after done arrive within the quiet period.
        await self.events(lambda: run.status != "streaming", run.run_id)
        return run

    async def steer(self, parent: Run, checkpoint_id: int, label: str, **direction) -> Run | None:
        self.pending = None
        parent.last_ack = None
        await self.socket.send(json.dumps({"type": "steer", "run_id": parent.run_id,
                                           "checkpoint_id": checkpoint_id, **direction}))
        # The quiet period after done also covers the AR score and the branch's
        # own alternatives, which it needs to be steered again.
        await self.events(lambda: parent.last_ack is not None and (
            not parent.last_ack["applied"] or (self.pending is not None and self.pending.status != "streaming")), None)
        if not parent.last_ack["applied"]:
            print(f"  {label}: refused: {parent.last_ack['message']}")
            return None
        child = self.pending
        child.label, child.ack, child.direction = label, parent.last_ack, direction
        print(f"  {label}: {child.text[child.position:child.position + 120]!r}", flush=True)
        return child


def first_section(run: Run) -> int:
    """The first checkpoint after the plan that has a reading and alternatives."""
    return next(k for k, r in sorted(run.readings.items())
                if r["type"] == "av" and r["position"] > run.position and run.alternatives.get(k))


def later_headings(run: Run, position: int) -> list[str]:
    return [m.group(0) for m in re.finditer(r"(?m)^\s*(?:#{1,6}\s*)?(?:\d+[.)]\s*)?\*{0,2}([^\n*:]{3,60})", run.text[position:])][1:]


def fresh(run: Run, checkpoint_id: int) -> list[dict]:
    """Alternatives the original answer does not reach on its own later."""
    position = run.readings[checkpoint_id]["position"]
    headings = [re.sub(r"[#*\d.)]", "", h).strip().lower() for h in later_headings(run, position)]
    return [a for a in run.alternatives.get(checkpoint_id, [])
            if not any(similar_focus(a["focus"], h) or any(w in h for w in a["focus"].split()[1:] if len(w) > 4)
                       for h in headings)]


def section(run: Run, text: str, start: int) -> str:
    """The section starting at ``start``: up to the next checkpoint (or numbered/heading line)."""
    ends = [r["position"] for r in run.readings.values() if r["position"] > start]
    body = text[start: min(ends) if ends else None]
    later = re.search(r"\n\s*(?:#{1,6}\s|\d{1,2}[.)]\s)", body[1:])
    return body[: later.start() + 1] if later else body


async def control(prompt: str, prefix: str) -> str:
    text = ""
    async with httpx.AsyncClient(timeout=300) as client:
        async with client.stream("POST", f"{SIDECAR}/steer", headers=SIDECAR_HEADERS,
                                 json={"prompt": prompt, "prefix": prefix, "steers": [], "max_new_tokens": 200}) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if line:
                    text += json.loads(line).get("text", "")
    return text


async def judge(client: httpx.AsyncClient, run: Run, section: str) -> dict:
    target = run.branch["focus"]
    reading = run.parent.readings[run.branch["checkpoint_id"]]
    current = reading.get("focus") or reading["label"]

    async def ask(question: str) -> str:
        return (await qwen(client, [{"role": "user", "content": f"Section:\n\"\"\"{section[:SECTION_CHARS]}\"\"\"\n\n{question}"}], 4)).strip().lower()

    follows = await ask(f"Does this section cover {target}? Answer full (it is what the section is about), "
                        "partial (it is one part of it) or none.") if run.branch["kind"] == "toward" else "-"
    keeps = await ask(f"Is {current} what this section is mainly about? Answer yes or no.")
    fluent = await ask("How fluent and well-formed is this text? Answer one digit from 1 (broken) to 5 (fluent).")
    return {"follows": follows.split()[0] if follows else "?", "keeps_current": keeps.split()[0] if keeps else "?",
            "fluency": (re.findall(r"[1-5]", fluent) or ["?"])[0]}


def quote(text: str) -> str:
    return "\n".join("> " + line for line in text[:SECTION_CHARS].strip().splitlines()) + ("…" if len(text) > SECTION_CHARS else "")


async def main() -> None:
    async with websockets.connect(WS_URL, max_size=None) as socket:
        await socket.recv()  # idle
        session = Session(socket)
        steered: list[Run] = []
        checks: list[tuple[str, bool]] = []

        car = await session.start(CAR)
        step1 = first_section(car)
        options = fresh(car, step1)
        print("car readings:", {k: (r["label"], r.get("focus")) for k, r in sorted(car.readings.items())})
        print("car first-section fresh alternatives:", [a["focus"] for a in options])
        a1 = await session.steer(car, step1, "A1 toward", alternative_id=options[0]["id"])
        a2 = await session.steer(car, step1, "A2 re-steer, same point", alternative_id=options[-1]["id"])
        a3 = None
        if a1:
            later = [k for k, r in sorted(a1.readings.items())
                     if r["type"] == "av" and r["position"] > a1.position and a1.alternatives.get(k)]
            if later:
                a3 = await session.steer(a1, later[0], "A3 stacked on A1", alternative_id=0)
        a4 = await session.steer(car, step1, "A4 away", away=True)
        plan_options = fresh(car, 0)
        c1 = await session.steer(car, 0, "C1 whole answer", alternative_id=(plan_options or car.alternatives[0])[0]["id"])

        garden = await session.start(GARDEN)
        g1 = first_section(garden)
        b1 = await session.steer(garden, g1, "B1 typed", text="focus on growing in containers on a balcony")
        b2 = await session.steer(garden, g1, "B2 typed opposite", text="do the opposite of this")
        steered = [r for r in (a1, a2, a3, a4, c1, b1, b2) if r]

        if a1 and a2:
            prefix = car.text[: a1.position]
            checks.append(("A1 and A2 share the kept prefix", a1.text.startswith(prefix) and a2.text.startswith(prefix)))
            checks.append(("A1 and A2 differ after it", a1.text[a1.position:] != a2.text[a2.position:]))
        if a3 and a1:
            checks.append(("A3 keeps A1's text up to its branch point", a3.text.startswith(a1.text[: a3.position])))
            checks.append(("A3 branches after A1's steered section", a3.position > a1.position))
        checks.append(("no events from abandoned runs", session.leaks == 0))

        async with httpx.AsyncClient(timeout=120) as client:
            for run in steered:
                run.section = section(run, run.text, run.position)
                run.control = await control(run.prompt, run.text[: run.position])
                run.original = section(run.parent, run.parent.text, run.position)
                run.verdict = await judge(client, run, run.section)
                run.control_verdict = await judge(client, run, section(run, run.text[: run.position] + run.control, run.position))
                print(run.label, run.verdict, "control:", run.control_verdict, flush=True)

    lines = ["# Steering: genuine end-to-end cases", "",
             "Steers are block-20 differences between Qwen's own states at the original and a target "
             "section opening (see apps/api/pod/av_sidecar.py); toward steers are anchored with that "
             "opening. Every text below came from the live API. A blind Qwen judge reads only the "
             "steered section, and the same section of an unsteered greedy continuation (control).", "",
             "| case | steer | follows target | still on reading's focus | fluency | control: follows / on focus |",
             "|---|---|---|---|---|---|"]
    for run in steered:
        lines.append(f"| {run.label} | {run.branch['kind']}{' (anchored)' if run.branch.get('anchored') else ''} *{run.branch['focus']}* | {run.verdict['follows']} | "
                     f"{run.verdict['keeps_current']} | {run.verdict['fluency']} | "
                     f"{run.control_verdict['follows']} / {run.control_verdict['keeps_current']} |")
    lines += ["", "## Re-steering checks", ""] + [f"- {'✓' if ok else '✗'} {name}" for name, ok in checks] + [""]
    for base in (car, garden):
        lines += [f"## {base.prompt}", "", "### Readings and alternatives (original run)", ""]
        for k, reading in sorted(base.readings.items()):
            if reading["type"] != "av":
                continue
            alts = "; ".join(a["focus"] for a in base.alternatives.get(k, []))
            lines.append(f"- **{reading['label']}** (position {reading['position']}): *{reading.get('focus')}* — alternatives: {alts}")
        lines.append("")
        for run in steered:
            if run.prompt != base.prompt:
                continue
            reading = run.parent.readings[run.branch["checkpoint_id"]]
            first = next((r for _, r in sorted(run.readings.items()) if r["type"] == "av"), None)
            lines += [f"### {run.label}: {run.branch['kind']} *{run.branch['focus']}*", "",
                      f"From {run.parent.label} at **{reading['label']}** (position {run.position}), where the reading was "
                      f"*{reading.get('focus')}*. Input: `{json.dumps(run.direction)}`."]
            if run.ack.get("note"):
                lines.append(f"Qwen read the typed direction as: *{run.ack['note']}*")
            if run.branch.get("opening"):
                lines.append(f"Steer made from the opening: `{run.branch['opening']}`")
            lines += ["", "**Original section:**", quote(run.original), "",
                      "**Unsteered control (same prefix, greedy):**", quote(run.control), "",
                      "**Steered section:**", quote(run.section), "",
                      "<details><summary>Steered answer from the branch point</summary>", "",
                      quote(run.text[run.position:]), "", "</details>", ""]
            if first:
                lines.append(f"Reading of the steered state at its first section: *{first.get('focus')}*")
            if run.score:
                b, a = run.score["before"], run.score["after"]
                lines.append(f"AR (centered cosine with the reading's note → target note): before {b.get('current')} → "
                             f"{b.get('target', '-')}, after {a.get('current')} → {a.get('target', '-')}")
            lines += [f"Judge: follows {run.verdict['follows']}, still on the reading's focus {run.verdict['keeps_current']}, "
                      f"fluency {run.verdict['fluency']}/5", ""]
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text("\n".join(lines))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
