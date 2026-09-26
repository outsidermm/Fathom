# Pre-demo audit — verified follow-up to PR #10

Audited September 26, 2026, directly on `samuel/full-audit`, as requested.
PR #10 was **open and unmerged** at the start. Baseline: audit commit
`3cbb1ba`, based on main `ff7f778`. A fresh fetch confirmed both remote
heads remained there during this pass. The open-PR list contained only #10;
there was no separate open Hari PR. All ownership restrictions still apply.
This report supersedes the earlier PR description; existing fixes are
identified separately from new work. No merge or deployment was performed.

**Demo-critical remaining work:** the frontend still discards the live AV
payload, and the public generation endpoint still lacks application auth,
Origin validation, and aggregate admission limits. Neither is silently
implemented here: AV presentation and rate-limit policy require team decisions.

## 1. Cross-file contract consistency

Checked `apps/api/app/schemas.py`, `apps/web/src/lib/contract.ts`, the complete
current API contract, every producer, and the store's actual dispatch path.

- **Preserved from the initial audit:** matching optional activation
  explanations in Pydantic/TypeScript/docs. Reserved `gemma-2b` remains
  explicitly rejected at runtime; simplified the earlier comment, because a
  disabled UI option does not itself require a backend wire type.
- **Fixed:** several status send paths emitted null optional fields even
  though TypeScript and the contract require absent fields. Stop now emits
  exactly `{type: "status", state: "idle"}`; error paths also omit unset
  checkpoint/label/count fields (`apps/api/app/main.py:108`,
  `apps/api/app/qwen_stream.py:327`). Mock activation serialization now omits
  an absent explanation (`apps/api/app/mock_stream.py:87`).
- **Fixed:** AV timing fields can be null under the existing schema and
  serializer; TypeScript now permits this (`apps/web/src/lib/contract.ts:56`,
  `apps/api/app/schemas.py:106`). Focus already allowed null.
- **Corrected an overclaim:** AV readings do not invariably arrive before
  their section. The existing hold-timeout regression explicitly expects a
  late reading. Documented paced timeout/unpaced ordering and Python Unicode
  code-point offsets; a future JS consumer must not slice UTF-16 strings with
  these offsets directly. No protocol redesign.
- **Flag, P1:** `apps/web/src/lib/stream-store.ts:112` handles token,
  activation, flag, and terminal status only. It drops `av`, `av_error`,
  `inspecting`, and the done-event `av_dropped` count. The backend really emits
  these; type agreement is not UI integration. No new AV UI built.
- Confirmed `/api/features` is placeholder data; activation/flag events are
  not emitted by the **routed** backend. `run_mock_stream` still produces
  synthetic events but is not invoked by `main.py`.
- Searched harness terminology across tracked source/docs. No live harness
  routes or persistence appeared. Kept the explicit exclusion in the current
  contract, Git-branch wording in the historical roadmap, the clearly planned
  steering design in `docs/orchestration.md:19`, and the Qwen markup observation
  in `docs/runpod-inference.md:187`. Treating those literal word matches as
  implemented harness regressions would be a false positive.

## 2. Frontend build and code health

**Validation:** the requested `rm -rf node_modules .next && npm install &&
npm run build` completed successfully on Node 24.21.0/npm 11.19.0. Google Fonts
were reachable. Production build, `npx tsc --noEmit`, `npx eslint .`, and
**9/9 frontend tests** pass after fixes. npm reported zero vulnerabilities.
The test runner gives a non-fatal module-type detection warning for native
TypeScript imports; no package-wide module conversion was needed.

- **Preserved from the initial audit:** RunCompare's status/id subscriptions
  avoid token-driven rerenders; unused `@radix-ui/react-tabs` remains removed.
- **Fixed with failing-then-passing regressions:** Stop before a rerun socket
  opens used to send the queued start anyway; a failed connection replayed a
  queued start after marking its run failed; starting during backoff let an
  old timer create a second socket and invalidate the working one.
  `apps/web/src/lib/stream-store.ts:174`, `:206`, `:321` clear pending work and
  timers and guard against duplicate sockets. Final unmount cancels queued
  generation and marks an unfinished run stopped (`:250`). Tests also check
  that stale socket events cannot populate a newer run.
- **Fixed:** PromptConsole subscribed to the entire active run and rerendered
  on every text delta. It now subscribes to status/message primitives; the
  prompt textarea has the backend's 16,000-character upper limit
  (`apps/web/src/components/observatory/prompt-console.tsx:17`, `:61`).
