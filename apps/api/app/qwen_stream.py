"""Stream Qwen's OpenAI-compatible chat completion into the browser socket."""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import re
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import httpx

from .av_text import clean_focus, similar_focus, split_explanation
from .checkpoints import LOOKAHEAD, PLAN, Checkpoint, next_checkpoint
from .schemas import AVAlternativesEvent, AVErrorEvent, AVEvent, StatusEvent, TokenEvent

SendEvent = Callable[[dict], Awaitable[None]]
logger = logging.getLogger(__name__)


@dataclass
class CheckpointState:
    checkpoint: Checkpoint
    reading: dict | None = None  # the "av" event, once it has arrived
    alternatives: list[dict] | None = None


@dataclass
class RunState:
    """What a run produced, kept so it can be steered from afterwards."""

    run_id: str
    prompt: str
    # Parent text kept before a branch point; "" for a fresh run.
    prefix: str = ""
    # Sidecar steers the text was generated under (inherited ones first).
    steers: list[dict] = field(default_factory=list)
    parent_run_id: str | None = None
    text: str = ""  # prefix plus everything streamed after it
    checkpoints: dict[int, CheckpointState] = field(default_factory=dict)


def _qwen_endpoint() -> tuple[str, str, dict[str, str]]:
    """(chat completions URL, model name, auth headers) for the Qwen server."""
    base_url = os.environ.get("QWEN_API_BASE", "http://127.0.0.1:30001/v1").rstrip("/")
    model = os.environ.get("QWEN_MODEL", "qwen2.5-7b")
    api_key = os.environ.get("QWEN_API_KEY")
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    return f"{base_url}/chat/completions", model, headers


async def qwen_deltas(
    prompt: str, *, client: httpx.AsyncClient | None = None
) -> AsyncIterator[str]:
    """Yield exact text deltas from SGLang's chat-completions SSE response."""
    url, model, headers = _qwen_endpoint()
    headers = {**headers, "Accept": "text/event-stream"}

    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)
        )

    try:
        async with client.stream(
            "POST",
            url,
            headers=headers,
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": True,
                "max_tokens": 512,
            },
        ) as response:
            response.raise_for_status()
            data_lines: list[str] = []
            async for line in response.aiter_lines():
                if line.startswith("data:"):
                    data_lines.append(line[5:].strip())
                elif not line and data_lines:
                    payload = "\n".join(data_lines)
                    data_lines.clear()
                    if payload == "[DONE]":
                        return
                    yield _content_delta(payload)
            if data_lines:
                payload = "\n".join(data_lines)
                if payload != "[DONE]":
                    yield _content_delta(payload)
    finally:
        if owns_client:
            await client.aclose()


def _content_delta(payload: str) -> str:
    event = json.loads(payload)
    if not isinstance(event, dict):
        raise ValueError("Qwen returned an invalid event")
    if "error" in event:
        raise ValueError("Qwen returned a streaming error")
    choices = event.get("choices", [])
    if not isinstance(choices, list):
        raise ValueError("Qwen returned invalid choices")
    if not choices:
        return ""
    if not isinstance(choices[0], dict):
        raise ValueError("Qwen returned an invalid choice")
    delta = choices[0].get("delta", {})
    if not isinstance(delta, dict):
        raise ValueError("Qwen returned an invalid delta")
    content = delta.get("content")
    return content if isinstance(content, str) else ""


