"""Behavioral checks for steering: branch events, steer stacks, and refusals."""

from __future__ import annotations

import asyncio
import json
import unittest

import httpx
from pydantic import ValidationError

from app.checkpoints import PLAN, Checkpoint, next_checkpoint
from app.qwen_stream import CheckpointState, RunState
from app.schemas import SteerMessage
from app.steer import run_steer, split_opening
from tests.test_qwen_stream import ANSWER, INTRO, STEP_1, patch_alternatives

STEP_1_AT = next_checkpoint(ANSWER, set(), -1)
STEP_2_AT = next_checkpoint(ANSWER, {STEP_1_AT.position}, STEP_1_AT.position)
ANCHOR = "1. **Credit**:"
STEERED = ANCHOR + " Check your credit report before you apply for a loan.\n" \
          "2. **Shop**: Compare lenders and dealers.\n"
ALTERNATIVES = [
    {"id": 0, "focus": "checking your credit score", "detail": "The step checks credit first."},
    {"id": 1, "focus": "visiting dealerships", "detail": "The step visits dealers."},
]


def reading(checkpoint_id: int, checkpoint: Checkpoint) -> dict:
    return {
        "type": "av", "explanation": "Budget note. The phrase sets a budget.", "genre": "Budget note.",
        "detail": "The phrase sets a budget.", "focus": "setting a budget", "layer": 20,
        "sample": "replayed_last_content_token", "checkpoint_id": checkpoint_id,
        "position": checkpoint.position, "label": checkpoint.label,
    }


def parent_run(steers: list[dict] | None = None) -> RunState:
    state = RunState(run_id="parent", prompt="Help buy a car", text=ANSWER, steers=steers or [])
    state.checkpoints[0] = CheckpointState(STEP_1_AT, reading(0, STEP_1_AT), ALTERNATIVES)
    state.checkpoints[1] = CheckpointState(STEP_2_AT, reading(1, STEP_2_AT), ALTERNATIVES)
    return state


class FakeBackends:
    """Qwen chat completions and the sidecar's /contrast, /steer and /score."""

    def __init__(self, chat_reply: str = "1. **Credit**:") -> None:
        self.chat_reply = chat_reply
        self.requests: dict[str, list[dict]] = {}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.rsplit("/", 1)[-1]
        body = json.loads(request.content)
        self.requests.setdefault(path, []).append(body)
        if path == "completions":
            return httpx.Response(200, json={"choices": [{"message": {"content": self.chat_reply}}]})
        if path == "contrast":
            return httpx.Response(200, json={"direction_id": f"d{len(self.requests['contrast'])}", "sizes": {}})
        if path == "steer":
            if body["prefix"].endswith(ANCHOR):  # Anchored: continue after the opening.
                lines = [{"text": STEERED[len(ANCHOR):]}, {"done": True, "end_char": None}]
            else:
                lead = STEERED.index("\n")
                lines = [{"text": STEERED[:lead]}, {"released": len(body["prefix"]) + lead},
                         {"text": STEERED[lead:]}, {"done": True, "end_char": len(body["prefix"]) + lead}]
            return httpx.Response(200, content="".join(json.dumps(line) + "\n" for line in lines))
        if path == "score":
            return httpx.Response(200, json={"reads": [{"current": 0.41, "target": 0.27},
                                                       {"current": 0.27, "target": 0.31}]})
        return httpx.Response(404)


