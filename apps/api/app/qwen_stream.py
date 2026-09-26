"""Stream Qwen's OpenAI-compatible chat completion into the browser socket."""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator, Awaitable, Callable

import httpx

from .schemas import StatusEvent, TokenEvent

SendEvent = Callable[[dict], Awaitable[None]]


async def qwen_deltas(
    prompt: str, *, client: httpx.AsyncClient | None = None
) -> AsyncIterator[str]:
    """Yield exact text deltas from SGLang's chat-completions SSE response."""
    base_url = os.environ.get("QWEN_API_BASE", "http://127.0.0.1:30001/v1").rstrip("/")
    model = os.environ.get("QWEN_MODEL", "qwen2.5-7b")
    api_key = os.environ.get("QWEN_API_KEY")
    headers = {"Accept": "text/event-stream"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    owns_client = client is None
    if client is None:
        client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)
        )

    try:
        async with client.stream(
            "POST",
            f"{base_url}/chat/completions",
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


async def run_qwen_stream(
    prompt: str, send: SendEvent, *, client: httpx.AsyncClient | None = None
) -> None:
    """Bridge live Qwen chunks to the existing frontend WebSocket shape."""
    index = 0
    position = 0
    try:
        async for delta in qwen_deltas(prompt, client=client):
            if not delta:
                continue
            if index == 0:
                await send(StatusEvent(state="streaming").model_dump())
            await send(TokenEvent(index=index, text=delta, position=position).model_dump())
            index += 1
            position += len(delta)
        if index == 0:
            await send(StatusEvent(state="streaming").model_dump())
        await send(StatusEvent(state="done").model_dump())
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
