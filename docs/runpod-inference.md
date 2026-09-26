# Runpod inference runbook

This runbook covers the **existing experimental Pod**, its persistent files, and
the manual AV smoke test. It does not imply that the repository API is already
connected to the models: `apps/api/app/main.py` still calls `run_mock_stream`.
The target-model hook, AR scoring, and live steering remain integration work.
See [orchestration.md](orchestration.md) for that work and
[api-contract.md](api-contract.md) for the target live browser protocol.

## What lives where

| Item | Location | Survives a Pod stop? |
| --- | --- | --- |
| Qwen2.5-7B-Instruct target weights | `/workspace/models/qwen2.5-7b-instruct` | Yes |
| NLA AV weights | `/workspace/models/nla-av` | Yes |
| NLA AR weights | `/workspace/models/nla-ar` | Yes |
| Upstream inference client, README, examples | `/workspace/nla-inference` | Yes |
| Experimental restart script | `/workspace/hackgt_setup.sh` | Yes |
| Installed Python packages, processes, logs under `/root` | Container disk | No |

The Pod was provisioned as `hackgt-nla-setup` (`h2r390d0dwabeq`) on one A100
SXM4 80 GB. Runpod's **Volumes** tab showed the Global volume
`hackgt-nla-models` mounted at `/workspace` with about 41 GB stored. Check the
mount and its contents again before stopping or rebuilding the Pod. Do not
mistake a stopped Pod for a running inference endpoint; starting it requires
the runtime and processes to be restored.

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
uvicorn app.main:app --reload --port 8000
curl -fsS http://127.0.0.1:8000/api/health
```

This starts the **mock FastAPI app** on port 8000. It does not start SGLang
and does not load Qwen, AV, or AR. Use `--reload` for local development only;
it can restart the API process while a live model session is in progress.
Port 30000 is an internal model endpoint. The browser should connect to the
FastAPI WebSocket on port 8000, never directly to SGLang.

## Stop, restart, and troubleshoot

- Before stopping, confirm in Runpod's **Volumes** tab that
  `hackgt-nla-models` is attached at `/workspace` and contains the models and
  client. Runpod's generic Stop dialog previously warned that no volume was
  configured even while this Global volume appeared attached; do not rely on
  the dialog alone to establish persistence.
- Stop the Pod when idle to stop GPU compute billing. Global volume storage
  can still incur charges. Stopping terminates AV and removes installed
  packages and `/root/av.log`; restart from step 1.
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
