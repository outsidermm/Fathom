"""Does steering a running answer cost fewer generated tokens than asking
again? Runs against the Qwen and sidecar URLs in apps/api/.env; from apps/api:

    .venv/bin/python -m scripts.steer_tokens        # BENCH_CASES=2 for a smoke run

For each prompt, a greedy original (sidecar, no steer) goes through the
production reading pipeline to get readings and alternatives. Early, mid and
late checkpoints each get one alternative the original does not reach on its
own. Four arms then redirect that section toward it, all greedy on the same
HF model:

S  steered: the production run_steer (block-20 contrast steer, anchored with
   the target opening, loop guard), from the checkpoint.
A  anchor only: the same prefix and target opening, no steer.
P  prefix + instruction: the same prefix, the request added to the prompt,
   no opening, no steer.
R  re-prompt: the request added to the prompt, the whole answer again.

Generated tokens are the sidecar's own counts; prefill and helper tokens use
SGLang's /tokenize and usage (the same Qwen tokenizer). A blind Qwen judge
asks whether the new section (R: the whole answer) covers the target. Savings
are compared only on cases where both arms reached it. The report goes to
scripts/out/steer_tokens.md and .json.
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import os
import re
import statistics
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
# Wait for every reading of the original so its alternatives exist.
os.environ.setdefault("AV_HOLD_TIMEOUT", "30")

from app import steer as steer_module  # noqa: E402
from app.av_text import similar_focus  # noqa: E402
from app.checkpoints import PLAN  # noqa: E402
from app.qwen_stream import RunState, _qwen_endpoint, run_qwen_stream  # noqa: E402
from app.schemas import SteerMessage  # noqa: E402
from scripts.alternatives_eval import PROMPTS  # noqa: E402
from scripts.predict_eval import qwen  # noqa: E402

SIDECAR = os.environ.get("AV_API_BASE", "http://127.0.0.1:30003").rstrip("/")
SIDECAR_HEADERS = {"Authorization": f"Bearer {os.environ['AV_API_KEY']}"} if os.environ.get("AV_API_KEY") else {}
OUT = Path(__file__).parent / "out" / "steer_tokens"
ORIGINAL_TOKENS = 512  # The live answer's cap.
BRANCH_TOKENS = 400  # The sidecar's STEER_MAX_TOKENS default, used by run_steer.
MAX_CASES = int(os.environ.get("BENCH_CASES", "0")) or None
ARMS = ("S", "A", "P", "R")
ARM_NAMES = {"S": "steered", "A": "anchor only", "P": "prefix + instruction", "R": "re-prompt"}


@dataclass
class Tally:
    """Tokens an arm spent, filled by the wrappers below while it runs."""

    generated: int = 0  # decode tokens across every /steer call (loop-guard retries too)
    retries: int = 0  # /steer calls beyond the first
    helper_prompt: int = 0  # setup chat calls (target title / typed direction)
    helper_completion: int = 0
    contrast_calls: int = 0
    prefill: int = 0  # prompt + kept text replayed by /steer and /contrast
    eos: bool = False  # the last /steer call ended on its own, within its cap
    steer_calls: list[dict] = field(default_factory=list)


_TALLY: contextvars.ContextVar[Tally | None] = contextvars.ContextVar("tally", default=None)
_tokens_cache: dict[str, int] = {}


async def count_tokens(client: httpx.AsyncClient, text: str) -> int:
    """Qwen tokens in ``text`` via SGLang's /tokenize (no chat template)."""
    if not text:
        return 0
    if text not in _tokens_cache:
        url, model, headers = _qwen_endpoint()
        root = url.rsplit("/v1/", 1)[0]
        response = await client.post(f"{root}/tokenize", headers=headers, json={"model": model, "prompt": text})
        response.raise_for_status()
        _tokens_cache[text] = response.json()["count"]
    return _tokens_cache[text]


async def sidecar_generate(client: httpx.AsyncClient, body: dict, tally: Tally | None = None) -> str:
    """Text from the sidecar's /steer, recording its done line in ``tally``."""
    text = ""
    async with client.stream("POST", f"{SIDECAR}/steer", headers=SIDECAR_HEADERS, json=body) as response:
        response.raise_for_status()
        async for line in response.aiter_lines():
            if not line:
                continue
            event = json.loads(line)
            if event.get("done") and tally is not None:
                cap = body.get("max_new_tokens", BRANCH_TOKENS)
                tally.steer_calls.append({"prompt": body["prompt"], "prefix": body.get("prefix", ""), "tokens": event["tokens"]})
                tally.generated += event["tokens"]
                tally.eos = event["tokens"] < cap
            text += event.get("text", "")
    return text