class SteerTests(unittest.TestCase):
    def setUp(self) -> None:
        patch_alternatives(self)
        self.readings: list[dict] = []

    async def fake_av(self, _prompt, answer, *, checkpoint_id, checkpoint, client=None, steers=None):
        self.readings.append({"answer": answer, "steers": [dict(s) for s in steers or []]})
        return reading(checkpoint_id, checkpoint)

    def steer(self, parent: RunState, backends: FakeBackends, **message):
        from unittest.mock import patch

        events: list[dict] = []
        kept: list[RunState] = []

        async def send(event: dict) -> None:
            events.append(event)

        async def run() -> None:
            async with httpx.AsyncClient(transport=httpx.MockTransport(backends)) as client:
                with patch("app.qwen_stream._request_av", self.fake_av):
                    await run_steer(
                        parent, SteerMessage(run_id=parent.run_id, **message), send, kept.append,
                        client=client,
                    )

        asyncio.run(asyncio.wait_for(run(), timeout=5))
        return events, kept

    def test_message_takes_exactly_one_direction(self) -> None:
        SteerMessage(run_id="r", checkpoint_id=0, alternative_id=1)
        SteerMessage(run_id="r", checkpoint_id=0, text="go the other way")
        SteerMessage(run_id="r", checkpoint_id=0, away=True)
        for bad in ({}, {"alternative_id": 0, "away": True}, {"text": "  "}, {"alternative_id": 3}):
            with self.assertRaises(ValidationError):
                SteerMessage(run_id="r", checkpoint_id=0, **bad)

    def test_branch_streams_from_the_checkpoint_under_a_new_run_id(self) -> None:
        backends = FakeBackends()
        events, kept = self.steer(parent_run(), backends, checkpoint_id=0, alternative_id=0)

        kinds = [event["type"] for event in events]
        self.assertEqual(kinds[:2], ["steer_ack", "branch"])
        ack, branch = events[0], events[1]
        self.assertEqual((ack["applied"], ack["run_id"]), (True, "parent"))
        child = kept[0]
        self.assertEqual(branch, {
            "type": "branch", "run_id": child.run_id, "parent_run_id": "parent", "checkpoint_id": 0,
            "position": len(INTRO), "kind": "toward", "focus": "checking your credit score",
            "opening": ANCHOR, "anchored": True,
        })
        # Everything after the branch event belongs to the child.
        self.assertTrue(all(event["run_id"] == child.run_id for event in events[2:]))
        tokens = [event for event in events if event["type"] == "token"]
        self.assertEqual(tokens[0]["position"], len(INTRO))
        self.assertEqual("".join(t["text"] for t in tokens), STEERED)
        self.assertEqual(child.text, INTRO + STEERED)
        self.assertIn("status", kinds)
        self.assertEqual(kinds[-1], "steer_score")
        self.assertEqual(events[-1]["after"], {"current": 0.27, "target": 0.31})

        # The steer was made from the original vs the written opening, on the kept prefix.
        contrast = backends.requests["contrast"][0]
        self.assertEqual((contrast["prefix"], contrast["original"], contrast["targets"]),
                         (INTRO, "1. **Budget**:", ["1. **Credit**:"]))
        # The branch opens with the target opening, replayed under the steer,
        # which lets go where the opening ends.
        anchored = {"direction_id": "d1", "start_char": len(INTRO), "end_char": len(INTRO) + len(ANCHOR)}
        self.assertEqual(backends.requests["steer"][0]["prefix"], INTRO + ANCHOR)
        self.assertEqual(backends.requests["steer"][0]["steers"], [anchored])
        # Readings of the branch replay the same steer.
        self.assertEqual(self.readings[0]["steers"], [anchored])
        self.assertEqual(self.readings[0]["answer"], INTRO + ANCHOR)

    def test_steering_a_branch_again_keeps_the_earlier_steer(self) -> None:
        earlier = {"direction_id": "d0", "start_char": len(INTRO), "end_char": len(INTRO) + 14}
        backends = FakeBackends("2. **Shop**:")
        _, kept = self.steer(parent_run([earlier]), backends, checkpoint_id=1, alternative_id=1)

        self.assertEqual(backends.requests["contrast"][0]["steers"], [earlier])
        self.assertEqual(backends.requests["contrast"][0]["prefix"], INTRO + STEP_1)
        start = len(INTRO + STEP_1)
        self.assertEqual(backends.requests["steer"][0]["steers"],
                         [earlier, {"direction_id": "d1", "start_char": start, "end_char": start + len("2. **Shop**:")}])
        self.assertEqual(kept[0].steers[0], earlier)

    def test_re_steering_the_same_point_does_not_stack(self) -> None:
        earlier = {"direction_id": "d0", "start_char": len(INTRO), "end_char": len(INTRO) + 14}
        backends = FakeBackends()
        _, kept = self.steer(parent_run([earlier]), backends, checkpoint_id=0, alternative_id=1)

        # The earlier steer shaped the text being replaced, so it is dropped.
        self.assertEqual(backends.requests["contrast"][0]["steers"], [])
        self.assertEqual(backends.requests["steer"][0]["steers"][0]["start_char"], len(INTRO))
        self.assertEqual(len(backends.requests["steer"][0]["steers"]), 1)

    def test_typed_direction_is_made_concrete_and_shown(self) -> None:
        reply = json.dumps({"focus": "checking your credit score", "detail": "Checks credit first.",
                            "title": "Check Your Credit"})
        backends = FakeBackends(reply)
        events, _ = self.steer(parent_run(), backends, checkpoint_id=0, text="do the opposite")
        self.assertEqual(events[0]["note"], "Checks credit first.")
        self.assertEqual(events[1]["focus"], "checking your credit score")
        # Only the title is Qwen's; the markup is the original's.
        self.assertEqual(backends.requests["contrast"][0]["targets"], ["1. **Check Your Credit**:"])

    def test_openings_keep_the_original_markup(self) -> None:
        self.assertEqual(split_opening("### 1. Determine Your Budget"), ("### 1. ", "Determine Your Budget", ""))
        self.assertEqual(split_opening("1. **Choose the Right Location**:"), ("1. **", "Choose the Right Location", "**:"))
        self.assertEqual(split_opening("### Step 2: Research Cars"), ("### Step 2: ", "Research Cars", ""))
        # A title reply wrapped in markup still lands in the original's format.
        _, kept = self.steer(parent_run(), FakeBackends("**2. Check Your Credit**"), checkpoint_id=0, alternative_id=0)
        self.assertEqual(kept[0].steers[0]["start_char"], len(INTRO))

    def test_plan_steer_branches_at_the_first_section(self) -> None:
        parent = parent_run()
        parent.checkpoints[2] = CheckpointState(PLAN, reading(2, PLAN), ALTERNATIVES)
        backends = FakeBackends()
        events, _ = self.steer(parent, backends, checkpoint_id=2, alternative_id=0)
        self.assertEqual(events[1]["position"], len(INTRO))
        self.assertEqual(backends.requests["contrast"][0]["original"], "1. **Budget**:")

    def test_away_uses_the_other_directions(self) -> None:
        backends = FakeBackends()
        events, _ = self.steer(parent_run(), backends, checkpoint_id=0, away=True)
        self.assertEqual(events[1]["kind"], "away")
        self.assertEqual(events[1]["focus"], "setting a budget")
        self.assertEqual(events[1]["anchored"], False)
        self.assertNotIn("opening", events[1])
        self.assertEqual(len(backends.requests["contrast"][0]["targets"]), len(ALTERNATIVES))
        # Not anchored: the model writes the heading, and readings replay where the steer let go.
        self.assertEqual(backends.requests["steer"][0]["prefix"], INTRO)
        lead_end = len(INTRO) + STEERED.index("\n")
        self.assertEqual(self.readings[0]["steers"],
                         [{"direction_id": "d1", "start_char": len(INTRO), "end_char": lead_end}])

    def test_refusals_do_not_start_a_branch(self) -> None:
        parent = parent_run()
        parent.checkpoints[1].alternatives = None
        for message, expected in (
            ({"checkpoint_id": 7, "alternative_id": 0}, "That reading is not available to steer from"),
            ({"checkpoint_id": 1, "away": True}, "Steering away needs this reading's other directions first"),
            ({"checkpoint_id": 0, "alternative_id": 2}, "That direction is not available"),
        ):
            events, kept = self.steer(parent, FakeBackends(), **message)
            self.assertEqual(kept, [])
            self.assertEqual([(e["type"], e["applied"], e["message"]) for e in events],
                             [("steer_ack", False, expected)])


if __name__ == "__main__":
    unittest.main()
