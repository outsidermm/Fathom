"""Behavioral checks for Qwen SSE parsing, AV checkpoints, and the WebSocket bridge."""

from __future__ import annotations

import asyncio
import json
import unittest
from collections.abc import AsyncIterator
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from app.av_text import clean_focus, split_explanation
from app.checkpoints import PLAN, Checkpoint, next_checkpoint
from app.main import app
from app.qwen_stream import (
    _request_av,
    alternatives_count,
    qwen_deltas,
    request_alternatives,
    run_qwen_stream,
    summarize_focus,
)


class SSEBody(httpx.AsyncByteStream):
    async def __aiter__(self) -> AsyncIterator[bytes]:
        for content in (None, "Hello", " world"):
            event = {"choices": [{"delta": {"content": content}}]}
            yield f"data: {json.dumps(event)}\n\n".encode()
            await asyncio.sleep(0)
        yield b"data: [DONE]\n\n"


INTRO = "Sure, here are the steps to buy a used car:\n\n"
STEP_1 = "1. **Budget**: Set a realistic spending limit that includes insurance and maintenance costs.\n"
STEP_2 = "2. **Research**: Compare vehicles that meet your needs and price range.\n"
STEP_3 = "3. **Inspect**: Ask a mechanic to look for expensive mechanical problems.\n"
ANSWER = INTRO + STEP_1 + STEP_2 + STEP_3


def av_event(checkpoint_id: int, checkpoint: Checkpoint, explanation: str = "Reading.") -> dict:
    return {
        "type": "av", "explanation": explanation, "layer": 20,
        "sample": "replayed_last_content_token", "checkpoint_id": checkpoint_id,
        "position": checkpoint.position, "label": checkpoint.label,
    }


def alternatives_event(reading: dict) -> dict:
    return {
        "type": "av_alternatives", "checkpoint_id": reading["checkpoint_id"],
        "position": reading["position"], "label": reading["label"],
        "alternatives": [
            {"id": 0, "focus": "weighing vehicle types", "detail": "Vehicle type."},
            {"id": 1, "focus": "comparing financing options", "detail": "Financing."},
        ],
    }


async def no_alternatives(*_args, **_kwargs) -> None:
    return None


def patch_alternatives(test: unittest.TestCase, fake=no_alternatives) -> None:
    """Keep tests offline: .env points request_alternatives at the live Pod."""
    patcher = patch("app.qwen_stream.request_alternatives", fake)
    patcher.start()
    test.addCleanup(patcher.stop)


def chunks(text: str, size: int = 25) -> list[str]:
    return [text[i : i + size] for i in range(0, len(text), size)]


def streaming(*parts: str, delay: float = 0.0):
    async def fake_deltas(_prompt: str, *, client=None) -> AsyncIterator[str]:
        for part in parts:
            yield part
            await asyncio.sleep(delay)
    return fake_deltas


class CheckpointTests(unittest.TestCase):
    def test_sections_start_at_steps_and_read_their_lead(self) -> None:
        first = next_checkpoint(ANSWER, set(), -1)
        assert first is not None
        self.assertEqual((first.label, first.position), ("Step 1", len(INTRO)))
        self.assertEqual(ANSWER[first.position : first.sample_end], "1. **Budget**:")
        second = next_checkpoint(ANSWER, {first.position}, first.position)
        assert second is not None
        self.assertEqual(ANSWER[second.position : second.sample_end], "2. **Research**:")

    def test_a_section_waits_for_its_whole_lead(self) -> None:
        self.assertIsNone(next_checkpoint(INTRO + "1.", set(), -1))
        self.assertIsNone(next_checkpoint(INTRO + "1. **Budg", set(), -1))
        self.assertIsNone(next_checkpoint(INTRO + "### 1.", set(), -1))

    def test_headings_and_prose(self) -> None:
        heading = next_checkpoint("Great idea!\n\n### Budget\nPlan your spending.\n", set(), -1)
        assert heading is not None
        self.assertEqual(heading.label, "Section")
        prose = "Plants make their own food. They use sunlight, water, and air to do it. " * 3
        sentence = next_checkpoint(prose, set(), -1)
        assert sentence is not None
        self.assertEqual(prose[sentence.position : sentence.sample_end], "They use sunlight")
        self.assertGreaterEqual(sentence.position, 100)

    def test_plan_reads_the_prompt_end(self) -> None:
        self.assertEqual((PLAN.position, PLAN.sample_end), (0, 0))


class QwenStreamTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.events: list[dict] = []
        patch_alternatives(self)

    async def send(self, event: dict) -> None:
        self.events.append(event)

    def kinds(self) -> list[str]:
        return [event["type"] for event in self.events]

    def av_labels(self) -> list[str]:
        return [event["label"] for event in self.events if event["type"] == "av"]

    def assert_readings_precede_their_sections(self) -> None:
        """Each reading comes after all text before its section and before any of it."""
        released = 0
        for event in self.events:
            if event["type"] == "token":
                self.assertEqual(event["position"], released)
                released += len(event["text"])
            elif event["type"] == "av":
                self.assertEqual(released, event["position"], event["label"])

    async def test_readings_are_shown_before_their_sections(self) -> None:
        async def fake_av(_prompt, answer, *, checkpoint_id, checkpoint, client=None):
            await asyncio.sleep(0.02)
            return av_event(checkpoint_id, checkpoint)

        with patch("app.qwen_stream.qwen_deltas", streaming(*chunks(ANSWER))), \
                patch("app.qwen_stream._request_av", fake_av):
            await run_qwen_stream("Help buy a car", self.send)

        self.assertEqual(self.av_labels(), ["Plan", "Step 1", "Step 2", "Step 3"])
        self.assert_readings_precede_their_sections()
        self.assertEqual("".join(e["text"] for e in self.events if e["type"] == "token"), ANSWER)
        self.assertEqual(self.events[-1], {"type": "status", "state": "done", "av_dropped": 0})

    async def test_plan_reading_comes_before_any_text(self) -> None:
        answers: dict[str, str] = {}

        async def fake_av(_prompt, answer, *, checkpoint_id, checkpoint, client=None):
            answers[checkpoint.label] = answer
            return av_event(checkpoint_id, checkpoint)

        with patch("app.qwen_stream.qwen_deltas", streaming(*chunks(ANSWER))), \
                patch("app.qwen_stream._request_av", fake_av):
            await run_qwen_stream("Help buy a car", self.send)

        self.assertLess(self.kinds().index("av"), self.kinds().index("token"))
        self.assertEqual(answers["Plan"], "")  # The prompt's end state.
        self.assertEqual(answers["Step 2"], INTRO + STEP_1 + "2. **Research**:")

    async def test_hold_timeout_releases_text_and_late_reading_still_lands(self) -> None:
        async def fake_av(_prompt, _answer, *, checkpoint_id, checkpoint, client=None):
            await asyncio.sleep(0.15 if checkpoint.label == "Step 1" else 0)
            return av_event(checkpoint_id, checkpoint)

        with patch.dict("os.environ", {"AV_HOLD_TIMEOUT": "0.05"}), \
                patch("app.qwen_stream.qwen_deltas", streaming(*chunks(ANSWER), delay=0.01)), \
                patch("app.qwen_stream._request_av", fake_av):
            await run_qwen_stream("Help buy a car", self.send)

        step_1 = next(e for e in self.events if e.get("label") == "Step 1" and e["type"] == "av")
        before = self.events[: self.events.index(step_1)]
        shown = sum(len(e["text"]) for e in before if e["type"] == "token")
        self.assertGreater(shown, step_1["position"])  # Its section had started.
        self.assertEqual(self.events[-1]["av_dropped"], 0)

    async def test_reading_that_misses_the_answer_is_dropped(self) -> None:
        release = asyncio.Event()

        async def fake_av(_prompt, _answer, *, checkpoint_id, checkpoint, client=None):
            await release.wait()
            return av_event(checkpoint_id, checkpoint)

        with patch("app.qwen_stream.qwen_deltas", streaming(*chunks(ANSWER))), \
                patch("app.qwen_stream._request_av", fake_av):
            await asyncio.wait_for(run_qwen_stream("Help buy a car", self.send, pace=False), timeout=1)
            release.set()
            await asyncio.sleep(0.01)

        self.assertNotIn("av", self.kinds())
        self.assertEqual(self.events[-1], {"type": "status", "state": "done", "av_dropped": 3})

    async def test_unpaced_runs_have_no_plan_and_no_holds(self) -> None:
        async def fake_av(_prompt, _answer, *, checkpoint_id, checkpoint, client=None):
            return av_event(checkpoint_id, checkpoint)

        with patch("app.qwen_stream.qwen_deltas", streaming(*chunks(ANSWER), delay=0.01)), \
                patch("app.qwen_stream._request_av", fake_av):
            await run_qwen_stream("Help buy a car", self.send, pace=False)

        self.assertNotIn("Plan", self.av_labels())
        self.assertNotIn("inspecting", [e.get("state") for e in self.events])

    async def test_concurrency_is_capped(self) -> None:
        running = 0
        peak = 0

        async def fake_av(_prompt, _answer, *, checkpoint_id, checkpoint, client=None):
            nonlocal running, peak
            running += 1
            peak = max(peak, running)
            await asyncio.sleep(0.02)
            running -= 1
            return av_event(checkpoint_id, checkpoint)

        with patch.dict("os.environ", {"AV_CONCURRENCY": "2"}), \
                patch("app.qwen_stream.qwen_deltas", streaming(ANSWER)), \
                patch("app.qwen_stream._request_av", fake_av):
            await run_qwen_stream("Help buy a car", self.send)

        self.assertEqual(peak, 2)
        self.assertEqual(len(self.av_labels()), 4)

    async def test_long_lists_spread_their_checkpoints(self) -> None:
        steps = "".join(
            f"{i}. **Step{i}**: Do the important thing carefully and think about what it costs you here.\n"
            for i in range(1, 12)
        )

        async def fake_av(_prompt, _answer, *, checkpoint_id, checkpoint, client=None):
            return av_event(checkpoint_id, checkpoint)

        with patch("app.qwen_stream.qwen_deltas", streaming(*chunks(INTRO + steps))), \
                patch("app.qwen_stream._request_av", fake_av):
            await run_qwen_stream("Many steps", self.send)

        labels = self.av_labels()
        self.assertEqual(labels[:4], ["Plan", "Step 1", "Step 2", "Step 3"])
        self.assertLessEqual(len(labels), 6)
        self.assertGreater(int(labels[-1].split()[1]), 5)  # Reaches the second half.
        self.assert_readings_precede_their_sections()

    async def test_cancelled_run_does_not_emit_late_av(self) -> None:
        av_started = asyncio.Event()

        async def fake_av(_prompt, _answer, *, checkpoint_id, checkpoint, client=None):
            av_started.set()
            await asyncio.sleep(60)
            return av_event(checkpoint_id, checkpoint)

        async def slow_deltas(_prompt: str, *, client=None) -> AsyncIterator[str]:
            yield ANSWER
            await asyncio.sleep(60)

        with patch("app.qwen_stream.qwen_deltas", slow_deltas), \
                patch("app.qwen_stream._request_av", fake_av):
            run = asyncio.create_task(run_qwen_stream("Help buy a car", self.send))
            await asyncio.wait_for(av_started.wait(), timeout=1)
            run.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await run

        self.assertNotIn("av", self.kinds())

    async def test_av_payload_is_forwarded(self) -> None:
        requests: list[httpx.Request] = []

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json={
                "explanation": "Structured list format. The text sets a car budget.",
                "layer": 20, "sample": "replayed_last_content_token",
                "replay_ms": 40, "av_ms": 900,
            })

        async def fake_focus(note, *, client=None):
            self.assertEqual(note, "The text sets a car budget.")  # Only the AV note.
            return "setting a car budget"

        with patch.dict("os.environ", {"AV_API_KEY": "secret"}), \
                patch("app.qwen_stream.summarize_focus", fake_focus):
            async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
                event = await _request_av(
                    "Help buy a car", "1. **Budget**:", checkpoint_id=0,
                    checkpoint=Checkpoint(0, 14, "Step 1"), client=client,
                )

        self.assertEqual(json.loads(requests[0].content), {
            "prompt": "Help buy a car", "answer": "1. **Budget**:",
        })
        self.assertEqual(requests[0].headers["authorization"], "Bearer secret")
        self.assertEqual(event["position"], 0)
        self.assertEqual(event["detail"], "The text sets a car budget.")
        self.assertEqual(event["focus"], "setting a car budget")

    async def test_plan_reads_before_the_assistant_header(self) -> None:
        bodies: list[dict] = []

        def respond(request: httpx.Request) -> httpx.Response:
            bodies.append(json.loads(request.content))
            return httpx.Response(200, json={"explanation": "Only a genre sentence."})

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            await _request_av("Help buy a car", "", checkpoint_id=0, checkpoint=PLAN, client=client)
            await _request_av("Help buy a car", "1. **Budget**:", checkpoint_id=1,
                              checkpoint=Checkpoint(0, 14, "Step 1"), client=client)

        self.assertEqual(bodies[0]["prompt_end_back"], 2)
        self.assertNotIn("prompt_end_back", bodies[1])

    async def test_focus_is_summarized_from_the_note_alone(self) -> None:
        requests: list[httpx.Request] = []

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, json={
                "choices": [{"message": {"content": '"Advising to determine a budget."'}}]
            })

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            focus = await summarize_focus("The sentence introduces budget considerations.", client=client)

        body = json.loads(requests[0].content)
        self.assertEqual(body["messages"][-1]["content"], "The sentence introduces budget considerations.")
        self.assertEqual(body["temperature"], 0)
        self.assertEqual(focus, "advising to determine a budget")

    async def test_focus_failure_is_none(self) -> None:
        transport = httpx.MockTransport(lambda _: httpx.Response(503))
        async with httpx.AsyncClient(transport=transport) as client:
            self.assertIsNone(await summarize_focus("A note.", client=client))
        self.assertIsNone(clean_focus("budget"))  # Too short to be a phrase.
        self.assertIsNone(clean_focus(" ".join(["word"] * 12)))
        self.assertEqual(clean_focus("Weighing vehicle types\nextra"), "weighing vehicle types")
        self.assertEqual(
            clean_focus("stating london's role", "It notes London's role, not Canberra's."),
            "stating London's role",
        )
        self.assertEqual(
            clean_focus("planning the trip itinerary", 'The heading "Plan the Trip Itinerary" begins a section.'),
            "planning the trip itinerary",
        )

    async def test_explanation_split(self) -> None:
        genre, detail = split_explanation(
            'Structured article format with sections. The text "While Canberra was chosen" '
            "compares Ottawa and London in 1908, as a compromise."
        )
        self.assertEqual(genre, "Structured article format with sections.")
        self.assertTrue(detail.startswith("The text"))
        self.assertEqual(split_explanation("Only a genre sentence."), ("Only a genre sentence.", ""))

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
        async def fake_av(_prompt, _answer, *, checkpoint_id, checkpoint, client=None):
            await asyncio.sleep(60)
            return av_event(checkpoint_id, checkpoint)

        transport = httpx.MockTransport(lambda _: httpx.Response(503))
        with patch("app.qwen_stream._request_av", fake_av):
            async with httpx.AsyncClient(transport=transport) as client:
                await asyncio.wait_for(run_qwen_stream("hello", self.send, client=client), timeout=1)

        self.assertNotIn("token", self.kinds())
        self.assertEqual(self.events[-1]["state"], "error")
        self.assertIn("503", self.events[-1]["message"])

    async def test_av_failure_keeps_the_answer(self) -> None:
        av_transport = httpx.MockTransport(lambda _: httpx.Response(503))
        async with httpx.AsyncClient(transport=av_transport) as av_client:
            with patch("app.qwen_stream.qwen_deltas", streaming(*chunks(ANSWER))):
                await run_qwen_stream("Help buy a car", self.send, av_client=av_client)

        self.assertIn("av_error", self.kinds())
        self.assertEqual("".join(e["text"] for e in self.events if e["type"] == "token"), ANSWER)
        self.assertEqual(self.events[-1]["state"], "done")


class AlternativesTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.events: list[dict] = []

    async def send(self, event: dict) -> None:
        self.events.append(event)

    def kinds(self) -> list[str]:
        return [event["type"] for event in self.events]

    async def run_stream(self, fake_alternatives, fake_av=None, **options) -> None:
        async def instant_av(_prompt, _answer, *, checkpoint_id, checkpoint, client=None):
            return av_event(checkpoint_id, checkpoint)

        with patch("app.qwen_stream.qwen_deltas", streaming(*chunks(ANSWER))), \
                patch("app.qwen_stream._request_av", fake_av or instant_av), \
                patch("app.qwen_stream.request_alternatives", fake_alternatives):
            await run_qwen_stream("Help buy a car", self.send, **options)

    async def test_alternatives_follow_their_reading(self) -> None:
        prefixes: dict[str, str] = {}

        async def fake_alternatives(_prompt, answer, reading, *, n, client=None):
            prefixes[reading["label"]] = answer
            return alternatives_event(reading)  # Ready before later readings are shown.

        await self.run_stream(fake_alternatives)

        readings = [e for e in self.events if e["type"] == "av"]
        options = [e for e in self.events if e["type"] == "av_alternatives"]
        self.assertEqual([e["checkpoint_id"] for e in options], [e["checkpoint_id"] for e in readings])
        for option in options:
            reading = next(e for e in readings if e["checkpoint_id"] == option["checkpoint_id"])
            self.assertLess(self.events.index(reading), self.events.index(option))
            self.assertEqual(option["position"], reading["position"])
        self.assertEqual(prefixes["Plan"], "")
        self.assertEqual(prefixes["Step 2"], INTRO + STEP_1 + "2. **Research**:")

    async def test_failed_readings_get_no_alternatives(self) -> None:
        calls = 0

        async def failing_av(_prompt, _answer, *, checkpoint_id, checkpoint, client=None):
            return {"type": "av_error", "message": "AV unavailable", "checkpoint_id": checkpoint_id,
                    "position": checkpoint.position, "label": checkpoint.label}

        async def fake_alternatives(*_args, **_kwargs):
            nonlocal calls
            calls += 1

        await self.run_stream(fake_alternatives, failing_av)
        self.assertEqual(calls, 0)
        self.assertEqual(self.events[-1]["state"], "done")

    async def test_late_alternatives_are_sent_after_done(self) -> None:
        async def after_done(_prompt, _answer, reading, *, n, client=None):
            while not any(e.get("state") == "done" for e in self.events):
                await asyncio.sleep(0.005)
            return alternatives_event(reading)

        await self.run_stream(after_done)

        done = next(i for i, e in enumerate(self.events) if e.get("state") == "done")
        self.assertEqual(self.kinds()[done + 1:], ["av_alternatives"] * 4)

    async def test_grace_bounds_the_wait_after_done(self) -> None:
        cancelled = asyncio.Event()

        async def stuck_alternatives(*_args, **_kwargs):
            try:
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                cancelled.set()
                raise

        with patch.dict("os.environ", {"AV_ALT_GRACE": "0.05"}):
            await asyncio.wait_for(self.run_stream(stuck_alternatives), timeout=2)

        self.assertNotIn("av_alternatives", self.kinds())
        self.assertEqual(self.events[-1]["state"], "done")
        self.assertTrue(cancelled.is_set())

    async def test_cancelled_run_emits_no_alternatives(self) -> None:
        started = asyncio.Event()

        async def slow_alternatives(_prompt, _answer, reading, *, n, client=None):
            started.set()
            await asyncio.sleep(60)
            return alternatives_event(reading)

        run = asyncio.create_task(self.run_stream(slow_alternatives))
        await asyncio.wait_for(started.wait(), timeout=1)
        run.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await run
        self.assertNotIn("av_alternatives", self.kinds())

    async def test_zero_disables_alternatives(self) -> None:
        calls = 0

        async def fake_alternatives(*_args, **_kwargs):
            nonlocal calls
            calls += 1

        with patch.dict("os.environ", {"AV_ALTERNATIVES": "0"}):
            await self.run_stream(fake_alternatives)
        self.assertEqual(calls, 0)
        for value, count in (("0", 0), ("1", 2), ("2", 2), ("3", 3), ("9", 3), ("x", 3)):
            with patch.dict("os.environ", {"AV_ALTERNATIVES": value}):
                self.assertEqual(alternatives_count(), count, value)

    async def test_request_carries_task_prefix_and_note(self) -> None:
        bodies: list[dict] = []
        reply = {"alternatives": [
            {"focus": "Setting your car budget (step 1)", "detail": "Near the reading."},
            {"focus": "weighing what type of vehicle fits", "detail": "Vehicle type, size, seats."},
            {"focus": "Weighing what type of vehicle fits.", "detail": "A duplicate."},
            {"focus": "comparing loan and lease financing", "detail": "Loans and leases."},
            {"focus": "planning a dealership visit (Saturday)", "detail": "Test drives."},
            {"focus": "estimating insurance costs", "detail": "Beyond the quota."},
        ]}

        def respond(request: httpx.Request) -> httpx.Response:
            bodies.append(json.loads(request.content))
            return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(reply)}}]})

        reading = {**av_event(2, Checkpoint(71, 90, "Step 1")),
                   "detail": "The text sets a car budget.", "focus": "setting a car budget"}
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            event = await request_alternatives(
                "Help buy a car", "1. **Budget**:", reading, n=3, client=client,
            )

        request = bodies[0]["messages"][-1]["content"]
        for part in ("Help buy a car", "1. **Budget**:", "The text sets a car budget."):
            self.assertIn(part, request)
        schema = bodies[0]["response_format"]["json_schema"]["schema"]
        self.assertEqual(schema["properties"]["alternatives"]["maxItems"], 4)  # One spare.
        self.assertEqual(
            (event["checkpoint_id"], event["position"], event["label"]), (2, 71, "Step 1")
        )
        self.assertEqual([a["focus"] for a in event["alternatives"]], [
            "weighing what type of vehicle fits", "comparing loan and lease financing",
            "planning a dealership visit",
        ])
        self.assertEqual([a["id"] for a in event["alternatives"]], [0, 1, 2])

    async def test_request_falls_back_without_json_mode(self) -> None:
        bodies: list[dict] = []
        content = 'Here you go: {"alternatives": [{"focus": "weighing vehicle types", ' \
                  '"detail": "Types."}, {"focus": "planning a dealership visit", "detail": "Visit."}]}'

        def respond(request: httpx.Request) -> httpx.Response:
            bodies.append(json.loads(request.content))
            if "response_format" in bodies[-1]:
                return httpx.Response(400)
            return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            event = await request_alternatives(
                "Help buy a car", "", av_event(0, PLAN), n=2, client=client,
            )

        self.assertEqual(len(bodies), 2)
        self.assertEqual(len(event["alternatives"]), 2)

    async def test_noun_focus_is_relabeled_from_its_detail(self) -> None:
        reply = {"alternatives": [
            {"focus": "veto override", "detail": "Congress overrides a veto by two thirds."},
            {"focus": "weighing committee amendments", "detail": "Committees amend the bill."},
        ]}
        transport = httpx.MockTransport(lambda _: httpx.Response(
            200, json={"choices": [{"message": {"content": json.dumps(reply)}}]}
        ))
        notes: list[str] = []

        async def fake_focus(note, *, client=None):
            notes.append(note)
            return "overriding a presidential veto"

        with patch("app.qwen_stream.summarize_focus", fake_focus):
            async with httpx.AsyncClient(transport=transport) as client:
                event = await request_alternatives(
                    "How does a bill become law?", "", av_event(0, PLAN), n=2, client=client,
                )

        self.assertEqual(notes, ["Congress overrides a veto by two thirds."])
        self.assertEqual([a["focus"] for a in event["alternatives"]], [
            "overriding a presidential veto", "weighing committee amendments",
        ])

    async def test_request_failures_are_none(self) -> None:
        replies = [
            httpx.Response(503),
            httpx.Response(200, json={"choices": [{"message": {"content": "not json"}}]}),
            httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(
                {"alternatives": [{"focus": "weighing vehicle types", "detail": "Only one."}]}
            )}}]}),
        ]
        for reply in replies:
            transport = httpx.MockTransport(lambda _, reply=reply: reply)
            async with httpx.AsyncClient(transport=transport) as client:
                with self.assertLogs("app.qwen_stream", "WARNING"):
                    self.assertIsNone(await request_alternatives(
                        "Help buy a car", "", av_event(0, PLAN), client=client,
                    ))


