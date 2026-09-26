# Design system: "Surface & Deep" (HackGT 13 seaside theme)

> **Agents: read this whole file before touching any UI.** It replaces the
> earlier "brutalist black-and-white shell" direction. Where this file and
> `AGENTS.md` disagree, this file wins until `AGENTS.md` is updated (that
> update is part of Phase 1 in `docs/frontend-roadmap.md`).

## 1. The idea

HackGT 13's site (hack.gt) is a cozy, hand-illustrated **seaside market**:
sky and mountains at the top, sand and driftwood in the middle, shallow
turquoise water with caustic ripples, wooden planks, pinned paper notes,
crates, starfish, shells, a friendly mascot. It is warm, rounded, playful.

We're in the **Oracle of the Deep** track, and our product looks *inside* a
model. So the app is split into two worlds:

| World | What it is | Look |
|---|---|---|
| **Surface** | Everything around the visualization: top bar, prompt console, panels, inspector, feeds | HackGT's seaside: sand, planks, paper, gold buttons, teal ink, rounded display type |
| **The Deep** | The live feature map, and only the feature map | Dark ocean under a foam waterline, with features glowing like bioluminescence as the model generates |

The waterline (an animated wave and foam edge) is the boundary between them.
The story for judges: the model's internals are hidden underwater, and our
tool lets you see down into the deep and steer what's there.

## 2. Sources and confidence

- **Colors** were sampled from pixels in full-page hack.gt screenshots taken
  on Sep 25, 2026 (median of small patches, not eyeballed). The ink,
  harbor, and coral-ink text values were then confirmed from the site's
  computed styles. Gradients and textures can make surface pixels differ.
- **Fonts were confirmed from computed styles on hack.gt on Sep 25, 2026.**
  The site uses Darumadrop One for display and Sen for body copy; the
  September 26 check below distinguishes the live nav from our UI font choice.
  Both are available through `next/font/google`.
- **Motion** on hack.gt wasn't observable from static screenshots. §7 is
  our own motion vocabulary built to fit the illustrations. Glance at the
  live site and match anything obvious (for example, if the waves drift,
  match their speed).

