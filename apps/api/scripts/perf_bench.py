"""Latency and throughput of the live stack, measured on the Pod against its
own localhost ports so the numbers carry no proxy or WAN delay.

    uvicorn app.main:app --host 127.0.0.1 --port 8100 &
    python -m scripts.perf_bench

Phases, run one after another so they do not compete for the GPU:
1 SGLang streaming: time to first token and decode tokens/s, one request at a time.
2 SGLang under load: total tokens/s with 1, 4, 8 and 16 concurrent streams.
3 Readings: the API's own _request_av (sidecar replay, AV, focus label) per checkpoint.
4 HF decoding in the sidecar: /steer tokens/s with no steer and with a steer.
5 End to end over the WebSocket: first visible token, and steer latency
  (click to branch, to its first token, to its first model-written token).
GPU memory is sampled throughout. Results go to scripts/out/perf_bench.json
and scripts/out/perf_bench.md.
"""

from __future__ import annotations

import asyncio
import json
import os
import statistics
import subprocess
import threading
import time
from pathlib import Path

import httpx
import websockets
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from app.checkpoints import next_checkpoint  # noqa: E402
from app.qwen_stream import _request_av  # noqa: E402
from app.steer import split_opening  # noqa: E402

QWEN = os.environ.get("QWEN_API_BASE", "http://127.0.0.1:30001/v1").rstrip("/")
QWEN_HEADERS = {"Authorization": f"Bearer {os.environ['QWEN_API_KEY']}"} if os.environ.get("QWEN_API_KEY") else {}
MODEL = os.environ.get("QWEN_MODEL", "qwen2.5-7b")
SIDECAR = os.environ.get("AV_API_BASE", "http://127.0.0.1:30003").rstrip("/")
SIDECAR_HEADERS = {"Authorization": f"Bearer {os.environ['AV_API_KEY']}"} if os.environ.get("AV_API_KEY") else {}
WS_URL = os.environ.get("BENCH_WS", "ws://127.0.0.1:8100/ws/stream")
OUT = Path(__file__).parent / "out"
REPEATS = int(os.environ.get("BENCH_REPEATS", "3"))
TIMEOUT = httpx.Timeout(connect=10.0, read=300.0, write=30.0, pool=60.0)

PROMPTS = [
    "I'm buying my first car. Walk me through the process step by step.",
    "Give me 4 numbered steps to start a vegetable garden.",
    "How do I prepare for a job interview? Give me clear steps.",
    "Explain step by step how to set up a monthly budget.",
    "What are the steps to train for a first 5K run?",
    "Walk me through planning a week-long trip abroad, step by step.",
    "How should I learn a new programming language? Give numbered steps.",
    "Give me steps to move to a new apartment without stress.",
    "How do I start a small online business? List the steps.",
    "Walk me through writing a research paper, step by step.",
]


def pct(values: list[float], q: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))
    return ordered[index]


def summary(values: list[float]) -> dict:
    if not values:
        return {"n": 0}
    return {"n": len(values), "p50": statistics.median(values), "p95": pct(values, 0.95),
            "mean": statistics.fmean(values), "min": min(values), "max": max(values)}


