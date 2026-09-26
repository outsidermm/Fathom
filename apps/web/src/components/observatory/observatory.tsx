"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DeepViewport } from "@/components/sea/deep-viewport";
import { useActivationStream, type FlagEntry } from "@/hooks/use-activation-stream";
import type { Model } from "@/lib/contract";

const SIGNATURE_LABEL: Record<string, string> = {
  hedging: "hedging",
  refusal: "refusal",
  unsupported: "unsupported claim",
};

/**
 * Temporary Phase 1 shell. The Surface uses warm paper and sand; the Deep
 * keeps the activation map. Phase 2 replaces this layout with the roadmap.
 */
export function Observatory() {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<Model>("qwen2.5-7b");
  const [clampedIds, setClampedIds] = useState<Set<string>>(new Set());
  const { status, statusMessage, connected, tokens, activations, flags, start, clamp, resetClamps } =
    useActivationStream();

  const text = useMemo(() => tokens.map((t) => t.text).join(""), [tokens]);

  // The actual steering interaction from the pitch: click a feature in the
  // map, clamp it, regenerate from the same prompt, watch the output change.
  const toggleClamp = (featureId: string) => {
    setClampedIds((prev) => {
      const next = new Set(prev);
      const clampingUp = !next.has(featureId);
      if (clampingUp) {
        next.add(featureId);
      } else {
        next.delete(featureId);
      }
      clamp(featureId, clampingUp ? 1 : 0);
      return next;
    });
  };

  const handleResetClamps = () => {
    setClampedIds(new Set());
    resetClamps();
  };

  return (
    <>
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-paper focus:px-4 focus:py-2 focus:outline-3 focus:outline-harbor"
    >
      Skip to content
    </a>
    <main id="main-content" className="grid min-h-screen bg-background text-foreground lg:h-screen lg:grid-cols-[minmax(0,1fr)_360px]">
      <FeatureMap
        activations={activations}
        flags={flags}
        clampedIds={clampedIds}
        onToggleClamp={toggleClamp}
      />

      <aside className="flex flex-col gap-4 overflow-y-auto bg-sand p-4 lg:border-l-4 lg:border-water-deep">
        <header className="flex items-center justify-between">
          <h1 className="font-display text-xl text-ink">
            interpretability observatory
          </h1>
          <span
            className={`h-2 w-2 rounded-full ${connected ? "bg-ink" : "bg-slate"}`}
            title={connected ? "connected" : "disconnected"}
          />
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">prompt</CardTitle>
            <CardDescription>status: {status}{statusMessage && ` — ${statusMessage}`}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <label htmlFor="observatory-prompt" className="sr-only">Prompt</label>
            <Input
              id="observatory-prompt"
              name="prompt"
              autoComplete="off"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Type a prompt to stream…"
            />
            <div className="flex gap-2">
              <select
                aria-label="Model"
                className="h-10 min-w-0 flex-1 rounded-xl border-2 border-input bg-paper px-2 font-ui text-sm text-driftwood focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-harbor"
                value={model}
                onChange={(e) => setModel(e.target.value as Model)}
              >
                <option value="gemma-2b" disabled>gemma-2b (not connected)</option>
                <option value="qwen2.5-7b">qwen2.5-7b</option>
              </select>
              <Button size="sm" onClick={() => start(prompt, model)} disabled={!connected}>
                run
              </Button>
            </div>
            {clampedIds.size > 0 && (
              <Button size="sm" variant="outline" onClick={handleResetClamps}>
                reset clamps ({clampedIds.size})
              </Button>
            )}
          </CardContent>
        </Card>

        {flags.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">flagged mid-stream</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {flags.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-md border border-alert/40 bg-alert/10 px-2 py-1 text-xs"
                >
                  <span>{SIGNATURE_LABEL[f.signature] ?? f.signature}</span>
                  <span className="text-muted-foreground">
                    {Math.round(f.confidence * 100)}%
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card className="flex-1">
          <CardHeader>
            <CardTitle className="text-sm">output</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{text || "—"}</p>
          </CardContent>
        </Card>
      </aside>
    </main>
    </>
  );
}

function FeatureMap({
  activations,
  flags,
  clampedIds,
  onToggleClamp,
}: {
  activations: {
    tokenIndex: number;
    featureId: string;
    value: number;
    coords: { x: number; y: number };
  }[];
  flags: FlagEntry[];
  clampedIds: Set<string>;
  onToggleClamp: (featureId: string) => void;
}) {
  // Placeholder 2D scatter. Swap for the real three.js/D3 force layout —
  // coords already arrive pre-projected from the API (see docs/api-contract.md).
  // The visible dots are decorative; one real button per feature provides
  // an accessible, keyboard-focusable clamp target over the map.
  const visibleActivations = activations.slice(-200);
  const latestByFeature = new Map<string, (typeof visibleActivations)[number]>();
  for (const activation of visibleActivations) {
    latestByFeature.set(activation.featureId, activation);
  }

  return (
    <DeepViewport className="min-h-[55vh] lg:min-h-0">
      <div className="relative flex h-full min-h-[55vh] items-center justify-center lg:min-h-0">
      <svg viewBox="-40 -40 80 80" className="h-[90%] w-[90%]">
        {visibleActivations.map((a, i) => {
          const isFlagged = flags.some((flag) => flag.tokenIndex === a.tokenIndex);
          return (
            <circle
              key={i}
              cx={a.coords.x}
              cy={a.coords.y}
              r={0.6 + a.value * 1.4}
              fill={isFlagged ? "var(--alert)" : `var(--glow-${Math.max(1, Math.ceil(a.value * 5))})`}
              opacity={Math.max(0.15, a.value)}
            />
          );
        })}
        {Array.from(latestByFeature.values()).map((a) => {
          const isClamped = clampedIds.has(a.featureId);
          const isFlagged = flags.some((flag) => flag.tokenIndex === a.tokenIndex);
          const radius = (isClamped ? 1.2 : 0.6) + a.value * 1.4;
          const diameterPercent = `${(radius * 2 * 100) / 6}%`;

          return (
            <foreignObject
              key={a.featureId}
              x={a.coords.x - 3}
              y={a.coords.y - 3}
              width={6}
              height={6}
            >
              <button
                type="button"
                aria-label={`Toggle clamp for feature ${a.featureId}`}
                aria-pressed={isClamped}
                onClick={() => onToggleClamp(a.featureId)}
                className="flex h-full w-full items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none focus-visible:ring-1 focus-visible:ring-clamp-up focus-visible:ring-offset-1 focus-visible:ring-offset-deep"
              >
                <span
                  aria-hidden="true"
                  className="block rounded-full"
                  style={{
                    width: diameterPercent,
                    height: diameterPercent,
                    backgroundColor: isFlagged
                      ? "var(--alert)"
                      : `var(--glow-${Math.max(1, Math.ceil(a.value * 5))})`,
                    opacity: Math.max(0.15, a.value),
                    boxShadow: isClamped ? "0 0 0 0.4px var(--clamp-up)" : "none",
                  }}
                />
              </button>
            </foreignObject>
          );
        })}
      </svg>
        {activations.length === 0 && (
          <p className="absolute font-body text-sm text-deep-ink/80">
            Live answers are connected. The activation map is coming next.
          </p>
        )}
      </div>
    </DeepViewport>
  );
}
