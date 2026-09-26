# Runpod inference runbook

This runbook covers the persistent model files, the tested Qwen text stream,
and the first AV integration. The browser WebSocket relays Qwen answer text and
up to six asynchronous AV explanations of replayed block-20 checkpoints.
Live per-token capture, AV/AR orchestration, and steering remain integration work.
See [orchestration.md](orchestration.md) for that work and
[target-harness-contract.md](target-harness-contract.md) for the possible
post-hackathon browser protocol (not built this weekend — see
[api-contract.md](api-contract.md) for what the frontend actually speaks now).

## What lives where

| Item | Location | Survives replacement with a new Pod? |
| --- | --- | --- |
| Qwen2.5-7B-Instruct target weights | `/workspace/models/qwen2.5-7b-instruct` | Yes |
| NLA AV weights | `/workspace/models/nla-av` | Yes |
| NLA AR weights | `/workspace/models/nla-ar` | Yes |
| Upstream inference client, README, examples | `/workspace/nla-inference` | Yes |
| Experimental restart script | `/workspace/hackgt_setup.sh` | Yes |
| Installed Python packages, processes, logs under `/root` | Container disk | No |

The original Pod was `hackgt-nla-setup` (`h2r390d0dwabeq`) on one A100
SXM4 80 GB. Its GPU became unavailable after stopping, so a replacement
`hackgt-qwen-nla` (`4xtv64rlg1fp5z`) was deployed on an A100 SXM 80 GB.
Runpod's **Volumes** tab showed the Global volume
`hackgt-nla-models` mounted at `/workspace` with about 41 GB stored. Check the
mount and its contents again before stopping or rebuilding the Pod. A new
container needs the serving runtime and processes restored before it is an
inference endpoint.