_FOCUS_SYSTEM = (
    "You label what a language model was doing, given an interpretability note "
    "about its internal state. Reply with one phrase of 3 to 7 words that "
    "starts with a lowercase -ing verb and names the specific topic, not just "
    "the structure (not 'listing the next step'). Use only what the note says; "
    "add no facts. "
    "No quotes, no final period."
)
# Few-shot pairs taken from real AV readings of Qwen answers.
_FOCUS_EXAMPLES = [
    ('The sentence "When you start looking at cars, it\'s important to determine your '
     'budget" introduces a financial question about price, listing budget considerations '
     "like total cost or monthly payments.", "advising to determine a budget"),
    ('The paragraph "consider your budget and determine what type of vehicle you need" '
     "continues the personal assessment with questions about vehicle type, size, features.",
     "weighing what type of vehicle fits"),
    ('The phrase "def is_palindrome(s): This function checks if a given string s is a '
     'palindrome" establishes the function\'s purpose and expects the implementation next.',
     "defining the palindrome-checking function"),
    ('The sentence ending "Consequences can include fines, legal penalties, and a criminal '
     'record" is a closing clause about the seriousness of the act.',
     "warning about legal consequences"),
    ('The bullet "Step 3: Visit the dealership" signals the next section in a numbered list of '
     "car-buying steps, likely covering test drives at the dealership.",
     "planning a dealership visit"),
]


async def summarize_focus(note: str, *, client: httpx.AsyncClient | None = None) -> str | None:
    """Compress an AV note into a short "-ing" phrase, or None.

    Qwen sees only the AV's note, never the answer, so the phrase stays a label
    of what the AV reported rather than a summary of the visible text.
    """
    url, model, headers = _qwen_endpoint()
    messages = [{"role": "system", "content": _FOCUS_SYSTEM}]
    for example, label in _FOCUS_EXAMPLES:
        messages += [{"role": "user", "content": example}, {"role": "assistant", "content": label}]
    messages.append({"role": "user", "content": note})
    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(timeout=httpx.Timeout(10.0))
    try:
        response = await client.post(url, headers=headers, json={
            "model": model, "messages": messages, "temperature": 0, "max_tokens": 20,
        })
        response.raise_for_status()
        return clean_focus(response.json()["choices"][0]["message"]["content"], note)
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
        return None
    finally:
        if owns_client:
            await client.aclose()


_ALTERNATIVES_SYSTEM = (
    "You suggest other directions a language model could take at one point in "
    "its answer. You get the user's task, the answer so far, and an "
    "interpretability note on what the model's internal state was focused on "
    "there. Propose {n} other steps the model could take next in this same "
    "task, each a different part of the overall workflow (if the note is about "
    "setting a budget, others might be choosing a car type or comparing "
    "financing). Each must differ from the note and from each other, and stay "
    "on the task. For each, write a 'detail' of one or two sentences in the "
    "note's voice, saying what the section would do and what it sets up next, "
    "without quoting answer text; and a 'focus' of 3 to 7 words that starts "
    "with a lowercase -ing verb and names the specific topic. When the answer "
    "so far is empty, propose other overall approaches to the task. "
    'Reply only with JSON: {{"alternatives": [{{"focus": "...", "detail": "..."}}]}}'
)
# The budget note from _FOCUS_EXAMPLES, with sibling steps of the same task.
_ALTERNATIVES_EXAMPLE = (
    "Help me buy my first car.",
    "When you start looking at cars, it's important to determine your budget.",
    _FOCUS_EXAMPLES[0][0],
    [
        {"focus": "weighing what type of vehicle fits",
         "detail": "The section turns to a personal assessment of vehicle type, asking about "
                   "size, seating and features, and expects a list of needs next."},
        {"focus": "comparing loan and lease financing",
         "detail": "The step introduces financing, weighing loans, leases and interest rates "
                   "before any purchase is made."},
        {"focus": "planning a dealership visit",
         "detail": "The section moves to visiting a dealership, setting up test drives and "
                   "questions to ask the salesperson."},
        {"focus": "estimating insurance and running costs",
         "detail": "The step looks past the price to insurance, fuel and upkeep, before "
                   "narrowing down models."},
    ],
)


def _alternatives_request(task: str, answer: str, note: str) -> str:
    return f"Task: {task}\n\nAnswer so far:\n{answer or '(empty)'}\n\nNote: {note}"


