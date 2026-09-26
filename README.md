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

## Repo layout

```
apps/web/    Next.js + TypeScript + shadcn/ui frontend
apps/api/    FastAPI backend — currently a mock activation stream
docs/        API contract, decisions
docker-compose.yml   Postgres
```

## Quick start

**Backend** (mock model pipeline, real contract):

```bash
cd apps/api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Health check: `curl localhost:8000/api/health`

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
- [x] Mock websocket stream matching the real contract — frontend can build
      against this without waiting on the model pipeline
- [ ] NLA vs. SAE decision (validate NLA via Neuronpedia's hosted demo first;
      fall back to SAE/Gemma Scope if it's not clearly better by the team's
      cutoff time)
- [ ] Real activation hooks replacing `apps/api/app/mock_stream.py`
- [ ] Real three.js/D3 force-layout visualization replacing the placeholder
      SVG scatter in `apps/web/src/components/observatory/observatory.tsx`
- [ ] Failure-signature flagging (hedging/refusal/unsupported) tuned against
      the real model instead of the mock's keyword heuristic
- [ ] Demo framing + video
