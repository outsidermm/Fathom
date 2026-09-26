"""Interpretability Observatory API — live Qwen text-stream bridge.

Run: uvicorn app.main:app --reload --port 8000
Contract: ../../docs/api-contract.md
"""

from __future__ import annotations

import asyncio
import os
from contextlib import suppress
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from .mock_stream import FEATURES
from .qwen_stream import run_qwen_stream
from .schemas import (
    ClampMessage,
    Feature,
    HealthResponse,
    ResetClampsMessage,
    StartMessage,
    StatusEvent,
    StopMessage,
)

# apps/api/.env; variables already set in the shell take precedence.
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

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
    run_task: asyncio.Task | None = None
    send_lock = asyncio.Lock()

    async def send(payload: dict) -> None:
        async with send_lock:
            await websocket.send_json(payload)

    async def cancel_run() -> None:
        nonlocal run_task
        if run_task and not run_task.done():
            run_task.cancel()
            with suppress(asyncio.CancelledError):
                await run_task
        run_task = None

    try:
        await send(StatusEvent(state="idle").model_dump(exclude_none=True))
        while True:
            raw = await websocket.receive_json()
            msg_type = raw.get("type")

            if msg_type == "start":
                try:
                    msg = StartMessage.model_validate(raw)
                except ValidationError as exc:
                    await send(
                        StatusEvent(state="error", message=str(exc)).model_dump(exclude_none=True)
                    )
                    continue
                await cancel_run()
                if msg.model != "qwen2.5-7b":
                    await send(
                        StatusEvent(state="error", message="Only qwen2.5-7b is connected").model_dump()
                    )
                    continue
                run_task = asyncio.create_task(run_qwen_stream(msg.prompt, send))

            elif msg_type == "clamp":
                ClampMessage.model_validate(raw)
                await send(
                    StatusEvent(state="error", message="Activation steering is not connected yet").model_dump()
                )

            elif msg_type == "reset_clamps":
                ResetClampsMessage.model_validate(raw)
                await send(
                    StatusEvent(state="error", message="Activation steering is not connected yet").model_dump()
                )

            elif msg_type == "stop":
                StopMessage.model_validate(raw)
                await cancel_run()
                await send(StatusEvent(state="idle").model_dump())

            else:
                await send(
                    StatusEvent(
                        state="error", message=f"unknown message type: {msg_type}"
                    ).model_dump(exclude_none=True)
                )
    except WebSocketDisconnect:
        await cancel_run()
