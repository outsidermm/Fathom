# Deployment — hosting this for the whole team, not just James's laptop

Today, only James can reach Qwen: `apps/api` calls out to
`QWEN_API_BASE` (default `http://127.0.0.1:30001/v1`), which only exists
because of his personal SSH tunnel into the Runpod pod (see
[runpod-inference.md](runpod-inference.md)). This doc covers hosting the
frontend and API so everyone — teammates and judges — hits the same URL,
independent of anyone's laptop.

## Who owns what

| Part | Host | Owner |
|---|---|---|
| Next.js frontend | [Vercel](https://vercel.com) | whoever runs the steps below |
| FastAPI + browser WebSocket | Render web service, from the `apps/api/Dockerfile` image | whoever runs the steps below |
| `observatory-db` (Postgres) | Render Postgres | provisioned by the Render Blueprint; nothing reads/writes it yet — see note below |
| Qwen + NLA AV/AR + activation capture | Runpod GPU Pod | **James** — see his note below |

**Job queue (Render Key Value):** not provisioned. Nothing in the current
contract needs one — there's one WebSocket session per browser tab and no
background work to queue. Add it if a real feature needs it later; it's a
few minutes of work via the Blueprint, not worth doing speculatively.

**Postgres:** provisioned now per team decision, even though no code reads
`DATABASE_URL` yet (`apps/api/requirements.txt` already has
`sqlalchemy[asyncio]` + `asyncpg` ready for whenever something needs it).
It costs nothing extra to have stood up on the `starter`/`basic-256mb`
plans below; don't feel obligated to wire it into anything for the demo.

## 1. Deploy the API + database (Render)

1. Push this repo to GitHub if it isn't already (it is: `outsidermm/hackgt-13`).
2. In the Render dashboard: **New > Blueprint**, connect the repo. Render
   reads [`render.yaml`](../render.yaml) at the repo root and shows two
   resources to approve: the `observatory-api` web service (built from
   `apps/api/Dockerfile`) and the `observatory-db` Postgres instance.
3. Approve and deploy. First build takes a few minutes (installs
   `apps/api/requirements.txt` inside the image).
4. Once it's live, open the service's **Environment** tab and set the vars
   `render.yaml` left blank (deliberately — they're secrets or not known
   until step 3 below):
   - `CORS_ORIGINS` — set once you have the Vercel URL (step 2). Comma-
     separate multiple origins, no trailing slash: `https://observatory.vercel.app`
   - `QWEN_API_BASE` / `QWEN_API_KEY` — from James, see below.
5. Health check: `curl https://<your-service>.onrender.com/api/health`
   should return `{"status":"ok"}` even before Qwen is wired up —
   `/api/features` will also respond (still placeholder data).

## 2. Deploy the frontend (Vercel)

1. In Vercel: **Add New > Project**, import the same GitHub repo.
2. Set **Root Directory** to `apps/web` (this is a monorepo — Vercel needs
   to know the Next.js app isn't at the repo root).
3. Environment variables (Project Settings > Environment Variables):
   ```
   NEXT_PUBLIC_API_BASE=https://<your-render-service>.onrender.com
   NEXT_PUBLIC_WS_URL=wss://<your-render-service>.onrender.com/ws/stream
   ```
   Note `wss://`, not `ws://` — Render terminates TLS, and browsers refuse
   a plain `ws://` connection from an `https://` page (mixed content).
   These are `NEXT_PUBLIC_*` vars, baked in at build time — redeploy after
   changing them.
4. Deploy. Copy the resulting `https://<project>.vercel.app` URL back into
   Render's `CORS_ORIGINS` (step 1.4) and redeploy the API so the
   WebSocket's CORS check actually allows it.

No code changes were needed for this step — `apps/web/src/lib/contract.ts`
already reads `NEXT_PUBLIC_API_BASE`/`NEXT_PUBLIC_WS_URL` from the
environment with `localhost` fallbacks for local dev.

## 3. The Runpod side — James's bridge

The team's call: **James owns making Qwen reachable from Render**, however
he implements it (this replaces "SSH tunnel to a laptop" with something
Render can actually reach — a proxied/token-gated port on the pod, an
outbound-connecting worker, or anything else). This doc doesn't prescribe
the mechanism; it defines the handoff so the rest of the stack doesn't
need to change no matter which he picks:

- **Give us a URL** reachable from the public internet (Render is not on
  the same network as the pod), OpenAI-chat-completions-compatible, to set
  as `QWEN_API_BASE` on the Render service (see `apps/api/app/qwen_stream.py`
  — it already POSTs `{base_url}/chat/completions` with `stream=True`).
- **If it needs auth**, `qwen_stream.py` already reads `QWEN_API_KEY` from
  the environment and sends it as a bearer token — just tell us to set that
  var too, no code change needed.
- Whatever he builds, **keep the pod's raw Qwen port off the public
  internet** — put a token or the worker pattern in front of it, not a bare
  `--host 0.0.0.0`.

Until that URL exists, the hosted API will behave exactly like an
unreachable local backend today: `/ws/stream` accepts a `start` message and
returns a `status: error` (or hangs, depending on the failure mode) instead
of Qwen tokens. `/api/health` and `/api/features` work regardless — so
frontend/layout work and the demo shell can be verified end-to-end on the
real hosted URLs before the Runpod side is plugged in.

## Local dev is unaffected

Nothing above changes how anyone runs things locally — `docker-compose.yml`,
`.env.example`, and the Quick Start in the root [README](../README.md) are
all still for local dev against James's tunnel. This doc is only about the
shared, always-on URLs.
