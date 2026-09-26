# Interpretability Observatory — HackGT 13, Oracle of the Deep

A live, navigable map of what's happening inside a language model as it
generates — click a feature, clamp it, regenerate, watch the output change.

## Team

| Person | Owns |
|---|---|
| Kareem + James | NLA vs. SAE decision, activation hooks, model integration, FastAPI/websocket backend |
| Samuel + Hari | Next.js/shadcn frontend, live feature-map visualization |

See `AGENTS.md` for frontend AI-assistant guidelines and `docs/api-contract.md`
for the interface both sides build against.

Repository owner and deployment documentation: [outsidermm](https://github.com/outsidermm).
The NLA models and inference client are upstream work by
[Kit Fraser-Taliente and coauthors](https://transformer-circuits.pub/2026/nla/index.html).

## Repo layout

```
apps/web/    Next.js + TypeScript + shadcn/ui frontend
apps/api/    FastAPI backend — currently a mock activation stream
docs/        API contract, Runpod runbook, live orchestration design
docker-compose.yml   Postgres
```

## Quick start

**Backend** (legacy mock stream for local UI development):

```bash
cd apps/api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Health check: `curl localhost:8000/api/health`
This command runs the mock API, which does not implement the target
[conversation contract](docs/api-contract.md). For the separate Runpod model setup, see
[the inference runbook](docs/runpod-inference.md). For the planned path from
live generation to explanation and task steering, see
[the orchestration design](docs/orchestration.md).

**Frontend**:

```bash
cd apps/web
npm install
cp .env.example .env.local   # or copy the NEXT_PUBLIC_* vars from the root .env.example
npm run dev
```

Open http://localhost:3000 — type a prompt, hit run, watch fake features
light up. Click a dot in the map to clamp that feature and re-run.

**Postgres** (not wired into the API yet — bring it up once you know what
you're persisting):

```bash
docker compose up -d
```

## Status

- [x] Repo scaffolded, frontend and backend build/typecheck clean
- [x] Legacy mock WebSocket stream for early frontend development
- [ ] Live conversation API, history, attachments, replies, tool events,
      inspection, and steering from the target contract
- [x] Download Qwen2.5-7B-Instruct, NLA AV, and NLA AR checkpoints to the
      Runpod Global volume; verify one AV random-vector smoke test
- [ ] Validate AV on real Qwen layer-20 activations and AR reconstruction
- [ ] Real activation hooks replacing `apps/api/app/mock_stream.py`
- [ ] Real three.js/D3 force-layout visualization replacing the placeholder
      SVG scatter in `apps/web/src/components/observatory/observatory.tsx`
- [ ] Failure-signature flagging (hedging/refusal/unsupported) tuned against
      the real model instead of the mock's keyword heuristic
- [ ] Demo framing + video
