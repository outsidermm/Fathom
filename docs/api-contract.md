# API contract — frontend/backend interface

This is the shared source of truth so `apps/web` (Samuel, Hari) and `apps/api`
(Kareem, James) can build in parallel without waiting on each other. The API
currently streams **live Qwen text** and up to six checkpointed NLA AV
interpretations while delivering the answer. Activation-map events, flags, and steering are planned; `/api/features`
still returns placeholder data. The frontend should not present those
placeholders as model internals. **Integration gap:** `apps/web` currently
handles tokens and planned map/flag events, but drops `av`, `av_error`, and
`status: inspecting`; a typed event is not yet a visible interpretation.

If you change a shape here, update both `apps/api/app/schemas.py` (Pydantic)
and `apps/web/src/lib/contract.ts` (TypeScript) in the same commit.

> **Not this file:** the "durable conversations, branches, attachments, tool
> calls" harness design lives in `docs/target-harness-contract.md`. That's a possible
> post-hackathon direction, not what's being built this weekend — none of it
> is implemented, and this file should never describe endpoints the running
> API doesn't actually serve.

## WebSocket — `ws://localhost:8000/ws/stream`

One websocket connection per browser tab. **No state-resuming reconnect for
the hackathon** — on disconnect, the client opens a fresh connection and
lets the user press Run or Rerun to send `start` again for a new run.
Generation is not automatically replayed after a disconnect. The API does not persist runs or
clamps.

### Client → server

```jsonc
// Start a generation run; qwen2.5-7b is the only connected model.
// pace (default true) holds the text at each checkpoint until its AV
// reading arrives or AV_HOLD_TIMEOUT (4 s) passes.
{ "type": "start", "prompt": "string", "model": "qwen2.5-7b", "pace": true }

// Reserved steering messages: currently return status:error and do not
// change generation. Do not show these controls as available yet.
{ "type": "clamp", "feature_id": "string", "value": -1.0 } // -1..1

{ "type": "reset_clamps" }

// Stop the current stream
{ "type": "stop" }

// The user picked one of a reading's alternatives (see av_alternatives).
// Acknowledged with steer_ack; nothing is steered yet. Safe to send at any time.
{ "type": "steer", "checkpoint_id": 2, "alternative_id": 1 } // alternative_id 0..2
```

### Server → client

```jsonc
// A generated Qwen text delta, in order (may be a partial word)
{ "type": "token", "index": 0, "text": "The", "position": 0 }

// One checkpoint interpretation associated with the section at `position`
// (a Python Unicode-code-point offset, not a token index or JS UTF-16 offset).
// Paced runs try to send it before that section; a timed-out reading can
// arrive after its text has started. Unpaced runs do not guarantee precedence.
// Show `focus`, a 3-7 word "-ing" label ("advising to set a budget") that
// Qwen writes from the AV's `detail` alone (never from the answer text); keep
// `detail` one click away. `focus` is null when it could not be made or the
// note had no detail; the `genre` opener is mostly the AV's prior and often wrong.
// It describes one replayed activation approximately, not literal thoughts.
{ "type": "av", "explanation": "...", "genre": "...", "detail": "...",
  "focus": "advising to determine a budget",
  "layer": 20, "sample": "replayed_last_content_token",
  "checkpoint_id": 0, "position": 95, "label": "Step 1",
  "replay_ms": 40, "av_ms": 2100 } // timings may be null or absent

// AV failed; the Qwen answer remains valid and status:done still follows.
{ "type": "av_error", "message": "AV unavailable: ...", "checkpoint_id": 0,
  "position": 95, "label": "Step 1" }

// 2-3 other steps the model could take at a checkpoint, in the reading's form
// (an "-ing" focus plus a short note). Qwen writes them from the task, the
// answer up to the checkpoint and the AV note: they are suggestions, not
// readings of the model's state, and the UI must say so. Always sent after
// the checkpoint's own "av" event, and may arrive after status:done.
// Never sent for an av_error checkpoint; missing when generation failed.
{ "type": "av_alternatives", "checkpoint_id": 2, "position": 95, "label": "Step 1",
  "alternatives": [
    { "id": 0, "focus": "weighing what type of vehicle fits",
      "detail": "The section turns to vehicle size, seating and features." },
    { "id": 1, "focus": "comparing loan and lease financing",
      "detail": "The step weighs loans, leases and interest rates." }
  ] }

// Reply to steer. applied is always false until steering is connected;
// this is not an error and does not end the run.
{ "type": "steer_ack", "checkpoint_id": 2, "alternative_id": 1, "applied": false,
  "message": "Steering is not connected yet" }

// Planned only: not emitted by the current backend.
// token_index ties it back to the "token" event above.
{
  "type": "activation",
  "token_index": 0,
  "feature_id": "feat_4821",
  "value": 0.73,          // 0..1 firing strength
  "coords": { "x": 12.4, "y": -3.1, "z": 0.8 }, // precomputed 3D layout position; all axes required
  "explanation": "..."    // optional; already rendered by feature-inspector.tsx / diagnostics-feed.tsx
}

// Planned only: not emitted by the current backend.
{
  "type": "flag",
  "token_index": 14,
  "signature": "hedging" | "refusal" | "unsupported",
  "confidence": 0.81
}

// Connection / run lifecycle. `message` is only ever present on "error" —
// omit the field entirely rather than sending it null.
{ "type": "status", "state": "idle" | "streaming" | "done" | "error", "message": "optional" }

// Paced runs only: text is held at a checkpoint while its AV reading runs.
// status:streaming follows when the hold ends.
{ "type": "status", "state": "inspecting", "checkpoint_id": 0, "label": "Step 1" }

// av_dropped counts readings cancelled because they missed the answer.
{ "type": "status", "state": "done", "av_dropped": 0 }
```

