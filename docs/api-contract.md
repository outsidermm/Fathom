# API contract — frontend/backend interface

This is the shared source of truth so `apps/web` (Samuel, Hari) and `apps/api`
(Kareem, James) can build in parallel without waiting on each other. The API
currently streams **live Qwen text** and one NLA AV interpretation after the
answer. Activation-map events, flags, and steering are planned; `/api/features`
still returns placeholder data. The frontend should not present those
placeholders as model internals.

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
sends `start` again to begin a new run. The API does not persist runs or
clamps.

### Client → server

```jsonc
// Start a generation run; qwen2.5-7b is the only connected model
{ "type": "start", "prompt": "string", "model": "qwen2.5-7b" }

// Reserved steering messages: currently return status:error and do not
// change generation. Do not show these controls as available yet.
{ "type": "clamp", "feature_id": "string", "value": -1.0 } // -1..1

{ "type": "reset_clamps" }

// Stop the current stream
{ "type": "stop" }
```

### Server → client

```jsonc
// A generated Qwen text delta, in order (may be a partial word)
{ "type": "token", "index": 0, "text": "The", "position": 0 }

// The NLA AV interpretation of Qwen's block-20 residual after the last
// answer token containing text (skipping trailing punctuation when possible).
// This arrives after the text stream and before status:done.
// It describes one activation approximately; it is not literal thoughts.
{ "type": "av", "explanation": "...", "layer": 20, "sample": "replayed_last_content_token" }

// AV failed; the Qwen answer remains valid and status:done still follows.
{ "type": "av_error", "message": "AV unavailable: ..." }

// Planned only: not emitted by the current backend.
// token_index ties it back to the "token" event above.
{
  "type": "activation",
  "token_index": 0,
  "feature_id": "feat_4821",
  "value": 0.73,          // 0..1 firing strength
  "coords": { "x": 12.4, "y": -3.1, "z": 0.8 } // precomputed 3D layout position; all axes required
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
- The current `av` event is one end-of-answer sample. Per-token activation
  maps and steerable directions still require target-model hooks and a
  separate implementation.

## Open asks for whoever owns the real backend (from the 11 PM sync)

1. `run_id` on every server event, echoed from `start` — without it, a late
   event from a stopped run can leak into the next one.
2. Feature dictionary at real scale: move `coords` into `GET /api/features`,
   add `limit` and `?q=` search, decide which subset the map shows.
3. `GET /api/clusters` → `{id, label, centroid}`, or confirm the frontend
   should derive centroids from features client-side.
4. Optional: `layer: number` on activations, for a depth-gauge stretch goal.
