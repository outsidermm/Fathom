# API contract — frontend/backend interface

This is the shared source of truth so `apps/web` (Samuel, Hari) and `apps/api`
(Kareem, James) can build in parallel without waiting on each other. The API
already implements a **mock** version of this contract that emits fake but
correctly-shaped data — point the frontend at it today, swap in real model
internals later without changing a single frontend type.

If you change a shape here, update both `apps/api/app/schemas.py` (Pydantic)
and `apps/web/src/lib/contract.ts` (TypeScript) in the same commit.

## WebSocket — `ws://localhost:8000/ws/stream`

One connection per generation session. Query param: `?session_id=<uuid>`
(client-generated, used for reconnects).

### Client → server

```jsonc
// Start a generation run
{ "type": "start", "prompt": "string", "model": "gemma-2b" | "qwen2.5-7b" }

// Steer: clamp a feature up/down and trigger regeneration from the same prompt
{ "type": "clamp", "feature_id": "string", "value": -1.0 } // -1..1

// Reset all clamps to 0 (no intervention)
{ "type": "reset_clamps" }

// Stop the current stream
{ "type": "stop" }
```

### Server → client

```jsonc
// A generated token, in order
{ "type": "token", "index": 0, "text": "The", "position": 0 }

// A feature firing for the most recent token — this is what drives the
// live map. token_index ties it back to the "token" event above.
{
  "type": "activation",
  "token_index": 0,
  "feature_id": "feat_4821",
  "value": 0.73,          // 0..1 firing strength
  "coords": { "x": 12.4, "y": -3.1, "z": 0.8 } // precomputed layout position
}

// A failure-signature detector firing mid-stream (the "diagnostic instrument" hook)
{
  "type": "flag",
  "token_index": 14,
  "signature": "hedging" | "refusal" | "unsupported",
  "confidence": 0.81
}

// Connection / run lifecycle
{ "type": "status", "state": "idle" | "streaming" | "done" | "error", "message": "optional" }
```

## REST

- `GET /api/health` → `{ "status": "ok" }`
- `GET /api/features` → list of known features for the search/legend panel:

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
  needs a way to visually distinguish them (color, per `--signal-alert` in
  `globals.css`).
