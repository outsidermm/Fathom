"""Pydantic models mirroring docs/api-contract.md.

Keep this file and apps/web/src/lib/contract.ts in sync whenever the
contract changes — see docs/api-contract.md for the canonical shapes.
"""

from __future__ import annotations

from typing import Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator, model_validator

# Reserved model value shared with the disabled frontend option. The current
# WebSocket handler explicitly rejects it; only qwen2.5-7b is connected.
Model = Literal["gemma-2b", "qwen2.5-7b"]
Signature = Literal["hedging", "refusal", "unsupported"]
StreamState = Literal["idle", "streaming", "inspecting", "done", "error"]


# ---- client -> server -----------------------------------------------------


class StartMessage(BaseModel):
    type: Literal["start"] = "start"
    prompt: str = Field(max_length=16000)
    model: Model
    # Hold text at each checkpoint until its AV reading arrives (or times out).
    pace: bool = True
    # Echoed as run_id on every event of this run; generated when missing.
    run_id: Optional[str] = Field(default=None, min_length=1, max_length=64)

    @field_validator("prompt")
    @classmethod
    def prompt_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("prompt cannot be blank")
        return value


class ClampMessage(BaseModel):
    type: Literal["clamp"] = "clamp"
    feature_id: str
    value: float = Field(ge=-1.0, le=1.0)


class ResetClampsMessage(BaseModel):
    type: Literal["reset_clamps"] = "reset_clamps"


class StopMessage(BaseModel):
    type: Literal["stop"] = "stop"


class SteerMessage(BaseModel):
    """Branch a run at one of its readings: toward an alternative, toward a
    typed direction, or away from the reading. Exactly one of the three."""

    type: Literal["steer"] = "steer"
    run_id: str = Field(min_length=1, max_length=64)  # the run to branch from
    checkpoint_id: int = Field(ge=0)
    alternative_id: Optional[int] = Field(default=None, ge=0, le=2)
    text: Optional[str] = Field(default=None, min_length=1, max_length=300)
    away: bool = False

    @model_validator(mode="after")
    def exactly_one_direction(self) -> "SteerMessage":
        if self.text is not None and not self.text.strip():
            raise ValueError("text cannot be blank")
        chosen = [self.alternative_id is not None, self.text is not None, self.away]
        if sum(chosen) != 1:
            raise ValueError("give exactly one of alternative_id, text or away")
        return self


ClientMessage = Union[StartMessage, ClampMessage, ResetClampsMessage, StopMessage, SteerMessage]


# ---- server -> client -------------------------------------------------------


class Coords(BaseModel):
    x: float
    y: float
    z: float


class TokenEvent(BaseModel):
    type: Literal["token"] = "token"
    index: int
    text: str
    position: int


class ActivationEvent(BaseModel):
    type: Literal["activation"] = "activation"
    token_index: int
    feature_id: str
    value: float = Field(ge=0.0, le=1.0)
    coords: Coords
    # Not emitted by the current backend (see the "Planned only" note on this
    # event in docs/api-contract.md), but declared here to match
    # apps/web/src/lib/contract.ts and the fields feature-inspector.tsx /
    # diagnostics-feed.tsx already read off "activation" events.
    explanation: Optional[str] = None


class FlagEvent(BaseModel):
    type: Literal["flag"] = "flag"
    token_index: int
    signature: Signature
    confidence: float = Field(ge=0.0, le=1.0)


class AVEvent(BaseModel):
    type: Literal["av"] = "av"
    explanation: str
    layer: Literal[20] = 20
    sample: Literal["replayed_last_content_token", "prompt_end"] = "replayed_last_content_token"
    checkpoint_id: int = Field(ge=0)
    position: int = Field(ge=0)
    label: str
    # First sentence (mostly the AV's generic prior) and the rest, which
    # carries most of the signal: show the detail first.
    genre: str = ""
    detail: str = ""
    # Short "-ing" phrase compressing the detail ("advising to set a budget"),
    # written by Qwen from the AV note alone. None when it could not be made.
    focus: Optional[str] = None
    replay_ms: Optional[int] = None
    av_ms: Optional[int] = None


class AVErrorEvent(BaseModel):
    type: Literal["av_error"] = "av_error"
    message: str
    checkpoint_id: int = Field(ge=0)
    position: int = Field(ge=0)
    label: str


class AVAlternative(BaseModel):
    id: int = Field(ge=0, le=2)
    # Same form as a reading: an "-ing" label and a short AV-style note.
    focus: str
    detail: str


class AVAlternativesEvent(BaseModel):
    """Other steps the model could take at a checkpoint, written by Qwen from
    the task, the answer so far and the AV note. Suggestions, not readings.
    Sent after its checkpoint's ``av`` event, possibly after status:done."""

    type: Literal["av_alternatives"] = "av_alternatives"
    checkpoint_id: int = Field(ge=0)
    position: int = Field(ge=0)
    label: str
    alternatives: list[AVAlternative] = Field(min_length=2, max_length=3)


class SteerAckEvent(BaseModel):
    """Reply to steer, under the parent's run_id. applied:false says why in
    message and does not end any run; applied:true is followed by "branch"."""

    type: Literal["steer_ack"] = "steer_ack"
    checkpoint_id: int = Field(ge=0)
    alternative_id: Optional[int] = Field(default=None, ge=0, le=2)
    applied: bool
    message: Optional[str] = None
    # For a typed direction: what Qwen made of it, shown to the user.
    note: Optional[str] = None


class BranchEvent(BaseModel):
    """A steered run starts. Its events carry the new run_id; its text
    continues the parent's up to ``position``."""

    type: Literal["branch"] = "branch"
    run_id: str
    parent_run_id: str
    checkpoint_id: int = Field(ge=0)  # the parent's checkpoint it branches at
    position: int = Field(ge=0)
    kind: Literal["toward", "away"]
    focus: str  # where it steers toward, or the reading it steers away from
    # Toward only: the opening line the steer was made from.
    opening: Optional[str] = None
    # True when the branch's text starts with ``opening`` (replayed under the
    # steer) rather than leaving the heading to the steered model.
    anchored: bool = False


class SteerScore(BaseModel):
    # Centered cosine of the block-20 state at the section's opening with the
    # AR reconstruction of the reading's note, and of the target's note.
    current: float
    target: Optional[float] = None


class SteerScoreEvent(BaseModel):
    """AR measurement of a branch, sent after its status:done."""

    type: Literal["steer_score"] = "steer_score"
    before: SteerScore
    after: SteerScore


class StatusEvent(BaseModel):
    type: Literal["status"] = "status"
    state: StreamState
    message: Optional[str] = None
    # Set with state "inspecting": the checkpoint the text is held at.
    checkpoint_id: Optional[int] = None
    label: Optional[str] = None
    # Set with state "done": AV readings cancelled because they missed the answer.
    av_dropped: Optional[int] = None


ServerMessage = Union[
    TokenEvent, ActivationEvent, FlagEvent, AVEvent, AVErrorEvent,
    AVAlternativesEvent, SteerAckEvent, BranchEvent, SteerScoreEvent, StatusEvent,
]


# ---- REST -------------------------------------------------------------------


class Feature(BaseModel):
    id: str
    label: str
    cluster: str
    description: str


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
