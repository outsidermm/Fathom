"""Pod-local Qwen layer-20 replay and NLA activation verbalization service.

Run with Transformers 4.x and the upstream ``nla_inference.py`` on PYTHONPATH.
Models load at startup, so /health answers only once requests can be served.
Set AV_API_KEY whenever the port is reachable beyond loopback.
"""

from __future__ import annotations

import hmac
import os
import re
import threading
import time
from contextlib import asynccontextmanager
from functools import lru_cache

import httpx
import torch
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from nla_inference import NLAClient
from pydantic import BaseModel, Field
from transformers import AutoModelForCausalLM, AutoTokenizer

QWEN_PATH = os.environ.get("QWEN_PATH", "/workspace/models/qwen2.5-7b-instruct")
AV_PATH = os.environ.get("AV_PATH", "/workspace/models/nla-av")
AV_URL = os.environ.get("AV_URL", "http://127.0.0.1:30002")
REPLAY_DEVICE = os.environ.get("QWEN_REPLAY_DEVICE", "cuda:0")
LAYER = 20
AV_MAX_TOKENS = int(os.environ.get("AV_MAX_TOKENS", "96"))
# Required on every request except /health when set.
AV_API_KEY = os.environ.get("AV_API_KEY")

# Guards only the replay forward pass. AV generation runs outside it so that
# concurrent requests can batch in the AV SGLang server.
_replay_lock = threading.Lock()


@lru_cache(maxsize=1)
def _models():
    torch.set_num_threads(16)
    tokenizer = AutoTokenizer.from_pretrained(QWEN_PATH)
    model = AutoModelForCausalLM.from_pretrained(
        QWEN_PATH,
        dtype=torch.bfloat16,
        device_map=REPLAY_DEVICE,
        low_cpu_mem_usage=True,
    ).model.eval()
    av = NLAClient(AV_PATH, sglang_url=AV_URL, device="cpu")
    return tokenizer, model, av


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _models()
    yield


app = FastAPI(title="Qwen activation verbalizer", lifespan=lifespan)


@app.middleware("http")
async def require_key(request: Request, call_next):
    if request.url.path != "/health" and AV_API_KEY:
        supplied = request.headers.get("authorization", "")
        if not hmac.compare_digest(supplied.encode(), f"Bearer {AV_API_KEY}".encode()):
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
    return await call_next(request)


class ExplainRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=16000)
    # Empty reads the end of the prompt: the state just before the first answer token.
    answer: str = Field(max_length=16000)
    # With an empty answer, read this many tokens before the prompt's last one.
    prompt_end_back: int = Field(default=0, ge=0, le=4)
    # Sample the final token even if it has no letters or digits (e.g. "**").
    last_token: bool = False
    # AV decoding temperature; above 0 draws a sample instead of the greedy reading.
    temperature: float = Field(default=0.0, ge=0.0, le=1.5)


class ExplainResponse(BaseModel):
    explanation: str
    layer: int = LAYER
    sample: str = "replayed_last_content_token"  # or "prompt_end" for an empty answer
    replay_ms: int
    av_ms: int


@app.get("/health")
def health():
    return {"status": "ok"}


_OPEN_TAG = "<explanation>"
_SENTENCE_END = re.compile(r"[.!?](?=\s|$)")


def _clean(text: str) -> str:
    """Drop the tag NLAClient leaves on a truncated decode, ending at a full sentence."""
    text = text.strip()
    if not text.startswith(_OPEN_TAG):
        return text
    text = text[len(_OPEN_TAG):].strip()
    ends = [m.end() for m in _SENTENCE_END.finditer(text)]
    return text[: ends[-1]] if ends else text


@app.post("/explain", response_model=ExplainResponse)
def explain(request: ExplainRequest):
    try:
        tokenizer, model, av = _models()
        started = time.perf_counter()
        prompt_ids = tokenizer.apply_chat_template(
            [{"role": "user", "content": request.prompt}],
            tokenize=True,
            add_generation_prompt=True,
        )
        answer_ids = tokenizer.encode(request.answer, add_special_tokens=False)
        if not answer_ids and request.prompt_end_back:
            prompt_ids = prompt_ids[: -request.prompt_end_back]
        sample_answer_index = len(answer_ids) - 1 if request.last_token else next(
            (
                i for i in range(len(answer_ids) - 1, -1, -1)
                if any(char.isalnum() for char in tokenizer.decode([answer_ids[i]]))
            ),
            len(answer_ids) - 1,
        )
        input_ids = torch.tensor(
            [prompt_ids + answer_ids[: sample_answer_index + 1]],
            dtype=torch.long,
            device=REPLAY_DEVICE,
        )
        with _replay_lock, torch.inference_mode():
            # HF hidden_states[21] is the residual after block 20.
            state = model(
                input_ids=input_ids, output_hidden_states=True, use_cache=False
            ).hidden_states[LAYER + 1][0, -1].float().cpu()
        replayed = time.perf_counter()
        text = _clean(av.generate(
            state, temperature=request.temperature, max_new_tokens=AV_MAX_TOKENS
        ))
        if not text:
            raise ValueError("AV returned an empty explanation")
        return ExplainResponse(
            explanation=text,
            sample="replayed_last_content_token" if answer_ids else "prompt_end",
            replay_ms=round((replayed - started) * 1000),
            av_ms=round((time.perf_counter() - replayed) * 1000),
        )
    except (ValueError, RuntimeError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
