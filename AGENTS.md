# Agent / AI-assistant guidelines for this repo

Samuel and Hari: you're building the frontend with frontier-model help, not by
hand — this file exists so whatever you prompt (Claude, Cursor, v0, etc.)
produces code that fits this stack and doesn't look sloppy. Point your agent
at this file, or just paste its contents into your first prompt of a session.

## Stack facts your agent needs to know

- **Next.js 16.3.6** (App Router, Turbopack) — newer than most training data.
  Next.js itself ships breaking-change docs inside the installed package:
  `apps/web/node_modules/next/dist/docs/`. If an agent suggests something
  that looks like older Next.js (`getServerSideProps`, non-async `params`,
  `pages/` router patterns), have it check that folder first. There's also
  an `apps/web/AGENTS.md` that Next.js itself generated with the same
  warning — don't delete it.
- **React 19**, TypeScript, Tailwind v4 (CSS-first config — no
  `tailwind.config.js`, theme tokens live in `src/app/globals.css` under
  `@theme inline`).
- **shadcn/ui**, `new-york` style, `stone` base color, already
  initialized (`apps/web/components.json`). `Button`, `Card`, `Input` exist
  under `src/components/ui/` — compose from those before writing new
  primitives. shadcn ships its own registry-aware agent skill
  (`npx shadcn@latest` picks it up automatically in a project with
  `components.json`) — if your agent has network access, let it pull new
  components from the registry rather than hand-rolling them.
- **Design direction**: follow `docs/design-system.md` for the HackGT
  seaside "Surface & Deep" theme. Surface UI uses sand, paper, planks, and
  teal ink; the feature map lives in a dark ocean viewport. Activation
  strength uses the `--glow-1` through `--glow-5` ramp, clamps use
  `--clamp-up` and `--clamp-down`, and flags use `--alert` with an icon
  and label.

## Install these before you start prompting

Vercel's Web Interface Guidelines — 100+ rules for accessibility, keyboard
support, form behavior, animation, and performance, written specifically to
be applied by AI coding agents:

```
npx skills add https://github.com/vercel-labs/agent-skills --skill web-design-guidelines
```

Same repo also has a React/Next.js performance skill (40+ rules — re-render
discipline, list virtualization, memoization) worth adding given this app is
rendering a live-updating activation stream:

```
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-best-practices
```

(Both work as Claude Code / Cursor / Windsurf skills. If your tool doesn't
support the `skills add` convention, open the guideline pages directly —
they're written to be pasted into a prompt: https://vercel.com/design/guidelines)

## House rules

1. **Build against `docs/api-contract.md` — that's the real contract for
   this weekend.** `apps/api`'s WebSocket now streams live Qwen answer text
   through the existing event shape; AV readings and steering are connected,
   while feature-map data is still placeholder. The separate "conversation
   harness" design in `docs/target-harness-contract.md` (durable conversations,
   branches, attachments, tool calls) is a possible **post-hackathon**
   direction the team passed on for HackGT 13. Don't build toward it or
   treat `docs/api-contract.md` as if it describes those routes.
2. **Prefer prompting for real Next.js/shadcn code over "design tool then
   translate."** If you're generating a new screen from scratch, prompt
   v0.dev directly (it outputs Next.js + Tailwind + shadcn code you can
   paste straight into `src/components/`) rather than mocking it in a
   generic design tool first — that's a translation step you don't have
   time for this weekend.
3. **Every interactive element needs a visible focus state and a real
   `<button>`/`<a>` underneath it** — judges and demo day will involve a
   keyboard at some point. The web-design-guidelines skill above enforces
   this; don't turn it off.
4. **Don't invent a second color system.** Use the palette and color
   meanings in `docs/design-system.md` §3: one glow ramp for activation
   strength, gold/violet rings for clamps, and alert plus text/icon for flags.
