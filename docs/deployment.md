# Deployment — one Vercel Services project

The deployment target is **one Vercel project and domain** from
`outsidermm/HackGT-13`, with `apps/web` (Next.js) and `apps/api` (FastAPI)
as separate services. Qwen inference stays on James's Runpod GPU Pod.
These are setup instructions for the account owner; this branch does not
create or deploy a Vercel project. Review `kareem/vercel-deploy` before any
production promotion or merge.

## What Vercel currently documents

Official documentation checked on **2026-09-25**:

- [Services overview](https://vercel.com/docs/services): Services is in beta
  on all plans. Services build independently, share a deployment/domain and
  project environment variables, and need top-level rewrites for public access.
  Build/runtime fields such as `framework` and `functions` belong inside each
  service, not at the top level.
- [Configuration reference](https://vercel.com/docs/services/config-reference):
  `root` is relative to the root `vercel.json`; `entrypoint` accepts a Python
  ASGI module and variable. Here `app.main:app` resolves to
  `apps/api/app/main.py`'s `app` from the `apps/api/` service root.
  `main:app` would incorrectly look for `apps/api/main.py`.
- [Routing](https://vercel.com/docs/services/routing): ordered rewrites choose
  the first matching service and preserve the original request path. We route
  `/api/(.*)` and `/ws/(.*)` to `api`, then `/(.*)` to `web`. No prefix stripping,
  destination `path` override, or Next.js proxy is required.
- [Services compute guide](https://vercel.com/kb/guide/vercel-services-fluid-compute):
  Services backends use Fluid Compute by default. Configure duration under
  `services.api.functions`, with paths relative to the service root.
  Our key is `app/main.py`, with `maxDuration: 300`. There is no documented
  service-level `fluid` property; the current official JSON schema also rejects
  it. The previous `fluid: true` is replaced by Services' default, not moved
  into an unsupported field.

The root [`vercel.json`](../vercel.json) is the single deployment config.
The previous `apps/api/vercel.json` has been removed. Application files stay
in place, with Python 3.12 still selected by `apps/api/.python-version` and
API dependencies still in `apps/api/requirements.txt`.

| Public route | Service | Path received by the app |
|---|---|---|
| `GET /api/health` | `api` | `/api/health` |
| `GET /api/features` | `api` | `/api/features` |
| `WS /ws/stream` | `api` | `/ws/stream` |
| `/`, frontend routes, `/_next/...` | `web` | Original path |

Routing into a service is final: an unknown `/api/...` returns the API's 404,
not the frontend. FastAPI's default `/docs` and `/openapi.json` are not exposed
by these API rewrites; those public paths enter the web service.
`apps/web/next.config.ts` has no rewrite/proxy config and needs no changes.
The browser calls the API directly through the deployment's shared routes;
no internal service binding is needed for this client flow.

## 1. Set up the single Services project (account owner)

1. Confirm **Services (Beta) is available/enabled for the owning account/team**.
   The overview currently lists all plans, but does not prescribe an account
   toggle or enrollment sequence. This branch cannot confirm the team's access.
   If the account cannot use `services`, consult Vercel's dashboard/support or
   use the two-project fallback below; do not improvise beta config fields.
2. Import the GitHub repo **once**, with **Root Directory at the repository
   root** (not `apps/web` or `apps/api`). Let the root config define both
   services and their framework presets. Remove project-wide install/build
   overrides inherited from a standalone Next.js or FastAPI setup; use the
   service presets' defaults.
3. Set these project Environment Variables for the intended environment
   (Preview for branch validation; Production only when approved):

   | Variable | Hosted Services value |
   |---|---|
   | `QWEN_API_BASE` | James's reachable HTTPS OpenAI-compatible base URL, including `/v1` |
   | `QWEN_API_KEY` | Bearer secret for that endpoint, if required |
   | `QWEN_MODEL` | `qwen2.5-7b` (code default) |
   | `CORS_ORIGINS` | Exact allowed HTTP origins when cross-origin access is needed, comma-separated without spaces or trailing slash |
   | `NEXT_PUBLIC_API_BASE` | **Empty string**, explicitly set |
   | `NEXT_PUBLIC_WS_URL` | `/ws/stream` |

   For the Vercel UI, enter an actual empty value for `NEXT_PUBLIC_API_BASE`,
   not literal quote characters. In a dotenv file the equivalent is:

   ```dotenv
   NEXT_PUBLIC_API_BASE=""
   NEXT_PUBLIC_WS_URL=/ws/stream
   ```

   The project environment is shared across services; do not assume an API-only
   secret scope. `QWEN_API_KEY` stays a server secret: never rename it with
   `NEXT_PUBLIC_` or read it from browser code. Redeploy after environment changes;
   `NEXT_PUBLIC_*` values are compiled into the web build.
4. Validate the branch's Preview deployment manually. Confirm the API runs on
   Fluid Compute with a 300-second duration and the browser can access the HTTP
   routes and WebSocket upgrade under the project-wide deployment protection.
5. Check `curl -fsS https://<deployment>.vercel.app/api/health` returns
   `{"status":"ok"}`. `/api/features` remains placeholder data. Neither check
   proves Qwen connectivity. Submit a browser prompt and confirm real `token`
   events followed by `status: done`; exercise Stop and a fresh run.

### Same-origin URLs and CORS

`contract.ts` uses `??` localhost fallbacks. **Unset variables still point at
localhost**, even on Vercel, so explicitly set both hosted values above.
`API_BASE` is an origin prefix; empty means same-origin paths such as
`/api/health`. Setting it to `/api` would duplicate the prefix when constructing
an API route. There is no need for a fixed public origin in this setup.

The existing hook passes `WS_URL` to the browser's `new WebSocket(...)`.
The [WebSocket constructor](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket)
accepts relative URLs and resolves HTTPS to WSS. `/ws/stream` therefore follows
this deployment's domain on both Preview and Production. An explicit
`wss://<deployment>.vercel.app/ws/stream` is also valid, but locks that build to
one domain. These relative values are for the hosted/shared-origin setup;
keep the localhost values for separate `npm run dev` and Uvicorn servers.

Same-origin browser HTTP requests do not require cross-origin CORS permissions.
`CORS_ORIGINS` still configures **HTTP CORSMiddleware only**. `/ws/stream`
currently accepts **any origin**, including requests without an `Origin`
header, and has **no application authentication**. This migration preserves
that behavior; CORS is not an access restriction on Qwen generation.

## 2. Fallback if Services Beta is unavailable

The previous standalone setup is preserved in commit **`bec9ad4`**. Use that
revision on a separate fallback branch/checkout rather than deploying this
Services config as if it were standalone:

1. Import two Vercel projects with roots `apps/api` (FastAPI) and `apps/web`
   (Next.js). The older `apps/api/vercel.json` enables Fluid Compute and sets
   the API's `app/main.py` duration to 300 seconds.
2. Set `QWEN_API_BASE`, `QWEN_API_KEY`, `QWEN_MODEL`, and `CORS_ORIGINS` in the
   API project. For HTTP CORS, allow the frontend's exact origin.
3. Set these in the web project and rebuild:

   ```dotenv
   NEXT_PUBLIC_API_BASE=https://<api-deployment>.vercel.app
   NEXT_PUBLIC_WS_URL=wss://<api-deployment>.vercel.app/ws/stream
   ```

4. Validate API health, deployment protection, and actual Qwen streaming.
   Relative URLs are unsuitable for this fallback because the frontend and
   API have different origins. Keep production promotion separate from review.

## 3. Runpod handoff — James

James owns making Qwen reachable **from Vercel**, replacing the laptop-only
SSH tunnel for hosted use. See [runpod-inference.md](runpod-inference.md).

- Supply an HTTPS OpenAI-compatible base URL for `QWEN_API_BASE`; the bridge
  POSTs to `{base}/chat/completions` with `stream: true`.
- Supply a bearer credential for `QWEN_API_KEY` if needed; the bridge already
  sends it. Keep the raw Qwen port private behind that authenticated bridge.
- Warm the model and validate a complete generation through the hosted API.
  Until the URL works, health/features can succeed while `/ws/stream` reports
  `status: error` or waits for an upstream timeout.

## State review

Vercel pins a connection to one Function instance; reconnects may reach another.
Its [state guidance](https://vercel.com/docs/functions/websockets#manage-persistent-state)
puts durable state and coordination in an external store.

Review of `app/main.py` and `app/qwen_stream.py` found **no assumption of shared
mutable state across connections**:

- Each `ws_stream` call owns its `run_task`, send lock, and cancellation closure.
- Each generation owns its HTTP client, SSE buffer, token index, and position.
  The production path does not pass a shared client.
- The global app, CORS configuration, and `FEATURES` placeholder list are shared
  within a process but are not mutated by the current routes.
- There are no rooms, broadcasts, global run registries, persisted clamps,
  shared counters, or local file persistence in the live path.

There is one socket per browser tab; a socket can process successive prompts.
Runs do not survive disconnects. A new `start` is a new generation, consistent
with the hackathon contract. No Redis or job queue is needed for this flow.

## Execution limits and real constraints

The [current duration docs](https://vercel.com/docs/functions/configuring-functions/duration#duration-limits)
list these Python Fluid Compute limits:

| Plan | Default | Generally available maximum | Extended maximum |
|---|---:|---:|---:|
| Hobby | 300s | 300s | None |
| Pro / Enterprise | 300s | 800s | 1800s (beta) |

Above 800s requires per-function configuration and a supported runtime
(Python 3.12/3.13/3.14); Secure Compute and Static IPs do not support it during
beta. Our explicit 300s setting applies on Pro too. To extend it on Pro,
change `services.api.functions["app/main.py"].maxDuration` in the root
`vercel.json`; a dashboard default does
not override that file.

For comparison, Vercel's earlier official
[duration documentation](https://vercel.com/docs/functions/configuring-functions/duration)
published these **legacy, non-Fluid** limits:

| Plan | Default | Maximum |
|---|---:|---:|
| Hobby | 10s | 60s |
| Pro | 15s | 300s |
| Enterprise | 15s | 900s |

The freshly fetched duration page now focuses on Fluid and no longer includes
that legacy table; those figures remain in the indexed older official docs.
This WebSocket setup requires Fluid, so the legacy model is not the target.

**This is a real constraint to validate, not a proven safe runtime budget.**
The bridge caps output at 512 model tokens, but total time also includes
upstream queuing, prompt processing, first-token delay, and downstream delivery.
Its 120-second HTTPX read timeout limits a wait for incoming data, not the
entire generation. Continuous slow output can run much longer.
The Runpod runbook records about **86 seconds** for the first request during
kernel compilation and about **0.12 seconds** to the first token for a later
prompt; it does not establish a worst-case full completion time. The cold
observation already exceeds the legacy Hobby maximum. For illustration,
512 tokens at 2 tokens/s is 256s before first-token overhead; adding 86s would
exceed our 300s limit. This is arithmetic, not a measured throughput claim.

**Connection age also matters:** Vercel closes sockets at the Function duration
limit, even when idle. `ws_stream` stays open after `done` or `stop`, and the
frontend opens a socket when the page mounts. Waiting on the page or running
multiple prompts consumes the same 300s lifetime; a later prompt may be cut off.
The current `use-activation-stream.ts` only sets `connected=false` on close;
it does **not** reconnect or resume, despite the contract's intended fresh-run
reconnect flow. A page reload opens a new connection. Implementing reconnect
handling is a follow-up before relying on long-lived demo tabs. A reconnect
cannot restore a partially completed run with the present contract.

For the account-owner validation, measure complete cold and warm 512-token
runs, test concurrent requests, and leave a tab open past 300s to observe the
close behavior. No hosted timing or WebSocket smoke test has been performed
by this branch.

## Deferred infrastructure and retained files

**Hosted Postgres is deferred.** Nothing reads `DATABASE_URL`; do not provision
it on Vercel or add an integration for this migration. The local compose
service and optional example variable remain for future persistence work.

[`render.yaml`](../render.yaml) and
[`apps/api/Dockerfile`](../apps/api/Dockerfile) remain unchanged as the previous
Render deployment path. The API service uses the FastAPI preset and Python
dependencies; it does not use that Blueprint or Docker image in this setup.

## Local development and tests

Phase 0 in [frontend-roadmap.md](frontend-roadmap.md) still works unchanged:

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The root `.env.example` documents local defaults and hosted substitutions.
The API reads process environment variables; it does not automatically load
that file. Export any overrides before starting Uvicorn. For the frontend,
copy `apps/web/.env.example` to `apps/web/.env.local` as in the README.

For a unified local route surface, the Services docs also describe
`vercel dev -L` from the repository root (no cloud authentication). Use the
relative hosted web variables for that mode. The separate-server Phase 0
workflow above remains unchanged.

Run the existing API suite from `apps/api`:

```bash
python -m unittest discover -s tests -v
```

It checks SSE parsing, upstream error reporting, and the browser WebSocket
bridge with a mocked model stream. It does not exercise Vercel's runtime or
live Qwen latency.