- **Fixed:** explicit JavaScript smooth scrolling ignored reduced-motion
  preferences (`token-stream.tsx:22`); slider accessibility labels were on
  the wrapper rather than its actual focusable thumb (`ui/slider.tsx:57`).
- **Fixed:** the tour described currently unavailable map/steering behavior
  as live. Copy now states the integration limits (`coach-marks.tsx:12`).
- Local production browser check: revised tour appears, Escape dismisses it,
  prompt maxlength is 16000, and keyboard focus on a sample prompt has a solid
  visible outline. No live GPU prompt was submitted.
- Applied the installed React performance skill and fetched current
  [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).
  Both skills are recorded in the **root** `skills-lock.json`; there is no
  `apps/web/skills-lock.json`. Read the installed Next.js client-boundary docs.
- All remaining direct runtime dependencies are imported or required by
  Next.js (`react-dom` also appears in tests). CSS imports account for
  `tw-animate-css`. No direct prerelease/canary pin or further confident
  removal candidate was found. No extra dependencies added. Backend
  `sqlalchemy`/`asyncpg` remain unused by the current app but are retained
  with the explicitly deferred persistence setup, rather than removed by guesswork.

**Hari/ownership flags, unchanged:**

- `feature-map/feature-map.tsx:402`: the keyboard controller has `role="img"`;
  node buttons at `:413` have `tabIndex={-1}`. Screen-reader keyboard behavior
  needs a browser/AT-specific review and an appropriate interaction pattern.
- `feature-map/feature-map.tsx:404`, `:429`: arrow navigation changes the canvas
  accessible name, so the earlier claim of *no* accessible feedback was too
  categorical. It still does not update the live region or focused node;
  announcements cannot be assumed. `:416` describes pointer-hovered nodes
  only, not the keyboard-selected tooltip.
- `feature-map/feature-map.tsx:352`: new feature arrays recreate the animation
  effect and observer. `connected-deep.tsx:35` publishes new arrays as node
  coordinates arrive. This is a plausible scale concern, not a measured hitch.
- `diagnostics-feed.tsx:51` rebuilds the token lookup each token; the full run
  subscription in `connected-deep.tsx:112` drives it. Low priority at demo scale.
- `connected-deep.tsx:76` snapshots the canvas for Pause Motion while the live
  canvas continues animating underneath; the control freezes the view but
  does not reduce that render-loop CPU cost. Owner confirmation is required.

## 3. Backend code health

Read the complete bridge, Qwen SSE/AV scheduling code, checkpoint selector,
schemas, text cleanup, mock producer, and Pod sidecar/launchers.

**Validation:** clean isolated **Python 3.12.14** environment installed the
unchanged `requirements.txt`. Baseline **26/26** tests passed; final
**35/35** pass, including with `CORS_ORIGINS=https://audit.example` in the
test process. Python compile checks and `bash -n` pass. Resolved key versions:
FastAPI 0.141.1, Starlette 1.7.0, Pydantic 2.13.5, HTTPX 0.28.1, Uvicorn 0.54.0.
Starlette currently warns that HTTPX TestClient support is deprecated in favor
of httpx2; it still works. A dependency migration/pinning policy is deferred.

- **Preserved from the initial audit:** validation for all client message
  types and CORS/Origin coverage. Added explicit malformed text, non-object
  JSON, binary-frame, blank-prompt, unknown-type, and unknown-feature checks.
- **Fixed:** cleanup only ran on `WebSocketDisconnect`, so another receive/send
  transport failure could leave generation running. Cleanup is now in
  `finally` (`apps/api/app/main.py:149`). Completed send tasks are also awaited,
  suppressing only cancellation and disconnect/OS transport errors (`:66`).
  The earlier low-confidence task-cleanup concern has a deterministic
  reproduction now; arbitrary exceptions are not broadly swallowed.
- **Fixed:** upstream JSON such as `null`, arrays, null choices, and null deltas
  raised uncaught TypeError/AttributeError, leaving the browser waiting with
  no terminal event. Structural validation turns these into the existing
  terminal error path (`apps/api/app/qwen_stream.py:75`).
- **Fixed:** `AV_CONCURRENCY=inf/nan` could fail before the stream's error
  handler, and non-finite hold values broke bounded-hold expectations.
  Shared tuning parsing falls back for non-finite/negative/invalid values
  (`qwen_stream.py:165`). Finite zero hold remains supported.
