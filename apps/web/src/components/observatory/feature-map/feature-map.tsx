"use client";

import { memo, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";

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
  /** Display name of the active model, written on the glass fish's body. */
  modelLabel?: string;
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
  modelLabel,
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
  // The name tooltip follows keyboard focus only: on hover it got in the way of dragging.
  const tooltipFeature = features.find((feature) => feature.id === keyboardId);
  const presentationRef = useRef({ selection, keyboardId, hoveredId, clamps, tokenFeatures: null as Set<string> | null });
  const motionPausedRef = useRef(ambientPaused);
  // Last pointer position over the map; neurons move under a still pointer as the brain turns.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  const modelLabelRef = useRef(modelLabel);
  const mapRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [brainZoomed, setBrainZoomed] = useState(false);
  const brainZoomedRef = useRef(brainZoomed);
  const [has3d, setHas3d] = useState(false);

  useEffect(() => { brainZoomedRef.current = brainZoomed; }, [brainZoomed]);

  // The zoom button matches the legend's height (it wraps on narrow screens).
  useEffect(() => {
    const map = mapRef.current;
    const legend = map?.querySelector("aside");
    if (!map || !legend) return;
    const observer = new ResizeObserver(() => map.style.setProperty("--legend-height", `${legend.getBoundingClientRect().height}px`));
    observer.observe(legend);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { motionPausedRef.current = ambientPaused; }, [ambientPaused]);
  useEffect(() => { modelLabelRef.current = modelLabel; }, [modelLabel]);

  // React handles interaction changes; the activation stream only updates refs.
  useEffect(() => {
    presentationRef.current = {
      selection, keyboardId, hoveredId, clamps,
      tokenFeatures: activeRunId && hoveredTokenIndex !== null
        ? new Set(source.forToken(activeRunId, hoveredTokenIndex).map((entry) => entry.featureId)) : null,
    };
    const point = screenPositionsRef.current.get(keyboardId ?? "");
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
          setHas3d(true);
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
      const point = projected.get(ui.keyboardId ?? "");
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
      scene3d?.frame(elapsed / 1000, !reducedMotion && !motionPausedRef.current, neuronState,
        { brain: brainZoomedRef.current, instant: reducedMotion });
      updateScreenPositions();
      // No hover while dragging the fish around.
      const nearest = pointerRef.current && !draggingRef.current ? nearestNeuron(screenPositionsRef.current, pointerRef.current) : null;
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
      context.textAlign = "center";
      context.lineJoin = "round";
      // Zoomed out, the model's name sits at the centre of the brain; zoomed in,
      // it crossfades to the name of each region. Without the 3D scene, only
      // region names show.
      const zoom = scene3d ? scene3d.zoomAmount() : 1;
      const brainPoint = scene3d && modelLabelRef.current && zoom < 0.99 ? scene3d.project(BRAIN_BOUNDS.center) : null;
      if (brainPoint && modelLabelRef.current) {
        context.font = `24px ${displayFont}`;
        context.globalAlpha = .8 * (1 - zoom);
        context.strokeStyle = abyss;
        context.lineWidth = 6;
        context.strokeText(modelLabelRef.current, brainPoint.x, brainPoint.y + 8);
        context.globalAlpha = .92 * (1 - zoom);
        context.fillStyle = deepInk;
        context.fillText(modelLabelRef.current, brainPoint.x, brainPoint.y + 8);
      }
      // Region labels draw above every neuron, with a dark halo so they never lose contrast.
      context.font = `16px ${displayFont}`;
      for (const anchor of zoom > 0.01 ? labelAnchors : []) {
        const point = projectPoint(anchor.center);
        if (!point) continue;
        context.globalAlpha = .85 * zoom;
        context.strokeStyle = abyss;
        context.lineWidth = 5;
        context.strokeText(anchor.label, point.x, point.y + 5);
        context.globalAlpha = zoom;
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
      const tipState = states.get(ui.keyboardId ?? "");
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
      <div ref={mapRef} className={`${styles.map} ${has3d ? styles.withZoom : ""}`} onPointerMove={pointerMove}
        onPointerDown={() => {
          draggingRef.current = true;
          setHoveredId(null);
          mapRef.current?.setAttribute("data-dragging", "");
          const end = () => {
            draggingRef.current = false;
            mapRef.current?.removeAttribute("data-dragging");
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
          };
          window.addEventListener("pointerup", end);
          window.addEventListener("pointercancel", end);
        }}
        onPointerLeave={() => { pointerRef.current = null; setHoveredId(null); }}>
        <canvas
          data-feature-map
          ref={canvasRef}
          className={styles.canvas}
          role="img"
          tabIndex={0}
          aria-label={`Feature map: ${features.length} features shown as neurons in a fish brain. ${tooltipFeature ? `Focused feature: ${tooltipFeature.label}.` : "Neurons brighten when a feature activates."}`}
          aria-describedby={instructionsId}
          onKeyDown={keyDown}
          // Clicking to drag also focuses the canvas; only keyboard focus picks a feature.
          onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) setKeyboardId(selection ?? features[0]?.id ?? null); }}
          onBlur={() => setKeyboardId(null)}
        />
        {features.map((feature) => (
          <button key={feature.id}
            ref={(button) => { if (button) buttonRefs.current.set(feature.id, button); else buttonRefs.current.delete(feature.id); }}
            className={styles.nodeButton} type="button" tabIndex={-1}
            aria-label={`Select ${feature.label}, ${feature.cluster}${clamps[feature.id] ? `, clamped ${clamps[feature.id] > 0 ? "+" : ""}${clamps[feature.id]}` : ""}`}
            aria-pressed={selection === feature.id}
            aria-describedby={keyboardId === feature.id ? tooltipId : undefined}
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
        {has3d ? (
          <button type="button" className={styles.zoomButton} aria-pressed={brainZoomed}
            aria-label={brainZoomed ? "Zoom out to the whole fish" : "Zoom in on the brain"}
            title={brainZoomed ? "Zoom out to the whole fish" : "Zoom in on the brain"}
            onClick={() => setBrainZoomed((zoomed) => !zoomed)}>
            {brainZoomed ? <ZoomOut aria-hidden /> : <ZoomIn aria-hidden />}
          </button>
        ) : null}
        <Legend />
      </div>
    </DeepViewport>
  );
}

export const FeatureMap = memo(FeatureMapInner);
