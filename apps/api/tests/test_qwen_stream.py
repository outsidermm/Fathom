"""Behavioral checks for Qwen SSE parsing and the browser WebSocket bridge."""

from __future__ import annotations

import asyncio
import json
import unittest
from collections.abc import AsyncIterator
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from app.main import app
from app.qwen_stream import qwen_deltas, run_qwen_stream


class SSEBody(httpx.AsyncByteStream):
    async def __aiter__(self) -> AsyncIterator[bytes]:
        for content in (None, "Hello", " world"):
            event = {"choices": [{"delta": {"content": content}}]}
            yield f"data: {json.dumps(event)}\n\n".encode()
            await asyncio.sleep(0)
        yield b"data: [DONE]\n\n"


class QwenStreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_exact_deltas_and_request(self) -> None:
        requests: list[httpx.Request] = []

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=SSEBody())

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            deltas = [delta async for delta in qwen_deltas("Say hello", client=client)]

        self.assertEqual(deltas, ["", "Hello", " world"])
        self.assertEqual(requests[0].url.path, "/v1/chat/completions")
        body = json.loads(requests[0].content)
        self.assertEqual(body["messages"], [{"role": "user", "content": "Say hello"}])
        self.assertTrue(body["stream"])

    async def test_upstream_failure_sends_error_without_fake_text(self) -> None:
        async def send(event: dict) -> None:
            events.append(event)

        events: list[dict] = []
        transport = httpx.MockTransport(lambda _: httpx.Response(503))
        async with httpx.AsyncClient(transport=transport) as client:
            await run_qwen_stream("hello", send, client=client)

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["type"], "status")
        self.assertEqual(events[0]["state"], "error")
        self.assertIn("503", events[0]["message"])


class WebSocketBridgeTests(unittest.TestCase):
    def test_prompt_streams_qwen_text_to_websocket(self) -> None:
        async def fake_deltas(_prompt: str, *, client=None) -> AsyncIterator[str]:
            yield "Hello"
            yield " world"

        with patch("app.qwen_stream.qwen_deltas", fake_deltas):
            with TestClient(app) as client:
                with client.websocket_connect("/ws/stream") as websocket:
                    self.assertEqual(websocket.receive_json()["state"], "idle")
                    websocket.send_json(
                        {"type": "start", "prompt": "Say hello", "model": "qwen2.5-7b"}
                    )
                    events = [websocket.receive_json() for _ in range(4)]

        self.assertEqual([event["type"] for event in events], ["status", "token", "token", "status"])
        self.assertEqual([event["text"] for event in events if event["type"] == "token"], ["Hello", " world"])
        self.assertEqual(events[-1]["state"], "done")


if __name__ == "__main__":
    unittest.main()
