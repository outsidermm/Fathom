"""Pod-local Qwen layer-20 replay, NLA verbalization, and steered generation.

Run with Transformers 4.x and the upstream ``nla_inference.py`` on PYTHONPATH.
Models load at startup, so /health answers only once requests can be served.
Set AV_API_KEY whenever the port is reachable beyond loopback.

Steering takes its directions from Qwen itself. /contrast replays the answer
so far followed by the section's original opening and by a target opening
(written by Qwen for the chosen direction). The difference of their block-20
residuals at the opening's last token, where a section's topic is summed up
and readings are taken, is the steer: it is added to every new token's
block-20 residual until the new section's opening line ends. It moves the
state by exactly the gap between the two real states, so a steer is full with
no strength setting. The AR only measures (/score): how close the steered
state's reconstruction is to the current and target notes.

Measured on real answers (docs/api-contract.md): adding the same difference at
several layers compounds into gibberish, and clamping at layers 8-24 steered
less often, so /contrast defaults to block 20 alone.
"""

from __future__ import annotations

import base64
import hmac
import logging
import math
import os
import re
import threading
import time
import uuid
from collections import OrderedDict
from contextlib import asynccontextmanager
from functools import lru_cache

import httpx
import orjson
import torch
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from nla_inference import NLAClient, NLACritic
from pydantic import BaseModel, Field
from transformers import AutoModelForCausalLM, AutoTokenizer

QWEN_PATH = os.environ.get("QWEN_PATH", "/workspace/models/qwen2.5-7b-instruct")
AV_PATH = os.environ.get("AV_PATH", "/workspace/models/nla-av")
AR_PATH = os.environ.get("AR_PATH", "/workspace/models/nla-ar")
AV_URL = os.environ.get("AV_URL", "http://127.0.0.1:30002")
REPLAY_DEVICE = os.environ.get("QWEN_REPLAY_DEVICE", "cuda:0")
# The GPU has no room for AR next to Qwen, the sidecar and AV; on CPU it runs
# in float32 (this Pod's EPYC has no bf16) and only scores steers.
AR_DEVICE = os.environ.get("AR_DEVICE", "cpu")
# Mean block-20 residual over answer tokens; AR scores are taken around it.
CALIBRATION_PATH = os.environ.get("NLA_CALIBRATION", "/workspace/hackgt/nla_calibration.pt")
LAYER = 20
# Layers a steer edits by default (Qwen2.5-7B has 28).
STEER_LAYERS = [LAYER]
AV_MAX_TOKENS = int(os.environ.get("AV_MAX_TOKENS", "96"))
STEER_MAX_TOKENS = int(os.environ.get("STEER_MAX_TOKENS", "400"))
# Qwen's own generation_config value; greedy decoding loops without it.
REPETITION_PENALTY = 1.05
# Required on every request except /health when set.
AV_API_KEY = os.environ.get("AV_API_KEY")

logger = logging.getLogger("uvicorn.error")

# Guards every Qwen forward pass, and the hook state it reads. AV generation
# runs outside it so that concurrent requests can batch in the AV server; a
# steered generation takes it once per token, so replays wait one step at most.
_replay_lock = threading.Lock()
_ar_lock = threading.Lock()
# Steers the layer hooks apply to the forward pass under _replay_lock:
# [({layer: (u, p or None for "add")}, first token position, end position)], and the
# absolute position of the pass's first token.
_hook = {"steers": [], "pos0": 0}
# Directions made by /contrast, by id; the oldest are dropped.
_directions: OrderedDict[str, dict[int, tuple[torch.Tensor, float]]] = OrderedDict()
_MAX_DIRECTIONS = 512


@lru_cache(maxsize=1)
def _models():
    torch.set_num_threads(12)
    tokenizer = AutoTokenizer.from_pretrained(QWEN_PATH)
    model = AutoModelForCausalLM.from_pretrained(
        QWEN_PATH,
        dtype=torch.bfloat16,
        device_map=REPLAY_DEVICE,
        low_cpu_mem_usage=True,
    ).eval()
    for layer, block in enumerate(model.model.layers):
        block.register_forward_hook(_steer_hook(layer))
    av = NLAClient(AV_PATH, sglang_url=AV_URL, device="cpu")
    return tokenizer, model, av


@lru_cache(maxsize=1)
def _critic() -> NLACritic:
    dtype = torch.float32 if AR_DEVICE == "cpu" else torch.bfloat16
    return NLACritic(AR_PATH, device=AR_DEVICE, dtype=dtype)


@lru_cache(maxsize=1)
def _mean() -> torch.Tensor:
    return torch.load(CALIBRATION_PATH)["mean"].float().to(REPLAY_DEVICE)


