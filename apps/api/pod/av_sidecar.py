"""Pod-local Qwen layer-20 replay and NLA activation verbalization service.

Run with Transformers 4.x and the upstream ``nla_inference.py`` on PYTHONPATH.
This sidecar stays on loopback; the API reaches it through a private tunnel.
"""

from __future__ import annotations

import os
import threading
from functools import lru_cache

import httpx
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from transformers import AutoModelForCausalLM, AutoTokenizer

from nla_inference import NLAClient

QWEN_PATH = os.environ.get("QWEN_PATH", "/workspace/models/qwen2.5-7b-instruct")
AV_PATH = os.environ.get("AV_PATH", "/workspace/models/nla-av")
AV_URL = os.environ.get("AV_URL", "http://127.0.0.1:30002")
REPLAY_DEVICE = os.environ.get("QWEN_REPLAY_DEVICE", "cuda:0")
LAYER = 20

app = FastAPI(title="Qwen activation verbalizer")
_inference_lock = threading.Lock()


class ExplainRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=16000)
    answer: str = Field(min_length=1, max_length=16000)


class ExplainResponse(BaseModel):
    explanation: str
    layer: int = LAYER
    sample: str = "replayed_last_content_token"


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


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/explain", response_model=ExplainResponse)
def explain(request: ExplainRequest):
    with _inference_lock:
        try:
            tokenizer, model, av = _models()
            prompt_ids = tokenizer.apply_chat_template(
                [{"role": "user", "content": request.prompt}],
                tokenize=True,
                add_generation_prompt=True,
            )
            answer_ids = tokenizer.encode(request.answer, add_special_tokens=False)
            if not answer_ids:
                raise ValueError("Answer contains no tokens")
            sample_answer_index = next(
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
            with torch.inference_mode():
                # HF hidden_states[21] is the residual after block 20.
                state = model(
                    input_ids=input_ids, output_hidden_states=True, use_cache=False
                ).hidden_states[LAYER + 1][0, -1].float().cpu()
            text = av.generate(state, temperature=0, max_new_tokens=200)
            if not text.strip():
                raise ValueError("AV returned an empty explanation")
            return ExplainResponse(explanation=text.strip())
        except (ValueError, RuntimeError, httpx.HTTPError) as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
