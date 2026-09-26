# Interpretability Observatory — HackGT 13, Oracle of the Deep

Watch Qwen2.5-7B answer while seeing summaries of its internal activations,
and steer it mid-answer. Answers stream live from SGLang. Before each section,
the browser shows an interpretation of Qwen's replayed layer-20 state from a
Natural Language Autoencoder (NLA) activation verbalizer. Qwen also suggests
2-3 other directions it could take. Click one, or type your own, and the answer
branches from that point. The kept text stays, and a block-20 contrastive
activation steer, anchored with the new section's opening, redirects what
follows. Branches can be steered again.

```
browser (Next.js) ──ws──▶ FastAPI (apps/api)
                              ├─▶ SGLang :30001   Qwen2.5-7B answer + helper calls
                              └─▶ sidecar :30003  HF Qwen: replay, /contrast, /steer, /score
                                     └─▶ SGLang :30002  NLA activation verbalizer (AV)
```

The 3D fish-brain feature map is ready for activation events (`?features=test`
shows it with a test layout). The backend does not emit those events yet, and
`/api/features` serves placeholder data.

## Results

In a live 43-case benchmark across 20 prompts, the steered branch reached its
requested direction and ended within its token cap in 21 cases; an identical
branch with the same anchored opening but no activation steer did so in 19.
Re-prompting from the start succeeded in 22. Among the 16 cases where both
steering and re-prompting succeeded, steering used a median 46% fewer generated
tokens. The anchor-only branch saved a similar 47% on its 15 paired successes;
steering used 3% more tokens than anchor-only on their 19 paired successes.
These results support keeping the answer prefix at a checkpoint, but do not
establish a separate token-saving benefit from the activation vector.

This small, model-judged benchmark has multiple cases per prompt, asymmetric
answer scoring, and many generations that hit the token cap. The steered timing
also includes its AV readings and AR score, so the timing columns do not
compare like-for-like latency. See the
[full method, cases, and example outputs](docs/benchmarks/steer-tokens.md).

## Team

| Person | Owns |
|---|---|
| Kareem + James | NLA vs. SAE decision, activation hooks, model integration, FastAPI/websocket backend |
| Samuel + Hari | Next.js/shadcn frontend, live feature-map visualization |

See `AGENTS.md` for frontend AI-assistant guidelines, `docs/api-contract.md`
for the interface both sides build against, and
[`docs/deployment.md`](docs/deployment.md) for the hosted Vercel/Runpod
setup so the whole team (not just whoever has a tunnel open) can hit a live
URL. Design: see [docs/design-system.md](docs/design-system.md).

Repository owner and deployment documentation: [outsidermm](https://github.com/outsidermm).
The NLA models and inference client are upstream work by
[Kit Fraser-Taliente and coauthors](https://transformer-circuits.pub/2026/nla/index.html).

## Repo layout

```
apps/web/    Next.js + TypeScript + shadcn/ui frontend
apps/api/    FastAPI backend — live Qwen text + AV checkpoints; feature-map events pending
docs/        API contract, Runpod runbook, deployment guide, orchestration design
vercel.json  Vercel Services — web + API on one domain, API duration 300s
```

## Cloud checks and deployment

GitHub Actions runs Ruff and the API unit tests on Python 3.12, plus frontend
lint, tests, and a type-checked production build on Node 24. The workflow runs
for pull requests to `main`, pushes to `main`, and manual dispatches. To keep
production changes behind these checks, require both `API / Ruff and tests`
and `Web / lint, tests, build` in the GitHub `main` branch rules.

The connected Vercel project creates a Preview deployment for branch pushes
and deploys `main` to production after merge.
GitHub Actions and Vercel run independently; the branch rule is what prevents
merging a failing PR. See
[`docs/deployment.md`](docs/deployment.md) for the Runpod URL and Vercel
environment variables needed for live Qwen streaming.

## Quick start

**Backend** (current WebSocket with live Qwen text and optional AV checkpoints):

```bash
cd apps/api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Health check: `curl localhost:8000/api/health`
This command runs the API locally. To get real Qwen output, start the A100
model server and SSH tunnel described in [the inference runbook](docs/runpod-inference.md).
Without them the WebSocket reports that Qwen is unavailable. The current
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
SSH tunnel active, the answer streams from Qwen with live AV readings,
alternatives, and steerable branches. The 3D activation map still uses
placeholder data.

## Deployed

Follow [`docs/deployment.md`](docs/deployment.md) to create one Vercel project
from the repository root using **Services (Beta)**:

- Frontend: `https://<project>.vercel.app/` (fill in once deployed)
- API: `/api/health`, `/api/features`, and `/ws/stream` on the same domain

Set `QWEN_API_BASE`, `QWEN_API_KEY`, `QWEN_MODEL`, `CORS_ORIGINS`, `AV_API_BASE`,
and `AV_API_KEY` in the project's environment settings. James must supply a Qwen
HTTPS URL reachable from Vercel, plus the Runpod AV sidecar's public URL (see
[the inference runbook](docs/runpod-inference.md)). Explicitly set `NEXT_PUBLIC_API_BASE` to an empty string
and `NEXT_PUBLIC_WS_URL=/ws/stream`, then rebuild. Unset values still fall
back to localhost for local development. `CORS_ORIGINS` controls HTTP CORS
only; the current WebSocket accepts any origin and has no authentication or
application-level generation rate limit. `AV_CONCURRENCY` is per run, not a
service-wide limit; decide public-demo admission controls before promotion.

Services uses Fluid Compute by default; the API has a 300-second connection
limit. Long generations or idle tabs can hit that limit; the current frontend
reconnects automatically with backoff. Interrupted runs are not resumed; press
Run or Rerun after reconnection to start again. See the deployment guide for plan
limits and validation steps. Deployment requires a Vercel account with repo access
and Services Beta availability; the guide documents the two-project fallback.

## Status

- [x] Repo scaffolded; frontend production build/typecheck/lint and API tests pass
- [x] Current WebSocket with a tested live Qwen text bridge and replayed AV checkpoints
- [x] Show AV readings, alternatives, and steered branches in the frontend
- [x] Vercel configuration and guide for frontend + API (`docs/deployment.md`)
- [ ] Validate hosted Qwen streaming and WebSocket duration/reconnect behavior
- [x] Runpod public proxy setup and authenticated service launch scripts documented
      (`docs/runpod-inference.md`); verify current Pod reachability before the demo
- [x] Steering (`steer` → `branch`) in the current WebSocket contract
- [ ] Real activation events for the feature map
- [x] Download Qwen2.5-7B-Instruct, NLA AV, and NLA AR checkpoints to the
      Runpod Global volume; verify one AV random-vector smoke test
- [x] Replay real Qwen layer-20 activations for experimental AV readings (runbook)
- [ ] Original-generation activation capture and AR reconstruction validation
- [ ] Real activation hooks replacing placeholder `/api/features` data
- [x] 3D fish-brain feature map for planned activation events, with keyboard selection
- [ ] Failure-signature flagging (hedging/refusal/unsupported) tuned against
      the real model instead of the mock's keyword heuristic
- [ ] Demo framing + video
