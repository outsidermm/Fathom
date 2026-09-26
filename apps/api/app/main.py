"""Interpretability Observatory API — live Qwen text-stream bridge.

Run: uvicorn app.main:app --reload --port 8000
Contract: ../../docs/api-contract.md
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from collections import OrderedDict
from contextlib import suppress
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from .mock_stream import FEATURES
from .qwen_stream import RunState, run_qwen_stream
from .schemas import (
    ClampMessage,
    Feature,
    HealthResponse,
    ResetClampsMessage,
    StartMessage,
    StatusEvent,
    SteerAckEvent,
    SteerMessage,
    StopMessage,
)
from .steer import run_steer

# apps/api/.env; variables already set in the shell take precedence.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

app = FastAPI(title="Interpretability Observatory API")

# Runs a socket keeps so they can be steered (and re-steered) afterwards.
_KEPT_RUNS = 32

_origins = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse()


@app.get("/api/features", response_model=list[Feature])
async def features() -> list[Feature]:
    return FEATURES


@app.websocket("/ws/stream")
async def ws_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    run_task: asyncio.Task | None = None
    send_lock = asyncio.Lock()
    runs: OrderedDict[str, RunState] = OrderedDict()

    def keep(state: RunState) -> None:
        runs[state.run_id] = state
        while len(runs) > _KEPT_RUNS:
            runs.popitem(last=False)

    async def send(payload: dict) -> None:
        async with send_lock:
            await websocket.send_json(payload)

    async def cancel_run() -> None:
        nonlocal run_task
        task = run_task
        run_task = None
        if task is not None:
            if not task.done():
                task.cancel()
            # Retrieve completed failures too. A dropped transport can fail
            # the sender before the receive loop observes the disconnect.
            with suppress(asyncio.CancelledError, WebSocketDisconnect, OSError):
                await task

    try:
        await send(StatusEvent(state="idle").model_dump(exclude_none=True))
        while True:
            # A malformed frame (non-JSON text, or JSON that isn't an object)
            # must not crash the connection — report it and keep listening.
            try:
                raw = await websocket.receive_json()
            except WebSocketDisconnect:
                raise
            except (json.JSONDecodeError, KeyError, UnicodeDecodeError):
                await send(
                    StatusEvent(
                        state="error", message="malformed message: expected JSON"
                    ).model_dump(exclude_none=True)
                )
                continue

            if not isinstance(raw, dict):
                await send(
                    StatusEvent(
                        state="error", message="malformed message: expected a JSON object"
                    ).model_dump(exclude_none=True)
                )
                continue

            msg_type = raw.get("type")

            try:
                if msg_type == "start":
                    msg = StartMessage.model_validate(raw)
                    await cancel_run()
                    if msg.model != "qwen2.5-7b":
                        await send(
                            StatusEvent(state="error", message="Only qwen2.5-7b is connected").model_dump(exclude_none=True)
                        )
                        continue
                    state = RunState(run_id=msg.run_id or uuid.uuid4().hex, prompt=msg.prompt)
                    keep(state)

                    async def send_run(event: dict, run_id: str = state.run_id) -> None:
                        await send({**event, "run_id": run_id})

                    run_task = asyncio.create_task(
                        run_qwen_stream(msg.prompt, send_run, pace=msg.pace, state=state)
                    )

                elif msg_type == "clamp":
                    ClampMessage.model_validate(raw)
                    await send(
                        StatusEvent(state="error", message="Activation steering is not connected yet").model_dump(exclude_none=True)
                    )

                elif msg_type == "reset_clamps":
                    ResetClampsMessage.model_validate(raw)
                    await send(
                        StatusEvent(state="error", message="Activation steering is not connected yet").model_dump(exclude_none=True)
                    )

                elif msg_type == "steer":
                    steer = SteerMessage.model_validate(raw)
                    parent = runs.get(steer.run_id)
                    if parent is None:
                        # A refusal, not status:error, which would end the client's run.
                        await send({**SteerAckEvent(
                            checkpoint_id=steer.checkpoint_id, alternative_id=steer.alternative_id,
                            applied=False, message="That run is no longer available to steer",
                        ).model_dump(exclude_none=True), "run_id": steer.run_id})
                        continue
                    # One generation at a time: a steer replaces whatever is streaming.
                    await cancel_run()
                    run_task = asyncio.create_task(run_steer(parent, steer, send, keep))

                elif msg_type == "stop":
                    StopMessage.model_validate(raw)
                    await cancel_run()
                    await send(StatusEvent(state="idle").model_dump(exclude_none=True))

                else:
                    await send(
                        StatusEvent(
                            state="error", message=f"unknown message type: {msg_type}"
                        ).model_dump(exclude_none=True)
                    )
            except ValidationError as exc:
                # Any message type can fail schema validation (e.g. a "clamp"
                # with a value outside -1..1, or a missing required field) —
                # this used to only be caught for "start", crashing the socket
                # for every other message type.
                await send(
                    StatusEvent(state="error", message=str(exc)).model_dump(exclude_none=True)
                )
    except WebSocketDisconnect:
        pass
    finally:
        await cancel_run()