def _alternatives_schema(n: int) -> dict:
    item = {
        "type": "object",
        "properties": {"focus": {"type": "string"}, "detail": {"type": "string"}},
        "required": ["focus", "detail"],
    }
    return {"type": "json_schema", "json_schema": {"name": "alternatives", "schema": {
        "type": "object",
        "properties": {"alternatives": {
            "type": "array", "items": item, "minItems": n, "maxItems": n,
        }},
        "required": ["alternatives"],
    }}}


def _parse_alternatives(content: str) -> list:
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        start, end = content.find("{"), content.rfind("}")
        if start < 0 or end <= start:
            raise
        payload = json.loads(content[start:end + 1])
    items = payload.get("alternatives") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        raise ValueError("no alternatives list")
    return items


def alternatives_count() -> int:
    """AV_ALTERNATIVES clamped to what the contract allows: 0 (off), 2 or 3."""
    count = int(_env_float("AV_ALTERNATIVES", 3))
    return 0 if count <= 0 else min(max(count, 2), 3)


async def request_alternatives(
    prompt: str,
    answer: str,
    reading: dict,
    *,
    n: int = 3,
    client: httpx.AsyncClient | None = None,
) -> dict | None:
    """An ``av_alternatives`` event for one ``av`` reading, or None.

    Qwen sees the task, the answer up to the checkpoint and the AV note, and
    proposes other steps of the same task in the reading's form. These are
    suggestions, not readings of the model's state.
    """
    note = reading.get("detail") or reading.get("explanation") or ""
    # One spare, so a candidate that repeats the reading can be dropped.
    asked = n + 1
    url, model, headers = _qwen_endpoint()
    task, example_answer, example_note, example_alternatives = _ALTERNATIVES_EXAMPLE
    messages = [
        {"role": "system", "content": _ALTERNATIVES_SYSTEM.format(n=asked)},
        {"role": "user", "content": _alternatives_request(task, example_answer, example_note)},
        {"role": "assistant", "content": json.dumps({"alternatives": example_alternatives[:asked]})},
        {"role": "user", "content": _alternatives_request(prompt, answer, note)},
    ]
    body = {
        "model": model, "messages": messages, "temperature": 0.7, "max_tokens": 320,
        "response_format": _alternatives_schema(asked),
    }
    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(timeout=httpx.Timeout(20.0))
    try:
        response = await client.post(url, headers=headers, json=body)
        if response.status_code == 400:  # No grammar backend: ask for plain JSON.
            body.pop("response_format")
            response = await client.post(url, headers=headers, json=body)
        response.raise_for_status()
        items = _parse_alternatives(response.json()["choices"][0]["message"]["content"])
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
        logger.warning("alternatives failed for %s: %s", reading.get("label"), exc)
        return None
    finally:
        if owns_client:
            await client.aclose()

    candidates = [
        (str(item.get("focus") or ""), str(item.get("detail") or "").strip())
        for item in items if isinstance(item, dict)
    ]
    candidates = [(focus, detail) for focus, detail in candidates if detail]

    async def label(focus: str, detail: str) -> str | None:
        focus = clean_focus(re.sub(r"\s*\([^)]*\)", "", focus), detail)
        if focus and focus.split()[0].endswith("ing"):
            return focus
        # Qwen often writes a noun phrase here ("veto override"); label the
        # detail the way readings are labeled instead.
        return await summarize_focus(detail)

    focuses = await asyncio.gather(*(label(*candidate) for candidate in candidates))
    seen = [reading["focus"]] if reading.get("focus") else []
    alternatives = []
    for focus, (_, detail) in zip(focuses, candidates):
        if not focus or any(similar_focus(focus, other) for other in seen):
            continue
        seen.append(focus)
        alternatives.append({"id": len(alternatives), "focus": focus, "detail": detail})
        if len(alternatives) == n:
            break
    if len(alternatives) < 2:
        logger.warning("alternatives for %s: only %d usable", reading.get("label"), len(alternatives))
        return None
    return AVAlternativesEvent(
        checkpoint_id=reading["checkpoint_id"], position=reading["position"],
        label=reading["label"], alternatives=alternatives,
    ).model_dump()


