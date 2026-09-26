"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { activationBus, useStreamStore, type ActivationEntry, type FlagEntry, type TokenEntry } from "@/lib/stream-store";
import type { Feature } from "@/lib/contract";
import { FeatureMap } from "./feature-map/feature-map";
import type { MapFeature } from "./feature-map/fake-activation-bus";
import { FeatureSearch } from "./feature-search";
import { DiagnosticsFeed } from "./diagnostics-feed";
import styles from "./connected-deep.module.css";

const EMPTY_FEATURES: readonly MapFeature[] = [];
const EMPTY_FLAGS: readonly FlagEntry[] = [];
const EMPTY_TOKENS: readonly TokenEntry[] = [];

// The current dictionary has labels but no coordinates. Only place nodes
// when their coordinates actually arrive from the live activation bus.
function createPositionSource(runId: string | null, definitions: Record<string, Feature>) {
    const byId = new Map<string, MapFeature>();
    let snapshot = EMPTY_FEATURES;
    function collect(batch: ActivationEntry[]) {
      let changed = false;
      for (const entry of batch) {
        const previous = byId.get(entry.featureId);
        if (previous && previous.coords.x === entry.coords.x && previous.coords.y === entry.coords.y) continue;
        const definition = definitions[entry.featureId];
        byId.set(entry.featureId, {
          id: entry.featureId,
          label: definition?.label ?? entry.featureId,
          cluster: definition?.cluster ?? "Uncategorized",
          description: definition?.description,
          coords: entry.coords,
        });
        changed = true;
      }
      if (changed) snapshot = [...byId.values()];
      return changed;
    }
    if (runId) collect(activationBus.forRun(runId));
    return {
      getSnapshot: () => snapshot,
      subscribe: (notify: () => void) => activationBus.subscribe((batch) => {
        if (runId && useStreamStore.getState().activeRunId === runId && collect(batch)) notify();
      }),
    };
}

function usePositionedFeatures() {
  const runId = useStreamStore((state) => state.activeRunId);
  const definitions = useStreamStore((state) => state.features);
  const positions = useMemo(() => createPositionSource(runId, definitions), [runId, definitions]);
  // Re-render only when node positions/definitions change, never for glow values.
  return useSyncExternalStore(positions.subscribe, positions.getSnapshot, () => EMPTY_FEATURES);
}

export function ConnectedFeatureMap({ paused }: { paused: boolean }) {
  const features = usePositionedFeatures();
  const runId = useStreamStore((state) => state.activeRunId);
  const selected = useStreamStore((state) => state.selectedFeatureId);
  const select = useStreamStore((state) => state.selectFeature);
  const clamps = useStreamStore((state) => state.clamps);
  const hoveredToken = useStreamStore((state) => state.hoveredTokenIndex);
  const flags = useStreamStore((state) => state.runs.find((run) => run.id === state.activeRunId)?.flags ?? EMPTY_FLAGS);
  const host = useRef<HTMLDivElement>(null);
  const frozen = useRef<HTMLCanvasElement>(null);

  // Preserve the shell's Pause Motion control without altering Hari's canvas.
  useEffect(() => {
    if (!paused) return;
    const container = host.current;
    const image = frozen.current;
    const live = container?.querySelector<HTMLCanvasElement>("[data-live-map] canvas");
    if (!container || !image || !live) return;
    image.width = live.width;
    image.height = live.height;
    image.getContext("2d")?.drawImage(live, 0, 0);
    function align() {
      if (!container || !image || !live) return;
      const outer = container.getBoundingClientRect();
      const rect = live.getBoundingClientRect();
      Object.assign(image.style, {
        left: `${rect.left - outer.left}px`, top: `${rect.top - outer.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`,
      });
    }
    align();
    const observer = new ResizeObserver(align);
    observer.observe(container);
    return () => observer.disconnect();
  }, [paused]);

  return <div ref={host} data-coach-target="map" className={`${styles.host} ${paused ? styles.paused : ""}`}>
    <div data-live-map inert={paused} className={styles.live}>
      <FeatureMap features={features} source={activationBus} activeRunId={runId}
        selectedFeatureId={selected} onSelectFeature={select} clamps={clamps}
        hoveredTokenIndex={hoveredToken} flags={flags} className="min-h-[350px] rounded-[20px]" />
    </div>
    {paused ? <><canvas ref={frozen} className={styles.frozen} aria-hidden="true" />
      <p className={styles.notice} role="status">Map paused. Resume Motion to explore features.</p></> : null}
  </div>;
}

export function ConnectedFeatureSearch() {
  const definitions = useStreamStore((state) => state.features);
  const select = useStreamStore((state) => state.selectFeature);
  const features = useMemo(() => Object.values(definitions), [definitions]);
  return <FeatureSearch features={features} onSelectFeature={select} />;
}

export function ConnectedDiagnosticsFeed() {
  const features = usePositionedFeatures();
  const run = useStreamStore((state) => state.runs.find((item) => item.id === state.activeRunId));
  const select = useStreamStore((state) => state.selectFeature);
  return <section className="rounded-xl bg-sand-light p-4" aria-labelledby="diagnostics-title">
    <h2 id="diagnostics-title" className="mb-3 font-ui text-base font-bold text-ink">Diagnostics</h2>
    <DiagnosticsFeed activeRunId={run?.id ?? null} flags={run?.flags ?? EMPTY_FLAGS}
      tokens={run?.tokens ?? EMPTY_TOKENS} features={features} source={activationBus} onSelectFeature={select} />
  </section>;
}
