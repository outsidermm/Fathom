"use client";

import { memo, useEffect, useRef } from "react";

import { DeepViewport } from "@/components/sea/deep-viewport";

import type { ActivationSource, MapFeature } from "./fake-activation-bus";
import styles from "./feature-map.module.css";

interface NodeState {
  glow: number;
  pulses: { startedAt: number; strength: number }[];
}

const FALLBACK_GLOWS = ["#1d6270", "#228596", "#25aabe", "#53cfdc", "#9deff3"];

function FeatureMapInner({
  features,
  source,
  className = "",
}: {
  features: readonly MapFeature[];
  source: ActivationSource;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodeStatesRef = useRef(new Map<string, NodeState>());

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
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = reducedMotionQuery.matches;
    let width = 1;
    let height = 1;
    let frameId = 0;
    let lastFrameAt = 0;
    const positions = new Map(features.map((feature) => [feature.id, feature.coords]));
    const states = nodeStatesRef.current;
    for (const feature of features) {
      if (!states.has(feature.id)) states.set(feature.id, { glow: 0, pulses: [] });
    }

    let project = (x: number, y: number): [number, number] => [x, y];

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
      const topPadding = Math.max(80, sidePadding);
      const availableWidth = Math.max(1, width - sidePadding * 2);
      const availableHeight = Math.max(1, height - topPadding - sidePadding);
      const scale = Math.min(
        availableWidth / Math.max(1, maxX - minX),
        availableHeight / Math.max(1, maxY - minY),
      );
      const left = sidePadding + (availableWidth - (maxX - minX) * scale) / 2;
      const top = topPadding + (availableHeight - (maxY - minY) * scale) / 2;
      project = (x, y) => [left + (x - minX) * scale, top + (maxY - y) * scale];
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

    function draw(timestamp: number) {
      if (!context) return;
      const elapsed = lastFrameAt === 0 ? 0 : Math.min(100, timestamp - lastFrameAt);
      lastFrameAt = timestamp;
      context.clearRect(0, 0, width, height);

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

        if (!reducedMotion) {
          for (let i = state.pulses.length - 1; i >= 0; i -= 1) {
            const pulse = state.pulses[i];
            const progress = (timestamp - pulse.startedAt) / 600;
            if (progress >= 1) {
              state.pulses.splice(i, 1);
              continue;
            }
            context.globalAlpha = 0.8 * (1 - progress);
            context.strokeStyle = glowColors[Math.min(4, Math.floor(pulse.strength * 5))];
            context.lineWidth = 1.5;
            context.beginPath();
            context.arc(x, y, (3 + 9 * pulse.strength) * (1 + progress * 0.8), 0, Math.PI * 2);
            context.stroke();
          }
        }

        context.globalAlpha = glow === 0 ? 0.35 : 0.35 + glow * 0.65;
        context.fillStyle = color;
        context.shadowColor = color;
        context.shadowBlur = glow === 0 ? 0 : 18 * glow;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;
      }
      context.globalAlpha = 1;
      frameId = requestAnimationFrame(draw);
    }

    frameId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      unsubscribe();
      reducedMotionQuery.removeEventListener("change", onMotionChange);
    };
  }, [features, source]);

  return (
    <DeepViewport className={className}>
      <div className={styles.map}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          role="img"
          aria-label="Feature map. Dots brighten when the corresponding model feature activates."
        />
      </div>
    </DeepViewport>
  );
}

export const FeatureMap = memo(FeatureMapInner);
