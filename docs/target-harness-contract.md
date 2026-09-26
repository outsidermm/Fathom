# Target harness contract — post-hackathon direction (not built this weekend)

> Moved out of `docs/api-contract.md` on 2026-09-25. This is James's design
> for a possible **future** product — a durable, conversational steering
> harness with branching, file attachments, and tool calls. **None of it is
> implemented**, and it is explicitly out of scope for HackGT 13: the team
> already considered and passed on this direction (the "Steerable AI
> Harness" idea) in favor of the interpretability-observatory pitch that
> `docs/api-contract.md` and `docs/frontend-roadmap.md` describe. Kept here,
> unedited, so the design work isn't lost and can be revisited later.
> `docs/orchestration.md` and `docs/runpod-inference.md` link to this file.

# API contract — live conversation harness

This is the **target browser-facing API** for the Qwen + NLA harness. It is not
implemented yet; the current backend and frontend must be migrated together.
The browser talks only to FastAPI. FastAPI owns conversation history, model
jobs, ordering, persistence, and the event stream. The model services remain
private to the Pod.

Qwen produces answer text and activation samples. NLA AV describes a sampled
activation; NLA AR reconstructs an activation from AV's text so the backend can
assess explanation fidelity. The orchestrator reports activity and chooses
which user-facing actions to offer. AV does not accept an arbitrary user
question as its activation input, and AR does not execute tools.

## Resources

All IDs are opaque and server-generated. Every HTTP request and WebSocket
connection checks conversation ownership; possession of an ID alone does not
grant access. For a hackathon, a durable anonymous session in a signed,
HttpOnly cookie is sufficient; the API and WebSocket must validate the same
session. The browser must never put a session secret in a URL.

## HTTP endpoints

Every route below has the `/api` prefix. All work-creating JSON requests
include a client-generated `client_request_id` UUID. A retry with the same
ID returns the original result rather than starting duplicate GPU work.

| Method and path | Purpose |
| --- | --- |
| `POST /session` | Establish an anonymous session and set its signed cookie. |
| `GET /session` | Restore that session after a page reload. |
| `POST /attachments` | Upload a file before sending a prompt; return its ID and processing state. |
| `GET /attachments/{attachment_id}` | Fetch owned attachment metadata and processing result. |
| `GET /attachments/{attachment_id}/content` | Download or preview an owned upload. |
| `DELETE /attachments/{attachment_id}` | Discard an unattached upload. |
| `POST /conversations` | Save the first prompt and start the first turn. |
| `GET /conversations?limit=20&cursor=...` | List the user's conversations, newest first. |
| `GET /conversations/{conversation_id}` | Fetch messages, branch tree, active branch, and latest event ID. |
| `PATCH /conversations/{conversation_id}` | Rename or archive a conversation. |
| `DELETE /conversations/{conversation_id}` | Delete a conversation and its owned records. |
| `GET /conversations/{conversation_id}/branches/{branch_id}` | Fetch one branch's saved answer, samples, inspections, tool calls, and interventions. |
| `POST /conversations/{conversation_id}/messages` | Reply to a message or send a follow-up task prompt. |
| `POST /conversations/{conversation_id}/inspections` | Ask about a captured activation without changing the task. |
| `POST /conversations/{conversation_id}/interventions` | Branch and rethink from a checkpoint. |
| `POST /conversations/{conversation_id}/branches/{branch_id}/cancel` | Stop active generation while keeping saved output. |
| `POST /conversations/{conversation_id}/branches/{branch_id}/retry` | Explicitly create a new branch from a saved checkpoint after interruption. |
| `POST /conversations/{conversation_id}/tool-calls/{tool_call_id}/decision` | Approve or deny a tool call that requires user approval. |
| `GET /capabilities` | Report current model, file-type, tool, AV, AR, and steering availability. |
| `GET /health` | API liveness only; a healthy API does not imply ready models. |

### Upload and start

```jsonc
// POST /api/conversations
{
  "prompt": "Compare these laptops for programming",
  "attachment_ids": ["att_1"], "client_request_id": "uuid"
}

// 201 Created
{
  "conversation_id": "conv_1", "message_id": "msg_1",
  "turn_id": "turn_1", "branch_id": "br_1", "state": "queued",
  "latest_event_id": 0
}
```

Only `ready` attachments can be referenced. The first implementation
should accept bounded UTF-8 text, Markdown, and PDF with server-side text
extraction, explicit size/page limits, and an `extracted_text_preview` in
the attachment metadata. The
deployed [Qwen2.5-7B-Instruct](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct)
is a text model, so an image file is not
understood merely because the API accepted an upload. Image support needs a
separate OCR/vision path and must be advertised only when deployed. Keep
uploaded bytes out of the WebSocket events and AV input.

The list response has `items` with `conversation_id`, `title`,
`updated_at`, `state`, and `active_branch_id`, plus `next_cursor`.
The detail response includes ordered task messages, turn IDs, branch parent
IDs and states, `active_branch_id`, and `latest_event_id`. The branch
response has its complete saved answer and related records. Paginate long
histories so a reload need not transfer every event or file.

### Reply or send a follow-up

```jsonc
// POST /api/conversations/conv_1/messages
{
  "text": "What if battery life matters most?",
  "reply_to_message_id": "msg_2",
  "parent_branch_id": "br_1",
  "attachment_ids": [],
  "if_running": "queue", // "queue" or "interrupt"
  "client_request_id": "uuid"
}

// 202 Accepted
{
  "message_id": "msg_3", "turn_id": "turn_2",
  "branch_id": "br_2", "state": "queued"
}
```

`reply_to_message_id` is the exact message shown as the reply target;
`parent_branch_id` defines the model context. The server verifies that
the message belongs to the conversation and is reachable from that branch.
Replying to an old message starts an alternate continuation; it does not
silently append to the newest branch. A queued follow-up waits for active
generation. `interrupt` marks that generation incomplete at its last saved
boundary and starts the new turn.

### Inspect the model's current focus

```jsonc
// POST /api/conversations/conv_1/inspections
{
  "branch_id": "br_1", "sample_id": "sample_12",
  "question": "Why is it discussing gaming performance?",
  "reply_to_inspection_id": null,
  "client_request_id": "uuid"
}

// 202 Accepted
{ "inspection_id": "insp_1", "sample_id": "sample_12", "state": "queued" }
```

The server can answer using the saved AV explanation and other explicitly
identified evidence. The question is not injected into AV as a substitute
for an activation vector. AR may provide a reconstruction score, but does
not answer the question or choose an intervention. If no usable sample
exists, return `sample_unavailable` instead of inventing an interpretation.
To ask about the latest visible focus, the UI sends that focus's exact
`sample_id`; the server never guesses which delayed sample was meant.
For a back-and-forth inspection, set `reply_to_inspection_id` to the prior
inspection; this threads the questions without adding them to the task prompt.

### Intervene and rethink

```jsonc
// POST /api/conversations/conv_1/interventions
{
  "source_branch_id": "br_1", "checkpoint_id": "cp_12",
  "instruction": "Return to the programming requirements",
  "mode": "prompt_rethink", "client_request_id": "uuid"
}

// 202 Accepted
{
  "intervention_id": "int_1", "source_branch_id": "br_1",
  "branch_id": "br_3", "checkpoint_id": "cp_12", "state": "queued"
}
```

`prompt_rethink` replays the retained prefix with the instruction and
streams a new suffix. `vector_steer` additionally requires a server-issued
`direction_id`, `polarity: "toward" | "away"`, and bounded `strength`
in `[0, 1]`. A direction must be validated for the same Qwen model and
layer before the server accepts it. Free text is not automatically a usable
steering vector; AR-generated candidates remain experimental until tested.
Both modes preserve the original branch for before/after comparison.

Reject an unavailable checkpoint with `409 checkpoint_unavailable` and a
stale branch with `409 branch_conflict`. Do not apply a request to another
branch just because that branch became active. Cancellation is idempotent and
preserves output already committed. A retry after an interrupted run creates
a new branch from the last durable checkpoint; it never mutates the old one.

### Tool calls

Qwen2.5 can produce [function-call requests](https://qwen.readthedocs.io/en/v2.5/framework/function_call.html), but the backend must provide
the schemas, parse and validate the request, execute the named tool, and feed
the result back to Qwen. Model output alone is never tool execution. Start
with a small allowlist and report the actual enabled tools through
`GET /api/capabilities`. A tool needing approval pauses that branch and
emits `tool_approval_required`; the UI then sends:

```jsonc
// POST /api/conversations/conv_1/tool-calls/call_1/decision
{ "decision": "approve", "client_request_id": "uuid" }
// decision may also be "deny"
```

The server checks that the call is pending on that conversation and branch,
runs an approved tool at most once, saves its inputs and result, then resumes
generation. A denied or failed call is recorded and returned to the model as
a bounded result. Buffer and parse tool-call syntax; never stream it as normal
answer text. Do not expose arbitrary shell, network, or filesystem access by
treating generated tool names and arguments as trusted.

## Live event stream

Connect to
`WS /ws/conversations/{conversation_id}?after_event_id=42` after creating
or fetching a conversation. This socket is server-to-client; HTTP carries
task messages, inspections, interventions, and tool decisions. FastAPI
replays durable events after `after_event_id` in order, then streams new
ones. `after_event_id=0` replays from the beginning. The client
deduplicates by event ID and reconnects after a break. The connection stays
open across turns; heartbeat frames do not consume event IDs.

Every event has a monotonically increasing `event_id` **per conversation**:

```jsonc
{
  "event_id": 43, "type": "output_delta",
  "conversation_id": "conv_1", "turn_id": "turn_1",
  "branch_id": "br_1", "message_id": "msg_2",
  "created_at": "2026-09-25T18:00:00Z",
  "data": { "text": "Battery life", "token_start": 18, "token_end": 20 }
}
```

Token ranges are half-open `[start, end)` in the target model's tokens.
`text` is the exact display delta; the browser does not retokenize it.
Delayed AV/AR events retain their original branch and sample IDs.

| Event `type` | Required `data` | Meaning |
| --- | --- | --- |
| `activity` | `state` | `queued`, `generating`, `interpreting`, `waiting_for_tool`, `reconsidering`, `done`, `canceled`, `interrupted`, or `error`. Orchestration status, not private reasoning. |
| `message_created` | `role`, `text`, `reply_to_message_id`, `attachment_ids` | A user message or initially empty assistant message was saved; lets another open tab see it. |
| `output_delta` | `text`, `token_start`, `token_end` | Append answer text to the named assistant message and branch. |
| `sample` | `sample_id`, `checkpoint_id`, `token_start`, `token_end`, `coords` | Captured activation and projected map point; no raw vector sent. |
| `focus` | `sample_id`, `label`, `explanation` | Approximate AV interpretation, not a thought transcript. |
| `fidelity` | `sample_id`, `reconstruction_cosine` | Optional AR reconstruction score, not answer correctness. |
| `direction_candidate` | `sample_id`, `direction_id`, `label`, `alignment_cosine`, `steerable` | Suggested direction; `steerable` requires a validated vector. |
| `inspection_answer` | `inspection_id`, `sample_id`, `answer`, `evidence` | Grounded reply to a question about the model's focus. |
| `inspection_requested` | `inspection_id`, `sample_id`, `question` | An inspection question was saved; lets another open tab display it. |
| `tool_call_proposed` | `tool_call_id`, `tool_name`, `arguments` | Qwen requested a tool; the backend has not executed it yet. |
| `tool_approval_required` | `tool_call_id`, `tool_name`, `arguments` | Branch waits for the user's decision. |
| `tool_call_completed` | `tool_call_id`, `status`, `result_summary` | Result saved and fed back into the model. |
| `branch_started` | `cause`, `source_branch_id` | A branch began. `cause` is `initial`, `reply`, `intervention`, or `retry`; intervention branches also carry `checkpoint_id` and `intervention_id`. |
| `turn_completed` | `state` | Turn or branch ended; final text is durable. |
| `error` | `code`, `stage`, `message`, `recoverable` | Typed failure; AV/AR failure does not discard a valid answer. |

Each branch-specific event carries its own `branch_id`. An old branch's
sample, focus, inspection, tool result, or fidelity result must never be
shown as the current branch's activity, though it remains visible when the
user opens that branch.

## Availability, errors, and persistence

HTTP failures use
`{ "error": { "code": "...", "message": "...", "request_id": "..." } }`.
Use `400`/`422` for invalid input, `401`/`403` for unauthorized
access, `404` for missing resources, `409` for branch or checkpoint
conflicts, `413` for oversized files, `415` for unsupported file types,
and `503` when a required model is unavailable. Do not expose internal
model URLs or raw activations in errors.

`GET /api/capabilities` reports readiness for target generation, AV
inspection, AR fidelity, prompt-level rethink, validated vector steering,
accepted file types/limits, and available tools with approval requirements.
The UI can keep normal conversation usable when AV or AR is down and can
offer prompt-level rethink when vector steering is unavailable.

```jsonc
{
  "target_generation": { "ready": true, "model": "qwen2.5-7b-instruct" },
  "av": { "ready": true }, "ar": { "ready": false },
  "prompt_rethink": true, "vector_steering": false,
  "attachments": { "media_types": ["text/plain", "text/markdown", "application/pdf"],
                   "max_bytes": 10000000 },
  "tools": [{ "name": "calculator", "enabled": true,
              "requires_approval": false }]
}
```

Persist task messages, branch lineage, answer deltas/final text, sample
metadata, interventions, inspections, tool calls, attachments, and the
ordered event log. A Pod stop may interrupt a running turn; saved
conversations and committed events must remain fetchable after restart.
Mark incomplete work as interrupted. Retrying generation is an explicit
new request and never silently replaces a saved branch.
