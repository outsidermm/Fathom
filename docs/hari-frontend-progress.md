# Hari’s frontend progress

This tracks Hari’s work against `frontend-roadmap.md`. Local component
completion and the team’s integration gates are tracked separately.

## Implemented locally

| Step | Branch / checkpoint | Evidence |
| --- | --- | --- |
| P1-H: sea primitives and style guide | `hari/p1-sea`, `65d763d`, `e512adb` | All primitives and decorations appear on `/styleguide`; full and half-height DeepViewports checked; production build and lint passed. |
| P2-H1: canvas rendering | `hari/p2-map`, `ae3d42f` | DPR sizing checked at desktop and phone widths; sample prompts produce glow, decay, and pulses. |
| P2-H2: interactions and legend | `hari/p2-map`, `55e9913` | Mouse selection, paper tooltip, arrow navigation, Enter selection, positive/negative clamp rings, flag sonar, token isolation, centroid labels, and legend checked in the browser. |
| P3-H: diagnostics and feature search | `hari/p3-demo` | Radix Accordion rows show confidence and token text; strongest features select map nodes. Command palette supports ⌘K / Ctrl+K, fuzzy label/cluster/description matching, arrow selection, Enter, Escape, focus return, and no-results feedback. Desktop and phone previews checked. |

The map uses one `requestAnimationFrame` loop and ref-held activation state.
Temporary runtime counters measured **60.0 FPS** and **59 activation batches
with 13 interaction/data commits** (one run start plus 12 flag updates;
the two initial development-mode effect executions were excluded).
Activation batches themselves did not produce React commits. The counters
were removed after checking. React DevTools was not available in the preview,
so this was measured directly rather than through its profiler.

## What is still required for the full timeline

- [ ] Merge Samuel’s P1 theme and shell work and run the first shared merge gate.
- [ ] Connect Hari’s components to Samuel’s `stream-store.ts` and real `activationBus`.
- [ ] Verify the shared prompt → glow → select → clamp → rerun loop on the merged app.
- [ ] Verify diagnostics and search against the shared store after merge #3.
- [ ] Capture the final demo loop and attach screenshots to the PR description.
- [ ] Open the PR after the required work is complete.

At the current checkpoint, `src/lib/stream-store.ts` is absent and the home
page still uses the legacy mock hook. The GitHub connector cannot access
`outsidermm/HackGT-13`, and the Git remote cannot authenticate. The sample
preview is explicitly labeled; its random activations and flags are not
model analysis, and its sample clamp controls only demonstrate map rings.

## Connecting the components when the store arrives

Use these inputs from Samuel’s store and active run:

| Component | Inputs |
| --- | --- |
| `FeatureMap` | Stable array of features with `coords`; `source={activationBus}`; active run ID; selected feature ID; `selectFeature` callback; pending clamps; hovered token index; active run flags. |
| `DiagnosticsFeed` | Active run ID, flags, tokens, feature definitions, `source={activationBus}`, and `selectFeature`. Use `headingLevel={4}` when its parent heading is h3; default row headings are h3. |
| `FeatureSearch` | Feature definitions and `selectFeature`. Search needs only ID, label, cluster, and optional description. |

`ActivationSource` exposes the roadmap’s `subscribe`, `forRun`, and
`forToken` methods. Its subscription never updates React state. The shared
store’s entries must expose camel-case `tokenIndex` and `featureId` and a
0–1 `value`. Feature positions are required for the map; the legacy REST
feature definition does not include them yet. Optional activation
`explanation` text is supported in expanded diagnostics.

Keep `fake-activation-bus.ts` and `FeatureMapDemo` confined to `/styleguide`.
They provide a development preview while the shared store is unavailable.
Do not use the fake feed in the live app.

## Beginner review steps

1. Open `/styleguide` and scroll to **Live Feature Map Preview**.
2. Run a sample stream. Brightness and size show activation strength.
3. Select a dot, or focus the map and use arrows followed by Enter.
4. Try both sample clamp buttons: the ring changes; these preview controls
   do not steer a real model.
5. Focus a sample token to isolate the features that fired for it.
6. Expand a diagnostic flag and choose one of its strongest features.
7. Open **Search Features**, or press ⌘K / Ctrl+K. Try “softening” or
   “hdgng”; Enter selects a result, and Escape closes the search.
