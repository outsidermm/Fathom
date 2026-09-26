import Link from "next/link";
import { Darumadrop_One, JetBrains_Mono, Sen } from "next/font/google";

import { Anglerfish } from "@/components/sea/decor/anglerfish";
import { Pebbles } from "@/components/sea/decor/pebbles";
import { Shell } from "@/components/sea/decor/shell";
import { Starfish } from "@/components/sea/decor/starfish";
import { Chalkboard } from "@/components/sea/chalkboard";
import { DeepViewport } from "@/components/sea/deep-viewport";
import { PaperNote } from "@/components/sea/paper-note";
import { Plank } from "@/components/sea/plank";
import { SeaPanel } from "@/components/sea/sea-panel";
import { WaveDivider } from "@/components/sea/wave-divider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import styles from "./styleguide.module.css";

const displayFont = Darumadrop_One({ weight: "400", subsets: ["latin"], variable: "--font-display" });
const bodyFont = Sen({ subsets: ["latin"], variable: "--font-body" });
const monoFont = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

const surfaceColors = [
  ["sky", "#c6effa"], ["sky-haze", "#e2efe9"], ["sand", "#e5ccae"],
  ["sand-light", "#f8eee1"], ["sand-beach", "#e8c08e"], ["paper", "#f6efec"],
  ["plank", "#cc8f4f"], ["plank-dark", "#a45e37"], ["wood", "#af6f40"],
  ["driftwood", "#503120"], ["crate", "#c5a97c"], ["ink", "#055958"],
  ["slate", "#384151"], ["harbor", "#0e6398"], ["water", "#aae2f0"],
  ["water-mid", "#9fd5e6"], ["water-deep", "#5896ab"], ["foam", "#ffffff"],
  ["gold", "#f0c37b"], ["gold-ink", "#56321d"], ["coral", "#e27459"],
  ["coral-ink", "#e56236"], ["starfish", "#e5a83d"], ["shell", "#e08b6a"],
  ["sea-glass", "#72c3d5"], ["kelp", "#a2d586"],
] as const;

const deepColors = [
  ["abyss", "#061a26"], ["deep", "#0b2533"], ["trench", "#123a4d"],
  ["glow-1", "#1d6270"], ["glow-2", "#228596"], ["glow-3", "#25aabe"],
  ["glow-4", "#53cfdc"], ["glow-5", "#9deff3"], ["clamp-up", "#c38300"],
  ["clamp-down", "#8362cd"], ["alert", "#e84f27"], ["deep-ink", "#f6efec"],
] as const;

const fontSamples = [
  ["Display · Darumadrop One", styles.display], ["UI · Darumadrop One", styles.ui],
  ["Body · Sen", styles.body], ["Mono · JetBrains Mono", styles.mono],
] as const;

const sizes = [14, 16, 20, 28, 40, 56] as const;