# The plan reads "<|im_start|>" before "assistant\n", two tokens before the
# prompt's end: in scripts/predict_eval.py its phrases matched their own answer
# 75% of the time vs 58% at the last token (12 prompts, chance 50%).
_PLAN_PROMPT_END_BACK = 2

_MAX_CHECKPOINTS = 6
# The first readings are taken at every step; later ones need this many
# characters since the previous checkpoint, spreading them over long answers.
_DENSE_CHECKPOINTS = 3
_SPREAD_GAP = 300
# After a hold, buffered text is released this many characters per tick.
_DRIP_CHARS = 12
_DRIP_SECONDS = 0.02


def _env_float(name: str, default: float) -> float:
    try:
        value = float(os.environ.get(name, default))
        return value if math.isfinite(value) and value >= 0 else default
    except ValueError:
        return default


async def run_qwen_stream(
    prompt: str,
    send: SendEvent,
    *,
    pace: bool = True,
    client: httpx.AsyncClient | None = None,
    av_client: httpx.AsyncClient | None = None,
    state: RunState | None = None,
    deltas: AsyncIterator[str] | None = None,
) -> None:
    """Bridge live Qwen text to the frontend, with AV readings before sections.

    Qwen is consumed at full speed into a buffer. With ``pace``, the display
    stays LOOKAHEAD characters behind Qwen, so each section's opening is known
    before any of it is shown. It first reads the prompt's end state ("Plan"),
    then holds at each section start until that section's reading arrives or
    AV_HOLD_TIMEOUT passes, and drips out buffered text afterwards. A reading
    still pending once all text is out is cancelled, not sent.

    Each reading also starts a request for alternative directions, sent after
    the reading itself; ones still running at status:done get AV_ALT_GRACE
    seconds more.

    ``state`` records the text, readings and alternatives for later steering.
    A branch passes its steered ``deltas`` and a ``state`` whose prefix is the
    parent text it continues: checkpoints are then found only after the
    prefix (the first is the new section itself), token positions continue
    from it, and readings replay the branch's steers.
    """
    state = state or RunState(run_id="", prompt=prompt)
    prefix = state.prefix
    hold_timeout = _env_float("AV_HOLD_TIMEOUT", 4.0)
    semaphore = asyncio.Semaphore(max(1, int(_env_float("AV_CONCURRENCY", 3))))
    alt_count = alternatives_count()
    # Separate from the AV slots: alternatives go to Qwen, not the sidecar.
    alt_semaphore = asyncio.Semaphore(max(1, int(_env_float("AV_ALT_CONCURRENCY", 2))))
    alt_grace = _env_float("AV_ALT_GRACE", 10.0)
    lookahead = LOOKAHEAD if pace else 0
    streamed = prefix  # The kept prefix and everything Qwen has produced since.
    streamed_done = False
    changed = asyncio.Event()
    checkpoints: list[tuple[Checkpoint, asyncio.Task[dict]]] = []
    sent: set[int] = set()
    shown: list[asyncio.Event] = []  # Set once a checkpoint's reading is sent.
    alt_tasks: list[tuple[int, asyncio.Task[None]]] = []
    announced = False  # Whether "streaming" has been sent.

    async def announce() -> None:
        nonlocal announced
        if not announced:
            announced = True
            await send(StatusEvent(state="streaming").model_dump(exclude_none=True))

    async def run_alternatives(checkpoint_id: int, answer: str, reading: dict) -> None:
        async with alt_semaphore:
            event = await request_alternatives(prompt, answer, reading, n=alt_count)
        if event is not None:
            state.checkpoints[checkpoint_id].alternatives = event["alternatives"]
            await shown[checkpoint_id].wait()  # Never before the reading itself.
            await send(event)

    async def run_av(checkpoint_id: int, checkpoint: Checkpoint, answer: str) -> dict:
        async with semaphore:
            reading = await _request_av(
                prompt, answer, checkpoint_id=checkpoint_id,
                checkpoint=checkpoint, client=av_client, steers=state.steers,
            )
        if reading["type"] == "av":
            state.checkpoints[checkpoint_id].reading = reading
            if alt_count:
                task = asyncio.create_task(run_alternatives(checkpoint_id, answer, reading))
                alt_tasks.append((checkpoint_id, task))
        return reading

    def schedule(checkpoint: Checkpoint, answer: str) -> None:
        state.checkpoints[len(checkpoints)] = CheckpointState(checkpoint)
        task = asyncio.create_task(
            run_av(len(checkpoints), checkpoint, answer[: checkpoint.sample_end])
        )
        checkpoints.append((checkpoint, task))
        shown.append(asyncio.Event())

    plan = pace and not prefix and state.parent_run_id is None

    async def produce() -> None:
        nonlocal streamed, streamed_done
        taken: set[int] = set()
        last_position = len(prefix) - 1  # A branch's first section starts at its prefix end.
        try:
            async for delta in deltas if deltas is not None else qwen_deltas(prompt, client=client):
                if not delta:
                    continue
                streamed += delta
                state.text = streamed
                answer = streamed
                while len(checkpoints) < _MAX_CHECKPOINTS:
                    sections = len(checkpoints) - (1 if plan else 0)  # Not the plan.
                    gap = 0 if sections < _DENSE_CHECKPOINTS else _SPREAD_GAP
                    checkpoint = next_checkpoint(answer, taken, last_position, gap)
                    if checkpoint is None:
                        break
                    schedule(checkpoint, answer)
                    taken.add(checkpoint.position)
                    last_position = checkpoint.position
                changed.set()
        finally:
            streamed_done = True
            changed.set()

    def released_pending(released: int) -> set[asyncio.Task[dict]]:
        return {
            task for checkpoint_id, (checkpoint, task) in enumerate(checkpoints)
            if checkpoint_id not in sent and checkpoint.position <= released and not task.done()
        }

    async def flush(released: int) -> None:
        """Send finished readings once the text before their section is out."""
        for checkpoint_id, (checkpoint, task) in enumerate(checkpoints):
            if checkpoint_id not in sent and checkpoint.position <= released and task.done():
                sent.add(checkpoint_id)
                await send(task.result())
                shown[checkpoint_id].set()

    async def hold(checkpoint_id: int, released: int) -> None:
        nonlocal announced
        checkpoint, task = checkpoints[checkpoint_id]
        if not task.done():
            await send(StatusEvent(
                state="inspecting", checkpoint_id=checkpoint_id, label=checkpoint.label
            ).model_dump(exclude_none=True))
            deadline = asyncio.get_running_loop().time() + hold_timeout
            while not task.done():
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    break
                # Earlier readings that missed their own hold can still land here;
                # a failed Qwen stream ends the hold at once.
                watch = {task} if producer.done() else {task, producer}
                await asyncio.wait(
                    released_pending(released) | watch,
                    timeout=remaining, return_when=asyncio.FIRST_COMPLETED,
                )
                await flush(released)
                if producer.done() and not producer.cancelled() and producer.exception():
                    break
            announced = True
            await send(StatusEvent(state="streaming").model_dump(exclude_none=True))
        await flush(released)

    if plan:
        schedule(PLAN, "")  # The prompt's end state, before any answer text.
    state.text = prefix
    producer = asyncio.create_task(produce())
    waiter: asyncio.Task[bool] | None = None
    try:
        index = 0
        released = len(prefix)
        next_hold = 0
        while True:
            changed.clear()
            text, done = streamed, streamed_done
            while pace and next_hold < len(checkpoints) and checkpoints[next_hold][0].position <= released:
                await hold(next_hold, released)
                next_hold += 1
            limit = len(text) if done else max(released, len(text) - lookahead)
            if pace and next_hold < len(checkpoints):
                limit = min(limit, checkpoints[next_hold][0].position)
            if limit > released:
                # Drip buffered text so a backlog after a hold reads as streaming.
                end = min(limit, released + _DRIP_CHARS) if pace else limit
                await announce()
                await send(TokenEvent(index=index, text=text[released:end], position=released).model_dump())
                index += 1
                released = end
                await flush(released)
                if pace and limit > released:
                    await asyncio.sleep(_DRIP_SECONDS)
                continue
            if done:
                break
            # Wake for new text, or for a reading of text already on screen.
            waiter = asyncio.create_task(changed.wait())
            await asyncio.wait(released_pending(released) | {waiter}, return_when=asyncio.FIRST_COMPLETED)
            waiter.cancel()
            await flush(released)
        await producer  # Re-raise a Qwen stream failure.
        await announce()
        while pace and next_hold < len(checkpoints):
            await hold(next_hold, released)
            next_hold += 1
        await flush(released)
        # Anything still running would describe text that is no longer on screen.
        await send(StatusEvent(
            state="done", av_dropped=len(checkpoints) - len(sent)
        ).model_dump(exclude_none=True))
        # Alternatives for readings on screen may still land after done.
        waiting = [task for checkpoint_id, task in alt_tasks if checkpoint_id in sent]
        if waiting:
            await asyncio.wait(waiting, timeout=alt_grace)
    except httpx.HTTPStatusError as exc:
        await send(
            StatusEvent(
                state="error", message=f"Qwen server returned HTTP {exc.response.status_code}"
            ).model_dump(exclude_none=True)
        )
    except (httpx.RequestError, ValueError) as exc:
        await send(
            StatusEvent(state="error", message=f"Qwen stream unavailable: {type(exc).__name__}").model_dump(exclude_none=True)
        )
    finally:
        pending: list[asyncio.Task[Any]] = [producer, *(task for _, task in checkpoints)]
        if waiter is not None:
            pending.append(waiter)
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        # Collected after the readings stop, so none can start another.
        for _, task in alt_tasks:
            task.cancel()
        await asyncio.gather(*(task for _, task in alt_tasks), return_exceptions=True)


