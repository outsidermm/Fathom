import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createFishGeometry } from "@/components/sea/sea-models";
import { readSeaPalette } from "@/components/sea/sea-renderer";
import { BRAIN_BOUNDS, BRAIN_REGIONS, FISH_PLACEMENT, taperAt, type Vec3 } from "./brain-layout";

export interface NeuronState {
  /** Activation strength 0..1. */
  glow: number;
  /** 1 = normal, lower = faded (e.g. not part of the hovered token). */
  dim: number;
  /** Progress 0..1 of the latest firing along the axon, or -1 when idle. */
  signal: number;
}

export interface BrainScene {
  canvas: HTMLCanvasElement;
  setNeurons(neurons: readonly { id: string; position: Vec3 }[]): void;
  /** Advances the camera, applies neuron states and renders one frame. */
  frame(delta: number, autoRotate: boolean, stateOf: (id: string) => NeuronState, zoom: { brain: boolean; instant: boolean }): void;
  /** 0 = whole fish in view, 1 = zoomed in on the brain (eases between). */
  zoomAmount(): number;
  /** Screen position in CSS px relative to the host, or null when off-screen. */
  project(point: Vec3): { x: number; y: number } | null;
  resize(width: number, height: number): void;
  dispose(): void;
}

const AXON_POINTS = 24;
const DENDRITES = 3;
const DENDRITE_POINTS = 7;
// Fixed camera tilt, in degrees from straight overhead.
const CAMERA_TILT = 66;
const VERTICES_PER_NEURON = (AXON_POINTS - 1) * 2 + DENDRITES * (DENDRITE_POINTS - 1) * 2;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * A translucent fish brain with features as neurons. `glowColors` is the
 * design system's activation ramp (weak → strong); `ink` is the outline colour.
 * Pointer input for orbiting is read from `controlsElement` (the 2D overlay).
 */
