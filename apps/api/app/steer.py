"""Steer a finished (or running) run from one of its checkpoints into a branch.

The user picks an alternative, types a direction, or asks to steer away from
the reading. Qwen writes the title the section would have in that direction,
spliced into the original opening's markup, and the sidecar turns original vs
target openings into a block-20 steer (/contrast). The branch streams from
the checkpoint through the same paced pipeline as a fresh run, so it gets its
own readings and can be steered again. The AR then scores how far the steered
state moved (/score).

Toward a direction, the branch is anchored: it opens with the target opening,
replayed under the steer, and the steer lets go where the opening ends. On
real answers the steer alone kept the text fluent and left the current focus,
but reached the named target only about a third of the time; anchored, the
section follows it. Away has no single destination, so it is not anchored.

Some directions push Qwen into a loop ("and and and", "Tal?>>[Tal?>>["). The
first stretch of every steered section is held back and checked; a looping
one is thrown away and regenerated from the same direction at half and then
a quarter of its size, and if that still loops, without the new steer.
"""

from __future__ import annotations

import json
import logging
import os
import re
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable

import httpx

from .checkpoints import PLAN
from .qwen_stream import RunState, SendEvent, _qwen_endpoint, run_qwen_stream
from .schemas import BranchEvent, SteerAckEvent, SteerMessage, SteerScoreEvent

logger = logging.getLogger(__name__)

_TITLE_SYSTEM = (
    "You name a section of an answer. Given the title of the section the answer was about to "
    "write and a new topic, reply with a title for the new topic in the same style and length "
    "as the original title. Reply with the title only."
)
_DIRECTION_SYSTEM = (
    "A user is steering a language model's answer at one point. You get the task, the title of "
    "the section the model was about to write, and the user's request for where to go instead. "
    "Turn the request into one concrete section: if it asks for the opposite of the current "
    "topic or to skip it, pick the specific section that should come instead. Reply only with "
    "JSON with three keys: focus (3 to 7 words starting with a lowercase -ing verb that name the "
    "new section's own topic, never what it skips), detail (one sentence on what the section "
    "covers) and title (the section's title, in the same style as the original title)."
)
_DIRECTION_EXAMPLE = (
    "Task: Plan a weekend trip to Paris.\nTitle: Book Your Flights\nRequest: skip travel, I live there",
    '{"focus": "exploring local neighborhoods", "detail": "The section suggests neighborhoods '
    'to explore on foot, with cafes and markets.", "title": "Explore Local Neighborhoods"}',
)
# An opening line is markup around a title: "### 1. " + "Determine Your Budget",
# or "1. **" + "Choose the Right Location" + "**:". Only the title is replaced,
# so the steer carries the topic and not a formatting difference.
_OPENING = re.compile(
    r"^(?P<head>\s*(?:#{1,6}\s*)?(?:(?:Step\s+)?\d{1,2}[.):]\s*)?(?:\*\*)?)"
    r"(?P<title>.*?)(?P<tail>(?:\*\*)?\s*:?\s*)$"
)


# Steered text held back and checked for a loop before any of it is sent.
_GUARD_CHARS = 200
# The new steer's size on each try; None: without it (the unsteered text).
_GUARD_SCALES: tuple[float | None, ...] = (1.0, 0.5, 0.25, None)
# A short unit repeated back to back ("and and and ", "Tal?>>[Tal?>>[").
_LOOP = re.compile(r"(\S.{0,15}?)\1{4,}", re.S)


def degenerate(text: str) -> bool:
    """Whether steered text has fallen into a loop or out of language."""
    # Units with a letter, so table rules and dividers ("| --- | --- |") pass.
    if any(len(match.group(0)) >= 24 and re.search("[A-Za-z]", match.group(1)) for match in _LOOP.finditer(text)):
        return True
    words = re.findall(r"[A-Za-z']+", text)
    if len(words) >= 12 and len({word.lower() for word in words}) / len(words) < 0.35:
        return True
    odd = sum(1 for char in text if not (char.isalnum() or char.isspace() or char in ".,:;!?'\"()-*#/&%$"))
    return len(text) >= 40 and odd / len(text) > 0.2


def _sidecar() -> tuple[str, dict[str, str]]:
    url = os.environ.get("AV_API_BASE", "http://127.0.0.1:30003").rstrip("/")
    key = os.environ.get("AV_API_KEY")
    return url, {"Authorization": f"Bearer {key}"} if key else {}


async def _chat(client: httpx.AsyncClient, messages: list[dict], max_tokens: int) -> str:
    url, model, headers = _qwen_endpoint()
    response = await client.post(url, headers=headers, json={
        "model": model, "messages": messages, "temperature": 0, "max_tokens": max_tokens,
    })
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"].strip()


def _first_line(text: str) -> str:
    return next((line.strip() for line in text.splitlines() if line.strip()), "")


def split_opening(opening: str) -> tuple[str, str, str]:
    """(markup before, title, markup after) of a section's opening line."""
    match = _OPENING.match(opening)
    if not match or not match["title"].strip():
        return "", opening, ""
    return match["head"], match["title"], match["tail"]


