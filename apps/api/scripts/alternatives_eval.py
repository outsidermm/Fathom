"""Do the alternative directions offered with each AV reading hold up? Runs
the production _request_av and request_alternatives against the Qwen and
sidecar URLs in apps/api/.env. From apps/api:

    .venv/bin/python -m scripts.alternatives_eval

Every checkpoint of 20 answers is scored on four checks:
ok        2-3 alternatives came back.
distinct  no alternative's focus matches the reading's or another's
          (same words, or content-word Jaccard >= 0.6).
form      each focus is a 2-10 word phrase starting with an -ing verb, and
          each detail is 1-2 sentences with no quoted text.
on_task   a blind Qwen judge calls every alternative a plausible step for
          the task.
The report, with every reading beside its alternatives, is written to
scripts/out/alternatives_eval.md.
"""

from __future__ import annotations

import asyncio
import os
import re
import statistics
import time
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from app.av_text import clean_focus, similar_focus  # noqa: E402
from app.checkpoints import PLAN, Checkpoint, next_checkpoint  # noqa: E402
from app.qwen_stream import (  # noqa: E402
    _DENSE_CHECKPOINTS,
    _MAX_CHECKPOINTS,
    _SPREAD_GAP,
    _request_av,
    alternatives_count,
    request_alternatives,
)
from scripts.predict_eval import PROMPTS as PREDICT_PROMPTS  # noqa: E402
from scripts.predict_eval import qwen  # noqa: E402

PROMPTS = PREDICT_PROMPTS + [
    "I'm buying my first car. Walk me through the process step by step.",
    "Plan a 3-day trip to Tokyo for a first-time visitor.",
    "Write a Python function that returns the n-th Fibonacci number, and explain it.",
    "My React app re-renders constantly. How do I debug it? Numbered steps.",
    "Should I rent or buy a home? Compare the options.",
    "Outline a 5-paragraph essay on the effects of social media on teenagers.",
    "Give me a simple recipe for banana bread.",
    "Explain why the sky is blue in plain prose, no lists.",
]
OUT = Path(__file__).parent / "out" / "alternatives_eval.md"
_SENTENCE = re.compile(r"(?<=[.!?])\s+")
limit = asyncio.Semaphore(3)


@dataclass
class Row:
    checkpoint: Checkpoint
    reading: dict
    alternatives: list[dict] = field(default_factory=list)
    checks: dict[str, bool] = field(default_factory=dict)
    judged: list[bool] = field(default_factory=list)
    av_ms: int = 0
    alt_ms: int = 0


def checkpoints(answer: str) -> list[Checkpoint]:
    """The live stream's placement: the plan, dense sections, then spread ones."""
    found = [PLAN]
    taken: set[int] = set()
    last = -1
    while len(found) < _MAX_CHECKPOINTS:
        gap = 0 if len(found) - 1 < _DENSE_CHECKPOINTS else _SPREAD_GAP
        checkpoint = next_checkpoint(answer, taken, last, gap)
        if checkpoint is None:
            break
        found.append(checkpoint)
        taken.add(checkpoint.position)
        last = checkpoint.position
    return found


def well_formed(alternative: dict) -> bool:
    focus, detail = alternative["focus"], alternative["detail"]
    sentences = [s for s in _SENTENCE.split(detail.strip()) if s]
    return (
        clean_focus(focus) == focus
        and focus.split()[0].endswith("ing")
        and 1 <= len(sentences) <= 2
        and not re.search(r"[\"“”]", detail)
    )


async def on_task(client: httpx.AsyncClient, prompt: str, alternative: dict) -> bool:
    reply = await qwen(client, [{"role": "user", "content": (
        f"Task: {prompt}\n\nProposed step: {alternative['focus']}. {alternative['detail']}\n\n"
        "Is this a plausible, relevant step for answering this task? Answer yes or no."
    )}], max_tokens=2)
    return reply.strip().lower().startswith("yes")


