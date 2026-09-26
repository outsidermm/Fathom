# Frontend roadmap: Fri 9:00 PM → Sat 12:00 AM (3 hours)

> **Status: Phases 0-3 below are done and merged.** Phase 1 (theme/sea
> primitives) landed in PR #4 (`samuel/frontend-phases-review`); Phase 2/3
> (feature map, legend, diagnostics feed, feature search) landed in PR #7
> (`hari/p3-demo`); the Phase 3 stretch goal (first-visit coach marks) landed
> in PR #8 (`samuel/coach-marks`); and further UI polish landed in PR #9
> (`kareem/ui-refinements-1`). The backend has since moved beyond this
> roadmap's plan too — PR #3 (`xjm/av-impl`) added the live NLA "AV"
> checkpoint-reading stream described in `docs/api-contract.md`, which this
> document's Phase-2 "contract asks" (§6) predate and don't reflect. Treat
> everything below as the historical plan that got this far, not the
> in-progress state of the app; `README.md`'s Status section and
> `docs/api-contract.md` are the current source of truth for what's actually
> built today.

**Owners:** Samuel (Surface: theme, app shell, state) · Hari (the Deep:
feature map, sea decorations). Swap the names if the split fits better the
other way. The split is by *file ownership*, so two Codex sessions never
edit the same file at once.

**Read first:** `docs/design-system.md` (the look), `docs/api-contract.md`
(the data). The backend now streams live Qwen text. Activation and flag events,
feature coordinates in the dictionary, and steering are still pending. The
frontend can handle the planned event shapes, but the full demo loop below
requires those backend capabilities. Do not present placeholder feature data
as Qwen internals.

**End state at midnight:** the app is fully re-themed to the HackGT seaside
look, and against the mock you can type a prompt → watch tokens surface
and features glow in the Deep → click a feature → clamp it → rerun → see
the baseline and steered outputs side by side, with flags pinging. That
loop is the demo.

---

## Timeline at a glance

| Time | Samuel (Surface) | Hari (Deep) | Sync |
|---|---|---|---|
| 9:00–9:20 | P0 setup | P0 setup | both see the mock stream in the browser |
| 9:20–10:10 | P1-S: tokens, fonts, restyle primitives, docs | P1-H: sea decor, WaveDivider, DeepViewport, `/styleguide` | **10:10 merge #1** (5 min) |
| 10:15–11:00 | P2-S1: stream store (critical path) → TopBar, PromptConsole | P2-H1: FeatureMap canvas against the store interface | — |
| 11:00–11:10 | ⏱ NLA-vs-SAE call; Kareem/James answer the contract asks (§6) | same | **11:00 sync** with Kareem/James |
| 11:10–11:40 | P2-S2: TokenStream, FeatureInspector + clamp slider, ClampTray | P2-H2: cluster labels, pulse/ping, hover/select, Legend | **11:40 merge #2** |
| 11:40–12:00 | P3-S: RunCompare, rerun loop, keyboard pass | P3-H: DiagnosticsFeed, FeatureSearch (⌘K) | **12:00 merge #3** + screen recording |

If you fall behind, cut from the bottom of each column. Never cut the store
(P2-S1) or the map (P2-H1).

---

## Git rules (read once)

- Branch per person per phase: `samuel/p1-theme`, `hari/p1-sea`, and so on.
  Merge to `main` only at the sync times. `git pull --rebase origin main`
  right after each merge.
- **File ownership** (don't edit the other person's files; ask in chat):

| Samuel owns | Hari owns |
|---|---|
| `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx` | `src/app/styleguide/page.tsx` |
| `src/components/ui/*` | `src/components/sea/*` (incl. `decor/`) |
| `src/lib/stream-store.ts`, `src/lib/contract.ts`, `src/hooks/*` | `src/components/observatory/feature-map/*` |
| `src/components/observatory/{top-bar,prompt-console,token-stream,feature-inspector,clamp-tray,run-compare}.tsx` | `src/components/observatory/{legend,diagnostics-feed,feature-search}.tsx` |
| `AGENTS.md`, `README.md` | — |