def _steer_hook(layer: int):
    def hook(_module, _inputs, output):
        active = [(d[layer], start, end) for d, start, end in _hook["steers"] if layer in d]
        if not active:
            return output
        hidden = output[0] if isinstance(output, tuple) else output
        steered = hidden.float()
        positions = torch.arange(steered.shape[1], device=steered.device) + _hook["pos0"]
        for (u, p), start, end in active:
            mask = ((positions >= start) & (positions < end)).to(steered.dtype).unsqueeze(-1)
            if p is None:  # "add": u is the raw difference
                steered = steered + mask * u
            else:
                steered = steered + mask * (p - steered @ u).unsqueeze(-1) * u
        steered = steered.to(hidden.dtype)
        return (steered, *output[1:]) if isinstance(output, tuple) else steered

    return hook


def _check_hook() -> float:
    """Max difference between the hooked block-20 output and hidden_states[21]."""
    tokenizer, model, _ = _models()
    ids = torch.tensor([tokenizer.encode("The quick brown fox jumps.")], device=REPLAY_DEVICE)
    captured = {}
    handle = model.model.layers[LAYER].register_forward_hook(
        lambda _m, _i, out: captured.setdefault("h", out[0] if isinstance(out, tuple) else out)
    )
    try:
        with _replay_lock, torch.inference_mode():
            _hook.update(steers=[], pos0=0)
            hidden = model.model(ids, output_hidden_states=True).hidden_states[LAYER + 1]
    finally:
        handle.remove()
    return (captured["h"] - hidden).abs().max().item()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _models()
    _critic()
    _mean()
    logger.info("hook check: max |block20 - hidden_states[21]| = %.3g", _check_hook())
    yield


app = FastAPI(title="Qwen activation verbalizer", lifespan=lifespan)


@app.middleware("http")
async def require_key(request: Request, call_next):
    if request.url.path != "/health" and AV_API_KEY:
        supplied = request.headers.get("authorization", "")
        if not hmac.compare_digest(supplied.encode(), f"Bearer {AV_API_KEY}".encode()):
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
    return await call_next(request)


def _encode_vector(vector: torch.Tensor) -> str:
    return base64.b64encode(vector.float().cpu().numpy().tobytes()).decode()


class Steer(BaseModel):
    """A /contrast direction, clamped from the token before start_char on."""

    direction_id: str
    start_char: int = Field(ge=0)
    # Released from the token at this answer offset on (the steered section's
    # opening line has ended); None while still active.
    end_char: int | None = Field(default=None, ge=0)


def _prompt_ids(tokenizer, prompt: str, back: int = 0) -> list[int]:
    ids = tokenizer.apply_chat_template(
        [{"role": "user", "content": prompt}], tokenize=True, add_generation_prompt=True
    )
    return ids[:-back] if back else ids


def _resolve_steers(steers: list[Steer], prompt_len: int, offsets: list[tuple[int, int]]):
    """Hook entries, each starting at the token just before its start_char."""
    resolved = []
    for steer in steers:
        directions = _directions.get(steer.direction_id)
        if directions is None:
            raise ValueError(f"unknown or expired direction {steer.direction_id}")
        before = sum(1 for start, _ in offsets if start < steer.start_char)
        end = math.inf
        if steer.end_char is not None:
            end = prompt_len + sum(1 for start, _ in offsets if start < steer.end_char)
        resolved.append((directions, prompt_len + before - 1, end))
    return resolved


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
    # Steers the answer was generated under, so a branch's reading describes
    # the steered state that produced its text.
    steers: list[Steer] = Field(default_factory=list, max_length=8)


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


