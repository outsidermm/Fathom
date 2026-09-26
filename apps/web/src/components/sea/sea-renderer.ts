import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { SeaPalette } from "./sea-models";

const TOKENS = [
  ["water", "--water", "#aae2f0"], ["waterDeep", "--water-deep", "#5896ab"],
  ["seaGlass", "--sea-glass", "#72c3d5"], ["ink", "--ink", "#055958"],
  ["paper", "--paper", "#f6efec"], ["abyss", "--abyss", "#061a26"],
  ["shell", "--shell", "#e08b6a"], ["starfish", "--starfish", "#e5a83d"],
  ["sand", "--sand", "#e5ccae"], ["crate", "--crate", "#c5a97c"],
] as const;

/** Reads the design-system colours so the 3D scenes never invent their own palette. */
export function readSeaPalette(element: Element) {
  const computed = getComputedStyle(element);
  return Object.fromEntries(TOKENS.map(([name, token, fallback]) =>
    [name, new THREE.Color(computed.getPropertyValue(token).trim() || fallback)])) as SeaPalette;
}

/** A transparent, antialiased renderer with a soft studio environment for real reflections. */
export function createSeaRenderer(host: HTMLElement, dataset: string) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "default" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset[dataset] = "true";
  host.appendChild(canvas);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04).texture;
  room.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); object.material.dispose(); } });
  return {
    renderer, canvas, environment,
    dispose(scene: THREE.Scene) {
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          geometries.add(object.geometry);
          (Array.isArray(object.material) ? object.material : [object.material]).forEach(value => materials.add(value));
        }
      });
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(value => value.dispose());
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

export interface SeaScene {
  setPaused(paused: boolean): void;
  /** Pushes the scene back (fog) so data drawn over it reads first. */
  setReceded?(receded: boolean): void;
  dispose(): void;
}

/**
 * Drives a scene only while it is on screen, the tab is visible, motion is allowed and the GL
 * context is alive; otherwise it renders a single still frame.
 */
export function runSeaLoop(host: HTMLElement, canvas: HTMLCanvasElement, initiallyPaused: boolean, scene: {
  update(delta: number): void;
  render(): void;
  resize(width: number, height: number): void;
}) {
  let paused = initiallyPaused;
  let visible = true;
  let contextLost = false;
  let disposed = false;
  let frame = 0;
  let lastTime = 0;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function canAnimate() { return !disposed && !contextLost && visible && !document.hidden && !paused && !motion.matches; }
  function render() { if (!contextLost && !disposed) scene.render(); }
  function tick(now: number) {
    frame = 0;
    if (!canAnimate()) return;
    if (!lastTime) lastTime = now;
    const delta = (now - lastTime) / 1000;
    lastTime = now;
    scene.update(Math.min(delta, .05));
    render();
    frame = requestAnimationFrame(tick);
  }
  function syncMotion() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
    canvas.dataset.paused = String(!canAnimate());
    render();
    if (canAnimate()) frame = requestAnimationFrame(tick);
  }
  function resize() {
    scene.resize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight));
    render();
  }
  const resizeObserver = new ResizeObserver(resize);
  const visibilityObserver = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; syncMotion(); });
  const onContextLost = (event: Event) => { event.preventDefault(); contextLost = true; host.dataset.renderer = "fallback"; syncMotion(); };
  const onContextRestored = () => { contextLost = false; host.dataset.renderer = "webgl"; syncMotion(); };
  resizeObserver.observe(host);
  visibilityObserver.observe(host);
  motion.addEventListener("change", syncMotion);
  document.addEventListener("visibilitychange", syncMotion);
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);
  resize();
  // Initialize the poses once even when the user has reduced motion enabled.
  scene.update(0);
  host.dataset.renderer = "webgl";
  syncMotion();

  return {
    animating: canAnimate,
    redraw: render,
    setPaused(value: boolean) { paused = value; syncMotion(); },
    stop() {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      motion.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncMotion);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      host.removeAttribute("data-renderer");
    },
  };
}
