<p align="center"><img src="apps/web/public/brand/fathom-mark.svg" alt="Fathom anglerfish mark" width="88"></p>

# Fathom

**See where an answer is heading. Change its course while it unfolds.**

Fathom is a steerable AI demo built for HackGT 13. Ask Qwen2.5-7B-Instruct a
question and watch its answer stream. At section checkpoints, Fathom shows a
short, plain-language interpretation of a replayed model activation. Choose a
suggested direction or write your own; the answer branches at that checkpoint,
keeps what was already written, and continues on the new path.

[Try the live demo](https://fathom-ai-space.vercel.app/) · [Run locally](#run-locally) · [Read the benchmark](docs/benchmarks/steer-tokens.md)

> **What a reading means:** It is an interpretation of one activation state,
> not a transcript of the model's thoughts. Suggested directions come from
> Qwen, and the post-steer score measures activation alignment, not whether the
> answer is correct.

## Use it

1. Enter a question and start the answer. Numbered how-to prompts make the
   section checkpoints easy to see.
2. Open a focus bubble beside a section. It shows the current reading and
   alternative directions suggested by Qwen.
3. Pick a direction or type one, such as “focus on growing vegetables in
   balcony containers.” Fathom preserves the earlier text and streams a new
   branch. You can steer a branch again or revisit an earlier one.

The live site needs the Runpod model services to be running for generation; the
interface can load while inference is unavailable.

## How it works

```text
Browser (Next.js) ── WebSocket ──▶ FastAPI orchestrator
                                  ├──▶ SGLang / Qwen2.5-7B: streamed answer and helper calls
                                  └──▶ replay sidecar / HF Qwen: block-20 reads and steered branches
                                        ├──▶ NLA activation verbalizer (AV): activation → description
                                        └──▶ NLA activation reconstructor (AR): description → scoring vector
```

1. **Find a checkpoint.** Deterministic checks recognize numbered steps,
   Markdown headings, and section leads as the answer arrives. The display is
   paced so a reading can appear beside its section.
2. **Read an activation.** The sidecar replays the prompt and generated prefix
   through Qwen, then samples the residual stream after decoder block 20 at
   the last content token of the section opening. The upstream NLA AV describes
   that state; Qwen condenses the description into the focus label shown in the
   interface.
3. **Branch the answer.** For a chosen direction, Qwen names a new section
   opening. The sidecar contrasts the block-20 states produced by the new and
   original openings and applies that difference during the new opening. The
   target opening also anchors the branch as text. Earlier text is retained,
   and later branches inherit prior interventions.
4. **Measure the shift.** The NLA AR reconstructs vectors from descriptions
   and scores their centered cosine similarity to the replayed states before
   and after the branch. This is feedback about the intervention's activation
   alignment, not an answer-quality grade.

SGLang serves the main answer, while the Hugging Face Qwen sidecar provides the
forward hooks needed for replay and intervention. See the
[orchestration design](docs/orchestration.md) and
[current WebSocket contract](docs/api-contract.md) for implementation details.

## What we measured

In a live benchmark of **43 checkpoint cases from 20 prompts**, branches that
succeeded alongside a full re-prompt used a median **46% fewer generated
tokens** (16 paired cases). An anchor-only branch, with the same preserved
prefix and target opening but no activation steer, saved a similar amount. The
measured token saving is therefore evidence for **checkpoint branching**, not
an isolated benefit from the activation vector.

This is a small, model-judged experiment with multiple checkpoints per prompt,
unequal scoring of branches and re-prompts, and many generations that hit their
token cap. It does not provide a like-for-like latency or total inference-cost
comparison. The [full report](docs/benchmarks/steer-tokens.md) includes the
four arms, method, individual cases, and limitations.

## Run locally

You need Python 3.12, Node.js 24, and reachable Qwen and AV/steering sidecar
endpoints. The model setup, persistent Runpod volume, and startup commands are
in the [inference runbook](docs/runpod-inference.md). The API health route works
without the models, but prompting requires them.

From the repository root, copy the example configuration and set the backend
URLs and keys for your model services:

```bash
cp .env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Start the API:

```bash
cd apps/api
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

In another terminal, start the web app:

```bash
cd apps/web
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). Check the API with
`curl http://localhost:8000/api/health`. Local defaults use `127.0.0.1:30001`
for Qwen and `127.0.0.1:30003` for the sidecar; configure reachable endpoints
or follow the runbook's SSH tunnel instructions before sending a prompt. For
hosting on Vercel and Runpod, see the [deployment guide](docs/deployment.md).

## Current scope

The answer stream, AV readings, suggested and typed directions, repeated
branching, and AR scores are connected. Conversation runs live in a WebSocket
session and are not persisted. The 3D fish-brain map is a visual prototype:
`?features=test` shows fixture data, while `/api/features` still returns
placeholders rather than live model features.

Next steps are capturing activations during generation to avoid replay,
testing heading-only and activation-only interventions under matched
conditions, and feeding real feature events into the map.

## Repository and credits

| Path | Purpose |
|---|---|
| `apps/web/` | Next.js, React, and Zustand interface |
| `apps/api/` | FastAPI orchestration, checkpoints, sidecar, and evaluations |
| `docs/api-contract.md` | Current browser/backend protocol |
| `docs/runpod-inference.md` | Model setup and operations |
| `docs/benchmarks/steer-tokens.md` | Live steering comparison |

The [Qwen2.5-7B-Instruct](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct)
model is from Qwen. Fathom integrates the upstream NLA AV/AR checkpoints and
inference client from
[Kit Fraser-Taliente and coauthors](https://transformer-circuits.pub/2026/nla/index.html).