- **Fixed:** checkpoint word-offset arithmetic was wrong with repeated words
  and repeated whitespace. `1. A          a a a a a a a a a a a` sampled after
  three words instead of eight. Source-span offsets fix it
  (`apps/api/app/checkpoints.py:45`); the initial audit's blanket correctness
  claim was not justified.
- **Fixed:** the initial CORS tests depended on the developer's environment
  having the default origin. They now load a separate app with an explicit
  nondefault origin and disabled dotenv loading (`test_cors_and_ws_origin.py:48`).
- Existing tests cover ordered paced checkpoints, AV failure preserving text,
  holds expiring, dropped readings, bounded per-run AV concurrency, and
  cancellation without late AV events. Unknown feature clamps remain an
  explicit unsupported-operation error, independent of dictionary membership.
- `.python-version` and Docker select Python 3.12. The machine's existing
  `.venv` was Python 3.11 and lacked HTTPX; it was left untouched. `pyrefly.toml`
  still points at that local venv and excludes GPU-only `pod/`; no claim of a
  successful pyrefly run. Recreate that local venv with 3.12 before using it.
- **Flag, P1:** no application rate limiter or global generation cap exists.
  `qwen_stream.py:191` creates a semaphore **per run**. Multiple sockets bypass
  that aggregate bound. Stop cancels bridge tasks/HTTP requests; it does not
  prove a synchronous Pod `/explain` worker has stopped GPU computation.
  Choose admission/cancellation policy with the backend owners.

## 4. Deployment configuration

