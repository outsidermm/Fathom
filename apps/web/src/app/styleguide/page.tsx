"use client";

import { useState } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Chalkboard } from "@/components/sea/chalkboard";
import { DeepViewport } from "@/components/sea/deep-viewport";
import { Anglerfish } from "@/components/sea/decor/anglerfish";
import { Pebbles } from "@/components/sea/decor/pebbles";
import { Shell } from "@/components/sea/decor/shell";
import { Starfish } from "@/components/sea/decor/starfish";
import { PaperNote } from "@/components/sea/paper-note";
import { Plank } from "@/components/sea/plank";
import { SeaPanel } from "@/components/sea/sea-panel";
import { WaveDivider } from "@/components/sea/wave-divider";

const colors = [
  ["sky", "#c6effa"],
  ["sky-haze", "#e2efe9"],
  ["sand", "#e5ccae"],
  ["sand-light", "#f8eee1"],
  ["sand-beach", "#e8c08e"],
  ["paper", "#f6efec"],
  ["plank", "#cc8f4f"],
  ["plank-dark", "#a45e37"],
  ["wood", "#af6f40"],
  ["driftwood", "#503120"],
  ["crate", "#c5a97c"],
  ["ink", "#055958"],
  ["slate", "#384151"],
  ["harbor", "#0871a3"],
  ["water", "#aae2f0"],
  ["water-mid", "#9fd5e6"],
  ["water-deep", "#5896ab"],
  ["foam", "#ffffff"],
  ["gold", "#f0c37b"],
  ["gold-ink", "#56321d"],
  ["coral", "#e27459"],
  ["coral-ink", "#e56236"],
  ["starfish", "#e5a83d"],
  ["shell", "#e08b6a"],
  ["sea-glass", "#72c3d5"],
  ["kelp", "#a2d586"],
  ["abyss", "#061a26"],
  ["deep", "#0b2533"],
  ["trench", "#123a4d"],
  ["glow-1", "#1d6270"],
  ["glow-2", "#228596"],
  ["glow-3", "#25aabe"],
  ["glow-4", "#53cfdc"],
  ["glow-5", "#9deff3"],
  ["clamp-up", "#c38300"],
  ["clamp-down", "#8362cd"],
  ["alert", "#e84f27"],
  ["deep-ink", "#f6efec"],
] as const;

const typeRoles = [
  ["Display", "font-display", "Darumadrop One"],
  ["UI", "font-ui font-bold", "Sen 700"],
  ["Body", "font-body", "Sen 400"],
  ["Mono", "font-mono", "JetBrains Mono"],
] as const;

const scales = [14, 16, 20, 28, 40, 56] as const;