# ---- wrappers around the production steer path -------------------------------

_production_sidecar_stream = steer_module._sidecar_stream
_production_chat = steer_module._chat


async def _counted_sidecar_stream(client, prompt, prefix, steers, new):
    """steer._sidecar_stream, also recording the sidecar's token count."""
    tally = _TALLY.get()
    url, headers = steer_module._sidecar()
    async with client.stream("POST", f"{url}/steer", headers=headers,
                             json={"prompt": prompt, "prefix": prefix, "steers": steers}) as response:
        response.raise_for_status()
        async for line in response.aiter_lines():
            if not line:
                continue
            event = json.loads(line)
            if event.get("done") and tally is not None:
                tally.steer_calls.append({"prompt": prompt, "prefix": prefix, "tokens": event["tokens"]})
                tally.generated += event["tokens"]
                tally.eos = event["tokens"] < BRANCH_TOKENS
            elif "released" in event:
                new["end_char"] = event["released"]
            elif event.get("text"):
                yield event["text"]


async def _counted_chat(client: httpx.AsyncClient, messages: list[dict], max_tokens: int) -> str:
    """steer._chat, also recording usage for the steer's setup calls."""
    url, model, headers = _qwen_endpoint()
    response = await client.post(url, headers=headers, json={
        "model": model, "messages": messages, "temperature": 0, "max_tokens": max_tokens,
    })
    response.raise_for_status()
    body = response.json()
    tally = _TALLY.get()
    if tally is not None:
        tally.helper_prompt += body.get("usage", {}).get("prompt_tokens", 0)
        tally.helper_completion += body.get("usage", {}).get("completion_tokens", 0)
    return body["choices"][0]["message"]["content"].strip()


_production_send = httpx.AsyncClient.send


async def _counted_send(self, request, **kwargs):
    tally = _TALLY.get()
    if tally is not None and request.url.path.endswith("/contrast"):
        tally.contrast_calls += 1
        body = json.loads(request.content)
        tally.steer_calls.append({"contrast": body})
    return await _production_send(self, request, **kwargs)


steer_module._sidecar_stream = _counted_sidecar_stream
steer_module._chat = _counted_chat
httpx.AsyncClient.send = _counted_send


# ---- cases --------------------------------------------------------------------


@dataclass
class Case:
    prompt: str
    bucket: str  # early / mid / late: where the branch point sits in the original
    checkpoint_id: int
    position: int
    original_tokens: int  # the whole original answer
    prefix_tokens: int  # kept text before the branch point
    reading: str
    target: dict
    title: str  # the original section's title
    arms: dict = field(default_factory=dict)


async def original_run(client: httpx.AsyncClient, prompt: str) -> RunState:
    """A greedy answer through the production reading pipeline."""
    state = RunState(run_id=uuid.uuid4().hex, prompt=prompt)

    async def deltas():
        async with client.stream("POST", f"{SIDECAR}/steer", headers=SIDECAR_HEADERS, json={
            "prompt": prompt, "steers": [], "max_new_tokens": ORIGINAL_TOKENS,
        }) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line and (text := json.loads(line).get("text")):
                    yield text

    async def ignore(_event: dict) -> None:
        return None

    await run_qwen_stream(prompt, ignore, pace=True, state=state, deltas=deltas())
    return state


_HEADING = re.compile(r"(?m)^\s*(?:#{1,6}\s*)?(?:\d+[.)]\s*)?\*{0,2}([^\n*:]{3,60})")


def fresh(state: RunState, checkpoint_id: int) -> list[dict]:
    """Alternatives the original does not reach later on its own."""
    entry = state.checkpoints[checkpoint_id]
    later = [re.sub(r"[#*\d.)]", "", m.group(0)).strip().lower()
             for m in _HEADING.finditer(state.text[entry.checkpoint.position:])][1:]
    return [a for a in entry.alternatives or []
            if not any(similar_focus(a["focus"], h) or any(w in h for w in a["focus"].split()[1:] if len(w) > 4)
                       for h in later)]


def pick_checkpoints(state: RunState) -> list[tuple[str, int]]:
    """One checkpoint per third of the answer that has a reading and a fresh alternative."""
    picked: dict[str, int] = {}
    for checkpoint_id, entry in sorted(state.checkpoints.items()):
        if entry.checkpoint == PLAN or entry.reading is None or not fresh(state, checkpoint_id):
            continue
        share = entry.checkpoint.position / max(1, len(state.text))
        bucket = "early" if share < 1 / 3 else "mid" if share < 2 / 3 else "late"
        picked.setdefault(bucket, checkpoint_id)
    return [(bucket, picked[bucket]) for bucket in ("early", "mid", "late") if bucket in picked]


