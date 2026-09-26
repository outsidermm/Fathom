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
from app.qwen_stream import _send_av, qwen_deltas, run_qwen_stream


class SSEBody(httpx.AsyncByteStream):
    async def __aiter__(self) -> AsyncIterator[bytes]:
        for content in (None, "Hello", " world"):
            event = {"choices": [{"delta": {"content": content}}]}
            yield f"data: {json.dumps(event)}\n\n".encode()
            await asyncio.sleep(0)
        yield b"data: [DONE]\n\n"


class QwenStreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_av_payload_is_forwarded(self) -> None:
        requests: list[httpx.Request] = []
        events: list[dict] = []

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json={
                "explanation": "A short greeting.",
                "layer": 20,
                "sample": "replayed_last_content_token",
            })

        async def send(event: dict) -> None:
            events.append(event)

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            await _send_av("Say hello", "Hello", send, client=client)

        self.assertEqual(json.loads(requests[0].content), {
            "prompt": "Say hello", "answer": "Hello"
        })
        self.assertEqual(events[0]["explanation"], "A short greeting.")

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

    async def test_av_failure_keeps_the_answer(self) -> None:
        events: list[dict] = []

        async def send(event: dict) -> None:
            events.append(event)

        av_transport = httpx.MockTransport(lambda _: httpx.Response(503))
        async with httpx.AsyncClient(transport=av_transport) as av_client:
            async def fake_deltas(_prompt: str, *, client=None) -> AsyncIterator[str]:
                yield "Hello"

            with patch("app.qwen_stream.qwen_deltas", fake_deltas):
                await run_qwen_stream("Say hello", send, av_client=av_client)

        self.assertEqual([event["type"] for event in events], ["status", "token", "av_error", "status"])
        self.assertEqual(events[-1]["state"], "done")


class WebSocketBridgeTests(unittest.TestCase):
    def test_prompt_streams_qwen_text_to_websocket(self) -> None:
        async def fake_deltas(_prompt: str, *, client=None) -> AsyncIterator[str]:
            yield "Hello"
            yield " world"

        async def fake_av(_prompt: str, _answer: str, send, *, client=None) -> None:
            await send({"type": "av", "explanation": "The answer is a greeting.", "layer": 20, "sample": "replayed_last_content_token"})

        with patch("app.qwen_stream.qwen_deltas", fake_deltas), patch("app.qwen_stream._send_av", fake_av):
            with TestClient(app) as client:
                with client.websocket_connect("/ws/stream") as websocket:
                    self.assertEqual(websocket.receive_json()["state"], "idle")
                    websocket.send_json(
                        {"type": "start", "prompt": "Say hello", "model": "qwen2.5-7b"}
                    )
                    events = [websocket.receive_json() for _ in range(5)]

        self.assertEqual([event["type"] for event in events], ["status", "token", "token", "av", "status"])
        self.assertEqual([event["text"] for event in events if event["type"] == "token"], ["Hello", " world"])
        self.assertEqual(events[-2]["explanation"], "The answer is a greeting.")
        self.assertEqual(events[-1]["state"], "done")


if __name__ == "__main__":
    unittest.main()
