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
- **shadcn/ui**, `new-york` style, `neutral` base color, already
  initialized (`apps/web/components.json`). `Button`, `Card`, `Input` exist
  under `src/components/ui/` — compose from those before writing new
  primitives. shadcn ships its own registry-aware agent skill
  (`npx shadcn@latest` picks it up automatically in a project with
  `components.json`) — if your agent has network access, let it pull new
  components from the registry rather than hand-rolling them.
- **Design direction**: brutalist, near-monochrome shell (the `--background`
  / `--foreground` / `--border` / `--muted` tokens). Color is reserved for
  the live feature-map visualization only — `--signal-cold`,
  `--signal-hot`, `--signal-alert` in `globals.css`. Don't add color to nav,
  cards, or form chrome; do use it in anything rendering activation data.

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
npx skills add https://github.com/vercel-labs/agent-skills --skill react-nextjs
```

(Both work as Claude Code / Cursor / Windsurf skills. If your tool doesn't
support the `skills add` convention, open the guideline pages directly —
they're written to be pasted into a prompt: https://vercel.com/design/guidelines)

## House rules

1. **Build against `docs/api-contract.md` — that's the real contract for
   this weekend.** `apps/api`'s WebSocket mock (`run_mock_stream`) already
   implements it and is what the frontend should point at now; nothing here
   is throwaway. There's a separate, unrelated "conversation harness"
   design in `docs/target-harness-contract.md` (durable conversations,
   branches, attachments, tool calls) — that's a possible **post-hackathon**
   direction the team already passed on for HackGT 13. Don't build toward
   it and don't treat `docs/api-contract.md` as if it describes those
   routes.
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
4. **Don't invent a second color system.** If something needs a status
   color, it's one of the three `--signal-*` tokens, not a new hex value.
