"use client";

import { memo, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { Legend } from "@/components/observatory/legend";
import { DeepViewport } from "@/components/sea/deep-viewport";
import { PaperNote } from "@/components/sea/paper-note";

import { BRAIN_BOUNDS, BRAIN_REGIONS, layoutBrain, type Vec3 } from "./brain-layout";
import type { BrainScene, NeuronState } from "./brain-scene";
import type { ActivationSource, MapFeature, MapFlag } from "./fake-activation-bus";
import styles from "./feature-map.module.css";

interface NodeState {
  glow: number;
  pulses: { startedAt: number; strength: number }[];
}

const FALLBACK_GLOWS = ["#1d6270", "#228596", "#25aabe", "#53cfdc", "#9deff3"];
const EMPTY_CLAMPS: Readonly<Record<string, number>> = {};
const EMPTY_FLAGS: readonly MapFlag[] = [];
// How long a firing takes to travel down a neuron's axon.
const SIGNAL_MS = 900;

/** The neuron within 16px of `pointer`, if any. */
function nearestNeuron(positions: ReadonlyMap<string, { x: number; y: number }>, pointer: { x: number; y: number }) {
  let nearest: string | null = null;
  let distance = 16;
  for (const [id, point] of positions) {
    const candidate = Math.hypot(pointer.x - point.x, pointer.y - point.y);
    if (candidate < distance) { distance = candidate; nearest = id; }
  }
  return nearest;
}

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
  ambientPaused?: boolean;
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
  ambientPaused = false,
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
  const motionPausedRef = useRef(ambientPaused);
  // Last pointer position over the map; neurons move under a still pointer as the brain turns.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => { motionPausedRef.current = ambientPaused; }, [ambientPaused]);

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
    const abyss = computed.getPropertyValue("--abyss").trim() || "#061a26";
    const displayFont = computed.getPropertyValue("--font-display").trim() || "sans-serif";
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = reducedMotionQuery.matches;
    let width = 1;
    let height = 1;
    let frameId = 0;
    let lastFrameAt = 0;
    let disposed = false;

    // Features are neurons inside a 3D fish brain: one region per cluster.
    const brain = layoutBrain(features);
    const positions = brain.positions;
    const states = nodeStatesRef.current;
    for (const id of states.keys()) if (!positions.has(id)) states.delete(id);
    for (const feature of features) {
      if (!states.has(feature.id)) states.set(feature.id, { glow: 0, pulses: [] });
    }
    const labelAnchors = BRAIN_REGIONS.flatMap((region, index) => {
      const label = brain.labels[index];
      return label ? [{ label, center: region.center }] : [];
    });

    // The WebGL scene loads lazily; until then (or if WebGL fails) a flat
    // top-down view draws the neurons as dots.
    let scene3d: BrainScene | null = null;
    let flatScale = 1;
    function flatProject(point: Vec3) {
      // Nose up, like the 3D view's starting angle.
      return { x: width / 2 + point.z * flatScale, y: height / 2 + 10 - (point.x - BRAIN_BOUNDS.center.x) * flatScale };
    }
    const projectPoint = (point: Vec3) => (scene3d ? scene3d.project(point) : flatProject(point));
    if (positions.size > 0) {
      void import("./brain-scene").then(({ createBrainScene }) => {
        if (disposed) return;
        try {
          scene3d = createBrainScene(host, canvas, glowColors, deepInk);
          scene3d.setNeurons([...positions].map(([id, position]) => ({ id, position })));
          scene3d.resize(width, height);
        } catch {
          scene3d = null;
        }
      });
    }

    function updateScreenPositions() {
      const projected = screenPositionsRef.current;
      projected.clear();
      for (const [id, point] of positions) {
        const screen = projectPoint(point);
        const button = buttonRefs.current.get(id);
        if (!screen) { if (button) button.style.display = "none"; continue; }
        projected.set(id, screen);
        if (button) { button.style.display = ""; button.style.left = `${screen.x}px`; button.style.top = `${screen.y}px`; }
      }
      const ui = presentationRef.current;
      const point = projected.get(ui.hoveredId ?? ui.keyboardId ?? "");
      if (point && tooltipRef.current) {
        tooltipRef.current.style.left = `${Math.max(8, Math.min(width - 228, point.x + 18))}px`;
        tooltipRef.current.style.top = `${Math.max(76, point.y - 100)}px`;
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
      flatScale = Math.min((width - 64) / BRAIN_BOUNDS.width, (height - 190) / BRAIN_BOUNDS.length);
      scene3d?.resize(width, height);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const unsubscribe = source.subscribe((batch) => {
      const now = performance.now();
      for (const activation of batch) {
        // A feature not yet in `features` has no neuron; track its glow so it
        // lights up as soon as the next layout places it.
        const state = states.get(activation.featureId) ?? { glow: 0, pulses: [] };
        state.glow = Math.max(0, Math.min(1, activation.value));
        if (!reducedMotion) state.pulses.push({ startedAt: now, strength: state.glow });
        states.set(activation.featureId, state);
      }
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

    let now = 0;
    const neuronState = (id: string): NeuronState => {
      const state = states.get(id);
      const ui = presentationRef.current;
      const latest = state?.pulses.at(-1);
      const signal = latest ? (now - latest.startedAt) / SIGNAL_MS : -1;
      return {
        glow: state?.glow ?? 0,
        dim: ui.tokenFeatures && !ui.tokenFeatures.has(id) ? .18 : 1,
        signal: signal >= 0 && signal < 1 ? signal : -1,
      };
    };

    function draw(timestamp: number) {
      if (!context) return;
      now = timestamp;
      const elapsed = lastFrameAt === 0 ? 0 : Math.min(100, timestamp - lastFrameAt);
      lastFrameAt = timestamp;
      for (const state of states.values()) {
        if (!reducedMotion && state.glow > 0) {
          state.glow *= Math.exp(-elapsed / 450);
          if (state.glow < 0.02) state.glow = 0;
        }
        while (state.pulses.length && timestamp - state.pulses[0].startedAt > SIGNAL_MS) state.pulses.shift();
      }
      scene3d?.frame(elapsed / 1000, !reducedMotion && !motionPausedRef.current, neuronState);
      updateScreenPositions();
      const nearest = pointerRef.current ? nearestNeuron(screenPositionsRef.current, pointerRef.current) : null;
      if (nearest !== presentationRef.current.hoveredId) setHoveredId(nearest);

      context.clearRect(0, 0, width, height);
      const ui = presentationRef.current;
      for (const [id, point] of screenPositionsRef.current) {
        const { glow, dim } = neuronState(id);
        const radius = 4 + 8 * glow;
        const { x, y } = point;
        if (!scene3d) {
          // Flat fallback: draw the neuron itself.
          const color = glowColors[Math.min(4, Math.floor(glow * 5))];
          context.globalAlpha = (0.75 + glow * 0.25) * dim;
          context.fillStyle = color;
          context.beginPath();
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.fill();
        }
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
      // Region labels draw above every neuron, with a dark halo so they never lose contrast.
      context.font = `16px ${displayFont}`;
      context.textAlign = "center";
      context.lineJoin = "round";
      for (const anchor of labelAnchors) {
        const point = projectPoint(anchor.center);
        if (!point) continue;
        context.globalAlpha = .85;
        context.strokeStyle = abyss;
        context.lineWidth = 5;
        context.strokeText(anchor.label, point.x, point.y + 5);
        context.globalAlpha = 1;
        context.fillStyle = deepInk;
        context.fillText(anchor.label, point.x, point.y + 5);
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
      scene3d?.dispose();
    };
  }, [features, source]);

  function select(id: string) {
    setLocalSelection(id);
    onSelectFeature?.(id);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    pointerRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const nearest = nearestNeuron(screenPositionsRef.current, pointerRef.current);
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
    <DeepViewport className={className} paused={ambientPaused} receded={features.length > 0}>
      <div className={styles.map} onPointerMove={pointerMove} onPointerLeave={() => { pointerRef.current = null; setHoveredId(null); }}>
        <canvas
          data-feature-map
          ref={canvasRef}
          className={styles.canvas}
          role="img"
          tabIndex={0}
          aria-label={`Feature map: ${features.length} features shown as neurons in a fish brain. ${tooltipFeature ? `Focused feature: ${tooltipFeature.label}.` : "Neurons brighten when a feature activates."}`}
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
        <p id={instructionsId} className={styles.srOnly}>Arrow keys explore · Enter selects · Drag to rotate</p>
        {features.length === 0 ? <p className={styles.empty}>Waiting for feature positions…</p> : null}
        {tooltipFeature ? (
          <div ref={tooltipRef} className={styles.tooltip} role="tooltip" id={tooltipId}>
            <PaperNote title={tooltipFeature.label} pin={false}>
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
