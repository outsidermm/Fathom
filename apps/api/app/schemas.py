"""Pydantic models mirroring docs/api-contract.md.

Keep this file and apps/web/src/lib/contract.ts in sync whenever the
contract changes — see docs/api-contract.md for the canonical shapes.
"""

from __future__ import annotations

from typing import Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator

Model = Literal["gemma-2b", "qwen2.5-7b"]
Signature = Literal["hedging", "refusal", "unsupported"]
StreamState = Literal["idle", "streaming", "done", "error"]


# ---- client -> server -----------------------------------------------------


class StartMessage(BaseModel):
    type: Literal["start"] = "start"
    prompt: str = Field(max_length=16000)
    model: Model

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


ClientMessage = Union[StartMessage, ClampMessage, ResetClampsMessage, StopMessage]


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


class StatusEvent(BaseModel):
    type: Literal["status"] = "status"
    state: StreamState
    message: Optional[str] = None


ServerMessage = Union[TokenEvent, ActivationEvent, FlagEvent, StatusEvent]


# ---- REST -------------------------------------------------------------------


class Feature(BaseModel):
    id: str
    label: str
    cluster: str
    description: str


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