- Need a new token? Hari asks Samuel (Samuel owns `globals.css`).
- Every PR description includes a screenshot.

---

## Phase 0 (9:00–9:20, both): setup

1. Pull the repo. Put this file and `design-system.md` in `docs/` (Kareem
   may have already committed them).
2. Terminal 1: `cd apps/api && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000`
3. Terminal 2: `cd apps/web && npm install && npm run dev`, then open
   http://localhost:3000, type a prompt, and press run. You should see dots
   appear.
4. Codex skills, from the repo root:
   ```bash
   npx skills add vercel-labs/agent-skills --skill web-design-guidelines
   npx skills add vercel-labs/agent-skills --skill vercel-react-best-practices
   ```
   Then **start a fresh Codex session** so it loads them.
5. One of you runs the §10 snippet from `design-system.md` on hack.gt and
   pastes the result in chat.

**Done when:** both machines show the mock stream at localhost:3000.

---

## Phase 1 (9:20–10:10): re-theme

### P1-S (Samuel): tokens, fonts, primitives, docs

Paste into Codex:

> Read `docs/design-system.md` completely, then `AGENTS.md` and
> `docs/frontend-roadmap.md` §Phase 1. We're replacing the monochrome shadcn
> theme with the HackGT "Surface & Deep" theme. Do everything in
> design-system.md §9 **for these files only**: `apps/web/src/app/globals.css`,
> `apps/web/src/app/layout.tsx`, `apps/web/components.json`,
> `apps/web/src/components/ui/{button,card,input}.tsx`, `AGENTS.md`,
> `README.md`, and delete the default `apps/web/public/*.svg`. Keep shadcn's
> semantic token names but map them onto the new palette exactly as §9 lists.
> Expose every §3 token as a Tailwind color. Add the §7 keyframes and the
> reduced-motion rule. Then run `npx shadcn@latest add tabs accordion slider tooltip dialog command`
> and restyle each to its §6 primitive (CrateTabs, Plank accordion, clamp
> Slider with the §3 diverging track, Paper tooltip, Dialog, Command).
> Update `observatory.tsx` only enough to compile with the new tokens. Finish
> by running the §11 acceptance checks and fixing anything they report.
> Don't touch `src/components/sea/` or `src/app/styleguide/`; those are
> Hari's.

**Done when:** §11 checks pass, the home page is sand/teal/gold with the new
fonts, and there are no gray or black leftovers.

### P1-H (Hari): sea primitives and styleguide

Paste into Codex:

> Read `docs/design-system.md` completely (especially §6, §7, §8). Build the
> decorative "sea" primitives in `apps/web/src/components/sea/`: `WaveDivider`
> (SVG wave with foam stroke and 2 parallax layers using the `drift` keyframe),
> `SeaPanel` (water surface with an SVG caustic ripple pattern), `DeepViewport`
> (the `--trench`→`--deep`→`--abyss` gradient container, WaveDivider on its
> top edge, faint caustic shimmer; it takes `children` and fills its parent),
> `PaperNote` (pinned and tilted, with `rotate` and `pin` props), `Plank` (wood
> grain via §6a, irregular edge via clip-path), `Chalkboard`, and
> `decor/{Starfish,Shell,Pebbles,Anglerfish}.tsx` as original, simple SVGs.
> §8: do NOT copy any HexLabs artwork, the bear, the logo, or MLH marks.
> Use only the CSS variables from design-system.md §3 (Samuel is adding
> them to globals.css in parallel; if one's missing when you run, add a
> local fallback like `var(--sand, #e5ccae)` and tell Samuel). Then create
> `apps/web/src/app/styleguide/page.tsx` that shows every §3 color swatch
> with its name and hex, the four type roles at each scale step, every sea
> primitive, and every `components/ui` primitive. Respect
> prefers-reduced-motion. Don't edit globals.css, layout.tsx, or
> components/ui.

**Done when:** `/styleguide` shows everything, and `DeepViewport` renders
correctly at full-screen and half-screen sizes.

### 10:10 merge #1 (5 min)

Merge both branches, run `npm run build`, and click through `/` and
`/styleguide`. Fix clashes right away.

