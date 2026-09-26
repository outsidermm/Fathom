"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { activationBus, useStreamStore, type ActivationEntry, type FlagEntry } from "@/lib/stream-store";
import { MODEL_LABELS, type Feature, type Model } from "@/lib/contract";
import { useFeatureTestFlag } from "@/lib/use-feature-test-flag";
import { FeatureMap } from "./feature-map/feature-map";
import type { MapFeature, MapFlag } from "./feature-map/fake-activation-bus";
import { TEST_FEATURES, TEST_RUN_ID, testActivationSource } from "./feature-map/test-feature-layout";
import styles from "./connected-deep.module.css";

const EMPTY_FEATURES: readonly MapFeature[] = [];
const EMPTY_FLAGS: readonly FlagEntry[] = [];

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

function TestFeatureMap({ paused, model }: { paused: boolean; model: Model }) {
  const [flags, setFlags] = useState<readonly MapFlag[]>(EMPTY_FLAGS);
  useEffect(() => {
    const unsubscribe = testActivationSource.onFlags(setFlags);
    if (!paused) testActivationSource.start();
    return () => { unsubscribe(); testActivationSource.stop(); };
  }, [paused]);
  return <div data-coach-target="map" className={styles.host}>
    <p className={styles.testBadge} role="note">Test layout · {TEST_FEATURES.length} fake positions, not from Qwen</p>
    <div className={styles.live}>
      <FeatureMap features={TEST_FEATURES} source={testActivationSource} activeRunId={TEST_RUN_ID} modelLabel={MODEL_LABELS[model]}
        ambientPaused={paused} flags={flags} className="min-h-[350px] rounded-[20px]" />
    </div>
  </div>;
}

export function ConnectedFeatureMap({ paused, model }: { paused: boolean; model: Model }) {
  const testLayout = useFeatureTestFlag();
  return testLayout ? <TestFeatureMap paused={paused} model={model} /> : <LiveFeatureMap paused={paused} model={model} />;
}

function LiveFeatureMap({ paused, model }: { paused: boolean; model: Model }) {
  const features = usePositionedFeatures();
  const runId = useStreamStore((state) => state.activeRunId);
  const flags = useStreamStore((state) => state.runs.find((run) => run.id === state.activeRunId)?.flags ?? EMPTY_FLAGS);
  const host = useRef<HTMLDivElement>(null);
  const frozen = useRef<HTMLCanvasElement>(null);

  // Preserve the shell's Pause Motion control without altering Hari's canvas.
  useEffect(() => {
    if (!paused) return;
    const container = host.current;
    const image = frozen.current;
    const live = container?.querySelector<HTMLCanvasElement>("canvas[data-feature-map]");
    if (!container || !image || !live) return;
    image.width = live.width;
    image.height = live.height;
    const snapshot = image.getContext("2d");
    // The 3D brain renders on its own canvas underneath the 2D overlay.
    const brain = container.querySelector<HTMLCanvasElement>("canvas[data-brain3d]");
    if (brain) snapshot?.drawImage(brain, 0, 0, image.width, image.height);
    snapshot?.drawImage(live, 0, 0);
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
      <FeatureMap features={features} source={activationBus} activeRunId={runId} ambientPaused={paused} modelLabel={MODEL_LABELS[model]}
        flags={flags} className="min-h-[350px] rounded-[20px]" />
    </div>
    {paused ? <><canvas ref={frozen} className={styles.frozen} aria-hidden="true" />
      <p className={styles.notice} role="status">Map paused. Resume Motion to explore features.</p></> : null}
  </div>;
}