class WebSocketBridgeTests(unittest.TestCase):
    def setUp(self) -> None:
        patch_alternatives(self)

    def test_prompt_streams_qwen_text_to_websocket(self) -> None:
        async def fake_av(_prompt: str, _answer: str, *, checkpoint_id, checkpoint, client=None) -> dict:
            return av_event(checkpoint_id, checkpoint, "The answer is a greeting.")

        with patch("app.qwen_stream.qwen_deltas", streaming("Hello", " world")), \
                patch("app.qwen_stream._request_av", fake_av):
            with TestClient(app) as client:
                with client.websocket_connect("/ws/stream") as websocket:
                    self.assertEqual(websocket.receive_json()["state"], "idle")
                    websocket.send_json(
                        {"type": "start", "prompt": "Say hello", "model": "qwen2.5-7b"}
                    )
                    events = []
                    while not events or events[-1].get("state") not in ("done", "error"):
                        events.append(websocket.receive_json())

        kinds = [event["type"] for event in events]
        self.assertLess(kinds.index("av"), kinds.index("token"))  # The plan, before any text.
        self.assertEqual("".join(e["text"] for e in events if e["type"] == "token"), "Hello world")
        self.assertEqual(events[-1]["state"], "done")


if __name__ == "__main__":
    unittest.main()