class GpuSampler(threading.Thread):
    """Samples used GPU memory every half second."""

    def __init__(self) -> None:
        super().__init__(daemon=True)
        self.samples: list[int] = []
        self.stop = threading.Event()

    def run(self) -> None:
        while not self.stop.is_set():
            out = subprocess.run(["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
                                 capture_output=True, text=True).stdout.strip()
            used, self.total = (int(x) for x in out.split(","))
            self.samples.append(used)
            self.stop.wait(0.5)


async def sglang_stream(client: httpx.AsyncClient, prompt: str) -> dict:
    """One streamed answer: time to first token, decode speed, and the text."""
    body = {"model": MODEL, "messages": [{"role": "user", "content": prompt}], "stream": True,
            "max_tokens": 512, "stream_options": {"include_usage": True}}
    sent = time.perf_counter()
    first = last = None
    text, tokens, chunks = "", None, 0
    async with client.stream("POST", f"{QWEN}/chat/completions", headers=QWEN_HEADERS, json=body) as response:
        response.raise_for_status()
        async for line in response.aiter_lines():
            if not line.startswith("data:") or line[5:].strip() == "[DONE]":
                continue
            payload = json.loads(line[5:])
            if payload.get("usage"):
                tokens = payload["usage"]["completion_tokens"]
            for choice in payload.get("choices") or []:
                delta = (choice.get("delta") or {}).get("content")
                if delta:
                    now = time.perf_counter()
                    first = first or now
                    last = now
                    text += delta
                    chunks += 1
    tokens = tokens or chunks
    return {"ttft": first - sent, "tokens": tokens, "total": last - sent,
            "decode_tps": (tokens - 1) / (last - first) if last > first else None, "text": text}


async def phase_sglang(client: httpx.AsyncClient) -> tuple[dict, list[dict]]:
    for prompt in PROMPTS[:2]:  # warm-up
        await sglang_stream(client, prompt)
    runs = []
    for _ in range(REPEATS):
        for prompt in PROMPTS:
            run = await sglang_stream(client, prompt)
            runs.append({**run, "prompt": prompt})
    return {
        "ttft_s": summary([r["ttft"] for r in runs]),
        "decode_tokens_per_s": summary([r["decode_tps"] for r in runs if r["decode_tps"]]),
        "completion_tokens": summary([r["tokens"] for r in runs]),
    }, runs


async def phase_load(client: httpx.AsyncClient) -> dict:
    results = {}
    for concurrency in (1, 4, 8, 16):
        rounds = []
        for round_index in range(REPEATS):
            prompts = [PROMPTS[(round_index + i) % len(PROMPTS)] for i in range(concurrency)]
            start = time.perf_counter()
            runs = await asyncio.gather(*(sglang_stream(client, p) for p in prompts))
            wall = time.perf_counter() - start
            rounds.append({"aggregate_tps": sum(r["tokens"] for r in runs) / wall,
                           "ttft": [r["ttft"] for r in runs],
                           "per_stream_tps": [r["decode_tps"] for r in runs if r["decode_tps"]]})
        results[str(concurrency)] = {
            "aggregate_tokens_per_s": summary([r["aggregate_tps"] for r in rounds]),
            "ttft_s": summary([t for r in rounds for t in r["ttft"]]),
            "per_stream_tokens_per_s": summary([t for r in rounds for t in r["per_stream_tps"]]),
        }
    return results


def checkpoints(answer: str, limit: int = 4):
    found, taken, last = [], set(), -1
    while len(found) < limit:
        checkpoint = next_checkpoint(answer, taken, last)
        if checkpoint is None:
            break
        found.append(checkpoint)
        taken.add(checkpoint.position)
        last = checkpoint.position
    return found


async def phase_readings(client: httpx.AsyncClient, runs: list[dict]) -> dict:
    latencies, errors = [], 0
    for run in runs[: len(PROMPTS)]:
        for index, checkpoint in enumerate(checkpoints(run["text"])):
            start = time.perf_counter()
            event = await _request_av(run["prompt"], run["text"][: checkpoint.sample_end],
                                      checkpoint_id=index, checkpoint=checkpoint, client=client)
            if event["type"] == "av":
                latencies.append(time.perf_counter() - start)
            else:
                errors += 1
    return {"reading_latency_s": summary(latencies), "errors": errors}


async def sidecar_steer(client: httpx.AsyncClient, body: dict) -> dict:
    sent = time.perf_counter()
    first = None
    done: dict = {}
    async with client.stream("POST", f"{SIDECAR}/steer", headers=SIDECAR_HEADERS, json=body) as response:
        response.raise_for_status()
        async for line in response.aiter_lines():
            if not line.strip():
                continue
            item = json.loads(line)
            if item.get("text"):
                first = first or time.perf_counter()
            if item.get("done"):
                done = item
    end = time.perf_counter()
    tokens = done.get("tokens") or 0
    return {"first_token_s": first - sent if first else None, "tokens": tokens,
            "tps": (tokens - 1) / (end - first) if first and tokens > 1 else None}


async def phase_hf(client: httpx.AsyncClient, runs: list[dict]) -> dict:
    plain, steered = [], []
    for run in runs[: len(PROMPTS)]:
        found = checkpoints(run["text"], 1)
        if not found:
            continue
        checkpoint = found[0]
        prefix = run["text"][: checkpoint.position]
        original = run["text"][checkpoint.position:checkpoint.sample_end]
        head, _, tail = split_opening(original)
        target = f"{head}Compare Your Options{tail}"
        response = await client.post(f"{SIDECAR}/contrast", headers=SIDECAR_HEADERS, json={
            "prompt": run["prompt"], "prefix": prefix, "original": original, "targets": [target]})
        response.raise_for_status()
        steer = {"direction_id": response.json()["direction_id"], "start_char": len(prefix)}
        base = {"prompt": run["prompt"], "prefix": prefix, "max_new_tokens": 256, "release_after_lead": False}
        plain.append(await sidecar_steer(client, {**base, "steers": []}))
        steered.append(await sidecar_steer(client, {**base, "steers": [steer]}))
    return {
        "unsteered_tokens_per_s": summary([r["tps"] for r in plain if r["tps"]]),
        "steered_tokens_per_s": summary([r["tps"] for r in steered if r["tps"]]),
        "steered_first_token_s": summary([r["first_token_s"] for r in steered if r["first_token_s"]]),
    }


async def ws_case(prompt: str) -> dict:
    """Start a run, wait for it to finish with alternatives, then steer it."""
    async with websockets.connect(WS_URL, max_size=None, open_timeout=30) as socket:
        await socket.recv()  # initial status
        run_id = f"bench-{time.monotonic_ns()}"
        sent = time.perf_counter()
        await socket.send(json.dumps({"type": "start", "prompt": prompt, "model": MODEL, "run_id": run_id}))
        first_token = done_at = None
        alternatives: dict[int, list] = {}
        readings: dict[int, dict] = {}
        while True:
            event = json.loads(await asyncio.wait_for(socket.recv(), 180))
            if event.get("run_id") not in (None, run_id):
                continue
            kind = event["type"]
            if kind == "token" and first_token is None:
                first_token = time.perf_counter() - sent
            elif kind == "av":
                readings[event["checkpoint_id"]] = event
            elif kind == "av_alternatives":
                alternatives[event["checkpoint_id"]] = event["alternatives"]
            elif kind == "status" and event.get("state") == "done":
                done_at = time.perf_counter()
            elif kind == "status" and event.get("state") == "error":
                return {"prompt": prompt, "error": event.get("message")}
            if done_at and (readings.keys() <= alternatives.keys() or time.perf_counter() - done_at > 20):
                break
        steerable = [cid for cid in sorted(alternatives) if readings.get(cid, {}).get("label") != "Plan"]
        result = {"prompt": prompt, "first_visible_token_s": first_token}
        if not steerable:
            return result
        checkpoint_id = steerable[0]
        clicked = time.perf_counter()
        await socket.send(json.dumps({"type": "steer", "run_id": run_id, "checkpoint_id": checkpoint_id,
                                      "alternative_id": alternatives[checkpoint_id][0]["id"]}))
        child = anchor = None
        marks: dict[str, float] = {}
        while True:
            event = json.loads(await asyncio.wait_for(socket.recv(), 180))
            now = time.perf_counter() - clicked
            kind = event["type"]
            if kind == "steer_ack":
                marks["ack"] = now
                if not event.get("applied"):
                    return {**result, "steer_error": event.get("message")}
            elif kind == "branch":
                marks["branch"] = now
                child, anchor = event["run_id"], event.get("opening") or ""
                written = ""
            elif child and event.get("run_id") == child:
                if kind == "token":
                    marks.setdefault("first_token", now)
                    written += event["text"]
                    if len(written) > len(anchor) and event["text"].strip():
                        marks.setdefault("first_generated_token", now)
                elif kind == "status" and event.get("state") == "done":
                    marks["done"] = now
                elif kind == "steer_score":
                    marks["score"] = now
                    break
                elif kind == "status" and event.get("state") == "error":
                    return {**result, "steer_error": event.get("message")}
        return {**result, "steer": marks}


async def phase_end_to_end() -> tuple[dict, list[dict]]:
    cases = []
    for prompt in PROMPTS * max(1, REPEATS - 1):
        try:
            cases.append(await ws_case(prompt))
        except Exception as exc:  # keep measuring the other prompts
            cases.append({"prompt": prompt, "error": f"{type(exc).__name__}: {exc}"})
    steers = [c["steer"] for c in cases if "steer" in c]

    def mark(name: str) -> dict:
        return summary([s[name] for s in steers if name in s])

    return {
        "first_visible_token_s": summary([c["first_visible_token_s"] for c in cases if c.get("first_visible_token_s")]),
        "steer_to_ack_s": mark("ack"),
        "steer_to_branch_s": mark("branch"),
        "steer_to_first_token_s": mark("first_token"),
        "steer_to_first_generated_token_s": mark("first_generated_token"),
        "branch_done_to_ar_score_s": summary([s["score"] - s["done"] for s in steers if "score" in s and "done" in s]),
        "cases": len(cases), "steered": len(steers),
        "failures": [c for c in cases if "error" in c or "steer_error" in c],
    }, cases


def row(name: str, stats: dict, unit: str, scale: float = 1.0) -> str:
    if not stats.get("n"):
        return f"| {name} | – | – | 0 |"
    return f"| {name} | {stats['p50'] * scale:.2f} {unit} | {stats['p95'] * scale:.2f} {unit} | {stats['n']} |"


def report(results: dict) -> str:
    s, load, r, hf, e2e, gpu = (results[k] for k in ("sglang", "load", "readings", "hf", "end_to_end", "gpu"))
    lines = ["# Performance benchmark", "",
             f"Measured on the Pod against localhost services. {REPEATS} repeats of {len(PROMPTS)} prompts.", "",
             "| Metric | p50 | p95 | n |", "|---|---|---|---|",
             row("SGLang time to first token", s["ttft_s"], "ms", 1000),
             row("SGLang decode, 1 stream", s["decode_tokens_per_s"], "tok/s"),
             row("HF decode, no steer", hf["unsteered_tokens_per_s"], "tok/s"),
             row("HF decode, steered", hf["steered_tokens_per_s"], "tok/s"),
             row("Reading latency (replay + AV + label)", r["reading_latency_s"], "s"),
             row("First visible token (paced UI)", e2e["first_visible_token_s"], "s"),
             row("Steer click to branch event", e2e["steer_to_branch_s"], "s"),
             row("Steer click to first branch token", e2e["steer_to_first_token_s"], "s"),
             row("Steer click to first model-written token", e2e["steer_to_first_generated_token_s"], "s"),
             row("Branch done to AR score", e2e["branch_done_to_ar_score_s"], "s"),
             "", "## SGLang under load", "", "| Streams | total tok/s p50 | per-stream tok/s p50 | TTFT p50 |",
             "|---|---|---|---|"]
    for concurrency, stats in load.items():
        lines.append(f"| {concurrency} | {stats['aggregate_tokens_per_s']['p50']:.0f} | "
                     f"{stats['per_stream_tokens_per_s']['p50']:.1f} | {stats['ttft_s']['p50'] * 1000:.0f} ms |")
    lines += ["", f"GPU memory: {gpu['baseline_mib']} MiB before, peak {gpu['peak_mib']} MiB of {gpu['total_mib']} MiB.",
              f"End to end: {e2e['steered']}/{e2e['cases']} runs steered; {len(e2e['failures'])} failures;"
              f" {r['errors']} reading errors."]
    return "\n".join(lines) + "\n"


async def main() -> None:
    OUT.mkdir(exist_ok=True)
    gpu = GpuSampler()
    gpu.start()
    await asyncio.sleep(1)
    baseline = max(gpu.samples)
    results: dict = {}
    async with httpx.AsyncClient(timeout=TIMEOUT, limits=httpx.Limits(max_connections=64)) as client:
        print("1 SGLang", flush=True)
        results["sglang"], runs = await phase_sglang(client)
        print("2 load", flush=True)
        results["load"] = await phase_load(client)
        print("3 readings", flush=True)
        results["readings"] = await phase_readings(client, runs)
        print("4 HF decode", flush=True)
        results["hf"] = await phase_hf(client, runs)
    print("5 end to end", flush=True)
    results["end_to_end"], cases = await phase_end_to_end()
    gpu.stop.set()
    results["gpu"] = {"baseline_mib": baseline, "peak_mib": max(gpu.samples), "total_mib": gpu.total}
    (OUT / "perf_bench.json").write_text(json.dumps({**results, "cases": cases}, indent=2))
    (OUT / "perf_bench.md").write_text(report(results))
    print(report(results))


if __name__ == "__main__":
    asyncio.run(main())
