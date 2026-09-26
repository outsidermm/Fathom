"""Pydantic models mirroring docs/api-contract.md.

Keep this file and apps/web/src/lib/contract.ts in sync whenever the
contract changes — see docs/api-contract.md for the canonical shapes.
"""

from __future__ import annotations

from typing import Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator

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
    """The user picked one of a reading's alternatives. Acknowledged only."""

    type: Literal["steer"] = "steer"
    checkpoint_id: int = Field(ge=0)
    alternative_id: int = Field(ge=0, le=2)


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
    type: Literal["steer_ack"] = "steer_ack"
    checkpoint_id: int = Field(ge=0)
    alternative_id: int = Field(ge=0, le=2)
    # Steering is not connected: the choice is recorded by the client only.
    applied: Literal[False] = False
    message: str


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
    AVAlternativesEvent, SteerAckEvent, StatusEvent,
]


# ---- REST -------------------------------------------------------------------


class Feature(BaseModel):
    id: str
    label: str
    cluster: str
    description: str


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