def _replay(request) -> torch.Tensor:  # ExplainRequest or _Read
    """Block-20 residual at the sampled answer token (or the prompt's end), on CPU."""
    tokenizer, model, _ = _models()
    encoded = tokenizer(request.answer, add_special_tokens=False, return_offsets_mapping=True)
    answer_ids = encoded["input_ids"]
    prompt_ids = _prompt_ids(
        tokenizer, request.prompt, 0 if answer_ids else getattr(request, "prompt_end_back", 0)
    )
    sample_answer_index = len(answer_ids) - 1 if getattr(request, "last_token", False) else next(
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
    steers = _resolve_steers(request.steers, len(prompt_ids), encoded["offset_mapping"])
    with _replay_lock, torch.inference_mode():
        _hook.update(steers=steers, pos0=0)
        try:
            # HF hidden_states[21] is the residual after block 20 (and its hook).
            return model.model(
                input_ids=input_ids, output_hidden_states=True, use_cache=False
            ).hidden_states[LAYER + 1][0, -1].float().cpu()
        finally:
            _hook["steers"] = []


@app.post("/explain", response_model=ExplainResponse)
def explain(request: ExplainRequest):
    try:
        _, _, av = _models()
        started = time.perf_counter()
        state = _replay(request)
        replayed = time.perf_counter()
        text = _clean(av.generate(
            state, temperature=request.temperature, max_new_tokens=AV_MAX_TOKENS
        ))
        if not text:
            raise ValueError("AV returned an empty explanation")
        return ExplainResponse(
            explanation=text,
            sample="replayed_last_content_token" if request.answer else "prompt_end",
            replay_ms=round((replayed - started) * 1000),
            av_ms=round((time.perf_counter() - replayed) * 1000),
        )
    except (ValueError, RuntimeError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


class ContrastRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=16000)
    # Answer text before the section being redirected.
    prefix: str = Field(default="", max_length=16000)
    # The section's original opening ("### 1. Determine Your Budget"), and one
    # or more openings for where to go; several are averaged ("away" passes
    # the other alternatives).
    original: str = Field(min_length=1, max_length=400)
    targets: list[str] = Field(min_length=1, max_length=4)
    layers: list[int] = Field(default_factory=lambda: list(STEER_LAYERS), min_length=1, max_length=28)
    # "last": the state at each opening's last token, which sums up the
    # section's topic (where readings are taken); "mean": over its tokens.
    pool: str = Field(default="last", pattern="^(last|mean)$")
    # "add": add the full difference at every steered layer; "clamp": set each
    # new token's coordinate along the difference to the target's.
    mode: str = Field(default="add", pattern="^(clamp|add)$")
    # Multiplies the difference ("add" only), for measuring how much a steer
    # needs; the API uses the default.
    scale: float = Field(default=1.0, gt=0.0, le=8.0)
    # Steers the prefix was generated under (for a branch of a branch).
    steers: list[Steer] = Field(default_factory=list, max_length=8)


def _opening_means(request: ContrastRequest, opening: str) -> dict[int, torch.Tensor]:
    """Per layer, the mean residual over the opening's tokens after the prefix."""
    tokenizer, model, _ = _models()
    prompt_ids = _prompt_ids(tokenizer, request.prompt)
    encoded = tokenizer(request.prefix + opening, add_special_tokens=False, return_offsets_mapping=True)
    first = next(i for i, (start, end) in enumerate(encoded["offset_mapping"]) if end > len(request.prefix))
    steers = _resolve_steers(request.steers, len(prompt_ids), encoded["offset_mapping"])
    ids = torch.tensor([prompt_ids + encoded["input_ids"]], device=REPLAY_DEVICE)
    with _replay_lock, torch.inference_mode():
        _hook.update(steers=steers, pos0=0)
        try:
            hidden = model.model(input_ids=ids, output_hidden_states=True, use_cache=False).hidden_states
        finally:
            _hook["steers"] = []
    start = len(prompt_ids) + first
    if request.pool == "last":
        return {layer: hidden[layer + 1][0, -1].float() for layer in request.layers}
    return {layer: hidden[layer + 1][0, start:].float().mean(0) for layer in request.layers}


@app.post("/contrast")
def contrast(request: ContrastRequest):
    """Make a steering direction from original vs target openings."""
    if any(not 0 <= layer < 28 for layer in request.layers):
        raise HTTPException(status_code=422, detail="layers must be 0..27")
    try:
        original = _opening_means(request, request.original)
        targets = [_opening_means(request, target) for target in request.targets]
    except (ValueError, StopIteration) as exc:
        raise HTTPException(status_code=422, detail=str(exc) or "empty opening") from exc
    directions, sizes = {}, {}
    for layer in request.layers:
        target = torch.stack([t[layer] for t in targets]).mean(0)
        difference = target - original[layer]
        u = difference / difference.norm().clamp_min(1e-6)
        directions[layer] = (u, float(target @ u)) if request.mode == "clamp" else (difference * request.scale, None)
        sizes[layer] = round(float(difference.norm()), 2)
    direction_id = uuid.uuid4().hex
    _directions[direction_id] = directions
    while len(_directions) > _MAX_DIRECTIONS:
        _directions.popitem(last=False)
    return {"direction_id": direction_id, "sizes": sizes}


class ScoreRead(BaseModel):
    answer: str = Field(min_length=1, max_length=16000)
    steers: list[Steer] = Field(default_factory=list, max_length=8)


class ScoreRequest(BaseModel):
    """Where to read states (e.g. before and after a steer), and the notes to
    compare them with."""

    prompt: str = Field(min_length=1, max_length=16000)
    reads: list[ScoreRead] = Field(min_length=1, max_length=4)
    current: str = Field(min_length=1, max_length=4000)
    target: str | None = Field(default=None, min_length=1, max_length=4000)


class _Read(BaseModel):
    prompt: str
    answer: str
    steers: list[Steer]


@app.post("/score")
def score(request: ScoreRequest):
    """Centered cosine of each replayed block-20 state with the AR's
    reconstruction of each note: did the state move from current to target?"""
    try:
        states = [
            _replay(_Read(prompt=request.prompt, answer=read.answer, steers=read.steers)) - _mean().cpu()
            for read in request.reads
        ]
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    mean = _mean().cpu()
    critic = _critic()
    notes = {name: getattr(request, name) for name in ("current", "target") if getattr(request, name)}
    with _ar_lock:
        vectors = {name: critic.reconstruct(note).float() - mean for name, note in notes.items()}
    return {"reads": [
        {name: round(float(torch.cosine_similarity(vector, state, dim=0)), 4) for name, vector in vectors.items()}
        for state in states
    ]}


class SteerRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=16000)
    # Answer text kept from the parent run; generation continues after it.
    prefix: str = Field(default="", max_length=16000)
    steers: list[Steer] = Field(default_factory=list, max_length=8)  # none: the unsteered control
    max_new_tokens: int = Field(default=STEER_MAX_TOKENS, ge=1, le=1024)
    # Release the new steers once the steered section's lead line has ended,
    # so the section is redirected and then written without further edits.
    release_after_lead: bool = True