---

## Phase 2 (10:15–11:40): the components that connect to the backend

### The layout they plug into

```
┌──────────────────────── TopBar (sand-light pill) ─────────────────────────┐
│ wordmark · model select · ConnectionBadge                     [Run ▸ gold]│
├──────────────── PromptConsole (sand) ─────────────────────────────────────┤
│ prompt textarea · sample-prompt chips · Run / Stop / Rerun                │
├───────────────────────────────────────────────┬───────────────────────────┤
│ ~~~~~~~~~~~~~~~ WaveDivider ~~~~~~~~~~~~~~~~~~ │ FeatureInspector          │
│                                               │  (PaperNote)              │
│        FeatureMap inside DeepViewport         │  label · cluster · desc   │
│   glowing nodes · cluster labels · ping       │  sparkline over tokens    │
│                                               │  clamp Slider  −1 … +1    │
│                              Legend (corner)  │  [Rerun with clamp]       │
├───────────────────────────────────────────────┤ ClampTray (chips)         │
│ TokenStream (paper strip): tokens surface in; │ DiagnosticsFeed (Planks)  │
│ flagged tokens underlined in --alert with ⚠   │  ⚠ hedging · 81% · tok 14 │
└───────────────────────────────────────────────┴───────────────────────────┘
  RunCompare opens as a Dialog or bottom sheet: baseline vs steered, with the diff highlighted
```

### The store interface (Samuel builds it; both code against it from 10:15)

The current `useActivationStream` appends every websocket message into React
state. At real activation volume, that re-renders the whole app hundreds of
times a second. Replace it with `src/lib/stream-store.ts`:

```ts
// zustand for low-frequency UI state
type RunStatus = "streaming" | "done" | "error" | "stopped";
interface Run {
  id: string;                       // client-generated uuid (until the backend sends run_id)
  prompt: string; model: Model;
  clamps: Record<string, number>;   // snapshot at start; {} = baseline
  tokens: { index: number; text: string }[];
  flags: { tokenIndex: number; signature: Signature; confidence: number }[];
  status: RunStatus;
}
interface StreamStore {
  connection: "connecting" | "open" | "retrying" | "closed";
  features: Record<string, Feature>;          // from GET /api/features on load
  runs: Run[]; activeRunId: string | null; baselineRunId: string | null;
  clamps: Record<string, number>;             // pending clamps for the next run
  selectedFeatureId: string | null; hoveredTokenIndex: number | null;
  start(prompt: string, model: Model): void;  // sends "start", creates a Run
  rerun(): void;                              // same prompt/model, current clamps
  stop(): void;
  setClamp(featureId: string, value: number): void; // sends "clamp"; value 0 removes it
  resetClamps(): void;
  selectFeature(id: string | null): void;
  hoverToken(index: number | null): void;
}

// NOT in zustand: activations stream through a bus so React doesn't re-render per event
export const activationBus: {
  subscribe(fn: (batch: ActivationEntry[]) => void): () => void; // flushed once per animation frame
  forRun(runId: string): ActivationEntry[];                        // full history, for sparklines and compare
  forToken(runId: string, tokenIndex: number): ActivationEntry[];
};
```

Websocket rules inside the store: one socket for the whole app; reconnect
with backoff (0.5s, 1s, 2s, 4s, capped at 8s) and show "retrying" in the
ConnectionBadge; ignore events that arrive while no run is active.

### P2-S1 (Samuel, 10:15–11:00): store, TopBar, PromptConsole ⚠ critical path

> Read `docs/frontend-roadmap.md` §Phase 2 and `docs/api-contract.md`. Install
> `zustand`. Implement `apps/web/src/lib/stream-store.ts` exactly to the
> interface in the roadmap, including `activationBus` with a ring buffer per
> run and a requestAnimationFrame-batched `subscribe`. Websocket reconnect
> with backoff, as specified. Fetch `GET /api/features` on load. Delete
> `src/hooks/use-activation-stream.ts` once nothing imports it. Then build
> `top-bar.tsx` (TopBar pill per design-system §6, wordmark in Darumadrop One, model
> select, ConnectionBadge that shows a Chalkboard-style tooltip when
> retrying) and `prompt-console.tsx` (textarea, 3 sample-prompt chips:
> "Explain why the sky is blue", "Is it safe to take ibuprofen with
> coffee?", "Write a one-line product review"; GoldButton Run, Stop,
> Rerun; ⌘/Ctrl+Enter runs). Rebuild `page.tsx` to the Phase 2 layout grid
> using placeholders for components that don't exist yet. Every control
> needs a visible focus ring and must be keyboard operable.