export function createBrainScene(host: HTMLElement, controlsElement: HTMLElement, glowColors: readonly string[], ink: string): BrainScene {
  // preserveDrawingBuffer lets the Pause Motion snapshot copy this canvas.
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.dataset.brain3d = "true";
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
  host.prepend(canvas);

  const scene = new THREE.Scene();
  const fish = createGlassFish(host);
  scene.add(fish.root);
  // Frame the whole fish; start above and to one side so the brain and the
  // fish's profile both read.
  const bounds = new THREE.Box3().setFromObject(fish.root).getBoundingSphere(new THREE.Sphere());
  const brainBounds = new THREE.Sphere(new THREE.Vector3(BRAIN_BOUNDS.center.x, 0, 0), BRAIN_BOUNDS.radius);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);
  camera.position.setFromSphericalCoords(1, THREE.MathUtils.degToRad(CAMERA_TILT), Math.atan2(0.3, 0.9)).add(bounds.center);
  const controls = new OrbitControls(camera, controlsElement);
  controls.target.copy(bounds.center);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.autoRotateSpeed = 0.6;
  // Horizontal drags orbit; vertical swipes still scroll the page on touch.
  controlsElement.style.touchAction = "pan-y";
  controls.update();
  // The tilt is fixed so the view stays predictable: dragging only turns the
  // fish around, never over or under it.
  controls.minPolarAngle = controls.maxPolarAngle = THREE.MathUtils.degToRad(CAMERA_TILT);

  const inkColor = new THREE.Color(ink);
  const ramp = glowColors.map((color) => new THREE.Color(color));
  const rampAt = (value: number, target: THREE.Color) => target.copy(ramp[Math.min(ramp.length - 1, Math.floor(value * ramp.length))]);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x0a1a24, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(-3, 8, 4);
  scene.add(key);

  // Translucent lobes: bright at the silhouette, nearly clear face-on (an x-ray look).
  const shellMaterial = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: inkColor.clone() } },
    vertexShader: `
      varying vec3 vNormal; varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; varying vec3 vNormal; varying vec3 vView;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.4);
        gl_FragColor = vec4(uColor, 0.025 + rim * 0.32);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const shells: THREE.Mesh[] = [];
  for (const region of BRAIN_REGIONS) {
    const geometry = new THREE.SphereGeometry(1, 48, 32);
    const vertices = geometry.getAttribute("position");
    for (let i = 0; i < vertices.count; i += 1) {
      const lx = vertices.getX(i);
      vertices.setXYZ(i,
        region.center.x + lx * region.radius.x,
        region.center.y + vertices.getY(i) * region.radius.y,
        region.center.z + vertices.getZ(i) * region.radius.z * taperAt(region, lx));
    }
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, shellMaterial);
    mesh.renderOrder = 0;
    scene.add(mesh);
    shells.push(mesh);
  }

  const somaGeometry = new THREE.SphereGeometry(0.09, 16, 12);
  const somaMaterial = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 });
  let somas: THREE.InstancedMesh | null = null;

  // Soft additive halos around firing neurons.
  const haloMaterial = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 1 } },
    vertexShader: `
      attribute vec3 aColor; attribute float aSize; varying vec3 vColor; uniform float uScale;
      void main() {
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = pow(max(0.0, 1.0 - d), 2.0);
        gl_FragColor = vec4(vColor * a, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  let halos: THREE.Points | null = null;

  const fiberMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  let fibers: THREE.LineSegments | null = null;
  let ids: string[] = [];

  function disposeNeurons() {
    for (const object of [somas, halos, fibers]) {
      if (!object) continue;
      scene.remove(object);
      if (object !== somas) object.geometry.dispose();
    }
    somas?.dispose();
    somas = halos = fibers = null;
  }

  function setNeurons(neurons: readonly { id: string; position: Vec3 }[]) {
    disposeNeurons();
    ids = neurons.map((neuron) => neuron.id);
    if (neurons.length === 0) return;

    somas = new THREE.InstancedMesh(somaGeometry, somaMaterial, neurons.length);
    somas.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const idle = ramp[0];
    neurons.forEach((neuron, index) => {
      somas!.setMatrixAt(index, new THREE.Matrix4().setPosition(neuron.position.x, neuron.position.y, neuron.position.z));
      somas!.setColorAt(index, idle);
    });
    scene.add(somas);

    const haloGeometry = new THREE.BufferGeometry();
    haloGeometry.setAttribute("position", new THREE.Float32BufferAttribute(neurons.flatMap((n) => [n.position.x, n.position.y, n.position.z]), 3));
    haloGeometry.setAttribute("aColor", new THREE.Float32BufferAttribute(new Float32Array(neurons.length * 3), 3));
    haloGeometry.setAttribute("aSize", new THREE.Float32BufferAttribute(new Float32Array(neurons.length), 1));
    halos = new THREE.Points(haloGeometry, haloMaterial);
    halos.frustumCulled = false;
    halos.renderOrder = 2;
    scene.add(halos);

    // Each neuron: one axon running to the hindbrain tract (or, for hindbrain
    // neurons, forward into the tectum), plus a few short dendrites.
    const positions: number[] = [];
    for (const neuron of neurons) {
      const random = mulberry32(hash(neuron.id));
      const soma = new THREE.Vector3(neuron.position.x, neuron.position.y, neuron.position.z);
      const side = soma.z === 0 ? (random() < 0.5 ? -1 : 1) : Math.sign(soma.z);
      const forward = soma.x < -0.8;
      const end = forward
        ? new THREE.Vector3(0.8 + random() * 1.2, 0.1, side * (0.9 + random() * 0.6))
        : new THREE.Vector3(-3.7 - random() * 0.9, -0.15, side * (0.15 + random() * 0.2));
      const middle = new THREE.Vector3((soma.x + end.x) / 2, soma.y * 0.4, side * (0.35 + random() * 0.3));
      const axon = new THREE.CatmullRomCurve3([
        soma,
        soma.clone().add(new THREE.Vector3((random() - 0.5) * 0.4, 0.15, (random() - 0.5) * 0.4)),
        middle,
        end,
      ]).getPoints(AXON_POINTS - 1);
      for (let i = 0; i < AXON_POINTS - 1; i += 1) positions.push(...axon[i].toArray(), ...axon[i + 1].toArray());
      for (let d = 0; d < DENDRITES; d += 1) {
        const direction = new THREE.Vector3(random() - 0.5, random() - 0.3, random() - 0.5).normalize();
        const bend = new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(0.15);
        const branch = new THREE.QuadraticBezierCurve3(
          soma,
          soma.clone().addScaledVector(direction, 0.18).add(bend),
          soma.clone().addScaledVector(direction, 0.32 + random() * 0.2),
        ).getPoints(DENDRITE_POINTS - 1);
        for (let i = 0; i < DENDRITE_POINTS - 1; i += 1) positions.push(...branch[i].toArray(), ...branch[i + 1].toArray());
      }
    }
    const fiberGeometry = new THREE.BufferGeometry();
    fiberGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    fiberGeometry.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3));
    fibers = new THREE.LineSegments(fiberGeometry, fiberMaterial);
    fibers.frustumCulled = false;
    fibers.renderOrder = 1;
    scene.add(fibers);
  }

  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const color = new THREE.Color();
  const tint = new THREE.Color();
  // Resting fibers take the second glow step, so the network reads teal, not white.
  const fiberBase = ramp[Math.min(1, ramp.length - 1)].clone();

  // Zoom eases the camera from framing the fish to framing the brain, and
  // fades the fish out to a faint outline.
  let zoom = 0;
  const lastTarget = new THREE.Vector3();
  function frame(delta: number, autoRotate: boolean, stateOf: (id: string) => NeuronState, zoomTo: { brain: boolean; instant: boolean }) {
    const goal = zoomTo.brain ? 1 : 0;
    const nextZoom = zoomTo.instant ? goal : zoom + (goal - zoom) * (1 - Math.exp(-delta * 5));
    zoom = Math.abs(goal - nextZoom) < 0.001 ? goal : nextZoom;
    lastTarget.copy(controls.target);
    controls.target.lerpVectors(bounds.center, brainBounds.center, zoom);
    const distance = THREE.MathUtils.lerp(fitDistance(bounds.radius), fitDistance(brainBounds.radius), zoom);
    camera.position.sub(lastTarget).setLength(distance).add(controls.target);
    fish.setFade(1 - zoom * 0.9);
    controls.autoRotate = autoRotate;
    controls.update(delta);
    if (autoRotate) fish.swim(delta);
    if (somas && halos && fibers) {
      const haloColors = halos.geometry.getAttribute("aColor") as THREE.BufferAttribute;
      const haloSizes = halos.geometry.getAttribute("aSize") as THREE.BufferAttribute;
      const fiberColors = fibers.geometry.getAttribute("color") as THREE.BufferAttribute;
      ids.forEach((id, index) => {
        const { glow, dim, signal } = stateOf(id);
        somas!.getMatrixAt(index, matrix);
        matrix.decompose(position, quaternion, scale);
        scale.setScalar((1 + glow * 0.9) * (0.6 + dim * 0.4));
        somas!.setMatrixAt(index, matrix.compose(position, quaternion, scale));
        rampAt(glow, color).multiplyScalar(0.35 + dim * 0.65);
        somas!.setColorAt(index, color);
        const lit = glow > 0.02;
        haloColors.setXYZ(index, color.r * dim, color.g * dim, color.b * dim);
        haloSizes.setX(index, lit ? 0.25 + glow * 0.9 : 0);

        // Fibers: faint at rest, tinted by activation, with a bright spike
        // travelling down the axon after each firing.
        const start = index * VERTICES_PER_NEURON;
        const axonVertices = (AXON_POINTS - 1) * 2;
        for (let v = 0; v < VERTICES_PER_NEURON; v += 1) {
          const along = v < axonVertices ? Math.ceil(v / 2) / (AXON_POINTS - 1) : 0;
          const spike = v < axonVertices && signal >= 0 ? Math.max(0, 1 - Math.abs(along - signal) * 7) : 0;
          const strength = (0.07 + glow * 0.4 + spike * 1.3) * dim;
          color.copy(fiberBase).lerp(rampAt(Math.max(glow, spike), tint), Math.min(1, glow + spike));
          fiberColors.setXYZ(start + v, color.r * strength, color.g * strength, color.b * strength);
        }
      });
      somas.instanceMatrix.needsUpdate = true;
      if (somas.instanceColor) somas.instanceColor.needsUpdate = true;
      haloColors.needsUpdate = true;
      haloSizes.needsUpdate = true;
      fiberColors.needsUpdate = true;
    }
    renderer.render(scene, camera);
  }

  const projected = new THREE.Vector3();
  let width = 1, height = 1;
  function project(point: Vec3) {
    projected.set(point.x, point.y, point.z).project(camera);
    if (projected.z > 1) return null;
    return { x: (projected.x + 1) / 2 * width, y: (1 - projected.y) / 2 * height };
  }

  /** Camera distance that keeps a sphere of `radius` in frame at the current aspect. */
  function fitDistance(radius: number) {
    const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    return radius / Math.sin(Math.min(vertical, horizontal));
  }

  function resize(nextWidth: number, nextHeight: number) {
    width = Math.max(1, nextWidth);
    height = Math.max(1, nextHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Keep the whole brain in frame at any aspect, whichever way it has turned.
    const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
    const distance = THREE.MathUtils.lerp(fitDistance(bounds.radius), fitDistance(brainBounds.radius), zoom);
    camera.position.sub(controls.target).setLength(distance).add(controls.target);
    camera.updateProjectionMatrix();
    haloMaterial.uniforms.uScale.value = (height * renderer.getPixelRatio()) / (2 * Math.tan(vertical));
  }

  return {
    canvas,
    zoomAmount: () => zoom,
    setNeurons,
    frame,
    project,
    resize,
    dispose() {
      controls.dispose();
      fish.dispose();
      disposeNeurons();
      for (const shell of shells) shell.geometry.dispose();
      shellMaterial.dispose();
      somaGeometry.dispose();
      somaMaterial.dispose();
      haloMaterial.dispose();
      fiberMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

/**
 * The sea-glass reef fish from the sea scene, rebuilt as clear glass around
 * the brain: bright at its silhouette, nearly invisible face-on, with solid
 * eyes. It keeps the sea fish's travelling-wave swim (tail only, so the brain
 * in its head stays still).
 */
function createGlassFish(host: HTMLElement) {
  const palette = readSeaPalette(host);
  const geometry = createFishGeometry(palette, 0);
  const swim = { uSwim: { value: 0 }, uAmp: { value: 0.07 } };
  const fade = { value: 1 };
  const glass = (color: THREE.Color, base: number, rim: number, side: THREE.Side) => new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uBase: { value: base }, uRim: { value: rim }, uFade: fade, ...swim },
    vertexShader: `
      uniform float uSwim; uniform float uAmp;
      varying vec3 vNormal; varying vec3 vView;
      void main() {
        // Same body wave as the sea fish (sea-models.ts), in fish units.
        float swimT = clamp((0.45 - position.x) * 0.5, 0.0, 1.0);
        vec3 bent = position;
        bent.z += uAmp * swimT * swimT * sin(uSwim + position.x * 3.2);
        vec4 mv = modelViewMatrix * vec4(bent, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uBase; uniform float uRim; uniform float uFade;
      varying vec3 vNormal; varying vec3 vView;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.0);
        gl_FragColor = vec4(uColor, (uBase + rim * uRim) * uFade);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side,
    blending: THREE.AdditiveBlending,
  });
  const bodyMaterial = glass(palette.seaGlass.clone(), 0.02, 0.55, THREE.FrontSide);
  const finMaterial = glass(palette.seaGlass.clone().lerp(palette.water, 0.3), 0.05, 0.3, THREE.DoubleSide);

  const root = new THREE.Group();
  root.position.set(FISH_PLACEMENT.offset.x, FISH_PLACEMENT.offset.y, FISH_PLACEMENT.offset.z);
  root.scale.set(FISH_PLACEMENT.scale, FISH_PLACEMENT.scale, FISH_PLACEMENT.scale * FISH_PLACEMENT.lateral);
  root.add(new THREE.Mesh(geometry.body, bodyMaterial), new THREE.Mesh(geometry.fins, finMaterial), new THREE.Mesh(geometry.gill, finMaterial));
  for (const side of [-1, 1]) {
    const pectoral = new THREE.Mesh(geometry.pectoral, finMaterial);
    pectoral.position.copy(geometry.pectoralAt).setZ(side * geometry.pectoralAt.z);
    pectoral.rotation.y = side * 0.55;
    root.add(pectoral);
  }
  // Solid eyes give the glass body a face. They live in world space, outside
  // the widened body, so they stay round and clear of the brain.
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: palette.paper, roughness: 0.3, transparent: true, opacity: 0.55 });
  const pupilMaterial = new THREE.MeshStandardMaterial({ color: 0x020608, roughness: 0.1, transparent: true });
  const eyeRadius = FISH_PLACEMENT.eye.radius * FISH_PLACEMENT.scale;
  const eyeballGeometry = new THREE.SphereGeometry(eyeRadius, 24, 16);
  const pupilGeometry = new THREE.SphereGeometry(eyeRadius * 0.68, 20, 14);
  const eyes = new THREE.Group();
  for (const side of [-1, 1]) {
    const center = FISH_PLACEMENT.toWorld(FISH_PLACEMENT.eye.x, FISH_PLACEMENT.eye.y, side * FISH_PLACEMENT.eye.z);
    const eyeball = new THREE.Mesh(eyeballGeometry, eyeMaterial);
    eyeball.position.set(center.x, center.y, center.z);
    const pupil = new THREE.Mesh(pupilGeometry, pupilMaterial);
    pupil.position.set(center.x + eyeRadius * 0.15, center.y, center.z + side * eyeRadius * 0.47);
    eyes.add(eyeball, pupil);
  }
  const group = new THREE.Group();
  group.add(root, eyes);
  group.traverse((object) => { object.renderOrder = -1; });

  return {
    root: group,
    swim(delta: number) { swim.uSwim.value += delta * 3; },
    setFade(amount: number) {
      fade.value = amount;
      eyeMaterial.opacity = 0.55 * amount;
      pupilMaterial.opacity = amount;
    },
    dispose() {
      for (const part of [geometry.body, geometry.fins, geometry.pectoral, geometry.gill, geometry.eyeball, geometry.pupil, eyeballGeometry, pupilGeometry]) part.dispose();
      for (const material of [bodyMaterial, finMaterial, eyeMaterial, pupilMaterial]) material.dispose();
    },
  };
}
