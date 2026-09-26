# Runpod inference runbook

This runbook covers the persistent model files, the tested Qwen text stream,
and the separate AV experiment. The legacy browser WebSocket now relays real
Qwen answer text, but activation capture, AV/AR orchestration, and steering
remain integration work.
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
     --mem-fraction-static 0.60 --disable-cuda-graph \
     > /root/qwen.log 2>&1 < /dev/null &
   tail -f /root/qwen.log
   ```

   `--disable-cuda-graph` worked but produced a deprecation warning. Loading
   weights from the Global volume took about 47 seconds on this Pod. The
   first request compiled kernels and took about 86 seconds to reach the
   browser; a later prompt reached its first token in about 0.12 seconds.
   Those are observations, not latency guarantees. Check
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

1. Start the Pod in Runpod. Open its web terminal and verify the mount and GPU:

   ```bash
   nvidia-smi
   ls /workspace/models
   test -f /workspace/nla-inference/nla_inference.py
   test -f /workspace/models/nla-av/nla_meta.yaml
   ```

2. Restore the container environment and start the AV service:

   ```bash
   bash /workspace/hackgt_setup.sh
   tail -n 30 /root/av.log
   ```

   This script is an **experimental convenience**, copied to the volume but
   not yet validated after a fresh Pod restart. It installs SGLang 0.5.18,
   then pins Transformers below 5 because the upstream NLA client expected a
   list from `apply_chat_template`, whereas Transformers 5 returned a
   `BatchEncoding` in our smoke test. That pin conflicts with SGLang 0.5.18's
   declared Transformers requirement; treat the environment as a known working
   experiment, not a reproducible production lockfile. Verify both processes
   after every restart. Do not run the setup script against a live session:
   it stops an existing SGLang server before starting another.

3. Wait for the service to finish loading, then check its local endpoint:

   ```bash
   curl -fsS http://127.0.0.1:30000/health
   ```

   The AV server uses `--disable-radix-cache` because NLA sends
   `input_embeds`, not ordinary token IDs; the upstream client requires this
   to avoid incorrect cache reuse. `--disable-cuda-graph` avoided a long
   graph-capture stall on this A100. `--mem-fraction-static 0.70` limited
   SGLang's static reservation. These are measured deployment choices for
   this Pod, not general model defaults.

4. Run the upstream client from the **persistent** copy:

   ```bash
   python /workspace/nla-inference/nla_inference.py \
     /workspace/models/nla-av \
     --sglang-url http://127.0.0.1:30000 \
     --max-new-tokens 128
   ```

   Without `--parquet`, this sends a random vector. It checks loading,
   injection, and decoding, but says nothing about semantic correctness for
   real Qwen activations. Use a captured Qwen block-20 vector for that check.
   Short outputs may omit the closing `<explanation>` tag and trigger the
   client's raw-output warning without implying server failure.

## Run the current API locally

From the repository root:

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export QWEN_API_BASE=http://127.0.0.1:30001/v1
export QWEN_MODEL=qwen2.5-7b
uvicorn app.main:app --reload --port 8000
```

In another terminal, check `curl -fsS http://127.0.0.1:8000/api/health`.
This starts the FastAPI bridge on port 8000; it does not launch SGLang or load
the models locally. With a running A100 and SSH tunnel, `/ws/stream` carries
real Qwen text. `/api/features` remains placeholder data, and AV/AR events and
steering are not connected. Use `--reload` only for local development; it can
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
- If `/health` is unavailable, inspect `/root/av.log`, check `nvidia-smi`, and
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
