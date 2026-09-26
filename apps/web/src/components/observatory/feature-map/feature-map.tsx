"use client";

import { useEffect, useRef, useState } from "react";
import {
  activationBus,
  useStreamStore,
  type ActivationEntry,
  type FlagEntry,
} from "@/lib/stream-store";

type Node = {
  id: string;
  x: number;
  y: number;
  glow: number;
  last: number;
  pulses: number[];
  value: number;
};
type Point = { id: string; x: number; y: number };
const SIZE = 12;
const NO_FLAGS: FlagEntry[] = [];
function bounds(nodes: Node[], width: number, height: number): Point[] {
  if (!nodes.length) return [];
  const xs = nodes.map((node) => node.x),
    ys = nodes.map((node) => node.y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const pad = 54;
  const scale = Math.min(
    (width - 2 * pad) / Math.max(1, maxX - minX),
    (height - 2 * pad) / Math.max(1, maxY - minY),
  );
  return nodes.map((node) => ({
    id: node.id,
    x: width / 2 + (node.x - (minX + maxX) / 2) * scale,
    y: height / 2 + (node.y - (minY + maxY) / 2) * scale,
  }));
}
export function FeatureMap({ paused }: { paused: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef(new Map<string, Node>());
  const pointsRef = useRef<Point[]>([]);
  const [tip, setTip] = useState<{
    id: string;
    x: number;
    y: number;
    value: number;
  } | null>(null);
  const [keyboardId, setKeyboardId] = useState<string | null>(null);
  const [hasNodes, setHasNodes] = useState(false);
  const hasNodesRef = useRef(false);
  const requestDraw = useRef<(() => void) | null>(null);
  const flagPulse = useRef<{ tokenIndex: number; time: number } | null>(null);
  const features = useStreamStore((state) => state.features);
  const runId = useStreamStore((state) => state.activeRunId);
  const flags = useStreamStore(
    (state) =>
      state.runs.find((run) => run.id === state.activeRunId)?.flags ?? NO_FLAGS,
  );
  const selected = useStreamStore((state) => state.selectedFeatureId);
  const hoveredToken = useStreamStore((state) => state.hoveredTokenIndex);
  const clamps = useStreamStore((state) => state.clamps);
  const select = useStreamStore((state) => state.selectFeature);
  const latestRef = useRef({
    runId,
    selected,
    hoveredToken,
    clamps,
    features,
    flags,
    paused,
  });
  useEffect(() => {
    latestRef.current = {
      runId,
      selected,
      hoveredToken,
      clamps,
      features,
      flags,
      paused,
    };
    requestDraw.current?.();
  }, [runId, selected, hoveredToken, clamps, features, flags, paused]);
  useEffect(() => {
    if (flags.length) {
      flagPulse.current = {
        tokenIndex: flags[flags.length - 1].tokenIndex,
        time: performance.now(),
      };
      requestDraw.current?.();
    }
  }, [flags]);

  useEffect(() => {
    const nodes = nodesRef.current;
    nodes.clear();
    if (runId) for (const entry of activationBus.forRun(runId)) add(entry);
    hasNodesRef.current = nodes.size > 0;
    setHasNodes(hasNodesRef.current);
    function add(entry: ActivationEntry) {
      const old = nodes.get(entry.featureId);
      const now = performance.now();
      nodes.set(entry.featureId, {
        id: entry.featureId,
        x: entry.coords.x,
        y: entry.coords.y,
        glow: Math.max(old?.glow ?? 0, entry.value),
        last: now,
        pulses: [...(old?.pulses ?? []), now],
        value: entry.value,
      });
    }
    requestDraw.current?.();
    return activationBus.subscribe((batch) => {
      if (latestRef.current.runId) {
        batch.forEach(add);
        if (!hasNodesRef.current) {
          hasNodesRef.current = true;
          setHasNodes(true);
        }
        requestDraw.current?.();
      }
    });
  }, [runId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const styles = getComputedStyle(canvas);
    const colors = [1, 2, 3, 4, 5].map((i) =>
      styles.getPropertyValue(`--glow-${i}`).trim(),
    );
    const ink = styles.getPropertyValue("--deep-ink").trim();
    const up = styles.getPropertyValue("--clamp-up").trim(),
      down = styles.getPropertyValue("--clamp-down").trim(),
      alert = styles.getPropertyValue("--alert").trim();
    const displayFont = getComputedStyle(
      document.querySelector(".font-display") ?? canvas,
    ).fontFamily;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0,
      height = 0,
      frame: number | null = null;
    const resize = () => {
      const rect = canvas.getBoundingClientRect(),
        ratio = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      requestDraw.current?.();
    };
    const observer = new ResizeObserver(resize);
    const draw = (now: number) => {
      frame = null;
      context.clearRect(0, 0, width, height);
      const nodes = [...nodesRef.current.values()];
      const points = bounds(nodes, width, height);
      pointsRef.current = points;
      const { hoveredToken, runId, selected, clamps, features, flags, paused } =
        latestRef.current;
      const still = paused || reduced.matches;
      const active =
        hoveredToken !== null && runId
          ? new Set(
              activationBus
                .forToken(runId, hoveredToken)
                .map((entry) => entry.featureId),
            )
          : null;
      const clusters = new Map<
        string,
        { x: number; y: number; count: number }
      >();
      points.forEach((point) => {
        const node = nodesRef.current.get(point.id)!;
        const elapsed = Math.max(0, now - node.last);
        const glow = still ? node.value : node.glow * Math.exp(-elapsed / 650);
        const dim = active !== null && !active.has(point.id);
        const radius = 3 + 9 * glow;
        const cluster = features[point.id]?.cluster;
        if (cluster) {
          const entry = clusters.get(cluster) ?? { x: 0, y: 0, count: 0 };
          entry.x += point.x;
          entry.y += point.y;
          entry.count++;
          clusters.set(cluster, entry);
        }
        context.globalAlpha = dim ? 0.12 : Math.max(0.35, glow);
        context.fillStyle = colors[Math.min(4, Math.floor(glow * 5))] || ink;
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 1;
        if (glow > 0.05) {
          context.strokeStyle =
            colors[Math.min(4, Math.floor(glow * 5))] || ink;
          context.globalAlpha = glow * 0.65;
          context.lineWidth = 8 * glow;
          context.beginPath();
          context.arc(point.x, point.y, radius + 3, 0, Math.PI * 2);
          context.stroke();
          context.globalAlpha = 1;
        }
        node.pulses = node.pulses.filter((time) => now - time < 800);
        if (!still)
          for (const time of node.pulses) {
            const progress = (now - time) / 800;
            context.globalAlpha = 0.55 * (1 - progress);
            context.strokeStyle = colors[3];
            context.lineWidth = 1.5;
            context.beginPath();
            context.arc(
              point.x,
              point.y,
              radius + progress * 22,
              0,
              Math.PI * 2,
            );
            context.stroke();
          }
        context.globalAlpha = 1;
        if (selected === point.id || clamps[point.id]) {
          context.strokeStyle = clamps[point.id]
            ? clamps[point.id] > 0
              ? up
              : down
            : ink;
          context.lineWidth = clamps[point.id]
            ? 1.5 + 2.5 * Math.abs(clamps[point.id])
            : 2;
          context.beginPath();
          context.arc(point.x, point.y, radius + 7, 0, Math.PI * 2);
          context.stroke();
        }
      });
      context.globalAlpha = 0.7;
      context.fillStyle = ink;
      context.font = `20px ${displayFont}`;
      context.textAlign = "center";
      const placed: { x: number; y: number; width: number }[] = [];
      clusters.forEach((cluster, label) => {
        const x = cluster.x / cluster.count,
          labelWidth = context.measureText(label).width;
        let y = cluster.y / cluster.count - 26;
        while (
          placed.some(
            (item) =>
              Math.abs(item.x - x) < (item.width + labelWidth) / 2 + 8 &&
              Math.abs(item.y - y) < 22,
          )
        )
          y -= 24;
        placed.push({ x, y, width: labelWidth });
        context.fillText(label, x, y);
      });
      context.globalAlpha = 1;
      if (
        flags.length &&
        runId &&
        flagPulse.current &&
        (still || now - flagPulse.current.time < 1200)
      ) {
        const strongest = activationBus
          .forToken(runId, flagPulse.current.tokenIndex)
          .sort((a, b) => b.value - a.value)[0];
        const point = points.find((item) => item.id === strongest?.featureId);
        if (point) {
          const progress = still ? 0 : (now - flagPulse.current.time) / 1200;
          context.globalAlpha = 1 - progress;
          context.strokeStyle = alert;
          context.lineWidth = 2;
          context.beginPath();
          context.arc(point.x, point.y, 16 + progress * 38, 0, Math.PI * 2);
          context.stroke();
          context.fillStyle = alert;
          context.font = "18px sans-serif";
          context.fillText("⚠", point.x + 22, point.y - 16);
          context.globalAlpha = 1;
        }
      }
      if (
        !still &&
        (nodes.some((node) => now - node.last < 1500) ||
          (flagPulse.current && now - flagPulse.current.time < 1200))
      )
        schedule();
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(draw);
    };
    requestDraw.current = schedule;
    observer.observe(canvas);
    resize();
    schedule();
    reduced.addEventListener("change", schedule);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      reduced.removeEventListener("change", schedule);
      requestDraw.current = null;
    };
  }, []);

  const hit = (x: number, y: number) =>
    pointsRef.current
      .map((point) => ({
        point,
        distance: Math.hypot(point.x - x, point.y - y),
      }))
      .sort((a, b) => a.distance - b.distance)[0];
  return (
    <div className="relative h-full min-h-[370px] w-full">
      <button
        type="button"
        aria-label="Feature map. Use arrow keys to move between features and Enter to inspect."
        className="block h-full w-full cursor-crosshair p-0 text-left focus-visible:outline-3 focus-visible:outline-offset-[-5px] focus-visible:outline-foam"
        onKeyDown={(event) => {
          const direction = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1],
          }[event.key] as number[] | undefined;
          if (event.key === "Enter" && keyboardId) {
            select(keyboardId);
            return;
          }
          if (!direction) return;
          event.preventDefault();
          const origin = pointsRef.current.find(
            (point) => point.id === keyboardId,
          ) ?? {
            x: event.currentTarget.clientWidth / 2,
            y: event.currentTarget.clientHeight / 2,
          };
          const next = pointsRef.current
            .filter(
              (point) =>
                point.id !== keyboardId &&
                (point.x - origin.x) * direction[0] +
                  (point.y - origin.y) * direction[1] >
                  0,
            )
            .sort(
              (a, b) =>
                Math.hypot(a.x - origin.x, a.y - origin.y) -
                Math.hypot(b.x - origin.x, b.y - origin.y),
            )[0];
          if (next) {
            setKeyboardId(next.id);
            select(next.id);
          }
        }}
      >
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="h-full w-full"
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const found = hit(
              event.clientX - rect.left,
              event.clientY - rect.top,
            );
            if (
              found &&
              found.distance <=
                Math.max(
                  SIZE,
                  3 + 9 * (nodesRef.current.get(found.point.id)?.value ?? 0),
                )
            ) {
              const node = nodesRef.current.get(found.point.id)!;
              setTip({
                id: found.point.id,
                x: found.point.x,
                y: found.point.y,
                value: node.value,
              });
            } else setTip(null);
          }}
          onPointerLeave={() => setTip(null)}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const found = hit(
              event.clientX - rect.left,
              event.clientY - rect.top,
            );
            if (found && found.distance <= SIZE + 6) select(found.point.id);
          }}
        />
      </button>
      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-20 rounded bg-paper px-2 py-1 text-xs text-driftwood shadow-lg"
          style={{ left: tip.x + 12, top: tip.y - 20 }}
        >
          {features[tip.id]?.label ?? tip.id} · {Math.round(tip.value * 100)}%
        </div>
      )}
      {!hasNodes && (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center font-body text-sm text-deep-ink/85">
          Live text is connected. Activation data is not available from this
          model yet.
        </p>
      )}
    </div>
  );
}