function Swatches({ colors }: { colors: readonly (readonly [string, string])[] }) {
  return (
    <div className={styles.swatches}>
      {colors.map(([name, hex]) => (
        <div className={styles.swatch} key={name}>
          <div className={styles.swatchColor} style={{ backgroundColor: `var(--${name}, ${hex})` }} />
          <div className={styles.swatchMeta}>
            <span className={styles.swatchName}>--{name}</span>
            <span className={styles.swatchHex}>{hex}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function StyleguidePage() {
  return (
    <main className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable} ${styles.page}`}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Oracle of the Deep · UI reference</p>
        <h1 className={styles.title}>Surface & Deep Style Guide</h1>
        <p className={styles.intro}>The surface feels like a seaside market. The feature map lives below the waterline.</p>
        <Link className={styles.link} href="/">Return to the Observatory</Link>
      </header>

      <section className={styles.section} aria-labelledby="colors-title">
        <h2 className={styles.sectionTitle} id="colors-title">Color Tokens</h2>
        <h3 className={styles.subheading}>Surface</h3>
        <Swatches colors={surfaceColors} />
        <h3 className={`${styles.subheading} mt-8`}>The Deep</h3>
        <Swatches colors={deepColors} />
      </section>

      <section className={styles.section} aria-labelledby="type-title">
        <h2 className={styles.sectionTitle} id="type-title">Typography</h2>
        <p className={styles.sectionCopy}>Four font families across the 14, 16, 20, 28, 40, and 56&nbsp;px scale.</p>
        {fontSamples.map(([label, className]) => (
          <div className={styles.typeGroup} key={label}>
            <h3 className={styles.subheading}>{label}</h3>
            {sizes.map((size) => (
              <div className={styles.typeSample} key={size}>
                <span className={styles.typeSize}>{size}</span>
                <span className={className} style={{ fontSize: size }}>
                  {label.startsWith("Mono") ? "feat_0042 · 0.73" : "Signals beneath the surface"}
                </span>
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className={styles.section} aria-labelledby="sea-title">
        <h2 className={styles.sectionTitle} id="sea-title">Sea Primitives</h2>
        <div className={styles.primitiveGrid}>
          <div>
            <h3 className={styles.subheading}>WaveDivider</h3>
            <div className={styles.sampleBoxDark}><WaveDivider /></div>
          </div>
          <div>
            <h3 className={styles.subheading}>SeaPanel</h3>
            <SeaPanel className={styles.seaSample}>A shallow water surface with quiet caustic ripples.</SeaPanel>
          </div>
          <div>
            <h3 className={styles.subheading}>PaperNote</h3>
            <div className={styles.sampleBoxDark}><PaperNote title="Pinned Note" rotate={-1.5}>A warm paper surface for the inspector.</PaperNote></div>
          </div>
          <div>
            <h3 className={styles.subheading}>Plank</h3>
            <div className={styles.plankStack}>
              <Plank>Signals found in the stream</Plank>
              <Plank>Open a flagged token</Plank>
            </div>
          </div>
          <div>
            <h3 className={styles.subheading}>Chalkboard</h3>
            <Chalkboard>Waiting for the tide…</Chalkboard>
          </div>
          <div>
            <h3 className={styles.subheading}>Original Decorations</h3>
            <div className={styles.decorRow}>
              <Starfish /><Shell /><Pebbles /><Anglerfish />
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="viewport-title">
        <h2 className={styles.sectionTitle} id="viewport-title">DeepViewport</h2>
        <p className={styles.sectionCopy}>The same component fills both a full-screen and half-screen parent.</p>
        <div className={styles.viewportGrid}>
          <div className={styles.viewportFull}>
            <DeepViewport>
              <div className={styles.viewportContent}>
                <Anglerfish />
                <h3 className={styles.subheading}>Full-Screen Deep</h3>
                <p>Feature nodes will glow here when the stream store and map arrive in Phase 2.</p>
              </div>
            </DeepViewport>
          </div>
          <div className={styles.viewportHalf}>
            <DeepViewport>
              <div className={styles.viewportContent}>
                <h3 className={styles.subheading}>Half-Screen Deep</h3>
                <p>The waterline stays at the top edge as the viewport changes height.</p>
              </div>
            </DeepViewport>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="ui-title">
        <h2 className={styles.sectionTitle} id="ui-title">UI Primitives</h2>
        <p className={styles.sectionCopy}>These are the shared shadcn primitives already in the repository. Samuel’s Phase 1 theme pass will restyle them.</p>
        <div className={styles.primitiveGrid}>
          <div className={styles.sampleBox}>
            <h3 className={styles.subheading}>Button</h3>
            <div className={styles.uiGroup}>
              <Button type="button" disabled>Run</Button>
              <Button type="button" variant="secondary" disabled>Rerun</Button>
              <Button type="button" variant="outline" disabled>Compare</Button>
              <Button type="button" variant="ghost" disabled>Reset</Button>
            </div>
          </div>
          <div className={styles.sampleBox}>
            <h3 className={styles.subheading}>Card</h3>
            <Card>
              <CardHeader><CardTitle>Feature Preview</CardTitle></CardHeader>
              <CardContent>A sample card using shared UI components.</CardContent>
            </Card>
          </div>
          <div className={styles.sampleBox}>
            <h3 className={styles.subheading}>Input</h3>
            <label className={styles.inputLabel} htmlFor="styleguide-prompt">Sample Prompt</label>
            <Input className={styles.inputWidth} id="styleguide-prompt" name="sample-prompt" autoComplete="off" placeholder="Ask about the model…" />
          </div>
        </div>
      </section>
    </main>
  );
}