def section(text: str, start: int) -> str:
    """From ``start`` to the next heading or numbered line."""
    body = text[start:]
    later = re.search(r"\n\s*(?:#{1,6}\s|\d{1,2}[.)]\s|\*\*\d)", body[1:])
    return body[: later.start() + 1 if later else 1200][:1200]


def instruction(prompt: str, title: str, target: dict) -> str:
    return (f"{prompt}\n\nIn place of a section on \"{title}\", write a section on "
            f"{target['focus']} ({target['detail']}).")


async def judge(client: httpx.AsyncClient, text: str, focus: str, whole: bool) -> str:
    if whole:
        question = (f"Does this answer have a section about {focus}? Answer full (a section is about it), "
                    "partial (it is mentioned within a section) or none.")
        text = text[:4000]
    else:
        question = (f"Does this section cover {focus}? Answer full (it is what the section is about), "
                    "partial (it is one part of it) or none.")
    reply = await qwen(client, [{"role": "user", "content": f"Text:\n\"\"\"{text}\"\"\"\n\n{question} "
                                                         "Reply with one word: full, partial or none."}], 6)
    word = re.search(r"\b(full|partial|none)\b", reply.lower())
    return word.group(1) if word else "?"


async def run_arm(arm: str, fn) -> tuple[Tally, str, float]:
    tally = Tally()
    token = _TALLY.set(tally)
    started = time.perf_counter()
    try:
        text = await fn(tally)
    finally:
        _TALLY.reset(token)
    return tally, text, time.perf_counter() - started


async def run_case(client: httpx.AsyncClient, parent: RunState, bucket: str, checkpoint_id: int) -> Case | None:
    entry = parent.checkpoints[checkpoint_id]
    position = entry.checkpoint.position
    prefix = parent.text[:position]
    original = parent.text[position:entry.checkpoint.sample_end].strip()
    title = steer_module.split_opening(original)[1].strip("*# :").strip() or original
    target = fresh(parent, checkpoint_id)[0]
    case = Case(
        prompt=parent.prompt, bucket=bucket, checkpoint_id=checkpoint_id, position=position,
        original_tokens=await count_tokens(client, parent.text), prefix_tokens=await count_tokens(client, prefix),
        reading=entry.reading.get("focus") or entry.reading["label"], target=target, title=title,
    )
    asked = instruction(parent.prompt, title, target)

    branch: dict = {}

    async def steered(tally: Tally) -> str:
        children: list[RunState] = []

        async def capture(event: dict) -> None:
            if event.get("type") == "branch":
                branch.update(event)
            elif event.get("type") == "steer_ack" and not event.get("applied"):
                branch["refused"] = event.get("message")

        msg = SteerMessage(run_id=parent.run_id, checkpoint_id=checkpoint_id, alternative_id=target["id"])
        await steer_module.run_steer(parent, msg, capture, children.append, pace=False, client=client)
        return children[0].text[position:] if children else ""

    async def anchor_only(tally: Tally) -> str:
        anchor = branch.get("opening") or ""
        return anchor + await sidecar_generate(client, {"prompt": parent.prompt, "prefix": prefix + anchor, "steers": []}, tally)

    async def prefix_instruction(tally: Tally) -> str:
        return await sidecar_generate(client, {"prompt": asked, "prefix": prefix, "steers": []}, tally)

    async def reprompt(tally: Tally) -> str:
        cap = case.prefix_tokens + BRANCH_TOKENS
        return await sidecar_generate(client, {"prompt": asked, "steers": [], "max_new_tokens": cap}, tally)

    for arm, fn in (("S", steered), ("A", anchor_only), ("P", prefix_instruction), ("R", reprompt)):
        if arm == "A" and not branch.get("opening"):
            return None  # The steer was refused; nothing to compare against.
        tally, text, seconds = await run_arm(arm, fn)
        # Prefill: the prompt and kept text each /steer and /contrast call replays.
        for call in tally.steer_calls:
            if "contrast" in call:
                body = call["contrast"]
                for opening in [body["original"], *body["targets"]]:
                    tally.prefill += await count_tokens(client, body["prompt"]) + await count_tokens(client, body["prefix"] + opening)
            else:
                tally.prefill += await count_tokens(client, call["prompt"]) + await count_tokens(client, call["prefix"])
        tally.retries = max(0, sum(1 for c in tally.steer_calls if "tokens" in c) - 1)
        anchor = branch.get("opening", "") if arm in ("S", "A") else ""
        follows = await judge(client, text if arm == "R" else section(text, 0), target["focus"], whole=arm == "R")
        case.arms[arm] = {
            "text": text, "seconds": round(seconds, 2), "follows": follows,
            "anchor_tokens": await count_tokens(client, anchor),
            "keeps_prefix": text.startswith(prefix) if arm == "R" else True,
            **{k: v for k, v in asdict(tally).items() if k != "steer_calls"},
        }
        print(f"    {arm}: {tally.generated} tok, follows {follows}, {seconds:.1f}s", flush=True)
    case.arms["S"]["branch"] = {k: branch.get(k) for k in ("opening", "anchored", "refused")}
    return case


