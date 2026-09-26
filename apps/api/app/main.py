"""Interpretability Observatory API — mock pipeline.

Run: uvicorn app.main:app --reload --port 8000
Contract: ../../docs/api-contract.md
"""

from __future__ import annotations

import asyncio
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from .mock_stream import FEATURES, run_mock_stream
from .schemas import (
    ClampMessage,
    Feature,
    HealthResponse,
    ResetClampsMessage,
    StartMessage,
    StatusEvent,
    StopMessage,
)

app = FastAPI(title="Interpretability Observatory API")

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
    clamps: dict[str, float] = {}
    run_task: asyncio.Task | None = None

    async def send(payload: dict) -> None:
        await websocket.send_json(payload)

    def cancel_run() -> None:
        nonlocal run_task
        if run_task and not run_task.done():
            run_task.cancel()
        run_task = None

    try:
        await send(StatusEvent(state="idle").model_dump())
        while True:
            raw = await websocket.receive_json()
            msg_type = raw.get("type")

            if msg_type == "start":
                try:
                    msg = StartMessage.model_validate(raw)
                except ValidationError as exc:
                    await send(StatusEvent(state="error", message=str(exc)).model_dump())
                    continue
                cancel_run()
                run_task = asyncio.create_task(run_mock_stream(msg.prompt, clamps, send))

            elif msg_type == "clamp":
                msg = ClampMessage.model_validate(raw)
                clamps[msg.feature_id] = msg.value

            elif msg_type == "reset_clamps":
                ResetClampsMessage.model_validate(raw)
                clamps.clear()

            elif msg_type == "stop":
                StopMessage.model_validate(raw)
                cancel_run()
                await send(StatusEvent(state="idle").model_dump())

            else:
                await send(
                    StatusEvent(state="error", message=f"unknown message type: {msg_type}").model_dump()
                )
    except WebSocketDisconnect:
        cancel_run()