export default function StyleguidePage() {
  const [clamp, setClamp] = useState([0]);
  const [motionPaused, setMotionPaused] = useState(false);

  return (
    <main
      className={`mx-auto max-w-7xl space-y-12 px-4 py-10 text-ink sm:px-8 ${motionPaused ? "motion-paused" : ""}`}
    >
      <header>
        <p className="font-ui font-bold text-harbor">Oracle of the Deep</p>
        <h1 className="font-display text-[clamp(2.5rem,7vw,3.5rem)] text-balance">
          Surface &amp; Deep styleguide
        </h1>
        <p className="mt-3 max-w-2xl font-body text-base">
          Working palette, type, motion, and components for the frontend.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          aria-pressed={motionPaused}
          onClick={() => setMotionPaused((value) => !value)}
        >
          {motionPaused ? "Resume Motion" : "Pause Motion"}
        </Button>
      </header>

      <section aria-labelledby="palette-title" className="space-y-4">
        <h2 id="palette-title" className="font-display text-3xl">
          Palette
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {colors.map(([name, hex]) => (
            <div
              key={name}
              className="min-w-0 rounded-xl bg-sand-light p-2 shadow-sm"
            >
              <div
                aria-hidden="true"
                className="h-16 rounded-lg border border-driftwood/20"
                style={{ backgroundColor: `var(--${name})` }}
              />
              <p className="mt-2 break-words font-ui text-sm font-bold">
                {name}
              </p>
              <p className="font-mono text-xs text-muted-foreground">{hex}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="type-title" className="space-y-5">
        <h2 id="type-title" className="font-display text-3xl">
          Typography
        </h2>
        {typeRoles.map(([role, fontClass, family]) => (
          <div key={role} className="rounded-xl bg-paper p-5">
            <h3 className="font-ui text-lg font-bold text-harbor">
              {role} · {family}
            </h3>
            <div className="mt-3 space-y-2 overflow-x-auto">
              {scales.map((size) => (
                <p
                  key={size}
                  className={fontClass}
                  style={{ fontSize: size, lineHeight: 1.2 }}
                >
                  <span className="mr-4 inline-block w-8 align-middle font-mono text-xs">
                    {size}
                  </span>
                  See what lives beneath the surface
                </p>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section aria-labelledby="sea-title" className="space-y-5">
        <h2 id="sea-title" className="font-display text-3xl">
          Sea primitives
        </h2>
        <SeaPanel>
          <h3 className="font-ui text-lg font-bold">SeaPanel</h3>
          <p>Caustic light over shallow water.</p>
          <div className="mt-4 flex items-end gap-4">
            <Starfish className="size-14 animate-[bob_3.2s_ease-in-out_infinite_alternate]" />
            <Shell className="size-14 animate-[bob_3.2s_ease-in-out_infinite_alternate] [animation-delay:400ms]" />
            <Pebbles className="h-14 w-24" />
          </div>
        </SeaPanel>
        <div className="grid gap-5 md:grid-cols-2">
          <PaperNote rotate={-1.2}>
            <h3 className="font-ui text-xl font-bold text-harbor">
              PaperNote, pinned
            </h3>
            <p className="mt-2">The inspector will sit on this surface.</p>
          </PaperNote>
          <PaperNote rotate={1.2} pin={false}>
            <h3 className="font-ui text-xl font-bold text-harbor">
              PaperNote, loose
            </h3>
            <p className="mt-2">A second tilt with no pin.</p>
          </PaperNote>
        </div>
        <Plank>Plank: a wooden row with an irregular edge</Plank>
        <Chalkboard>Waiting for the tide…</Chalkboard>
        <div className="overflow-hidden rounded-xl">
          <p className="bg-water px-4 py-2 font-ui font-bold">WaveDivider</p>
          <WaveDivider className="bg-water" />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="h-[min(80vh,540px)]">
            <DeepViewport>
              <div className="flex h-full flex-col items-center justify-center gap-2">
                <Anglerfish className="w-36 animate-[bob_3.2s_ease-in-out_infinite_alternate]" />
                <p className="font-ui font-bold">
                  DeepViewport · near full-screen
                </p>
              </div>
            </DeepViewport>
          </div>
          <div className="h-64">
            <DeepViewport>
              <div className="flex h-full items-center justify-center font-ui font-bold">
                DeepViewport · half-screen
              </div>
            </DeepViewport>
          </div>
        </div>
      </section>

      <section aria-labelledby="ui-title" className="space-y-5">
        <h2 id="ui-title" className="font-display text-3xl">
          UI primitives
        </h2>
        <div className="flex flex-wrap gap-4">
          <Button>GoldButton</Button>
          <Button variant="secondary">PlankButton</Button>
          <Button variant="outline">Crate outline</Button>
          <Button variant="ghost">Sand ghost</Button>
          <Button variant="link">Harbor link</Button>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {(["paper", "plank", "sea"] as const).map((variant) => (
            <Card key={variant} variant={variant}>
              <CardHeader>
                <CardTitle>{variant} card</CardTitle>
              </CardHeader>
              <CardContent>Layered surfaces for the observatory.</CardContent>
            </Card>
          ))}
        </div>
        <div className="max-w-sm">
          <label
            htmlFor="styleguide-input"
            className="mb-2 block font-ui font-bold"
          >
            Prompt input
          </label>
          <Input
            id="styleguide-input"
            name="styleguide-prompt"
            autoComplete="off"
            placeholder="Ask the deep about…"
          />
        </div>
        <Tabs defaultValue="first">
          <TabsList aria-label="Example days">
            <TabsTrigger value="first">Day 1</TabsTrigger>
            <TabsTrigger value="second">Day 2</TabsTrigger>
          </TabsList>
          <TabsContent value="first" className="rounded-xl bg-paper p-4">
            CrateTabs: first panel.
          </TabsContent>
          <TabsContent value="second" className="rounded-xl bg-paper p-4">
            CrateTabs: second panel.
          </TabsContent>
        </Tabs>
        <Accordion type="single" collapsible className="max-w-xl">
          <AccordionItem value="example">
            <AccordionTrigger>What is under the waterline?</AccordionTrigger>
            <AccordionContent>
              Features fire as each token appears.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        <div className="max-w-sm">
          <label id="clamp-label" className="mb-2 block font-ui font-bold">
            Clamp slider: {clamp[0].toFixed(1)}
          </label>
          <Slider
            aria-labelledby="clamp-label"
            value={clamp}
            onValueChange={setClamp}
          />
          <div className="mt-1 flex justify-between font-mono text-xs">
            <span>−1</span>
            <span>0</span>
            <span>+1</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">Paper tooltip</Button>
            </TooltipTrigger>
            <TooltipContent>
              Activation strength, not cluster identity.
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">Chalkboard tooltip</Button>
            </TooltipTrigger>
            <TooltipContent variant="chalkboard">
              Waiting for the tide…
            </TooltipContent>
          </Tooltip>
          <Dialog>
            <DialogTrigger asChild>
              <Button>Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Compare two runs</DialogTitle>
                <DialogDescription>
                  Baseline and steered output will meet here.
                </DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
        </div>
        <div className="max-w-md rounded-[4px] bg-paper p-2">
          <h3 className="px-2 py-1 font-ui text-lg font-bold text-harbor">
            Command
          </h3>
          <Command>
            <CommandInput
              aria-label="Search features"
              placeholder="Search features…"
            />
            <CommandList>
              <CommandEmpty>No features found.</CommandEmpty>
              <CommandGroup heading="Features">
                <CommandItem value="hedging">Hedging language</CommandItem>
                <CommandItem value="refusal">Refusal pattern</CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      </section>
    </main>
  );
}