def _clean_title(title: str) -> str:
    title = _first_line(title).strip().strip('"').strip()
    return split_opening(title)[1].strip("*# :").strip()  # Drop markup Qwen may add.


async def write_opening(client: httpx.AsyncClient, original: str, focus: str, detail: str) -> str:
    """The original opening with its title replaced by one for ``focus``."""
    head, title, tail = split_opening(original)
    reply = await _chat(client, [
        {"role": "system", "content": _TITLE_SYSTEM},
        {"role": "user", "content": f"Original title: {title}\nNew topic: {focus}. {detail}"},
    ], 20)
    new = _clean_title(reply)
    if not new:
        raise ValueError("empty title")
    return head + new + tail


async def rewrite_direction(client: httpx.AsyncClient, prompt: str, original: str, request: str) -> dict:
    """A typed request as {focus, detail, opening}, with "the opposite" made concrete."""
    head, title, tail = split_opening(original)
    example, answer = _DIRECTION_EXAMPLE
    reply = await _chat(client, [
        {"role": "system", "content": _DIRECTION_SYSTEM},
        {"role": "user", "content": example},
        {"role": "assistant", "content": answer},
        {"role": "user", "content": f"Task: {prompt}\nTitle: {title}\nRequest: {request}"},
    ], 160)
    start, end = reply.find("{"), reply.rfind("}")
    parsed = json.loads(reply[start:end + 1])
    result = {key: str(parsed.get(key) or "").strip() for key in ("focus", "detail", "title")}
    title = _clean_title(result.pop("title"))
    if not all(result.values()) or not title:
        raise ValueError("incomplete direction")
    return {**result, "opening": head + title + tail}


def _branch_point(state: RunState, checkpoint_id: int):
    """Where a steer at this checkpoint branches. The plan's alternatives are
    other first sections, so a plan steer branches at the first section and
    keeps the answer's opening sentence."""
    checkpoint = state.checkpoints[checkpoint_id].checkpoint
    if checkpoint != PLAN:
        return checkpoint
    sections = sorted(
        (entry.checkpoint for entry in state.checkpoints.values() if entry.checkpoint != PLAN),
        key=lambda c: c.position,
    )
    return sections[0] if sections else None


async def _sidecar_stream(
    client: httpx.AsyncClient, prompt: str, prefix: str, steers: list[dict], new: dict,
) -> AsyncIterator[str]:
    """Text deltas from the sidecar's /steer; records where an unanchored
    steer let go."""
    url, headers = _sidecar()
    async with client.stream(
        "POST", f"{url}/steer", headers=headers,
        json={"prompt": prompt, "prefix": prefix, "steers": steers},
    ) as response:
        response.raise_for_status()
        async for line in response.aiter_lines():
            if not line:
                continue
            event = json.loads(line)
            if "released" in event:  # Before any text past it, so readings replay it.
                new["end_char"] = event["released"]
            elif event.get("text"):
                yield event["text"]


async def _steered_deltas(
    client: httpx.AsyncClient, prompt: str, prefix: str, steers: list[dict], new: dict,
    anchor: str = "", remake: Callable[[float], Awaitable[str]] | None = None,
) -> AsyncIterator[str]:
    """The anchor, then the steered text, its first stretch checked for a
    loop. ``steers`` ends with ``new``; a retry swaps new's direction for a
    smaller one (``remake``), or drops it, in place, so the run's readings
    replay what was actually generated."""
    if anchor:
        yield anchor
    released = new.get("end_char")
    for scale in _GUARD_SCALES:
        if scale is None:
            steers.remove(new)
        elif scale != 1.0:
            if remake is None:
                continue
            try:
                new["direction_id"] = await remake(scale)
            except (httpx.HTTPError, KeyError, ValueError) as exc:
                logger.warning("smaller steer unavailable: %s", exc)
                continue
        if released is None:
            new.pop("end_char", None)
        held: str | None = ""
        stream = _sidecar_stream(client, prompt, prefix + anchor, steers, new)
        try:
            async for text in stream:
                if held is None:
                    yield text
                    continue
                held += text
                if len(held) < _GUARD_CHARS:
                    continue
                if degenerate(held) and scale is not None:
                    break
                yield held
                held = None
            else:
                if held is not None and degenerate(held) and scale is not None:
                    raise _Looped
                if held:
                    yield held
                return
        except _Looped:
            pass
        finally:
            await stream.aclose()
        logger.warning("steered text looped at scale %s; retrying smaller", scale)


class _Looped(Exception):
    """The steered text looped before the stream ended."""


async def run_steer(
    parent: RunState,
    msg: SteerMessage,
    send: SendEvent,
    register: Callable[[RunState], None],
    *,
    pace: bool = True,
    client: httpx.AsyncClient | None = None,
) -> None:
    """Branch ``parent`` at ``msg.checkpoint_id`` and stream the steered run."""
    if client is None:
        timeout = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout) as owned:
            await _run_steer(parent, msg, send, register, pace, owned)
    else:
        await _run_steer(parent, msg, send, register, pace, client)