Live computed-style verification on **2026-09-26** found **both** reported
blues on [hack.gt](https://hack.gt): the “Friday, September 25” heading uses
`rgb(8, 113, 163)` (`#0871a3`), while “Oracle of the Deep” uses
`rgb(14, 99, 152)` (`#0e6398`). This app retains its existing `--harbor`
choice, `#0871a3`; changing that choice would be a design decision. Hari’s
styleguide label and CSS fallbacks should match the chosen app token.
The same browser check confirmed Darumadrop One for those headings **and
the About nav link**, and Sen for About body text. Sen for this app’s UI
is our readability choice, not an exact reproduction of the live nav.

## 3. Palette tokens

### Surface (sampled from hack.gt)

| Token | Hex | Sampled from | Use |
|---|---|---|---|
| `--sky` | `#c6effa` | hero sky | top-of-page gradient start |
| `--sky-haze` | `#e2efe9` | About section sky | gradient into sand |
| `--sand` | `#e5ccae` | Sponsors/FAQ background | **default page background** |
| `--sand-light` | `#f8eee1` | nav bar pill | top bar, raised surfaces |
| `--sand-beach` | `#e8c08e` | beach strip | decorative bands |
| `--paper` | `#f6efec` | pinned schedule note | inspector and note cards |
| `--plank` | `#cc8f4f` | FAQ planks | accordion rows, wood surfaces |
| `--plank-dark` | `#a45e37` | plank shadow edge | plank borders and shadows |
| `--wood` | `#af6f40` | schedule wood wall | large wood backdrop |
| `--driftwood` | `#503120` | active "Day 1" button, event titles | dark ink on paper, active states |
| `--crate` | `#c5a97c` | crate slats | inactive tab text and outlines on driftwood |
| `--ink` | `#055958` | "About"/"Tracks" headings, body copy | **primary text color** on sand and water |
| `--slate` | `#384151` | nav links | nav and secondary UI text |
| `--harbor` | `#0871a3` | "Friday, September 25" date heading | links, secondary headings |
| `--water` | `#aae2f0` | Tracks section water | shallow-water surfaces |
| `--water-mid` | `#9fd5e6` | sponsor section sea | gradients |
| `--water-deep` | `#5896ab` | lower sea band | transition into the Deep |
| `--foam` | `#ffffff` | wave foam | waterline, heading text on wood |
| `--gold` | `#f0c37b` | "Register" button | **primary CTA** (Run, Rerun) |
| `--gold-ink` | `#56321d` | Register button text | text on gold |
| `--coral` | `#e27459` | market awning red | decorative accent |
| `--coral-ink` | `#e56236` | schedule times | **large text only** (see §4) |
| `--starfish` | `#e5a83d` | starfish | decorative accent |
| `--shell` | `#e08b6a` | scallop shell | decorative accent |
| `--sea-glass` | `#72c3d5` | mascot fur | decorative accent |
| `--kelp` | `#a2d586` | green awning | decorative accent |

### The Deep (our addition, derived from their sea gradient)

These are validated with a colorblind-safety checker against `--deep`. Don't
swap values without re-running the checks.

| Token | Hex | Use |
|---|---|---|
| `--abyss` | `#061a26` | bottom of the map gradient |
| `--deep` | `#0b2533` | **map surface** (all chart checks run against this) |
| `--trench` | `#123a4d` | top of the map gradient, just under the waterline |
| `--glow-1` … `--glow-5` | `#1d6270` `#228596` `#25aabe` `#53cfdc` `#9deff3` | **activation strength**, weak to strong (one hue, passes lightness-step and contrast checks) |
| `--clamp-up` | `#c38300` | feature clamped up (+) |
| `--clamp-down` | `#8362cd` | feature clamped down (−) |
| `--alert` | `#e84f27` | failure-signature flag (hedging/refusal/unsupported), **always with an icon and label** |
| `--deep-ink` | `#f6efec` | text on the Deep (13.9:1) |

### Color rules for the feature map (non-negotiable)

1. **Color on the map means activation strength.** Map `value` (0..1) onto
   `--glow-1`…`--glow-5`. Brighter and bigger means stronger.
2. **Cluster identity is NOT color.** Clusters are already grouped by
   position (coordinates come from a UMAP-style projection). Label each
   cluster directly on the map with text at its centroid, optionally with a
   faint outline. We tested categorical palettes on this surface: past
   three hues, some pairs become indistinguishable for colorblind viewers
   when every dot can sit next to every other. So don't add per-cluster
   colors.
3. **Clamp state is a ring:** gold for up, violet for down. Ring thickness
   can scale with |value|.
4. **Flags are status:** `--alert` plus a ⚠ icon plus the signature name
   ("hedging"), never color alone. Keep `--alert` exclusive to flags.
5. The clamp slider track is a diverging scale: `--clamp-down` at −1,
   `--deep-ink` at 20% opacity at 0, `--clamp-up` at +1.

## 4. Contrast: approved text pairings

WCAG ratios, computed:

| Text on background | Ratio | Allowed for |
|---|---|---|
| `--driftwood` on `--paper` | 10.3 | all text |
| `--slate` on `--sand-light` | 9.0 | all text |
| `--gold-ink` on `--gold` | 6.8 | all text (buttons) |
| `--ink` on `--water` | 5.8 | all text |
| `--ink` on `--sand` | 5.3 | all text |
| muted text `#5f4e3e` on `--sand` / `--sand-light` / `--paper` | 5.1 / 6.9 / 7.0 | all text (secondary copy, captions) |
| `--harbor` on `--paper` | 4.7 | all text |
| `--driftwood` on `--plank` | 4.2 | text ≥ 18px bold only |
| `--foam` on `--wood` | 4.1 | text ≥ 18px bold only |
| `--coral-ink` on `--paper` | 3.0 | text ≥ 24px only |
| `--foam` on `--plank` | **2.8** | **never for text.** hack.gt does this on its FAQ planks; we don't. Use `--driftwood` on planks. |
| `--deep-ink` on `--deep` | 13.9 | all text on the map |

## 5. Typography

| Role | Family (closest match) | Weight | Where |
|---|---|---|---|
| Display | **Darumadrop One** | 400 | Page and section titles, big numbers, map cluster labels ≥ 20px. Chunky, bouncy, hand-lettered like "Tracks"/"Schedule". |
| UI | **Sen** | 700 | Nav, buttons, tabs, panel titles, token chips. |
| Body | **Sen** | 400–700 | Paragraphs, descriptions, tooltips. |
| Mono | **JetBrains Mono** | 400 | Feature IDs, activation values, token indices only. |

Set it up with `next/font/google` in `apps/web/src/app/layout.tsx`. This
replaces Geist:

```tsx
import { Darumadrop_One, Sen, JetBrains_Mono } from "next/font/google";

const display = Darumadrop_One({ weight: "400", subsets: ["latin"], variable: "--font-darumadrop" });
const body = Sen({ subsets: ["latin"], variable: "--font-sen" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

// <html className={`${display.variable} ${body.variable} ${mono.variable}`}>
```

Type scale: 14 / 16 / 20 / 28 / 40 / 56px. Darumadrop One only at 20px and up.
Letter-spacing 0 (don't track out rounded fonts). Headings in `--ink` on
light surfaces and `--foam` on wood (with the §6 text-shadow).

## 6. Surfaces and component styling

Everything is rounded and physically layered: things sit
*on* sand, get *pinned to* wood, or *float in* water. No hard 1px gray
borders anywhere.

| Primitive | hack.gt reference | Spec |
|---|---|---|
| **TopBar** | cream nav pill | `--sand-light` at 92% opacity, `border-radius: 20px`, soft shadow `0 6px 0 rgb(0 0 0 / 0.06)`, floating 16px from the top edge, `--slate` Sen links |
| **GoldButton** (primary CTA) | "Register" | `--gold` fill, `--gold-ink` Sen 700, radius 12px, bottom "lip" `box-shadow: 0 4px 0 #c99a4e`. On press: `translateY(3px)`, lip shrinks to 1px |
| **PlankButton** (secondary) | wooden "Register" sign | `--plank` with a wood-grain gradient (§6a), `--driftwood` text, rotate −1.5deg, a small leaf/rope decoration optional |
| **CrateTabs** | Day 1 / Day 2 / Day 3 | Tab group on a `--crate` slatted backdrop. Active: `--driftwood` fill, `--crate` text. Inactive: transparent with a 2px `--foam` outline and `--foam` text (large text only). Built on Radix Tabs |
| **PaperNote** | pinned schedule paper | `--paper`, radius 4px, always aligned with no hover transform, pin dot at the top center, shadow `0 10px 24px rgb(80 49 32 / 0.18)`. Title in Sen `--harbor` with a `--coral` 3px underline squiggle |
| **Plank** (accordion row) | FAQ planks | full-width `--plank` bar, radius 10px, irregular edges via `clip-path` or an SVG mask, `--plank-dark` bottom edge, `--driftwood` Sen text, chevron right. Built on Radix Accordion |
| **Chalkboard** | "Registration open until…" sign | `#2a2a2a` board, `--plank` frame, `--foam` Sen text. Use for empty and connection states ("Waiting for the tide…") |
| **WaveDivider** | every section boundary | SVG wave path with a white foam stroke, drifting horizontally (§7). Used above the Deep |
| **SeaPanel** | Tracks water | `--water` with a caustic ripple pattern (SVG or CSS radial gradients at ~20% white) |
| **DeepViewport** | (ours) | vertical gradient `--trench` to `--deep` to `--abyss`, a faint caustic shimmer near the top, the WaveDivider sitting on its top edge |

**6a. Wood grain in CSS, no images:**

```css
.wood {
  background:
    repeating-linear-gradient(178deg, rgb(0 0 0 / 0.05) 0 2px, transparent 2px 14px),
    linear-gradient(180deg, #d69a5a, var(--plank) 40%, var(--plank-dark));
}
```

**Heading text on wood** gets `text-shadow: 0 2px 0 rgb(80 49 32 / 0.45)`.

## 7. Motion

The personality is "gently alive": things bob, drift, and settle. Ambient
motion stays slow and small. Interactive motion is quick and springy.

| Name | Where | Spec |
|---|---|---|
| `drift` | WaveDivider, caustics | `translateX` loop, 14s linear infinite, alternating direction per layer (parallax) |
| `bob` | decorations (starfish, shells), empty-state chalkboard | `translateY(0 → -4px)`, 3.2s ease-in-out infinite alternate; stagger delays |
| `press` | GoldButton / PlankButton | `translateY(3px)`, 90ms |
| `settle` | panels entering | fade plus `translateY(12px → 0)`, 320ms `cubic-bezier(.2,.8,.2,1)`, 40ms stagger |
| `pulse` | feature fires on the map | radius 1× → 1.8× and opacity 1 → 0 ring, 600ms ease-out; the node itself decays from its glow step back down over ~1.5s |
| `ping` | a flag fires | `--alert` ring expanding 1× → 3×, 900ms, twice (sonar) |
| `surface` | a new token arrives in the TokenStream | token fades up from 6px below, 160ms |

```css
@keyframes drift { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes bob   { from { transform: translateY(0); } to { transform: translateY(-4px); } }
@keyframes ping  { from { transform: scale(1); opacity: .9; } to { transform: scale(3); opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }
}
```

Use CSS keyframes for ambient loops. Add the `motion` package only if a
component needs spring or layout animation. Don't pull in a second
animation library. The map animates on the canvas inside its own
`requestAnimationFrame` loop, not through React state (see the roadmap).

## 8. Illustrations and brand: what we may and may not use

- **Do NOT copy HexLabs' artwork**: the blue bear mascot, the HackGT
  hexagon logo, their crate/seafood/stall illustrations, or any image file
  from hack.gt. Also don't use the MLH "Official 2027 Season" badge. These
  belong to HexLabs and MLH. A palette and a vibe are fine to echo; their
  drawings and logos are not ours to ship.
- **Do** make simple *original* SVG decorations in `components/sea/decor/`:
  starfish, scallop shell, pebbles, a rope knot, a leaf sprig, a jellyfish
  or anglerfish for the Deep. Flat fills from the palette plus a slightly
  darker outline match their style. Keep each under ~40 path nodes.
- Our wordmark is our project name in Darumadrop One. Don't use a HackGT logo.
- If the team wants an official HackGT element (for example, the track
  name treatment), ask HexLabs at the help desk first.

## 9. Repo migration checklist (Phase 1)

**Decision on shadcn/ui: keep the primitives, drop the look.** shadcn isn't
a dependency or a theme you uninstall. It's source files we own
(`src/components/ui/*`) wrapping Radix, which gives us accessible keyboard
and ARIA behavior for Tabs, Accordion, Slider, Tooltip, and Dialog for free.
The monochrome look came from our *tokens*, not from shadcn. Re-skin by
changing tokens and component classes, and keep `components.json` so
`npx shadcn@latest add <x>` still works for new primitives. (If the team
still wants shadcn fully gone, see §9b, but it costs time and accessibility
for no visual gain.)

| File | Action |
|---|---|
| `apps/web/src/app/globals.css` | Replace the neutral `:root`/`.dark` blocks and `--signal-*` with the §3 tokens. **Map shadcn's semantic names onto the new palette** so existing components keep working: `--background: var(--sand)`, `--foreground: var(--ink)`, `--card: var(--paper)`, `--card-foreground: var(--driftwood)`, `--primary: var(--gold)`, `--primary-foreground: var(--gold-ink)`, `--secondary: var(--sand-light)`, `--secondary-foreground: var(--slate)`, `--muted: var(--sand-light)`, `--muted-foreground: #5f4e3e`, `--accent: var(--water)`, `--accent-foreground: var(--ink)`, `--border: rgb(80 49 32 / 0.18)`, `--input: rgb(80 49 32 / 0.25)`, `--ring: var(--harbor)`, `--destructive: var(--alert)`, `--radius: 0.875rem`. Expose every §3 token in `@theme inline` as `--color-*` so Tailwind classes like `bg-sand` and `text-ink` exist. Replace `--font-sans`/`--font-mono` with `--font-display`, `--font-ui`, `--font-body`, `--font-mono`. Remove the `.dark` block: the app is light-surface with a dark Deep, not a dark-mode toggle. Add the §7 keyframes and reduced-motion rule. |
| `apps/web/src/app/layout.tsx` | Swap Geist for the §5 fonts. `body` uses `font-body`. |
| `apps/web/components.json` | Keep. Set `"baseColor"` to `"stone"` (closest warm base; tokens override it anyway). |
| `apps/web/src/components/ui/button.tsx` | Keep Radix Slot/cva. Restyle variants: `default` becomes GoldButton, `secondary` becomes PlankButton, `outline` becomes a crate outline, `ghost` becomes a sand hover. Use Sen. |
| `apps/web/src/components/ui/card.tsx` | Default look becomes PaperNote without rotation; add a `variant` prop: `paper` \| `plank` \| `sea`. |
| `apps/web/src/components/ui/input.tsx` | `--paper` fill, 2px `--input` border, radius 12px, `--ring` focus ring 3px. |
| New primitives | `npx shadcn@latest add tabs accordion slider tooltip dialog command`, then restyle them per §6 (CrateTabs, Plank accordion, clamp Slider, Chalkboard/Paper tooltip, cmd-K search). |
| `AGENTS.md` (repo root) | Rewrite the "Design direction" bullet and house rule 4 to point here. Remove "brutalist", "near-monochrome", and every `--signal-*` reference. Keep the Codex skill instructions. |
| `README.md` | Under Team, replace "B&W shell" wording. Add "Design: see docs/design-system.md". |
| `apps/web/public/*.svg`, `src/app/favicon.ico` | Delete the create-next-app defaults. Add an original favicon (starfish or anglerfish SVG). |
| `apps/web/src/components/observatory/observatory.tsx` | Gets rebuilt in Phase 2. For Phase 1, just make it compile with the new tokens (`bg-black` becomes `DeepViewport`, `--signal-*` becomes the glow/clamp/alert tokens). |

**9b. Only if the team overrides and removes shadcn:** delete
`components.json` and `src/components/ui/*`, and uninstall
`class-variance-authority` and `tw-animate-css`. **Keep** `@radix-ui/*`,
`clsx`, `tailwind-merge`, and `lucide-react`, and hand-write the
Tabs/Accordion/Slider/Tooltip wrappers on Radix directly. Budget +45 min.

## 10. Confirm fonts and colors from the live site (2 minutes, human)

Open https://hack.gt, open DevTools → Console, paste:

```js
(() => {
  const fams = {}, colors = {};
  document.querySelectorAll("h1,h2,h3,h4,p,a,button,li,span,div").forEach(el => {
    if (!el.childNodes.length || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
    const cs = getComputedStyle(el);
    const key = `${cs.fontFamily} | ${cs.fontWeight}`;
    fams[key] = (fams[key] || 0) + 1;
    colors[cs.color] = (colors[cs.color] || 0) + 1;
  });
  const faces = [...document.fonts].map(f => `${f.family} ${f.weight} ${f.status}`);
  const rootVars = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } })
    .filter(r => r.selectorText === ":root").map(r => r.cssText.slice(0, 2000));
  const keyframes = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } })
    .filter(r => r.type === CSSRule.KEYFRAMES_RULE).map(r => r.name);
  console.table(Object.entries(fams).sort((a, b) => b[1] - a[1]).slice(0, 15));
  console.table(Object.entries(colors).sort((a, b) => b[1] - a[1]).slice(0, 15));
  console.log("font faces:", faces); console.log(":root vars:", rootVars); console.log("keyframes:", keyframes);
})();
```

Paste the output into the team chat. If the font families differ from §5
and are on Google Fonts, update §5 and `layout.tsx`. Update colors in §3
only if a value differs by more than a few points (screenshots are close).

## 11. Acceptance checks (agents run these before calling Phase 1 done)

```bash
cd apps/web
grep -rnE "oklch\(0\.[0-9]+ 0 0\)|signal-(cold|hot|alert)|Geist|bg-black|neutral-[0-9]" src/ && echo "LEFTOVERS: fix" || echo "clean"
npx tsc --noEmit && npx eslint . && npm run build
```

Then open `/styleguide` (built in Phase 1 by Hari) and eyeball every token,
font, and primitive in one place.
