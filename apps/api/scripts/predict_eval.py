"""Do AV phrases predict the text that follows them? Runs against the Qwen and
sidecar URLs in apps/api/.env. From apps/api:

    .venv/bin/python -m scripts.predict_eval

Sections: each section start is read at three points, and a blind two-way
judge (Qwen) picks which of two sections of the same answer the phrase
describes: the one that follows, or another. A "heading text" baseline labels
the heading words directly, without the AV, to show what the AV adds.
Plan: the prompt end is read at three positions, and two AV samples are
compared to test whether their agreement predicts accuracy.
"""

from __future__ import annotations

import asyncio
import os
import random
import re
import statistics
from dataclasses import dataclass

import httpx
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from app.av_text import split_explanation  # noqa: E402
from app.checkpoints import Checkpoint, next_checkpoint  # noqa: E402
from app.qwen_stream import _qwen_endpoint, summarize_focus  # noqa: E402

PROMPTS = [
    "Give me 4 numbered steps to start a vegetable garden.",
    "What are the steps to train for a marathon?",
    "List 4 tips for saving money on groceries, numbered.",
    "How do I set up a new laptop? Give numbered steps.",
    "Explain how to make a cup of pour-over coffee step by step.",
    "What should I consider when adopting a dog? Use a numbered list.",
    "Give me a 5-step plan to learn to play guitar.",
    "How do I prepare for a job interview at a tech company? Numbered steps.",
    "Describe how a bill becomes law in the United States, step by step.",
    "What are the main causes of World War I? List them with explanations.",
    "Explain how vaccines work in a short paragraph or two.",
    "How can I improve my sleep? Give numbered tips.",
]
SIDECAR = os.environ["AV_API_BASE"].rstrip("/")
AV_HEADERS = {"Authorization": f"Bearer {os.environ['AV_API_KEY']}"}
rng = random.Random(7)


@dataclass
class PlanRow:
    prompt: str
    labels: list[str | None]
    correct: list[bool | None]
    agree: bool | None
limit = asyncio.Semaphore(3)


async def qwen(client: httpx.AsyncClient, messages: list[dict], max_tokens: int) -> str:
    url, model, headers = _qwen_endpoint()
    response = await client.post(url, headers=headers, json={
        "model": model, "messages": messages, "temperature": 0, "max_tokens": max_tokens,
    })
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


async def phrase(client: httpx.AsyncClient, prompt: str, answer: str, **options) -> str | None:
    async with limit:
        response = await client.post(f"{SIDECAR}/explain", headers=AV_HEADERS, json={
            "prompt": prompt, "answer": answer, **options,
        })
    response.raise_for_status()
    _, detail = split_explanation(response.json()["explanation"])
    return await summarize_focus(detail, client=client) if detail else None


async def judge(client: httpx.AsyncClient, label: str, right: str, wrong: str) -> bool:
    options = [right, wrong]
    rng.shuffle(options)
    reply = await qwen(client, [{"role": "user", "content": (
        f'A tool described what a writer was about to write as: "{label}".\n\n'
        f"A) {options[0][:400]}\n\nB) {options[1][:400]}\n\n"
        "Which passage matches that description better? Answer A or B."
    )}], max_tokens=2)
    choice = 0 if "A" in reply.upper()[:2] else 1
    return options[choice] == right


def sections(answer: str) -> list[Checkpoint]:
    found: list[Checkpoint] = []
    taken: set[int] = set()
    last = -1
    while (checkpoint := next_checkpoint(answer, taken, last)) is not None:
        found.append(checkpoint)
        taken.add(checkpoint.position)
        last = checkpoint.position
    return found


def opening_end(answer: str, checkpoint: Checkpoint) -> int | None:
    """Just past a step's marker and opening "**", before any heading word."""
    match = re.match(r"[ \t]*(?:#{1,6}[ \t]*)?\d{1,2}[.)][ \t]+(\*\*)?", answer[checkpoint.position :])
    return checkpoint.position + match.end() if match and match.group(1) else None


async def main() -> None:
    scores: dict[str, list[bool]] = {}
    plan_rows: list[PlanRow] = []
    async with httpx.AsyncClient(timeout=120) as client:
        answers = [await qwen(client, [{"role": "user", "content": p}], 500) for p in PROMPTS]
        for prompt, answer in zip(PROMPTS, answers):
            found = [c for c in sections(answer)]
            spans = [
                answer[c.position : (found[i + 1].position if i + 1 < len(found) else len(answer))]
                for i, c in enumerate(found)
            ]
            if len(found) < 2:
                continue

            async def score(variant: str, index: int, label: str | None) -> None:
                if not label:
                    return
                others = [s for j, s in enumerate(spans) if j != index]
                ok = await judge(client, label, spans[index], rng.choice(others))
                scores.setdefault(variant, []).append(ok)

            jobs = []
            for i, c in enumerate(found):
                heading = answer[c.position : c.sample_end]
                jobs.append(("heading", i, phrase(client, prompt, answer[: c.sample_end])))
                jobs.append(("previous_end", i, phrase(client, prompt, answer[: c.position].rstrip())))
                cut = opening_end(answer, c)
                if cut is not None:
                    jobs.append(("opening", i, phrase(client, prompt, answer[:cut], last_token=True)))
                jobs.append(("heading_text_only", i, summarize_focus(heading, client=client)))
            labels = await asyncio.gather(*(job for _, _, job in jobs))
            await asyncio.gather(
                *(score(variant, index, label) for (variant, index, _), label in zip(jobs, labels))
            )

        # Plan: which prompt-end position, and does sample agreement predict accuracy?
        for index, (prompt, answer) in enumerate(zip(PROMPTS, answers)):
            other = answers[(index + 1 + rng.randrange(len(answers) - 1)) % len(answers)]
            labels = await asyncio.gather(
                *(phrase(client, prompt, "", prompt_end_back=b) for b in (0, 1, 2)),
                phrase(client, prompt, "", temperature=0.7),
            )
            correct: list[bool | None] = [
                await judge(client, label, answer, other) if label else None for label in labels[:3]
            ]
            agree = None
            if labels[0] and labels[3]:
                reply = await qwen(client, [{"role": "user", "content": (
                    f'Do "{labels[0]}" and "{labels[3]}" describe the same intended response? '
                    "Answer yes or no."
                )}], max_tokens=2)
                agree = reply.strip().lower().startswith("y")
            plan_rows.append(PlanRow(prompt, list(labels), correct, agree))

    print("SECTIONS: judge picks the following section over another (chance 50%)")
    for variant in ("previous_end", "opening", "heading", "heading_text_only"):
        values = scores.get(variant, [])
        if values:
            print(f"  {variant:18s} {statistics.mean(values):.0%}  (n={len(values)})")
    print("\nPLAN: phrase matches its own answer over another prompt's (chance 50%)")
    for back in (0, 1, 2):
        values = [float(v) for row in plan_rows if (v := row.correct[back]) is not None]
        print(f"  prompt_end_back={back}  {statistics.mean(values):.0%}  (n={len(values)})")
    for agree in (True, False):
        hits = [float(v) for r in plan_rows if r.agree is agree and (v := r.correct[0]) is not None]
        if hits:
            print(f"  samples agree={agree!s:5}  accuracy {statistics.mean(hits):.0%}  (n={len(hits)})")
    print("\nPlan labels (back=0 | back=1 | back=2 | sample):")
    for row in plan_rows:
        print(f"  {row.prompt[:48]:48s} {row.labels}  correct={row.correct} agree={row.agree}")


if __name__ == "__main__":
    asyncio.run(main())