**Push the store to your branch as early as possible (target 10:35) and
ping Hari.** The map depends on it.

### P2-H1 (Hari, 10:15–11:00): FeatureMap

> Read `docs/design-system.md` §3 (feature-map color rules), §7 (pulse, ping),
> and `docs/frontend-roadmap.md` §Phase 2. Build
> `apps/web/src/components/observatory/feature-map/feature-map.tsx`: an HTML
> `<canvas>` (2D context, devicePixelRatio aware, resizes with its container)
> rendered inside `DeepViewport`. Each feature is a node at its `coords`
> (x, y; ignore z for now), fit to the viewport with padding. Maintain
> per-node state in a plain Map inside a ref (not React state): current
> glow (0..1) that jumps to the activation `value` when it fires and decays
> over ~1.5s, plus a list of active pulse rings. Draw in a single
> requestAnimationFrame loop. Color = glow mapped to `--glow-1`…`--glow-5`
> (read the CSS variables once on mount), radius 3px + 9px × glow. Idle
> features are drawn as faint `--glow-1` dots at 35% opacity so the "sea
> floor" is visible. Subscribe to `activationBus.subscribe` from
> `src/lib/stream-store.ts`. Until Samuel pushes it, stub a local fake bus
> with the same signature that emits random activations for the 12 mock
> features, then swap to the real one. Nothing inside the rAF loop may
> call setState.

**Done when:** running a prompt makes nodes glow and fade smoothly at 60fps
with no React re-renders per event (check the React DevTools profiler).

### 11:00 sync with Kareem and James (10 min)

- Kareem/James announce the NLA-vs-SAE decision.
- Walk them through the **contract asks in §6**. Get a yes/no on each and
  the date/time they land. Update `docs/api-contract.md` together.
- If NLA won: features may arrive as per-token natural-language
  explanations instead of a fixed dictionary. The components below are
  built to handle an optional `explanation` string, so nothing gets thrown
  away.

### P2-S2 (Samuel, 11:10–11:40): TokenStream, Inspector, ClampTray

