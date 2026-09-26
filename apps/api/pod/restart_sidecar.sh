#!/bin/bash
# Restart only the AV sidecar on :30003 (Qwen and AV keep running).
STATE=/workspace/hackgt
# shellcheck disable=SC1091
source "$STATE/secrets.env"
for pid in $(pgrep -f '^/root/av-client-venv/bin/python /root/av-client-venv/bin/uvicorn av_sidecar:app'); do kill "$pid"; done
sleep 2
nohup env PYTHONPATH=/workspace/nla-inference QWEN_REPLAY_DEVICE=cuda:0 \
  AV_API_KEY="$AV_API_KEY" \
  /root/av-client-venv/bin/uvicorn av_sidecar:app --app-dir /root \
  --host 0.0.0.0 --port 30003 > /root/av-sidecar.log 2>&1 < /dev/null &
for i in $(seq 300); do curl -sf --max-time 2 http://127.0.0.1:30003/health >/dev/null && echo "sidecar up" && exit 0; sleep 1; done
echo "sidecar failed"; tail -20 /root/av-sidecar.log; exit 1