async def _request_av(
    prompt: str,
    answer: str,
    *,
    checkpoint_id: int,
    checkpoint: Checkpoint,
    client: httpx.AsyncClient | None = None,
    steers: list[dict] | None = None,
) -> dict:
    """Return an ``av`` or ``av_error`` event for one answer checkpoint."""
    url = os.environ.get("AV_API_BASE", "http://127.0.0.1:30003").rstrip("/")
    location = {
        "checkpoint_id": checkpoint_id, "position": checkpoint.position,
        "label": checkpoint.label,
    }
    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=60.0, write=30.0, pool=10.0)
        )
    key = os.environ.get("AV_API_KEY")
    headers = {"Authorization": f"Bearer {key}"} if key else None
    body: dict = {"prompt": prompt, "answer": answer}
    if steers:  # A branch's reading replays the steers its text came from.
        body["steers"] = steers
    if checkpoint == PLAN:
        body["prompt_end_back"] = _PLAN_PROMPT_END_BACK
    try:
        response = await client.post(f"{url}/explain", headers=headers, json=body)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("AV returned an invalid response")
        event = AVEvent.model_validate({"type": "av", **payload, **location})
        event.genre, event.detail = split_explanation(event.explanation)
        # The genre opener alone is too often wrong to label.
        if event.detail:
            event.focus = await summarize_focus(event.detail)
        return event.model_dump()
    except Exception as exc:  # AV must never break the answer stream.
        return AVErrorEvent(message=f"AV unavailable: {type(exc).__name__}", **location).model_dump()
    finally:
        if owns_client:
            await client.aclose()