async def evaluate(client: httpx.AsyncClient, prompt: str) -> tuple[str, list[Row]]:
    async with limit:
        answer = await qwen(client, [{"role": "user", "content": prompt}], 500)

    async def one(checkpoint_id: int, checkpoint: Checkpoint) -> Row:
        prefix = answer[: checkpoint.sample_end]
        async with limit:
            started = time.perf_counter()
            reading = await _request_av(
                prompt, prefix, checkpoint_id=checkpoint_id, checkpoint=checkpoint, client=client,
            )
            row = Row(checkpoint, reading, av_ms=round((time.perf_counter() - started) * 1000))
            if reading["type"] != "av":
                row.checks = dict.fromkeys(("ok", "distinct", "form", "on_task"), False)
                return row
            started = time.perf_counter()
            event = await request_alternatives(prompt, prefix, reading, n=alternatives_count())
            row.alt_ms = round((time.perf_counter() - started) * 1000)
        row.alternatives = event["alternatives"] if event else []
        focuses = [reading.get("focus") or ""] + [a["focus"] for a in row.alternatives]
        row.judged = [await on_task(client, prompt, a) for a in row.alternatives]
        row.checks = {
            "ok": 2 <= len(row.alternatives) <= 3,
            "distinct": bool(row.alternatives) and not any(
                similar_focus(a, b) for i, a in enumerate(focuses) for b in focuses[i + 1:] if a and b
            ),
            "form": bool(row.alternatives) and all(map(well_formed, row.alternatives)),
            "on_task": bool(row.judged) and all(row.judged),
        }
        return row

    rows = await asyncio.gather(*(one(i, c) for i, c in enumerate(checkpoints(answer))))
    return answer, list(rows)


def mark(passed: bool) -> str:
    return "✓" if passed else "✗"


def report(results: list[tuple[str, str, list[Row]]]) -> str:
    lines = ["# AV readings and their alternatives", ""]
    all_rows = [row for _, _, rows in results for row in rows]
    names = ("ok", "distinct", "form", "on_task")
    lines += ["| check | passed |", "|---|---|"]
    for name in names:
        passed = sum(row.checks[name] for row in all_rows)
        lines.append(f"| {name} | {passed}/{len(all_rows)} ({passed / len(all_rows):.0%}) |")
    clean = sum(all(all(r.checks.values()) for r in rows) for _, _, rows in results)
    av_ms = [r.av_ms for r in all_rows if r.reading["type"] == "av"]
    alt_ms = [r.alt_ms for r in all_rows if r.alternatives]
    lines += [
        "",
        f"Prompts with every checkpoint passing: {clean}/{len(results)}. "
        f"Median AV {statistics.median(av_ms) if av_ms else 0:.0f} ms, "
        f"alternatives {statistics.median(alt_ms) if alt_ms else 0:.0f} ms.",
        "",
    ]
    failures = [
        (n, prompt, row) for n, (prompt, _, rows) in enumerate(results, 1)
        for row in rows if not all(row.checks.values())
    ]
    if failures:
        lines += ["## Failures", ""]
        for n, prompt, row in failures:
            failed = ", ".join(k for k, v in row.checks.items() if not v)
            lines.append(f"- {n}. {prompt} / {row.checkpoint.label}: {failed}")
        lines.append("")
    for n, (prompt, answer, rows) in enumerate(results, 1):
        lines += [f"## {n}. {prompt}", ""]
        for row in rows:
            checks = " ".join(f"{k} {mark(v)}" for k, v in row.checks.items())
            lines.append(f"### {row.checkpoint.label} (position {row.checkpoint.position}) - {checks}")
            if row.checkpoint.position:
                lead = answer[row.checkpoint.position: row.checkpoint.sample_end].strip()
                lines.append(f"Text at this point: `{lead}`")
            if row.reading["type"] != "av":
                lines += [f"AV failed: {row.reading['message']}", ""]
                continue
            lines += [
                "",
                f"**AV reading:** *{row.reading.get('focus') or '(no focus)'}* - "
                f"{row.reading.get('detail') or row.reading['explanation']}",
                "",
                "**Alternatives:**" if row.alternatives else "**Alternatives:** none",
            ]
            for alternative, judged in zip(row.alternatives, row.judged):
                lines.append(
                    f"- *{alternative['focus']}* - {alternative['detail']} "
                    f"(on task {mark(judged)})"
                )
            lines.append("")
    return "\n".join(lines)


async def main() -> None:
    async with httpx.AsyncClient(timeout=120) as client:
        answers = await asyncio.gather(*(evaluate(client, p) for p in PROMPTS))
    results = [(prompt, answer, rows) for prompt, (answer, rows) in zip(PROMPTS, answers)]
    text = report(results)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(text)
    summary = text.split("\n## 1. ")[0]
    print(summary)
    print(f"Full report: {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
