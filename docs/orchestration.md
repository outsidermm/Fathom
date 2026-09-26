# Live inference and orchestration design

This is the **planned integration**, not a description of the current
implementation. Today `apps/api/app/main.py` streams mock tokens and mock
features. The [target harness contract](target-harness-contract.md) describes
that live conversation protocol as a possible **post-hackathon** direction —
it is not what's being built this weekend. For this weekend's build, see
[api-contract.md](api-contract.md) (the activation-stream contract the
frontend is actually implementing against) and
[frontend-roadmap.md](frontend-roadmap.md).
The [Runpod runbook](runpod-inference.md) covers the model files and the
separately verified AV service.

## User-visible flow

The user enters a task and sees the answer stream immediately. A small
"Current focus" card appears when an activation explanation is ready. The
user can steer **toward the task** or **away from a visible distraction**.
On a steering click, the system branches from a known generation boundary,
shows "Reconsidering…", and streams a revised continuation beside the old
one. The page should not expose layer numbers, raw vectors, or model-server
controls by default.

An NLA explanation is an approximate interpretation of one activation. It
is not a transcript of the model's private reasoning. A cosine score can
rank candidate directions; only a regenerated output tests whether an
intervention changed behavior. The UI should show the observed before/after
text and never promise that a direction guarantees a specific answer.

## Components and data flow

```text
Next.js browser ── WebSocket ──> FastAPI session orchestrator
                                  │
                                  ├─> Qwen target worker (generation + layer-20 hook)
                                  │       └─> selected 3,584-D activations
                                  ├─> direction store / cosine ranking
                                  ├─> NLA AV client ── HTTP input_embeds ──> SGLang AV
                                  └─> NLA AR scorer (PyTorch, when requested)
```

FastAPI owns run IDs, task context, ordering, cancellation, and the event
stream. The **target worker** owns Qwen tokenization, generation, and
activation hooks. The **AV client** converts a selected activation into an
embedding prompt using the checkpoint's `nla_meta.yaml`; SGLang runs the AV
model. The **AR scorer** reconstructs a vector from the AV explanation and
compares it with the captured vector. AR does not need a second SGLang server.

Keep SGLang's port 30000 private to the Pod. Only the FastAPI API should be
reachable by the browser. If the frontend is hosted elsewhere, configure an
authenticated HTTPS/WSS entry point and an explicit `CORS_ORIGINS` allowlist.
The existing `uvicorn app.main:app --reload --port 8000` command is for
local mock development; model serving should use a stable process without
automatic reloads.

## One generation session

1. Validate the task text and create a `run_id`. Save the exact target model
   revision, tokenizer revision, sampling settings, random seed, and active
   direction IDs. These make a branch reproducible enough to compare.
2. Start Qwen generation and stream each token without waiting for AV.
   Capture the designated residual-stream tensor at the NLA extraction
   point. Verify the exact hook against the upstream `hidden_states[20]`
   example; a one-layer offset would invalidate NLA output.
3. At selected phrase or sentence boundaries, copy only the activation(s)
   needed for inspection. Give each sample a `run_id`, token position,
   layer, model revision, and monotonically increasing sample number.
   Avoid sending every full vector to the browser.
4. Queue AV jobs separately. On completion, emit a short explanation tied
   to its original token range. Ignore a late result if its run was canceled
   or superseded; never display it as the current focus for a newer branch.
5. If requested, pass the AV text through AR and report cosine similarity
   between normalized original and reconstructed vectors. The score tests
   reconstruction of that vector, not factual correctness of the answer.
6. Finish the target stream even if AV or AR fails. Emit an interpretation
   unavailable state rather than blocking the answer.

Sampling every 8–16 tokens is a starting **design choice**, not a measured
latency guarantee. Tune it after timing target generation, AV, AR, transfer,
and queue delay on the actual Pod. Limit concurrent AV jobs and drop obsolete
ones so explanations do not accumulate behind the live response.

## Direction discovery and steering

Each actionable suggestion must have a real vector in the same Qwen model,
layer, and 3,584-dimensional space as the captured activation. A text label
from AV alone is insufficient. Seed the direction store with validated
contrastive vectors such as `mean(task examples) - mean(distractor examples)`;
record the examples, extraction position, normalization, and validation
results with the vector. Never use the AV model's free-form description as a
vector ID.

For a current activation `h` and candidate direction `d`, cosine similarity
can rank which stored directions are nearby. Compare centered activations
or an appropriate baseline when raw residual-stream offsets dominate the
score. Ranking is **descriptive**; test a proposed action by applying
`h' = h + αd` at the same extraction point and regenerating. Start with a
small bounded `α`, measure activation norm and output quality, and retain an
unsteered baseline. Do not assume the NLA AR checkpoint maps arbitrary
user commands to usable steering vectors.

"Rethink" means branch generation, not edit already emitted tokens in place:

1. Save a boundary and the visible prefix before the continuation to revise.
2. Cancel that continuation and mark its AV jobs stale.
3. Replay the retained prefix through the target model with the selected
   hook and direction. Recompute or deliberately invalidate any KV cache
   affected by the intervention; cached states from the old branch cannot
   simply be reused after changing earlier activations.
4. Stream the new suffix under a new branch ID. Keep the old suffix for a
   before/after comparison and report the actual text difference.

The user can also steer *away* from a current signal, but the signal must
resolve to a validated direction; negating a raw activation can remove many
unrelated features. If no validated direction exists, offer "reconsider this
part" as a prompt-level regeneration action and label it accordingly.

## One-A100 scheduling and implementation order

The three checkpoint directories use about 41 GB on disk, but disk size is
not a GPU-memory budget. SGLang's AV service previously reserved tens of
GB for weights and KV cache. Measure the target worker and AR separately
before attempting simultaneous residency. A first demo can keep target +
AV warm and score with AR only when there is room or after pausing another
GPU workload. Never claim three warm model services fit from disk sizes.

Build and verify in this order:

1. Target Qwen worker: exact layer hook, token stream, and activation shape.
2. AV adapter: one **real** target activation to SGLang; compare several
   distinct inputs and inspect outputs, not just the random-vector smoke test.
3. FastAPI orchestration: independent target and AV queues, run/branch IDs,
   cancellation, stale-result filtering, and health reporting.
4. AR scoring: reconstruct and attach a fidelity score without delaying
   target text.
5. Direction store and steering: held-out contrastive tests, bounded hook,
   branch replay, and before/after comparison.
6. Browser contract update: implement the planned events in both Pydantic
   and TypeScript together, then switch the mock producer to the real one.

The live UI should present **task**, **current focus**, **suggested redirect**,
and **observed result**. These are the useful outputs for a nontechnical user.