# ---- report -------------------------------------------------------------------


def reached(arm: dict) -> bool:
    return arm["follows"] == "full" and arm["eos"]


def median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def fmt(value: float | None, unit: str = "") -> str:
    return "-" if value is None else f"{value:,.0f}{unit}" if abs(value) >= 10 else f"{value:.1f}{unit}"


def paired(cases: list[Case], a: str, b: str) -> dict:
    """Generated tokens of ``a`` relative to ``b`` on cases where both reached the target."""
    pairs = [(c.arms[a]["generated"] + c.arms[a]["helper_completion"], c.arms[b]["generated"] + c.arms[b]["helper_completion"])
             for c in cases if reached(c.arms[a]) and reached(c.arms[b])]
    savings = [1 - x / y for x, y in pairs if y]
    return {"n": len(pairs), "median_saving": median(savings),
            "median_a": median([x for x, _ in pairs]), "median_b": median([y for _, y in pairs])}


def verdict(cases: list[Case]) -> str:
    rate = {arm: sum(reached(c.arms[arm]) for c in cases) / len(cases) for arm in ARMS}
    s_vs_r = paired(cases, "S", "R")
    saving = s_vs_r["median_saving"]
    if saving is None or saving < 0.1:
        return ("No meaningful token saving over re-prompting on paired successes; "
                "report latency (click to first corrected token) instead.")
    credit = "activation steering" if rate["S"] - rate["A"] >= 0.1 else "checkpoint branching (with the anchored opening)"
    return (f"Steering from a checkpoint used {saving:.0%} fewer generated tokens than re-prompting "
            f"(median, {s_vs_r['n']} paired successes). The saving is credited to **{credit}**: "
            f"steered reached the target in {rate['S']:.0%} of cases vs {rate['A']:.0%} for the anchor alone "
            f"and {rate['P']:.0%} for prefix + instruction.")


