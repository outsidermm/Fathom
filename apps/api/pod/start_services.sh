#!/bin/bash
# Bring up Qwen (30001), NLA AV (30002) and the sidecar (30003) for production.
# Idempotent: skips services already listening. Survives a Pod reset, which
# wipes /root: environments are rebuilt and state is kept under /workspace/hackgt.
#
#   bash /workspace/hackgt/start_services.sh
#
# Qwen and the sidecar listen on 0.0.0.0 for Runpod's HTTP proxy and require
# the keys in /workspace/hackgt/secrets.env. The AV server stays on loopback.
set -euo pipefail
# The /workspace network volume rejects uv's cache writes (os error 95).
export UV_CACHE_DIR=/root/.cache/uv UV_LINK_MODE=copy

STATE=/workspace/hackgt
mkdir -p "$STATE"
if [ ! -f "$STATE/secrets.env" ]; then
  umask 077
  printf 'QWEN_API_KEY=%s\nAV_API_KEY=%s\n' "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > "$STATE/secrets.env"
fi
# shellcheck disable=SC1091
source "$STATE/secrets.env"
: "${QWEN_API_KEY:?QWEN_API_KEY must be nonempty before exposing Qwen}"
: "${AV_API_KEY:?AV_API_KEY must be nonempty before exposing the sidecar}"

listening() { ss -ltn "sport = :$1" | grep -q LISTEN; }

wait_for() {  # url, name, extra curl args...
  local url=$1 name=$2; shift 2
  for _ in $(seq 600); do
    curl -sf --max-time 2 "$@" "$url" >/dev/null && { echo "$name up"; return 0; }
    sleep 1
  done
  echo "$name failed to start"; return 1
}

if [ ! -x /root/qwen-venv/bin/python ]; then
  echo "Rebuilding qwen-venv (SGLang)..."
  uv venv --system-site-packages /root/qwen-venv
  uv pip install --prerelease=allow --python /root/qwen-venv/bin/python sglang==0.5.18
fi
if [ ! -x /root/av-client-venv/bin/python ]; then
  echo "Rebuilding av-client-venv..."
  uv venv --system-site-packages /root/av-client-venv
  uv pip install --python /root/av-client-venv/bin/python \
    'transformers>=4.57,<5' safetensors orjson fastapi uvicorn pyyaml httpx \
    accelerate 'torch==2.14.0' 'torchvision==0.29.0'
fi
cp "$STATE"/pod/*.py "$STATE"/pod/*.sh /root/ 2>/dev/null || true

export PATH=/root/qwen-venv/bin:$PATH
if ! listening 30001; then
  nohup /root/qwen-venv/bin/python -m sglang.launch_server \
    --model-path /workspace/models/qwen2.5-7b-instruct --served-model-name qwen2.5-7b \
    --host 0.0.0.0 --port 30001 --api-key "$QWEN_API_KEY" \
    --mem-fraction-static 0.40 --disable-cuda-graph \
    > /root/qwen.log 2>&1 < /dev/null &
fi
wait_for http://127.0.0.1:30001/v1/models Qwen -H "Authorization: Bearer $QWEN_API_KEY"

# The sidecar (Qwen replay copy, ~15 GB) starts before AV; it only calls AV
# when a request arrives.
if ! listening 30003; then
  nohup env PYTHONPATH=/workspace/nla-inference QWEN_REPLAY_DEVICE=cuda:0 \
    AV_API_KEY="$AV_API_KEY" \
    /root/av-client-venv/bin/uvicorn av_sidecar:app --app-dir /root \
    --host 0.0.0.0 --port 30003 > /root/av-sidecar.log 2>&1 < /dev/null &
fi
wait_for http://127.0.0.1:30003/health Sidecar

# AV starts last: --mem-fraction-static applies to the memory free at launch
# (~31 GB here). 0.60 covers its 14.3 GB weights, ~4 GB of KV cache and CUDA
# graphs, which cut a reading from ~2.0 s to ~1.5 s with identical output.
if ! listening 30002; then
  nohup /root/qwen-venv/bin/python -m sglang.launch_server \
    --model-path /workspace/models/nla-av --host 127.0.0.1 --port 30002 \
    --disable-radix-cache --mem-fraction-static 0.60 --context-length 512 \
    --cuda-graph-max-bs 8 --trust-remote-code > /root/nla-av.log 2>&1 < /dev/null &
fi
wait_for http://127.0.0.1:30002/health "NLA AV"
