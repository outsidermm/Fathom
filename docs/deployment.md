# Deployment — frontend and API on Vercel

The deployment target is two Vercel projects from `outsidermm/HackGT-13`:
`apps/web` for Next.js and `apps/api` for FastAPI. Qwen inference stays on
James's Runpod GPU Pod. These are setup instructions for the account owner;
this branch does not create or deploy a Vercel project. Review
`kareem/vercel-deploy` before any production promotion or merge.

## What Vercel currently documents

Official documentation checked on **2026-09-25**:

- [FastAPI deployment](https://vercel.com/docs/frameworks/backend/fastapi)
  requires a `FastAPI` instance named `app` and lists these entrypoints:
  > `app.py`, `index.py`, `server.py`, `main.py`, `wsgi.py`, or `asgi.py`
  >
  > the same filenames inside `src/` or `app/`

  Our existing `app/main.py` matches when the project root is `apps/api`.
  A custom module can instead use `[tool.vercel] entrypoint = "module:app"`
  in `pyproject.toml`; we do not need that override.
- [Python runtime](https://vercel.com/docs/functions/runtimes/python) detects
  FastAPI from `requirements.txt` and routes requests to the app. Dependencies
  remain in that file. `.python-version` pins Python 3.12, matching the existing
  Docker image and a currently supported Vercel version.
- [Python WebSocket announcement](https://vercel.com/changelog/websocket-support-is-now-available-for-python-functions)
  (July 23, 2026) demonstrates a regular FastAPI `@app.websocket(...)` endpoint.
  [WebSocket docs](https://vercel.com/docs/functions/websockets) confirm ASGI
  support without a Vercel-specific upgrade API. WebSockets are in beta on
  all plans and run on Fluid Compute, as described in the
  [WebSocket beta announcement](https://vercel.com/changelog/websocket-support-is-now-in-public-beta).
- [Duration configuration](https://vercel.com/docs/functions/configuring-functions/duration)
  says a Python framework app builds into one Function and the `functions`
  key must be its resolved entrypoint file, here `app/main.py`.

The relevant structure is:

```text
apps/api/                 # Vercel API project's Root Directory
├── .python-version       # 3.12
├── requirements.txt      # includes fastapi, uvicorn, httpx
├── vercel.json
└── app/
    ├── __init__.py
    ├── main.py           # app = FastAPI(); HTTP routes + /ws/stream
    ├── qwen_stream.py
    ├── mock_stream.py
    └── schemas.py
```

[`apps/api/vercel.json`](../apps/api/vercel.json) selects the FastAPI preset,
explicitly enables Fluid Compute, and sets `functions["app/main.py"].maxDuration`
to **300 seconds**. This works within both Hobby and Pro Fluid limits.
The documented [fluid property](https://vercel.com/docs/project-configuration/vercel-json#fluid)
enables it per deployment. Framework routing preserves `/api/health`,
`/api/features`, and `/ws/stream`; no entrypoint relocation or rewrite is needed.

## 1. Set up the API project (account owner)

1. Import the GitHub repo in Vercel with **Root Directory `apps/api`** and
   **Framework Preset FastAPI**. Use the review branch for Preview validation;
   keep production promotion separate. Leave install/build settings at the
   preset defaults so Vercel installs `requirements.txt`.
2. Set these variables in the API project's Environment Variables settings
   for the intended environment (Preview for branch validation; Production
   only when approved):

   | Variable | Hosted value |
   |---|---|
   | `QWEN_API_BASE` | James's externally reachable HTTPS OpenAI-compatible base URL, including `/v1` |
   | `QWEN_API_KEY` | Bearer secret for that endpoint, if required; API project only |
   | `QWEN_MODEL` | `qwen2.5-7b` (the code's default) |
   | `CORS_ORIGINS` | Exact frontend HTTP origins, comma-separated with no spaces or trailing slash, e.g. `https://<frontend-project>.vercel.app` |

   Redeploy after changing variables. Vercel cannot reach the local default
   `http://127.0.0.1:30001/v1` or anyone's laptop SSH tunnel.
3. Validate the branch's Preview deployment. Confirm Fluid Compute is active
   and the Function duration is 300 seconds.
4. Check `curl -fsS https://<api-deployment>.vercel.app/api/health` returns
   `{"status":"ok"}`. `/api/features` also works without Qwen and remains
   placeholder data. Neither proves inference connectivity.

**HTTP CORS and WebSocket origins:** `CORS_ORIGINS` configures only HTTP
`CORSMiddleware`. `/ws/stream` currently accepts **any origin**, including
requests without an `Origin` header, and has **no application authentication**.
It does not read or enforce `CORS_ORIGINS`. Setting that variable is not an
access restriction on Qwen generation. The endpoint's behavior is unchanged
in this migration; decide on authentication/origin enforcement before wider
public exposure.

## 2. Set up the frontend project (account owner)

1. Import the same repo as a second Vercel project with **Root Directory
   `apps/web`** and the **Next.js** preset.
2. Set these in the web project's target environment:

   ```dotenv
   NEXT_PUBLIC_API_BASE=https://<api-deployment>.vercel.app
   NEXT_PUBLIC_WS_URL=wss://<api-deployment>.vercel.app/ws/stream
   ```

   Use the API deployment corresponding to that environment. HTTPS pages
   need `wss://` for the socket. These public variables are compiled into the
   frontend; rebuild/redeploy after changing them. Keep `QWEN_API_KEY` in the
   API project.
3. Add the frontend's exact URL to the API's `CORS_ORIGINS`, then redeploy
   the API for HTTP fetches. Include exact Preview origins if testing them.
4. Ensure the browser can reach the API's health and WebSocket upgrade routes
   under the project's deployment protection settings. A login page in place
   of an API response or upgrade prevents this separate frontend from working.
5. In the browser, submit a prompt and confirm actual `token` events followed
   by `status: done`, per [api-contract.md](api-contract.md). Exercise Stop and
   a fresh run, and inspect Function logs for upstream failures/timeouts.

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
change `app/main.py`'s `maxDuration` in `vercel.json`; a dashboard default does
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
Render deployment path. Vercel uses the FastAPI preset and Python dependencies;
it does not use that Blueprint or Docker image in this setup.

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

Run the existing API suite from `apps/api`:

```bash
python -m unittest discover -s tests -p test_qwen_stream.py -v
```

It checks SSE parsing, upstream error reporting, and the browser WebSocket
bridge with a mocked model stream. It does not exercise Vercel's runtime or
live Qwen latency.