async def _run_steer(
    parent: RunState,
    msg: SteerMessage,
    send: SendEvent,
    register: Callable[[RunState], None],
    pace: bool,
    client: httpx.AsyncClient,
) -> None:
    async def refuse(message: str) -> None:
        await send({**SteerAckEvent(
            checkpoint_id=msg.checkpoint_id, alternative_id=msg.alternative_id,
            applied=False, message=message,
        ).model_dump(exclude_none=True), "run_id": parent.run_id})

    entry = parent.checkpoints.get(msg.checkpoint_id)
    if entry is None or entry.reading is None:
        await refuse("That reading is not available to steer from")
        return
    reading = entry.reading
    checkpoint = _branch_point(parent, msg.checkpoint_id)
    if checkpoint is None:
        await refuse("The answer has no section to steer yet")
        return
    prefix = parent.text[:checkpoint.position]
    original = parent.text[checkpoint.position:checkpoint.sample_end].strip()

    try:
        if msg.alternative_id is not None:
            alternatives = entry.alternatives or []
            if msg.alternative_id >= len(alternatives):
                await refuse("That direction is not available")
                return
            alternative = alternatives[msg.alternative_id]
            kind, focus, target_note = "toward", alternative["focus"], alternative["detail"]
            targets = [await write_opening(client, original, focus, alternative["detail"])]
            note = None
        elif msg.text is not None:
            direction = await rewrite_direction(client, parent.prompt, original, msg.text)
            kind, focus, target_note = "toward", direction["focus"], direction["detail"]
            targets, note = [direction["opening"]], direction["detail"]
        else:
            alternatives = entry.alternatives or []
            if not alternatives:
                await refuse("Steering away needs this reading's other directions first")
                return
            kind, focus, target_note, note = "away", reading.get("focus") or reading["label"], None, None
            targets = [
                await write_opening(client, original, a["focus"], a["detail"]) for a in alternatives
            ]

        # Steers still shaping the kept prefix; later ones belong to the text being replaced.
        inherited = [steer for steer in parent.steers if steer["start_char"] < len(prefix)]
        url, headers = _sidecar()
        contrast = {
            "prompt": parent.prompt, "prefix": prefix, "original": original,
            "targets": targets, "steers": inherited,
        }

        async def make_direction(scale: float = 1.0) -> str:
            body = contrast if scale == 1.0 else {**contrast, "scale": scale}
            response = await client.post(f"{url}/contrast", headers=headers, json=body)
            response.raise_for_status()
            return response.json()["direction_id"]

        direction_id = await make_direction()
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        logger.warning("steer setup failed: %s", exc)
        await refuse(f"Steering unavailable: {type(exc).__name__}")
        return

    anchor = targets[0] if kind == "toward" else ""
    new = {"direction_id": direction_id, "start_char": len(prefix)}
    if anchor:  # Replayed under the steer, which lets go where the opening ends.
        new["end_char"] = len(prefix) + len(anchor)
    child = RunState(
        run_id=uuid.uuid4().hex, prompt=parent.prompt, prefix=prefix,
        steers=[*inherited, new], parent_run_id=parent.run_id,
    )
    register(child)
    await send({**SteerAckEvent(
        checkpoint_id=msg.checkpoint_id, alternative_id=msg.alternative_id,
        applied=True, note=note,
    ).model_dump(exclude_none=True), "run_id": parent.run_id})
    await send(BranchEvent(
        run_id=child.run_id, parent_run_id=parent.run_id, checkpoint_id=msg.checkpoint_id,
        position=checkpoint.position, kind=kind, focus=focus, opening=anchor or None,
        anchored=bool(anchor),
    ).model_dump(exclude_none=True))

    async def send_child(event: dict) -> None:
        await send({**event, "run_id": child.run_id})

    await run_qwen_stream(
        parent.prompt, send_child, pace=pace, state=child,
        deltas=_steered_deltas(client, parent.prompt, prefix, child.steers, new, anchor, make_direction),
    )
    await _score(client, parent, child, checkpoint, reading["explanation"], target_note, send_child)


async def _score(
    client: httpx.AsyncClient, parent: RunState, child: RunState, checkpoint,
    current: str, target: str | None, send: SendEvent,
) -> None:
    """AR scores of the state at the section's opening, before and after the steer."""
    start, before_end = checkpoint.position, checkpoint.sample_end
    after_line = _first_line(child.text[start:])
    if not after_line:
        return
    after_end = child.text.index(after_line, start) + len(after_line)
    url, headers = _sidecar()
    try:
        response = await client.post(f"{url}/score", headers=headers, json={
            "prompt": parent.prompt, "current": current, "target": target,
            "reads": [
                {"answer": parent.text[:before_end], "steers": parent.steers},
                {"answer": child.text[:after_end], "steers": child.steers},
            ],
        })
        response.raise_for_status()
        before, after = response.json()["reads"]
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        logger.warning("steer score failed: %s", exc)
        return
    await send(SteerScoreEvent(before=before, after=after).model_dump(exclude_none=True))
