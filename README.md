# Interpretability Observatory — HackGT 13, Oracle of the Deep

Live Qwen answers now stream through the browser. The next step is to map
sampled activations and let users steer and compare revised continuations.

## Team

| Person | Owns |
|---|---|
| Kareem + James | NLA vs. SAE decision, activation hooks, model integration, FastAPI/websocket backend |
| Samuel + Hari | Next.js/shadcn frontend, live feature-map visualization |

See `AGENTS.md` for frontend AI-assistant guidelines, `docs/api-contract.md`
for the interface both sides build against, and
[`docs/deployment.md`](docs/deployment.md) for the hosted Vercel/Render/Runpod
setup so the whole team (not just whoever has a tunnel open) can hit a live
URL.

Repository owner and deployment documentation: [outsidermm](https://github.com/outsidermm).
The NLA models and inference client are upstream work by
[Kit Fraser-Taliente and coauthors](https://transformer-circuits.pub/2026/nla/index.html).

## Repo layout

```
apps/web/    Next.js + TypeScript + shadcn/ui frontend
apps/api/    FastAPI backend — live Qwen text bridge; activation stream pending
docs/        API contract, Runpod runbook, deployment guide, orchestration design
docker-compose.yml   Postgres (local dev)
render.yaml  Render Blueprint — provisions the hosted API + Postgres
```

## Quick start

**Backend** (legacy WebSocket with live Qwen text through a private tunnel):

```bash
cd apps/api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Health check: `curl localhost:8000/api/health`
This command runs the API locally. To get real Qwen output, start the A100
model server and SSH tunnel described in [the inference runbook](docs/runpod-inference.md).
Without them the WebSocket reports that Qwen is unavailable. Activation
features and steering are not connected. The current
[API contract](docs/api-contract.md) covers the WebSocket; the
[conversation harness design](docs/target-harness-contract.md) is a possible
future direction. For the planned path from live generation to explanation
and task steering, see
[the orchestration design](docs/orchestration.md).

**Frontend**:

```bash
cd apps/web
npm install
cp .env.example .env.local   # or copy the NEXT_PUBLIC_* vars from the root .env.example
npm run dev
```

Open http://localhost:3000, type a prompt, and press run. With the A100 and
SSH tunnel active, the answer streams from Qwen. The activation map and
steering are still pending; the UI does not claim they are live.

**Postgres** (not wired into the API yet — bring it up once you know what
you're persisting):

```bash
docker compose up -d
```

## Deployed

Once set up per [`docs/deployment.md`](docs/deployment.md), the team shares
one live URL instead of everyone needing their own tunnel:

- Frontend: Vercel (fill in once deployed)
- API: Render (fill in once deployed)

## Status

- [x] Repo scaffolded, frontend and backend build/typecheck clean
- [x] Legacy WebSocket with a tested live Qwen text bridge
- [x] Dockerfile + Render Blueprint + Vercel setup so the API/DB and
      frontend deploy to shared URLs (`docs/deployment.md`)
- [ ] Runpod reachable from the hosted API (currently a private tunnel;
      James is bridging this — see `docs/deployment.md` §3)
- [ ] Real activation events and steering in the current WebSocket contract
- [x] Download Qwen2.5-7B-Instruct, NLA AV, and NLA AR checkpoints to the
      Runpod Global volume; verify one AV random-vector smoke test
- [ ] Validate AV on real Qwen layer-20 activations and AR reconstruction
- [ ] Real activation hooks replacing placeholder `/api/features` data
- [ ] Real three.js/D3 force-layout visualization replacing the placeholder
      SVG scatter in `apps/web/src/components/observatory/observatory.tsx`
- [ ] Failure-signature flagging (hedging/refusal/unsupported) tuned against
      the real model instead of the mock's keyword heuristic
- [ ] Demo framing + video
