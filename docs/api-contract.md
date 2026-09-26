# API contract — frontend/backend interface

This is the shared source of truth so `apps/web` (Samuel, Hari) and `apps/api`
(Kareem, James) can build in parallel without waiting on each other. The API
already implements a **mock** version of the current contract that emits fake
but correctly shaped data. The proposed NLA flow below adds new message types
and requires coordinated frontend/backend changes.

If you change a shape here, update both `apps/api/app/schemas.py` (Pydantic)
and `apps/web/src/lib/contract.ts` (TypeScript) in the same commit.

## WebSocket — `ws://localhost:8000/ws/stream`

One connection per generation session. Query param: `?session_id=<uuid>`
(client-generated, used for reconnects).

### Client → server

```jsonc
// Start a generation run
{ "type": "start", "prompt": "string", "model": "gemma-2b" | "qwen2.5-7b" }

// Mock only: bias future feature-firing values. This does not regenerate text.
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
  a validated set of points) — don't make the frontend do dimensionality
  reduction. NLA explanations are free-form descriptions of activation
  vectors, not SAE feature IDs; do not fabricate a feature dictionary from
  them just to fit the mock event shape.
- `flag` events are the demo's "diagnostic instrument" moment — decide the
  hedging/refusal/unsupported feature signatures early since the frontend
  needs a way to visually distinguish them (color, per `--signal-alert` in
  `globals.css`).

## Proposed live NLA protocol (not implemented)

The shapes above are the **only** messages currently accepted by
`apps/api/app/main.py` and understood by `apps/web/src/lib/contract.ts`.
The real pipeline described in [orchestration.md](orchestration.md) needs a
new protocol revision. These examples are a design target, not runnable API
requests. When implementing them, change both schema files, the WebSocket
handler, the frontend hook, and this document in the same code PR.

The browser would start a task with explicit user instructions:

```jsonc
{
  "type": "start",
  "task": "Compare these laptops for programming",
  "assumptions": ["User travels often"],
  "constraints": ["Use only the supplied specifications"],
  "model": "qwen2.5-7b"
}
```

The server would stream tokens immediately and send interpretations later,
with IDs so a delayed AV result cannot attach to the wrong continuation:

```jsonc
{ "type": "token", "run_id": "run_1", "branch_id": "base", "index": 0, "text": "For" }
{
  "type": "focus",
  "run_id": "run_1", "branch_id": "base", "sample_id": "s_12",
  "token_start": 8, "token_end": 16,
  "label": "Discussing gaming performance",
  "fidelity_cosine": 0.78 // optional; only after AR has scored this explanation
}
{
  "type": "direction_candidate",
  "run_id": "run_1", "branch_id": "base", "sample_id": "s_12",
  "direction_id": "programming_v1", "label": "Return to programming needs",
  "alignment_cosine": 0.31, "steerable": true
}
```

Only a candidate backed by a validated vector may set `steerable: true`.
The cosine value ranks alignment and is not a causal confidence score.
The browser would then request a branch from that sample:

```jsonc
{
  "type": "steer", "run_id": "run_1", "branch_id": "base",
  "sample_id": "s_12", "direction_id": "programming_v1",
  "polarity": "toward", "strength": 0.25
}
```

The server would acknowledge the new branch:

```jsonc
{ "type": "branch_started", "run_id": "run_1", "branch_id": "branch_2", "parent_branch_id": "base", "replayed_from": 8 }
```

The backend must verify ownership of the run and direction, bound the
strength, replay from a valid prefix, and tag all new tokens with the new
branch ID. If a model service is unavailable, it should send a typed error
for that stage while preserving the already streamed answer.
