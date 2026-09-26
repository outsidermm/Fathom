"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { PaperNote } from "@/components/sea/paper-note";
import { STEERING_ENABLED } from "@/lib/contract";
import { activationBus, useStreamStore } from "@/lib/stream-store";

const SNAP = [-1, -0.5, 0, 0.5, 1];
function snap(value: number) {
  const near = SNAP.find((point) => Math.abs(point - value) <= 0.04);
  return near ?? Math.round(value * 10) / 10;
}
export function FeatureInspector() {
  const id = useStreamStore((state) => state.selectedFeatureId);
  const feature = useStreamStore((state) =>
    id ? state.features[id] : undefined,
  );
  const run = useStreamStore((state) =>
    state.runs.find((item) => item.id === state.activeRunId),
  );
  const clamp = useStreamStore((state) => (id ? (state.clamps[id] ?? 0) : 0));
  const setClamp = useStreamStore((state) => state.setClamp);
  const rerun = useStreamStore((state) => state.rerun);
  const select = useStreamStore((state) => state.selectFeature);
  const data = useMemo(
    () =>
      id && run?.status !== "streaming"
        ? activationBus
            .forRun(run?.id ?? "")
            .filter((entry) => entry.featureId === id)
        : [],
    [id, run?.id, run?.status],
  );
  if (!id)
    return (
      <PaperNote rotate={0.6} className="min-h-44">
        <h2 className="font-ui text-lg font-bold text-harbor">
          Feature inspector
        </h2>
        <p className="mt-2 text-sm">
          Select a glowing feature to inspect its activity. The current Qwen
          connection does not send activation data yet.
        </p>
      </PaperNote>
    );
  const points = data
    .map(
      (entry) =>
        `${(entry.tokenIndex / Math.max(1, run?.tokens.length ?? 1)) * 180},${42 - entry.value * 38}`,
    )
    .join(" ");
  const max = data.reduce(
    (top, entry) => (entry.value > (top?.value ?? 0) ? entry : top),
    data[0],
  );
  const explanation = data.at(-1)?.explanation;
  return (
    <PaperNote rotate={0.6} className="min-h-56">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-ui text-lg font-bold text-harbor">
            {feature?.label ?? id}
          </h2>
          <p className="text-sm text-driftwood">
            {feature?.cluster ?? "Feature"}
          </p>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Close feature inspector"
          onClick={() => select(null)}
        >
          ×
        </Button>
      </div>
      <p className="mt-3 text-sm">
        {feature?.description ??
          "Description pending from the feature dictionary."}
      </p>
      <p className="mt-2 font-mono text-xs">{id}</p>
      {data.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-bold">Activation across tokens</p>
          <svg
            width="100%"
            height="54"
            viewBox="0 0 180 54"
            role="img"
            aria-label={`Activation sparkline with ${data.length} samples`}
          >
            <polyline
              fill="none"
              stroke="var(--harbor)"
              strokeWidth="2"
              points={points}
            />
            {max && (
              <circle
                cx={
                  (max.tokenIndex / Math.max(1, run?.tokens.length ?? 1)) * 180
                }
                cy={42 - max.value * 38}
                r="4"
                fill="var(--harbor)"
              />
            )}
          </svg>
        </div>
      )}
      {explanation && <p className="mt-2 text-sm italic">{explanation}</p>}
      <div className="mt-4">
        <label htmlFor="feature-clamp" className="font-ui text-sm font-bold">
          Clamp {clamp > 0 ? `+${clamp.toFixed(1)}` : clamp.toFixed(1)}
        </label>
        <Slider
          id="feature-clamp"
          aria-label="Feature clamp"
          min={-1}
          max={1}
          step={0.1}
          value={[clamp]}
          onValueChange={(value) => setClamp(id, snap(value[0]))}
          disabled={!STEERING_ENABLED}
        />
        <div className="flex justify-between font-mono text-xs">
          <span>−1</span>
          <span>0</span>
          <span>+1</span>
        </div>
        {!STEERING_ENABLED && (
          <p className="mt-2 text-xs text-muted-foreground">
            Steering is waiting on the backend connection.
          </p>
        )}
      </div>
      <Button
        className="mt-4"
        onClick={rerun}
        disabled={
          !STEERING_ENABLED || !run || run.status === "streaming" || clamp === 0
        }
      >
        Rerun with clamp
      </Button>
    </PaperNote>
  );
}