> Build three components in `apps/web/src/components/observatory/`, all
> reading from `stream-store.ts`:
> (1) `token-stream.tsx`: the active run's tokens as inline spans on a
> PaperNote strip, each animating in with the `surface` motion. Hovering a
> token calls `hoverToken(i)`. Tokens with a flag get a 2px `--alert`
> underline, a ⚠ icon, and a tooltip ("hedging · 81%"). It auto-scrolls,
> but pauses auto-scroll while the user is hovering.
> (2) `feature-inspector.tsx`: a PaperNote shown when `selectedFeatureId` is
> set, showing the label (Sen), cluster, description, and feature id in
> mono. Add a small SVG sparkline of this feature's activation value across
> the active run's tokens (from `activationBus.forRun`, recomputed when a
> run finishes or the selection changes, not per event), single `--harbor`
> line with a 4px dot at the max. Add the clamp Slider (−1…+1, step 0.1,
> snaps at −1/−0.5/0/0.5/1, the §3 diverging track) that calls `setClamp`,
> and a GoldButton "Rerun with clamp" that calls `rerun()`. If an activation
> carries an `explanation` string, show the latest one in italics.
> (3) `clamp-tray.tsx`: chips for every non-zero clamp ("hedging language
> +0.6"), each with a gold or violet ring by sign, × to remove, and a
> "Reset all" link.

### P2-H2 (Hari, 11:10–11:40): make the map legible and clickable

> Extend `feature-map.tsx`: (1) hit-testing on pointer move and click.
> Hover shows a Paper tooltip with the label and current value; click
> calls `selectFeature(id)`. The selected node gets a 2px `--deep-ink`
> ring. Hit radius is at least 12px. Add keyboard support too: the canvas
> is focusable, arrow keys move selection to the nearest node in that
> direction, and Enter selects. (2) Clamp rings, gold for positive and
> violet for negative, thickness 1.5–4px by |value|, read from the store's
> `clamps`. (3) `ping` rings in `--alert` when a flag event fires,
> centered on the most active node for that token. (4) When
> `hoveredTokenIndex` is set, dim every node except those that fired on
> that token (`activationBus.forToken`). (5) Cluster labels in Darumadrop One
> `--deep-ink` at 70% opacity at each cluster centroid (average of member
> coords). (6) `legend.tsx`, pinned bottom-right of the map: a glow ramp
> labeled "weak → strong activation", ring swatches "clamped +" and
> "clamped −", and "⚠ flagged". The legend is the key for color, so no
> meaning is carried by color alone.

### 11:40 merge #2 (5 min)

Run the full loop on `main`: prompt → glow → click → clamp → rerun.

---

## Phase 3 (11:40–12:00): close the demo loop

### P3-S (Samuel): RunCompare, keyboard pass

> Build `run-compare.tsx`: a Dialog or bottom sheet comparing
> `baselineRunId` and the latest steered run side by side on two PaperNotes
> (headers "Baseline" and "Steered: hedging +0.8, …"), with a word-level
> diff (inserted words highlighted with a `--gold` background, removed
> words with a `--clamp-down` 30% strikethrough) and a count of flags per
> run. It opens automatically when a steered run finishes, and can also be
> opened from a "Compare" button. Then run the web-design-guidelines skill
> across `src/` and fix every accessibility, focus, and keyboard finding.

### P3-H (Hari): DiagnosticsFeed, FeatureSearch

> Build `diagnostics-feed.tsx`: a Radix Accordion styled as Planks, one row
> per flag in the active run ("⚠ hedging · 81% · token 14 'might'").
> Expanding a row shows the top 3 features that fired on that token;
> clicking one selects it. Build `feature-search.tsx`: a ⌘K / Ctrl+K
> Command palette over `store.features` (label, cluster, description,
> fuzzy match) where selecting a feature calls `selectFeature`. Swap to the
> server-side `GET /api/features?q=` if Kareem/James add it (§6.3).

### 12:00 merge #3

Record a 30-second screen capture of the full loop and post it in the team
chat. That's the first draft of the demo video footage.

---

## Stretch (only if everything above is merged)

- First-visit coach marks, three steps on PaperNotes: "This is the model's
  mind", "Click a glowing feature", "Clamp it and rerun". Judges who don't
  know what an SAE is will need this.
- A depth gauge on the DeepViewport's left edge showing which layer the
  activations come from, once the backend sends it.
- Idle ambience: 3–4 `bob`-animated decor pieces on the sand around the
  shell.

---

## 6. Contract asks (hand to Kareem/James at 11:00)

These close real gaps between `docs/api-contract.md`, the mock in
`apps/api`, and what the frontend needs:

1. **Add `run_id` to every server event**, echoed from `start`. Without
   it, a late event from a stopped run can leak into the next run.
2. **Clamp semantics mismatch.** The contract says `clamp` "triggers
   regeneration", but `apps/api/app/main.py` only stores the clamp. The
   frontend assumes **clamp just stores, and the client sends an explicit
   `start` to rerun**. Please make the doc match the code.
3. **Feature dictionary at real scale.** A real SAE has thousands of
   features. Move `coords` into `GET /api/features` (activations can then
   drop them), add `limit` and `?q=` search, and decide which subset the
   map shows (for example, the top N by activation frequency).
4. **Clusters.** Either `GET /api/clusters` → `{id, label, centroid}`, or
   confirm the frontend should derive centroids from features.
5. **If NLA:** add an optional `explanation: string` on `activation`
   events. The inspector already renders it.
6. Optional but great for the demo: send `layer: number` on activations
   (used by the depth-gauge stretch goal).