def report(cases: list[Case]) -> str:
    n = len(cases)
    lines = [
        "# Token cost of steering vs. asking again", "",
        f"{n} live cases from {len({c.prompt for c in cases})} prompts on Qwen2.5-7B-Instruct "
        "(greedy, HF sidecar, same model for every arm). Every number and text below came from the live Pod; "
        "see apps/api/scripts/steer_tokens.py for the method.", "",
        f"**Result:** {verdict(cases)}", "",
        "## Arms", "",
        "| arm | what it does | reached target | ended within cap | median generated tokens | median prefill tokens | median seconds |",
        "|---|---|---|---|---|---|---|",
    ]
    what = {
        "S": "production steer from the checkpoint (block-20 contrast, anchored opening, loop guard)",
        "A": "same prefix + same anchored opening, no steer",
        "P": "same prefix, request added to the prompt, no opening, no steer",
        "R": "request added to the prompt, whole answer regenerated",
    }
    for arm in ARMS:
        rows = [c.arms[arm] for c in cases]
        lines.append(
            f"| {arm} {ARM_NAMES[arm]} | {what[arm]} | {sum(reached(r) for r in rows)}/{n} | {sum(r['eos'] for r in rows)}/{n} | "
            f"{fmt(median([r['generated'] + r['helper_completion'] for r in rows]))} | {fmt(median([r['prefill'] for r in rows]))} | "
            f"{fmt(median([r['seconds'] for r in rows]), ' s')} |")
    lines += [
        "", "Reached target: the blind judge says `full` and the arm ended on its own within its cap "
        f"(R: prefix tokens + {BRANCH_TOKENS}; others: {BRANCH_TOKENS}). R is judged on its whole answer, the others on "
        "the new section only, which favours R. Generated tokens run to the end of the answer for every arm: a branch "
        "rewrites everything after its checkpoint, so its saving is the kept prefix. S's seconds also include the "
        "branch's own readings and its AR score, which the other arms skip.", "",
        "## Paired savings (generated tokens, both arms reached the target)", "",
        "| comparison | pairs | median tokens | median saving |", "|---|---|---|---|",
    ]
    for a, b in (("S", "R"), ("P", "R"), ("A", "R"), ("S", "A")):
        p = paired(cases, a, b)
        saving = "-" if p["median_saving"] is None else format(p["median_saving"], ".0%")
        lines.append(f"| {a} vs {b} | {p['n']} | {fmt(p['median_a'])} vs {fmt(p['median_b'])} | {saving} |")
    lines += ["", "## By branch position (S vs R)", "", "| position | cases | pairs | median prefix tokens kept | median saving |",
              "|---|---|---|---|---|"]
    for bucket in ("early", "mid", "late"):
        group = [c for c in cases if c.bucket == bucket]
        if not group:
            continue
        p = paired(group, "S", "R")
        lines.append(f"| {bucket} | {len(group)} | {p['n']} | {fmt(median([c.prefix_tokens for c in group]))} | "
                     f"{'-' if p['median_saving'] is None else format(p['median_saving'], '.0%')} |")
    s_rows = [c.arms["S"] for c in cases]
    lines += [
        "", "## What the steer itself costs (S)", "",
        f"- Setup chat calls (target title): median {fmt(median([r['helper_prompt'] for r in s_rows]))} prompt + "
        f"{fmt(median([r['helper_completion'] for r in s_rows]))} completion tokens (completion counted in S's generated tokens above).",
        f"- /contrast calls: {sum(r['contrast_calls'] for r in s_rows)} over {n} cases (replays only, in prefill).",
        f"- Loop-guard retries: {sum(r['retries'] for r in s_rows)} over {n} cases (their tokens are in S's generated count).",
        f"- Anchored opening: median {fmt(median([r['anchor_tokens'] for r in s_rows]))} tokens, inserted, not generated (same for A).",
        f"- R kept the original text before the branch point in {sum(c.arms['R']['keeps_prefix'] for c in cases)}/{n} cases; "
        "S, A and P keep it by construction.",
        "- Not counted for any arm: readings and alternatives for the new text, which any regenerated answer also gets.",
        "", "## Cases", "",
        "| prompt | position | reading → target | S | A | P | R | tokens S / A / P / R |", "|---|---|---|---|---|---|---|---|",
    ]
    for c in cases:
        verdicts = " | ".join(f"{c.arms[a]['follows']}{'' if c.arms[a]['eos'] else ' (cap)'}" for a in ARMS)
        tokens = " / ".join(str(c.arms[a]["generated"] + c.arms[a]["helper_completion"]) for a in ARMS)
        lines.append(f"| {c.prompt[:48]} | {c.bucket} ({c.prefix_tokens} kept) | *{c.reading}* → *{c.target['focus']}* | {verdicts} | {tokens} |")
    lines += ["", "## Example texts", ""]
    for c in cases[:3]:
        lines += [f"### {c.prompt}", "", f"Branch at *{c.title}* ({c.bucket}, {c.prefix_tokens} tokens kept), toward *{c.target['focus']}*.", ""]
        for arm in ARMS:
            text = c.arms[arm]["text"] if arm == "R" else section(c.arms[arm]["text"], 0)
            quoted = "\n".join("> " + line for line in text[:600].strip().splitlines())
            lines += [f"**{arm} {ARM_NAMES[arm]}** ({c.arms[arm]['generated']} tokens, judge: {c.arms[arm]['follows']}):", "", quoted, ""]
    return "\n".join(lines)


async def main() -> None:
    cases: list[Case] = []
    timeout = httpx.Timeout(connect=10.0, read=300.0, write=30.0, pool=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        for prompt in PROMPTS:
            if MAX_CASES and len(cases) >= MAX_CASES:
                break
            print(f"{prompt}", flush=True)
            parent = await original_run(client, prompt)
            for bucket, checkpoint_id in pick_checkpoints(parent):
                if MAX_CASES and len(cases) >= MAX_CASES:
                    break
                print(f"  {bucket} checkpoint {checkpoint_id}", flush=True)
                try:
                    case = await run_case(client, parent, bucket, checkpoint_id)
                except (httpx.HTTPError, KeyError, ValueError) as exc:
                    print(f"    skipped: {type(exc).__name__}: {exc}", flush=True)
                    continue
                if case is not None:
                    cases.append(case)
            OUT.parent.mkdir(exist_ok=True)
            OUT.with_suffix(".json").write_text(json.dumps([asdict(c) for c in cases], indent=1))
    if not cases:
        raise SystemExit("no cases ran")
    OUT.with_suffix(".md").write_text(report(cases))
    print(f"wrote {OUT.with_suffix('.md')}")


if __name__ == "__main__":
    asyncio.run(main())