## REST

- `GET /api/health` → `{ "status": "ok" }`
- `GET /api/features` → placeholder feature list, not derived from Qwen:

```jsonc
[
  { "id": "feat_4821", "label": "legal hedging language", "cluster": "hedging", "description": "..." }
]
```

## Notes for whoever wires the real pipeline in

- `coords` should already be projected (UMAP/t-SNE run once at load time over
  the SAE/NLA feature set) — don't make the frontend do dimensionality
  reduction. Precompute and cache it in the API.
- `flag` events are the demo's "diagnostic instrument" moment — decide the
  hedging/refusal/unsupported feature signatures early since the frontend
  needs a way to visually distinguish them. See `docs/design-system.md` §3
  for the `--alert` token and the map's color rules.
- Paced readings normally precede their section. After a hold times out, a
  reading may arrive later while the answer is still streaming; `position`
  remains its original section start. Unpaced readings can also be late.
  In paced runs the display
  stays 140 characters behind Qwen: the first reading ("Plan", `position` 0,
  `sample: "prompt_end"`) is Qwen's state at the `<|im_start|>` token just
  before the assistant header, before any answer text; each later one is read
  at the end of a section's lead
  (a numbered step's heading, a Markdown heading, or a prose sentence's first
  clause) and shown before that section's text, which then streams. Never on
  a bare list marker. Up to six readings: the plan, three consecutive
  sections, then sections at least 300 characters apart. Every checkpoint gets
  its own AV request (up to `AV_CONCURRENCY`, default 3, at once); none are
  replaced or skipped after scheduling. Holds last up to `AV_HOLD_TIMEOUT`
  (4 s). Non-finite, negative, or invalid tuning values fall back to defaults.
  `AV_CONCURRENCY` is truncated to an integer and is at least 1; it limits
  each run independently, not aggregate GPU work. A Markdown
  heading directly followed by a numbered step counts as one section.
- Section phrases carry no foresight beyond the heading words: in
  `apps/api/scripts/predict_eval.py` they matched the following section 82% of
  the time, labeling the heading text without the AV 84%, and readings taken
  before the heading words 44-51% (chance 50%). The plan matched its own answer
  75% of the time (12 prompts). Present them as what the model's state showed
  just before the text, not as foresight.
- An AV reading that has not arrived once all answer text is out is cancelled
  and not sent: AV output is not streamed, so it would appear detached from its
  section. `status:done` is sent immediately with the `av_dropped` count. A
  stopped run cancels all pending AV work.
- Each `av` reading starts an alternatives request to Qwen right away
  (`AV_ALTERNATIVES`, default 3; 0 turns them off; `AV_ALT_CONCURRENCY`,
  default 2). Those still running at `status:done` get `AV_ALT_GRACE` (10 s)
  more, so a client should keep a finished run listening for
  `av_alternatives`; a new `start` or `stop` cancels them. In
  `apps/api/scripts/alternatives_eval.py` (20 prompts, 107 checkpoints)
  every checkpoint got 2-3 distinct, well-formed options, and a Qwen judge
  called 96% of options plausible steps for the task (median 3 s after the reading).
- These are replays of answer prefixes; exact generation activations and
  steerable directions still require target-model hooks.

## Open asks for whoever owns the real backend (from the 11 PM sync)

1. `run_id` on every server event, echoed from `start` — without it, a late
   event from a stopped run can leak into the next one.
2. Feature dictionary at real scale: move `coords` into `GET /api/features`,
   add `limit` and `?q=` search, decide which subset the map shows.
3. `GET /api/clusters` → `{id, label, centroid}`, or confirm the frontend
   should derive centroids from features client-side.
4. Optional: `layer: number` on activations, for a depth-gauge stretch goal.