def _penalize(logits: torch.Tensor, seen: torch.Tensor) -> torch.Tensor:
    scores = logits.gather(0, seen)
    scores = torch.where(scores > 0, scores / REPETITION_PENALTY, scores * REPETITION_PENALTY)
    return logits.scatter(0, seen, scores)


@app.post("/steer")
def steer(request: SteerRequest):
    """Stream a steered greedy continuation of prefix as NDJSON lines:
    {"text": delta}, one {"released": answer offset} when the new steers let
    go, and a final {"done": true, "tokens": n, "end_char": offset or null}.

    The prefix is replayed under the steers that started inside it; each
    steer starts at the token before its start_char, so a steer starting at
    len(prefix) changes the state that picks the first new token.
    """
    tokenizer, model, _ = _models()
    prompt_ids = _prompt_ids(tokenizer, request.prompt)
    encoded = tokenizer(request.prefix, add_special_tokens=False, return_offsets_mapping=True)
    ids = prompt_ids + encoded["input_ids"]
    try:
        steers = _resolve_steers(request.steers, len(prompt_ids), encoded["offset_mapping"])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    def forward(tokens: list[int], pos0: int, past):
        with _replay_lock, torch.inference_mode():
            _hook.update(steers=steers, pos0=pos0)
            try:
                return model(
                    torch.tensor([tokens], device=REPLAY_DEVICE),
                    past_key_values=past, use_cache=True,
                )
            finally:
                _hook["steers"] = []

    new = [i for i, s in enumerate(request.steers) if s.end_char is None and s.start_char >= len(request.prefix)]
    stop_ids = {tokenizer.eos_token_id, tokenizer.pad_token_id, tokenizer.convert_tokens_to_ids("<|im_end|>")}

    def stream():
        past = None
        if len(ids) > 1:
            past = forward(ids[:-1], 0, None).past_key_values
        position, token = len(ids) - 1, ids[-1]
        seen = torch.tensor(ids, device=REPLAY_DEVICE)
        generated: list[int] = []
        sent = ""
        end_char = None
        for _ in range(request.max_new_tokens):
            out = forward([token], position, past)
            past, position = out.past_key_values, position + 1
            logits = _penalize(out.logits[0, -1].float(), seen)
            token = int(logits.argmax())
            if token in stop_ids:
                break
            if end_char is None and request.release_after_lead and new:
                before = tokenizer.decode(generated, skip_special_tokens=True)
                if before.strip() and "\n" in tokenizer.decode([token]):
                    # The lead line has ended: this token and the rest are
                    # generated unsteered by the new steers.
                    end_char = len(request.prefix) + len(before)
                    for i in new:
                        directions, start, _ = steers[i]
                        steers[i] = (directions, start, position)
                    # Before this token's text, so a reader never sees text
                    # past the release without knowing where it happened.
                    yield orjson.dumps({"released": end_char}) + b"\n"
            generated.append(token)
            seen = torch.cat([seen, torch.tensor([token], device=REPLAY_DEVICE)])
            text = tokenizer.decode(generated, skip_special_tokens=True)
            if text.endswith("�"):  # Partial UTF-8 character: wait for the rest.
                continue
            if len(text) > len(sent):
                yield orjson.dumps({"text": text[len(sent):]}) + b"\n"
                sent = text
        yield orjson.dumps({"done": True, "tokens": len(generated), "end_char": end_char}) + b"\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@app.post("/activation")
def activation(request: ExplainRequest):
    """Research: the replayed block-20 residual minus the calibration mean."""
    try:
        state = _replay(request) - _mean().cpu()
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"centered": _encode_vector(state), "norm": round(float(state.norm()), 3)}
