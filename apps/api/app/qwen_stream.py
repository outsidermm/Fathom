"""Stream Qwen's OpenAI-compatible chat completion into the browser socket."""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import httpx

from .av_text import clean_focus, split_explanation
from .checkpoints import LOOKAHEAD, PLAN, Checkpoint, next_checkpoint
from .schemas import AVErrorEvent, AVEvent, StatusEvent, TokenEvent

SendEvent = Callable[[dict], Awaitable[None]]


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
    if "error" in event:
        raise ValueError("Qwen returned a streaming error")
    choices = event.get("choices") or []
    if not choices:
        return ""
    content = choices[0].get("delta", {}).get("content")
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
        return float(os.environ.get(name, default))
    except ValueError:
        return default


async def run_qwen_stream(
    prompt: str,
    send: SendEvent,
    *,
    pace: bool = True,
    client: httpx.AsyncClient | None = None,
    av_client: httpx.AsyncClient | None = None,
) -> None:
    """Bridge live Qwen text to the frontend, with AV readings before sections.

    Qwen is consumed at full speed into a buffer. With ``pace``, the display
    stays LOOKAHEAD characters behind Qwen, so each section's opening is known
    before any of it is shown. It first reads the prompt's end state ("Plan"),
    then holds at each section start until that section's reading arrives or
    AV_HOLD_TIMEOUT passes, and drips out buffered text afterwards. A reading
    still pending once all text is out is cancelled, not sent.
    """
    hold_timeout = _env_float("AV_HOLD_TIMEOUT", 4.0)
    semaphore = asyncio.Semaphore(max(1, int(_env_float("AV_CONCURRENCY", 3))))
    lookahead = LOOKAHEAD if pace else 0
    streamed = ""  # Everything Qwen has produced so far.
    streamed_done = False
    changed = asyncio.Event()
    checkpoints: list[tuple[Checkpoint, asyncio.Task[dict]]] = []
    sent: set[int] = set()
    announced = False  # Whether "streaming" has been sent.

    async def announce() -> None:
        nonlocal announced
        if not announced:
            announced = True
            await send(StatusEvent(state="streaming").model_dump(exclude_none=True))

    async def run_av(checkpoint_id: int, checkpoint: Checkpoint, prefix: str) -> dict:
        async with semaphore:
            return await _request_av(
                prompt, prefix, checkpoint_id=checkpoint_id,
                checkpoint=checkpoint, client=av_client,
            )

    def schedule(checkpoint: Checkpoint, answer: str) -> None:
        task = asyncio.create_task(
            run_av(len(checkpoints), checkpoint, answer[: checkpoint.sample_end])
        )
        checkpoints.append((checkpoint, task))

    async def produce() -> None:
        nonlocal streamed, streamed_done
        taken: set[int] = set()
        last_position = -1
        try:
            async for delta in qwen_deltas(prompt, client=client):
                if not delta:
                    continue
                streamed += delta
                answer = streamed
                while len(checkpoints) < _MAX_CHECKPOINTS:
                    sections = len(checkpoints) - (1 if pace else 0)  # Not the plan.
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

    if pace:
        schedule(PLAN, "")  # The prompt's end state, before any answer text.
    producer = asyncio.create_task(produce())
    waiter: asyncio.Task[bool] | None = None
    try:
        index = 0
        released = 0
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
    except httpx.HTTPStatusError as exc:
        await send(
            StatusEvent(
                state="error", message=f"Qwen server returned HTTP {exc.response.status_code}"
            ).model_dump()
        )
    except (httpx.RequestError, ValueError) as exc:
        await send(
            StatusEvent(state="error", message=f"Qwen stream unavailable: {type(exc).__name__}").model_dump()
        )
    finally:
        pending: list[asyncio.Task[Any]] = [producer, *(task for _, task in checkpoints)]
        if waiter is not None:
            pending.append(waiter)
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)


async def _request_av(
    prompt: str,
    answer: str,
    *,
    checkpoint_id: int,
    checkpoint: Checkpoint,
    client: httpx.AsyncClient | None = None,
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