[`Qwen/Qwen2.5-7B-Instruct`](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct)
is the target model released by Qwen. The NLA pair was released by
[`kitft`](https://huggingface.co/kitft):
[`nla-qwen2.5-7b-L20-av`](https://huggingface.co/kitft/nla-qwen2.5-7b-L20-av)
and [`nla-qwen2.5-7b-L20-ar`](https://huggingface.co/kitft/nla-qwen2.5-7b-L20-ar)
are fine-tuned NLA checkpoints. The AV accepts a 3,584-dimensional residual
stream activation from **block 20** and generates text. The AR reconstructs an
activation from that text so we can score explanation fidelity. Their upstream
[inference repository](https://github.com/kitft/nla-inference) defines the
tokenizer, prompt, injection, and scoring recipe; read `nla_meta.yaml` from
the checkpoint instead of hardcoding its token IDs or scale.

## Run the live Qwen text bridge

The replacement Pod was tested with the official Runpod PyTorch 2.8.0 image,
one A100 SXM 80 GB, a 30 GB container disk, and `hackgt-nla-models` mounted
at `/workspace`. Its compute price was $1.59/hour at the time of testing;
check the live console before starting it again. Keep the Qwen HTTP port on
Pod loopback and reach it through SSH. The browser talks only to FastAPI.

1. Start the Pod in Runpod, verify the volume in its **Volumes** tab, and use
   the current **Connect** tab for SSH host and port. A dedicated local key
   `~/.ssh/hackgt_runpod` was added to this Runpod account. Do not commit the
   private key. From an SSH shell on the Pod, check:

   ```bash
   nvidia-smi
   ls /workspace/models
   ```

2. If `/root/qwen-venv` is missing, create the serving environment in the
   container and install SGLang. The PyTorch image disallows system-wide pip
   installs, and the Global volume did not support creating a virtualenv:

   ```bash
   uv venv --system-site-packages /root/qwen-venv
   uv pip install --prerelease=allow --python /root/qwen-venv/bin/python sglang==0.5.18
   /root/qwen-venv/bin/python -c 'import torch,sglang; print(torch.__version__,sglang.__version__)'
   ```

   The tested environment resolved PyTorch 2.13.0+cu130 and SGLang 0.5.18.
   Keep it separate from the AV experiment, whose Transformers pin conflicts
   with this SGLang environment. Recreate it if a replacement Pod lacks the
   container disk.

3. Start Qwen only if it is not already serving on port 30001. The virtualenv
   must be on `PATH` because FlashInfer invokes its `ninja` executable while
   compiling kernels:

   ```bash
   PATH=/root/qwen-venv/bin:$PATH nohup /root/qwen-venv/bin/python -m sglang.launch_server \
     --model-path /workspace/models/qwen2.5-7b-instruct \
     --served-model-name qwen2.5-7b \
     --host 127.0.0.1 --port 30001 \
     --mem-fraction-static 0.40 --disable-cuda-graph \
     > /root/qwen.log 2>&1 < /dev/null &
   tail -f /root/qwen.log
   ```

   The lower cache reservation leaves GPU room for AV and Qwen replay.
   `--disable-cuda-graph` worked but produced a deprecation warning. Loading
   weights from the Global volume took about 47 seconds in an earlier
   Qwen-only run. Its first request compiled kernels and took about 86 seconds
   to reach the browser; a later prompt reached its first token in about
   0.12 seconds. Those are observations, not latency guarantees. Check
   `curl -fsS http://127.0.0.1:30001/v1/models` and one actual completion;
   `/health` can report 503 during startup.

4. On the local computer, open an SSH tunnel using the **current** direct TCP
   host and port from Runpod's Connect tab. Keep it open while testing:

   ```bash
   ssh -N -o ExitOnForwardFailure=yes -i ~/.ssh/hackgt_runpod \
     -p <pod-ssh-port> -L 127.0.0.1:30001:127.0.0.1:30001 root@<pod-ip>
   ```

   Start the local backend with `QWEN_API_BASE` set to
   `http://127.0.0.1:30001/v1`, then run the Next.js frontend on port 3000.
   The backend WebSocket is `ws://127.0.0.1:8000/ws/stream`; send
   `{"type":"start","prompt":"Say hello","model":"qwen2.5-7b"}`.
   A live test streamed 19 Qwen chunks through it, and the browser displayed
   the completed answer. No public Qwen HTTP port was exposed.

## Start and verify the AV experiment

For the current end-to-end AV path, run Qwen on 30001 with its reduced cache
reservation, the NLA AV SGLang server on 30002, and the Qwen replay + NLA
client sidecar on 30003. Each replay regenerates the hidden state from the
answer prefix available at its checkpoint and samples the last token containing
letters or digits.
Its tokenization can differ from SGLang's original token IDs. Treat the
explanation as approximate, not a transcript.
The upstream example specifies `hidden_states[21]` for the output of Qwen
block 20. The sidecar code is `apps/api/pod/av_sidecar.py`.

On this A100, start Qwen with `--mem-fraction-static 0.40`, then the GPU
replay sidecar, then AV with `--mem-fraction-static 0.60` and CUDA graphs;
`apps/api/pod/start_services.sh` does this in order. The parameter is
applied to the free GPU memory when each server starts, not to the entire
card. Watch `nvidia-smi` and adjust only after checking the current
allocation. Run the AV server with
`--disable-radix-cache`; the upstream NLA client sends `input_embeds`.

```bash
PATH=/root/qwen-venv/bin:$PATH nohup /root/qwen-venv/bin/python -m sglang.launch_server \
  --model-path /workspace/models/nla-av --host 127.0.0.1 --port 30002 \
  --disable-radix-cache --mem-fraction-static 0.50 --context-length 512 \
  --disable-cuda-graph --trust-remote-code > /root/nla-av.log 2>&1 < /dev/null &

uv venv --system-site-packages /root/av-client-venv
uv pip install --python /root/av-client-venv/bin/python \
  'transformers>=4.57,<5' safetensors orjson fastapi uvicorn \
  accelerate 'torch==2.14.0' 'torchvision==0.29.0'
```

From the repository root on the local computer, copy the sidecar to the Pod:

```bash
scp -i ~/.ssh/hackgt_runpod -P <pod-ssh-port> \
  apps/api/pod/av_sidecar.py root@<pod-ip>:/root/av_sidecar.py
```

Then launch it on the Pod:

```bash
nohup env PYTHONPATH=/workspace/nla-inference QWEN_REPLAY_DEVICE=cuda:0 \
  /root/av-client-venv/bin/uvicorn av_sidecar:app --app-dir /root \
  --host 127.0.0.1 --port 30003 > /root/av-sidecar.log 2>&1 < /dev/null &
```

Forward Pod port 30003 privately alongside Qwen's 30001 tunnel:

```bash
ssh -N -o ExitOnForwardFailure=yes -i ~/.ssh/hackgt_runpod \
  -p <pod-ssh-port> -L 127.0.0.1:30003:127.0.0.1:30003 root@<pod-ip>
```

The local FastAPI process calls `AV_API_BASE=http://127.0.0.1:30003` by default. Both
Pod services are bound to loopback; the browser receives only AV text via
FastAPI's `av` WebSocket event. If AV fails, it receives `av_error` and the
Qwen answer is retained.

Do not run the older `/workspace/hackgt_setup.sh` script while Qwen is live:
it stops the existing SGLang process and starts a standalone AV experiment on
port 30000. The path above keeps Qwen and AV available together.

## Run the current API locally

From the repository root:

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export QWEN_API_BASE=http://127.0.0.1:30001/v1
export QWEN_MODEL=qwen2.5-7b
export AV_API_BASE=http://127.0.0.1:30003
uvicorn app.main:app --reload --port 8000
```

In another terminal, check `curl -fsS http://127.0.0.1:8000/api/health`.
This starts the FastAPI bridge on port 8000; it does not launch SGLang or load
the models locally. With a running A100 and SSH tunnel, `/ws/stream` carries
real Qwen text and checkpoint-linked AV explanations when both sidecar and
tunnel are ready.
`/api/features` remains placeholder data, and AR and steering are not
connected. Use `--reload` only for local development; it can
restart the API during a model session. The browser should connect to FastAPI,
never directly to SGLang.

## Stop, restart, and troubleshoot

- Before stopping, confirm in Runpod's **Volumes** tab that
  `hackgt-nla-models` is attached at `/workspace` and contains the models and
  client. Runpod's generic Stop dialog previously warned that no volume was
  configured even while this Global volume appeared attached; do not rely on
  the dialog alone to establish persistence.
- Stop the Pod when idle to stop GPU compute billing. Global volume storage
  can still incur charges. Stopping ends the serving processes. If the Pod
  must be replaced, `/root/qwen-venv` and `/root/qwen.log` on its container
  disk will be lost; the `/workspace` model files remain on the Global volume.
- If `/health` is unavailable, inspect `/root/nla-av.log` and
  `/root/av-sidecar.log`, check `nvidia-smi`, and
  verify the model path. Model loading can take minutes. A successful health
  response does not prove activation injection is correct: run the client
  smoke test as well.
- If the client reports `injection token appears 0×`, check the Transformers
  version and the tokenizer in the AV checkpoint before changing the prompt
  or sidecar. If it reports no explanation tags, inspect raw output and the
  generation length.
- Do not launch three full servers with large KV caches on one A100 without a
  memory test. The AR is a truncated PyTorch reconstruction model in the
  upstream client; it does not require a second SGLang text-generation server.

The project repository and these deployment notes are maintained by
[`outsidermm`](https://github.com/outsidermm). The NLA checkpoints, inference
code, and method are credited to Kit Fraser-Taliente and coauthors in the
[upstream paper](https://transformer-circuits.pub/2026/nla/index.html).