Re-derived routes from the real app and rechecked current official
[Services configuration](https://vercel.com/docs/services/config-reference),
[routing](https://vercel.com/docs/services/routing),
[Fluid compute](https://vercel.com/kb/guide/vercel-services-fluid-compute),
[WebSockets](https://vercel.com/docs/functions/websockets), and
[duration](https://vercel.com/docs/functions/configuring-functions/duration) docs.

- No `vercel.json` change needed: `services.api.root = apps/api/`,
  `entrypoint = app.main:app`, and service-relative
  `functions["app/main.py"].maxDuration = 300` agree with the code/config model.
  `/api/(.*)` covers health/features; `/ws/(.*)` covers the stream; web is last.
- FastAPI's implicit `/docs`, `/redoc`, `/openapi.json`, and OAuth redirect
  documentation routes do **not** enter the API service under those rewrites.
  They are not promised public application endpoints; no extra rewrite added.
  Pod `/health` and `/explain` belong to a different app and remain separate.
- Current official docs do support FastAPI ASGI WebSockets on Fluid Compute.
  Do not apply the old blanket claim that Vercel cannot host WebSockets.
  Account availability, deployment protection, and live hosted timing remain
  unverified; a correct config is not a deployment smoke test.
- **Corrected docs:** reconnect behavior, automatic `apps/api/.env` loading,
  AV variables in the two-project fallback, and connection-age behavior.
  Waiting before the first run consumes socket lifetime; later runs use new
  sockets. There is no automatic generation replay after reconnection.
- Cross-checked every app-read env name: QWEN base/key/model, AV base/key,
  hold/concurrency, CORS, and three NEXT_PUBLIC variables. Root/web examples
  cover them; no API `.env.example` exists. `DATABASE_URL` is intentionally
  deferred. Pod-specific model paths and AV decode settings remain runbook
  concerns, not frontend or Vercel runtime requirements.
- Single Services project remains primary. Two-project fallback and inactive
  Render/Docker files remain clearly labeled. **Flag:** retain/remove the
  latter is a team decision; no files removed or providers changed.

## 5. Design system consistency

- Checked all 33 single-color palette rows plus five glow steps against
  `globals.css` and their Tailwind `--color-*` mappings: values agree.
  Extra literal wood/chalkboard/shadow colors are prescribed in design-system
  sections 6/9; alpha-black shadows are not a second semantic palette.
- **Resolved by actual browser computed styles on https://hack.gt/:**
  “Friday, September 25” is `rgb(8,113,163)` = `#0871a3`;
  “Oracle of the Deep” is `rgb(14,99,152)` = `#0e6398`.
  Both reports sampled real site colors. The app keeps its existing date-heading
  blue; no basis exists for declaring the other sample erroneous.
- Updated `docs/design-system.md:41` with the evidence and narrowed the token's
  source label. Both contrast values remain valid: approximately 4.74 and 5.67
  against paper. No global palette change was warranted.
- Verified Darumadrop One on date/track headings and the About nav link; Sen
  on About body text. Documented that this app's Sen UI is a readability choice.
  No font swap is justified solely by that nav difference.
- **Flag for Hari:** `apps/web/src/app/styleguide/page.tsx:30` displays
  `#0e6398` next to a swatch actually rendered with `var(--harbor)` = `#0871a3`.
  Align its label and harbor fallbacks in `feature-map-demo.module.css:34`,
  `feature-search.module.css:27`, `diagnostics-feed.module.css:26`,
  `sea/sea.module.css:120`, and `styleguide.module.css:22` with the selected
  app token. These protected files were not edited.

## 6. Security and secrets

- Scanned all **373 reachable historical file blobs** after fetching refs
  (non-shallow repository), rather than only current files. Looked for provider
  token formats, private-key headers, long bearer literals, credential URLs,
  and key/token/password assignments; candidate output contained locations
  only. Four initial assignment matches were empty example values crossing
  into the next line; a line-bounded rescan had no candidates. No committed
  real `.env*`, `secrets.env`, or common SSH private-key filename was found.
  This is a pattern-based reachable-history check, not a guarantee about
  deleted/unreachable objects, external logs, or arbitrary encoded credentials.
- **Fixed:** root/API `.env.local` and `.env.production` were not ignored.
  Root `.gitignore:10` now covers `.env` variants throughout the tree, retaining
  `.env.example`, and ignores `secrets.env`, PEM, and `.key` files. Verified
  representative paths with `git check-ignore`; examples remain trackable.
- **Fixed, P1:** `pod/restart_sidecar.sh` previously continued when sourcing
  the secret file failed and could launch on `0.0.0.0` with an empty key, which
  disables sidecar auth. It now fails before killing/restarting services on
  missing or empty credentials (`:3`, `:7`). The main launcher also rejects
  empty Qwen/AV keys (`pod/start_services.sh:22`). Regression tests execute only
  the configuration preambles against temporary fixtures; no Pod was touched.
- **Flag:** the public browser bridge's no-auth/no-Origin/no-rate-limit
  combination still permits generation abuse even though Pod endpoints use
  bearer keys. HTTP CORS cannot prevent it. Vercel firewall rate limits apply
  to upgrade requests, not every subsequent start message. Provider-side
  settings were not inspected or changed.

## 7. Documentation accuracy

- Corrected README/deployment claims that a reload is required to reconnect,
  that API dotenv is never loaded, that Runpod has only a private-tunnel setup,
  and that real replayed AV has not been exercised. Distinguished prior
  runbook observations from current hosted validation.
- README and the API contract now explicitly disclose the missing AV UI.
  The runbook no longer claims that the current UI leads with AV detail when
  it does not display AV at all (`docs/runpod-inference.md:212`).
- Deployment URL remains explicitly TBD; did not invent a public endpoint.
  Preserved the initial audit's roadmap completion banner and historical plan;
  Phases 0–3 components landed, but that does not imply live map/steering or
  AV UI integration. Removed the stale pending-branch review instruction.
- Current docs retain their primary Services deployment path and separate
  future orchestration/harness design. No future endpoints became requirements.

## 8. Fix versus flag and review boundary

This follow-up adds verified lifecycle, input/serialization, checkpoint,
credential-guard, accessibility/performance, and documentation fixes directly
above the original audit. Regression tests reproduced failures before fixing
the bridge/store/checkpoint paths; nine new API tests and three store tests
now protect them. Existing audit fixes remain part of this PR, not new discoveries.

Team decisions still required, in priority order:

1. **P1:** consume/display the live AV readings and inspecting/error states.
2. **P1:** choose public generation admission controls and verify hosted/GPU
   operation, including concurrent requests and connection expiry.
3. **P2:** Hari's map accessibility/animation concerns and styleguide mismatch;
   establish ownership before changing `connected-deep.*`.
4. **P3:** local Python venv repair, dependency locking/httpx2 migration, and
   retain/remove inactive Render/Docker files.

No file under `feature-map/`, `sea/`, or `app/styleguide/` was changed, nor
legend, diagnostics-feed, feature-search, connected-deep, or their CSS modules.
No AV UI, steering integration, rate-limit policy, merge, or deployment added.
