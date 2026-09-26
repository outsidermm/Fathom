"use client";

import { memo, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { Legend } from "@/components/observatory/legend";
import { DeepViewport } from "@/components/sea/deep-viewport";
import { PaperNote } from "@/components/sea/paper-note";

import type { ActivationSource, MapFeature, MapFlag } from "./fake-activation-bus";
import styles from "./feature-map.module.css";

interface NodeState {
  glow: number;
  pulses: { startedAt: number; strength: number }[];
}

const FALLBACK_GLOWS = ["#1d6270", "#228596", "#25aabe", "#53cfdc", "#9deff3"];
const EMPTY_CLAMPS: Readonly<Record<string, number>> = {};
const EMPTY_FLAGS: readonly MapFlag[] = [];

export interface FeatureMapProps {
  features: readonly MapFeature[];
  source: ActivationSource;
  activeRunId?: string | null;
  selectedFeatureId?: string | null;
  onSelectFeature?: (id: string | null) => void;
  clamps?: Readonly<Record<string, number>>;
  hoveredTokenIndex?: number | null;
  flags?: readonly MapFlag[];
  className?: string;
}

function FeatureMapInner({
  features,
  source,
  activeRunId = null,
  selectedFeatureId,
  onSelectFeature,
  clamps = EMPTY_CLAMPS,
  hoveredTokenIndex = null,
  flags = EMPTY_FLAGS,
  className = "",
}: FeatureMapProps) {
  const instructionsId = useId();
  const tooltipId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodeStatesRef = useRef(new Map<string, NodeState>());
  const screenPositionsRef = useRef(new Map<string, { x: number; y: number }>());
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipValueRef = useRef<HTMLSpanElement>(null);
  const pingsRef = useRef<{ featureId: string; startedAt: number }[]>([]);
  const processedFlagsRef = useRef(new Set<string>());
  const [localSelection, setLocalSelection] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [keyboardId, setKeyboardId] = useState<string | null>(null);
  const selection = selectedFeatureId === undefined ? localSelection : selectedFeatureId;
  const tooltipFeature = features.find((feature) => feature.id === (hoveredId ?? keyboardId));
  const presentationRef = useRef({ selection, keyboardId, hoveredId, clamps, tokenFeatures: null as Set<string> | null });

  // React handles interaction changes; the activation stream only updates refs.
  useEffect(() => {
    presentationRef.current = {
      selection, keyboardId, hoveredId, clamps,
      tokenFeatures: activeRunId && hoveredTokenIndex !== null
        ? new Set(source.forToken(activeRunId, hoveredTokenIndex).map((entry) => entry.featureId)) : null,
    };
    const point = screenPositionsRef.current.get(hoveredId ?? keyboardId ?? "");
    if (point && canvasRef.current && tooltipRef.current) {
      tooltipRef.current.style.left = `${Math.max(8, Math.min(canvasRef.current.clientWidth - 228, point.x + 18))}px`;
      tooltipRef.current.style.top = `${Math.max(76, point.y - 100)}px`;
    }
  }, [selection, keyboardId, hoveredId, clamps, activeRunId, hoveredTokenIndex, source]);

  useEffect(() => {
    processedFlagsRef.current.clear();
    pingsRef.current = [];
    for (const state of nodeStatesRef.current.values()) {
      state.glow = 0;
      state.pulses.length = 0;
    }
  }, [activeRunId]);

  useEffect(() => {
    if (!activeRunId) return;
    for (const flag of flags) {
      const key = `${activeRunId}:${flag.tokenIndex}:${flag.signature}`;
      if (processedFlagsRef.current.has(key)) continue;
      processedFlagsRef.current.add(key);
      let strongest = null;
      for (const entry of source.forToken(activeRunId, flag.tokenIndex)) {
        if (!strongest || entry.value > strongest.value) strongest = entry;
      }
      if (strongest) pingsRef.current.push({ featureId: strongest.featureId, startedAt: performance.now() });
    }
  }, [activeRunId, flags, source]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const context = canvas?.getContext("2d");
    if (!canvas || !host || !context) return;

    // CSS colors are read once, outside the animation loop.
    const computed = getComputedStyle(canvas);
    const glowColors = FALLBACK_GLOWS.map((fallback, index) =>
      computed.getPropertyValue(`--glow-${index + 1}`).trim() || fallback,
    );
    const deepInk = computed.getPropertyValue("--deep-ink").trim() || "#f6efec";
    const clampUp = computed.getPropertyValue("--clamp-up").trim() || "#c38300";
    const clampDown = computed.getPropertyValue("--clamp-down").trim() || "#8362cd";
    const alert = computed.getPropertyValue("--alert").trim() || "#e84f27";
    const displayFont = computed.getPropertyValue("--font-display").trim() || "sans-serif";
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = reducedMotionQuery.matches;
    let width = 1;
    let height = 1;
    let frameId = 0;
    let lastFrameAt = 0;
    const positions = new Map(features.map((feature) => [feature.id, feature.coords]));
    const states = nodeStatesRef.current;
    for (const id of states.keys()) if (!positions.has(id)) states.delete(id);
    for (const feature of features) {
      if (!states.has(feature.id)) states.set(feature.id, { glow: 0, pulses: [] });
    }

    const clusters = new Map<string, { x: number; y: number; count: number }>();
    for (const feature of features) {
      const centroid = clusters.get(feature.cluster) ?? { x: 0, y: 0, count: 0 };
      centroid.x += feature.coords.x;
      centroid.y += feature.coords.y;
      centroid.count += 1;
      clusters.set(feature.cluster, centroid);
    }

    let project = (x: number, y: number): [number, number] => [x, y];
    let clusterLabels: { label: string; x: number; y: number; anchorX: number; anchorY: number; width: number }[] = [];

    function updateProjection() {
      const coords = [...positions.values()];
      if (coords.length === 0) {
        project = () => [width / 2, height / 2];
        return;
      }
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const point of coords) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
      const sidePadding = Math.min(56, Math.max(28, Math.min(width, height) * 0.08));
      const topPadding = Math.max(88, sidePadding);
      const availableWidth = Math.max(1, width - sidePadding * 2);
      const availableHeight = Math.max(1, height - topPadding - 94);
      const scale = Math.min(
        availableWidth / Math.max(1, maxX - minX),
        availableHeight / Math.max(1, maxY - minY),
      );
      const left = sidePadding + (availableWidth - (maxX - minX) * scale) / 2;
      const top = topPadding + (availableHeight - (maxY - minY) * scale) / 2;
      project = (x, y) => [left + (x - minX) * scale, top + (maxY - y) * scale];
      const projected = screenPositionsRef.current;
      projected.clear();
      for (const [id, coords] of positions) {
        const [x, y] = project(coords.x, coords.y);
        projected.set(id, { x, y });
        const button = buttonRefs.current.get(id);
        if (button) { button.style.left = `${x}px`; button.style.top = `${y}px`; }
      }
      const ui = presentationRef.current;
      const point = projected.get(ui.hoveredId ?? ui.keyboardId ?? "");
      if (point && tooltipRef.current) {
        tooltipRef.current.style.left = `${Math.max(8, Math.min(width - 228, point.x + 18))}px`;
        tooltipRef.current.style.top = `${Math.max(76, point.y - 100)}px`;
      }
      // Keep labels linked to their centroids while separating overlapping words.
      clusterLabels = [];
      if (context) context.font = `18px ${displayFont}`;
      for (const [label, centroid] of clusters) {
        const [anchorX, anchorY] = project(centroid.x / centroid.count, centroid.y / centroid.count);
        const labelWidth = Math.max(context?.measureText(label).width ?? 0, label.length * 10) + 12;
        const x = Math.max(labelWidth / 2 + 8, Math.min(width - labelWidth / 2 - 8, anchorX));
        let y = anchorY - 19;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const offset = attempt === 0 ? 0 : Math.ceil(attempt / 2) * 23 * (attempt % 2 ? -1 : 1);
          const candidate = Math.max(84, Math.min(height - 104, anchorY - 19 + offset));
          if (!clusterLabels.some((placed) => Math.abs(placed.x - x) < (placed.width + labelWidth) / 2 && Math.abs(placed.y - candidate) < 23)) {
            y = candidate;
            break;
          }
        }
        clusterLabels.push({ label, x, y, anchorX, anchorY, width: labelWidth });
      }
    }

    function resize() {
      if (!canvas || !host || !context) return;
      const rect = host.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      updateProjection();
    }

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    let disposed = false;
    void document.fonts.ready.then(() => { if (!disposed) updateProjection(); });

    const unsubscribe = source.subscribe((batch) => {
      const now = performance.now();
      let newPosition = false;
      for (const activation of batch) {
        if (!positions.has(activation.featureId)) {
          positions.set(activation.featureId, activation.coords);
          newPosition = true;
        }
        const state = states.get(activation.featureId) ?? { glow: 0, pulses: [] };
        state.glow = Math.max(0, Math.min(1, activation.value));
        if (!reducedMotion) state.pulses.push({ startedAt: now, strength: state.glow });
        states.set(activation.featureId, state);
      }
      if (newPosition) updateProjection();
    });

    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      if (reducedMotion) {
        for (const state of states.values()) state.pulses.length = 0;
      }
    };
    reducedMotionQuery.addEventListener("change", onMotionChange);

    function ring(x: number, y: number, radius: number, color: string, thickness: number) {
      if (!context) return;
      context.strokeStyle = color;
      context.lineWidth = thickness;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.stroke();
    }

    function draw(timestamp: number) {
      if (!context) return;
      const elapsed = lastFrameAt === 0 ? 0 : Math.min(100, timestamp - lastFrameAt);
      lastFrameAt = timestamp;
      context.clearRect(0, 0, width, height);
      const ui = presentationRef.current;
      context.font = `18px ${displayFont}`;
      context.textAlign = "center";
      context.fillStyle = deepInk;
      context.globalAlpha = .7;
      for (const label of clusterLabels) {
        if (Math.abs(label.y - label.anchorY) > 24) {
          context.globalAlpha = .25;
          context.strokeStyle = deepInk;
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(label.anchorX, label.anchorY);
          context.lineTo(label.x, label.y + 5);
          context.stroke();
        }
        context.globalAlpha = .7;
        context.fillText(label.label, label.x, label.y);
      }

      for (const [id, coords] of positions) {
        const state = states.get(id);
        if (!state) continue;
        if (!reducedMotion && state.glow > 0) {
          state.glow *= Math.exp(-elapsed / 450);
          if (state.glow < 0.02) state.glow = 0;
        }
        const glow = state.glow;
        const color = glowColors[Math.min(4, Math.floor(glow * 5))];
        const radius = 3 + 9 * glow;
        const [x, y] = project(coords.x, coords.y);
        const dim = ui.tokenFeatures && !ui.tokenFeatures.has(id) ? .18 : 1;

        if (!reducedMotion) {
          for (let i = state.pulses.length - 1; i >= 0; i -= 1) {
            const pulse = state.pulses[i];
            const progress = (timestamp - pulse.startedAt) / 600;
            if (progress >= 1) {
              state.pulses.splice(i, 1);
              continue;
            }
            const eased = 1 - (1 - progress) ** 3;
            context.globalAlpha = (1 - progress) * dim;
            context.strokeStyle = glowColors[Math.min(4, Math.floor(pulse.strength * 5))];
            context.lineWidth = 1.5;
            context.beginPath();
            context.arc(x, y, (3 + 9 * pulse.strength) * (1 + eased * 0.8), 0, Math.PI * 2);
            context.stroke();
          }
        }

        context.globalAlpha = (glow === 0 ? 0.35 : 0.35 + glow * 0.65) * dim;
        context.fillStyle = color;
        context.shadowColor = color;
        context.shadowBlur = glow === 0 ? 0 : 18 * glow;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;
        context.globalAlpha = dim;
        const clamp = Math.max(-1, Math.min(1, ui.clamps[id] ?? 0));
        if (clamp) ring(x, y, Math.max(10, radius + 4), clamp > 0 ? clampUp : clampDown, 1.5 + 2.5 * Math.abs(clamp));
        if (ui.selection === id) ring(x, y, Math.max(15, radius + 8), deepInk, 2);
        if (ui.keyboardId === id || ui.hoveredId === id) {
          context.setLineDash([3, 3]);
          ring(x, y, Math.max(19, radius + 12), deepInk, 1.5);
          context.setLineDash([]);
        }
      }
      for (let i = pingsRef.current.length - 1; i >= 0; i -= 1) {
        const ping = pingsRef.current[i];
        const age = timestamp - ping.startedAt;
        if (age >= 1800) { pingsRef.current.splice(i, 1); continue; }
        const point = screenPositionsRef.current.get(ping.featureId);
        if (!point) continue;
        const progress = (age % 900) / 900;
        context.globalAlpha = reducedMotion ? 1 : .9 * (1 - progress);
        ring(point.x, point.y, reducedMotion ? 20 : 12 * (1 + 2 * progress), alert, 2);
      }
      context.globalAlpha = 1;
      const tipState = states.get(ui.hoveredId ?? ui.keyboardId ?? "");
      if (tooltipValueRef.current) tooltipValueRef.current.textContent = (tipState?.glow ?? 0).toFixed(2);
      frameId = requestAnimationFrame(draw);
    }

    frameId = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      observer.disconnect();
      unsubscribe();
      reducedMotionQuery.removeEventListener("change", onMotionChange);
    };
  }, [features, source]);

  function select(id: string) {
    setLocalSelection(id);
    onSelectFeature?.(id);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    let nearest: string | null = null;
    let distance = 16;
    for (const [id, point] of screenPositionsRef.current) {
      const candidate = Math.hypot(event.clientX - rect.left - point.x, event.clientY - rect.top - point.y);
      if (candidate < distance) { distance = candidate; nearest = id; }
    }
    setHoveredId((previous) => previous === nearest ? previous : nearest);
  }

  function keyDown(event: KeyboardEvent<HTMLCanvasElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const id = keyboardId ?? selection ?? features[0]?.id;
      if (id) select(id);
      return;
    }
    if (event.key === "Escape") { setKeyboardId(null); return; }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const currentId = keyboardId ?? selection ?? features[0]?.id;
    const origin = screenPositionsRef.current.get(currentId ?? "");
    if (!origin) return;
    let nearest = currentId;
    let distance = Infinity;
    for (const [id, point] of screenPositionsRef.current) {
      if (id === currentId) continue;
      const dx = point.x - origin.x, dy = point.y - origin.y;
      const inDirection = event.key === "ArrowLeft" ? dx < 0 : event.key === "ArrowRight" ? dx > 0 : event.key === "ArrowUp" ? dy < 0 : dy > 0;
      const candidate = Math.hypot(dx, dy);
      if (inDirection && candidate < distance) { nearest = id; distance = candidate; }
    }
    if (nearest) setKeyboardId(nearest);
  }

  return (
    <DeepViewport className={className}>
      <div className={styles.map} onPointerMove={pointerMove} onPointerLeave={() => setHoveredId(null)}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          role="img"
          tabIndex={0}
          aria-label={`Feature map with ${features.length} features. ${tooltipFeature ? `Focused feature: ${tooltipFeature.label}.` : "Dots brighten when a feature activates."}`}
          aria-describedby={instructionsId}
          onKeyDown={keyDown}
          onFocus={() => setKeyboardId(selection ?? features[0]?.id ?? null)}
          onBlur={() => setKeyboardId(null)}
        />
        {features.map((feature) => (
          <button key={feature.id}
            ref={(button) => { if (button) buttonRefs.current.set(feature.id, button); else buttonRefs.current.delete(feature.id); }}
            className={styles.nodeButton} type="button" tabIndex={-1}
            aria-label={`Select ${feature.label}, ${feature.cluster}${clamps[feature.id] ? `, clamped ${clamps[feature.id] > 0 ? "+" : ""}${clamps[feature.id]}` : ""}`}
            aria-pressed={selection === feature.id}
            aria-describedby={hoveredId === feature.id ? tooltipId : undefined}
            onClick={() => select(feature.id)} onFocus={() => setKeyboardId(feature.id)} onBlur={() => setKeyboardId(null)} />
        ))}
        <p id={instructionsId} className={styles.instructions}>Arrow keys explore · Enter selects</p>
        {features.length === 0 ? <p className={styles.empty}>Waiting for feature positions…</p> : null}
        {tooltipFeature ? (
          <div ref={tooltipRef} className={styles.tooltip} role="tooltip" id={tooltipId}>
            <PaperNote title={tooltipFeature.label} pin={false} rotate={0}>
              <p>{tooltipFeature.cluster} · Activation <span ref={tooltipValueRef}>0.00</span></p>
              {clamps[tooltipFeature.id] ? <p>Clamped {clamps[tooltipFeature.id] > 0 ? "+" : ""}{clamps[tooltipFeature.id]}</p> : null}
            </PaperNote>
          </div>
        ) : null}
        <span className={styles.srOnly} role="status">{selection ? `Selected ${features.find((feature) => feature.id === selection)?.label ?? selection}` : "No feature selected"}</span>
        {flags.length ? <p className={styles.flagNotice} role="status"><span aria-hidden="true">⚠</span> {flags.at(-1)?.signature} · token {(flags.at(-1)?.tokenIndex ?? 0) + 1}</p> : null}
        <Legend />
      </div>
    </DeepViewport>
  );
}

export const FeatureMap = memo(FeatureMapInner);
