import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { SeabedItem } from "./seabed-layout";

export type SeaPalette = Record<"water" | "waterDeep" | "seaGlass" | "ink" | "paper" | "abyss" | "shell" | "starfish" | "sand" | "crate", THREE.Color>;
export type SwimUniforms = { uSwim: { value: number }; uAmp: { value: number } };

export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  return .5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
}
/** Smoothly interpolates rows of [x, ...values] keyed on ascending x. */
function profileSampler(keys: number[][]) {
  return (x: number) => {
    let index = 0;
    while (index < keys.length - 2 && x > keys[index + 1][0]) index++;
    const p0 = keys[Math.max(index - 1, 0)], p1 = keys[index], p2 = keys[index + 1], p3 = keys[Math.min(index + 2, keys.length - 1)];
    const t = THREE.MathUtils.clamp((x - p1[0]) / (p2[0] - p1[0]), 0, 1);
    return p1.map((_, k) => k === 0 ? x : Math.max(0, catmull(p0[k], p1[k], p2[k], p3[k], t)));
  };
}
function setColors(geometry: THREE.BufferGeometry, colors: number[]) {
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
}

// ---------------------------------------------------------------- fish

type Species = {
  dorsal: THREE.Color; flank: THREE.Color; belly: THREE.Color; fin: THREE.Color; accent: THREE.Color; eye: THREE.Color;
  pattern: "none" | "bands" | "stripe";
  height: number;
  tail: [number, number][];
  dorsalFin: [number, number][];
  analFin: [number, number][];
};

function speciesFor(palette: SeaPalette, variant: number): Species {
  const forked: [number, number][] = [[-1.06, .15], [-1.52, .52], [-1.42, .2], [-1.27, 0], [-1.42, -.2], [-1.52, -.52], [-1.06, -.15]];
  const rounded: [number, number][] = [[-1.08, .19], [-1.34, .34], [-1.47, .13], [-1.49, 0], [-1.47, -.13], [-1.34, -.34], [-1.08, -.19]];
  const variants: Species[] = [
    { // sea-glass reef fish
      dorsal: palette.ink.clone().lerp(palette.waterDeep, .35), flank: palette.seaGlass.clone(), belly: palette.water.clone().lerp(palette.paper, .45),
      fin: palette.seaGlass.clone().lerp(palette.water, .3), accent: palette.ink.clone(), eye: palette.paper.clone(),
      pattern: "none", height: 1, tail: forked,
      dorsalFin: [[.36, 0], [.18, .26], [-.08, .34], [-.34, .22], [-.52, .02]], analFin: [[-.12, 0], [-.3, -.2], [-.52, -.16], [-.62, 0]],
    },
    { // coral banded fish
      dorsal: palette.shell.clone().lerp(palette.crate, .2).multiplyScalar(.72), flank: palette.shell.clone(), belly: palette.shell.clone().lerp(palette.paper, .5),
      fin: palette.shell.clone().lerp(palette.starfish, .25), accent: palette.paper.clone(), eye: palette.starfish.clone(),
      pattern: "bands", height: 1.12, tail: rounded,
      dorsalFin: [[.3, 0], [.12, .2], [-.18, .24], [-.42, .2], [-.6, .02]], analFin: [[-.1, 0], [-.3, -.18], [-.54, -.14], [-.64, 0]],
    },
    { // golden deep-bodied fish with a lateral stripe
      dorsal: palette.starfish.clone().lerp(palette.crate, .5).multiplyScalar(.75), flank: palette.starfish.clone(), belly: palette.sand.clone().lerp(palette.paper, .4),
      fin: palette.starfish.clone().lerp(palette.shell, .2), accent: palette.waterDeep.clone().lerp(palette.ink, .5), eye: palette.paper.clone(),
      pattern: "stripe", height: 1.28, tail: forked,
      dorsalFin: [[.38, 0], [.2, .3], [-.04, .34], [-.3, .22], [-.5, .02]], analFin: [[0, 0], [-.22, -.24], [-.5, -.2], [-.62, 0]],
    },
  ];
  return variants[variant % variants.length];
}

// Rows are [x, half height, half width, centre y] from caudal peduncle to snout.
const BODY = profileSampler([
  [-.98, .045, .025, 0], [-.9, .075, .04, 0], [-.65, .17, .08, .005], [-.3, .33, .15, .02],
  [.05, .41, .2, .03], [.4, .38, .2, .02], [.7, .27, .16, 0], [.9, .14, .1, -.03], [1, .012, .012, -.05],
]);
const TAIL_X = -.98, NOSE_X = 1;

/** Half height, half width and centre line of the fish body at `x` (tail −0.98 → nose 1). */
export function bodyAt(x: number, height: number) {
  const [, h, w, cy] = BODY(x);
  return { h: h * height, w, cy: cy * height };
}

function bodyGeometry(species: Species) {
  const rings = 72, segments = 40;
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const color = new THREE.Color();
  const shade = (x: number, ny: number) => {
    color.copy(species.belly).lerp(species.flank, THREE.MathUtils.smoothstep(ny, -.7, .1));
    color.lerp(species.dorsal, THREE.MathUtils.smoothstep(ny, .3, .95));
    if (species.pattern === "bands") {
      for (const centre of [.52, .02, -.56]) {
        const distance = Math.abs(x - centre);
        color.lerp(species.dorsal, (1 - THREE.MathUtils.smoothstep(distance, .075, .095)) * .9);
        color.lerp(species.accent, 1 - THREE.MathUtils.smoothstep(distance, .055, .075));
      }
    } else if (species.pattern === "stripe" && x < .62) {
      const stripe = 1 - THREE.MathUtils.smoothstep(Math.abs(ny - .08), .1, .2);
      color.lerp(species.accent, stripe * .75 * THREE.MathUtils.smoothstep(x, .62, .35));
    }
    // Soften the snout and deepen the peduncle for a painted, rounded read.
    color.multiplyScalar(.86 + .14 * THREE.MathUtils.smoothstep(x, -.95, -.4));
    colors.push(color.r, color.g, color.b);
  };
  for (let ring = 0; ring <= rings; ring++) {
    const x = TAIL_X + (NOSE_X - TAIL_X) * (.5 - .5 * Math.cos(Math.PI * ring / rings));
    const { h, w, cy } = bodyAt(x, species.height);
    for (let segment = 0; segment < segments; segment++) {
      const angle = segment / segments * Math.PI * 2;
      const sin = Math.sin(angle);
      positions.push(x, cy + h * sin * (sin < 0 ? .92 : 1), w * Math.cos(angle));
      shade(x, sin);
    }
  }
  const tail = positions.length / 3, nose = tail + 1;
  positions.push(TAIL_X - .012, bodyAt(TAIL_X, species.height).cy, 0, NOSE_X + .006, bodyAt(NOSE_X, species.height).cy, 0);
  shade(TAIL_X, 0);
  shade(NOSE_X, 0);
  for (let ring = 0; ring < rings; ring++) for (let segment = 0; segment < segments; segment++) {
    const next = (segment + 1) % segments;
    const a = ring * segments + segment, b = ring * segments + next, c = a + segments, d = b + segments;
    indices.push(a, c, b, b, c, d);
  }
  for (let segment = 0; segment < segments; segment++) {
    const next = (segment + 1) % segments;
    indices.push(tail, segment, next);
    indices.push(rings * segments + segment, nose, rings * segments + next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  setColors(geometry, colors);
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A ruled fin membrane between a root line and a smooth outline, with pleated rays. */
function finGeometry(root: (s: number) => THREE.Vector3, outline: THREE.Curve<THREE.Vector3>, base: THREE.Color, rays: number) {
  const across = 56, out = 10;
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const color = new THREE.Color(), edge = base.clone().lerp(new THREE.Color(1, 1, 1), .25);
  for (let i = 0; i <= across; i++) {
    const s = i / across;
    const start = root(s), end = outline.getPointAt(s);
    for (let j = 0; j <= out; j++) {
      const k = j / out;
      const point = start.clone().lerp(end, k);
      point.z += Math.sin(s * Math.PI * rays) * .012 * k;
      positions.push(point.x, point.y, point.z);
      const ray = .5 + .5 * Math.cos(s * Math.PI * rays * 2);
      color.copy(base).lerp(edge, k * k).multiplyScalar(.8 + .2 * ray + .1 * (1 - k));
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let i = 0; i < across; i++) for (let j = 0; j < out; j++) {
    const a = i * (out + 1) + j, b = a + out + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  setColors(geometry, colors);
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
const outlineCurve = (points: [number, number][]) =>
  new THREE.CatmullRomCurve3(points.map(([x, y]) => new THREE.Vector3(x, y, 0)), false, "centripetal");

/** Adds a travelling body wave in the vertex shader so the whole fish bends, tail first. */
function swimming<T extends THREE.Material>(material: T, uniforms: SwimUniforms) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uSwim = uniforms.uSwim;
    shader.uniforms.uAmp = uniforms.uAmp;
    shader.vertexShader = "uniform float uSwim;\nuniform float uAmp;\n" + shader.vertexShader
      .replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>
        float swimT = clamp((0.45 - position.x) * 0.5, 0.0, 1.0);
        float swimPhase = uSwim + position.x * 3.2;
        float swimSlope = -uAmp * swimT * sin(swimPhase) + uAmp * swimT * swimT * 3.2 * cos(swimPhase);
        objectNormal = normalize(vec3(objectNormal.x - swimSlope * objectNormal.z, objectNormal.yz));`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        transformed.z += uAmp * swimT * swimT * sin(swimPhase);`);
  };
  material.customProgramCacheKey = () => "sea-swim";
  return material;
}

export type FishGeometry = ReturnType<typeof createFishGeometry>;

/** Geometry is shared between every fish of the same species. */
export function createFishGeometry(palette: SeaPalette, variant: number) {
  const species = speciesFor(palette, variant);
  const top = (x: number) => { const { h, cy } = bodyAt(x, species.height); return cy + h; };
  const bottom = (x: number) => { const { h, cy } = bodyAt(x, species.height); return cy - h * .92; };
  const alongBody = (points: [number, number][], surface: (x: number) => number) =>
    outlineCurve(points.map(([x, dy]) => [x, surface(x) + dy * species.height]));
  const rootAlong = (from: number, to: number, surface: (x: number) => number, inset: number) =>
    (s: number) => { const x = THREE.MathUtils.lerp(from, to, s); return new THREE.Vector3(x, surface(x) + inset, 0); };

  const peduncle = bodyAt(-.9, species.height);
  const tail = finGeometry(s => new THREE.Vector3(-.9, peduncle.cy + THREE.MathUtils.lerp(peduncle.h, -peduncle.h, s) * .9, 0),
    outlineCurve(species.tail.map(([x, y]) => [x, y * species.height])), species.fin, 18);
  const [dorsalStart] = species.dorsalFin[0], [dorsalEnd] = species.dorsalFin.at(-1)!;
  const dorsal = finGeometry(rootAlong(dorsalStart, dorsalEnd, top, -.02), alongBody(species.dorsalFin, top), species.fin, 14);
  const [analStart] = species.analFin[0], [analEnd] = species.analFin.at(-1)!;
  const anal = finGeometry(rootAlong(analStart, analEnd, bottom, .02), alongBody(species.analFin, bottom), species.fin, 10);
  const pectoral = finGeometry(s => new THREE.Vector3(0, THREE.MathUtils.lerp(.035, -.035, s), 0),
    outlineCurve([[-.04, .05], [-.24, .06], [-.34, -.04], [-.26, -.13], [-.06, -.07]]), species.fin, 8);
  const fins = mergeGeometries([tail, dorsal, anal]);
  [tail, dorsal, anal].forEach(geometry => geometry.dispose());

  const eyeAt = bodyAt(.7, species.height);
  const eye = { x: .7, y: eyeAt.cy + eyeAt.h * .28, z: eyeAt.w * .93 };
  // The gill cover follows the body surface in a gentle backward bow.
  const gills = [-1, 1].map(side => {
    const points = Array.from({ length: 12 }, (_, index) => {
      const angle = -.95 + index / 11 * 1.9;
      const x = .5 - .07 * Math.cos(angle * 1.3);
      const { h, w, cy } = bodyAt(x, species.height);
      return new THREE.Vector3(x, cy + h * Math.sin(angle) * (angle < 0 ? .92 : 1), side * w * Math.cos(angle) * 1.01);
    });
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, .009, 6, false);
  });
  return {
    species, body: bodyGeometry(species), fins, pectoral, gill: mergeGeometries(gills),
    eyeball: new THREE.SphereGeometry(.068, 24, 16), pupil: new THREE.SphereGeometry(.046, 20, 14), eye,
    pectoralAt: new THREE.Vector3(.3, bodyAt(.3, species.height).cy - .1 * species.height, bodyAt(.3, species.height).w * .88),
  };
}

/** A smooth, vertex-coloured reef fish whose body, tail and median fins bend together. */
export function createFish(geometry: FishGeometry) {
  const { species } = geometry;
  const root = new THREE.Group();
  const uniforms: SwimUniforms = { uSwim: { value: Math.random() * 10 }, uAmp: { value: .1 } };
  const body = new THREE.Mesh(geometry.body, swimming(new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: .36, clearcoat: .7, clearcoatRoughness: .22,
    iridescence: .35, iridescenceIOR: 1.3, iridescenceThicknessRange: [180, 420],
  }), uniforms));
  const finMaterial = new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: .45, transparent: true, opacity: .84, side: THREE.DoubleSide, sheen: .4, sheenColor: species.fin,
  });
  root.add(body, new THREE.Mesh(geometry.fins, swimming(finMaterial.clone(), uniforms)));
  root.add(new THREE.Mesh(geometry.gill, new THREE.MeshStandardMaterial({ color: species.dorsal, roughness: .6 })));
  const eyeMaterial = new THREE.MeshPhysicalMaterial({ color: species.eye, roughness: .25, clearcoat: 1 });
  const pupilMaterial = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0x020608), roughness: .1, clearcoat: 1, clearcoatRoughness: .05 });
  const fins = [-1, 1].map(side => {
    const eyeball = new THREE.Mesh(geometry.eyeball, eyeMaterial);
    eyeball.position.set(geometry.eye.x, geometry.eye.y, side * geometry.eye.z);
    const pupil = new THREE.Mesh(geometry.pupil, pupilMaterial);
    pupil.position.set(geometry.eye.x + .01, geometry.eye.y, side * (geometry.eye.z + .032));
    root.add(eyeball, pupil);

    const pivot = new THREE.Group();
    pivot.position.copy(geometry.pectoralAt).setZ(side * geometry.pectoralAt.z);
    const fin = new THREE.Mesh(geometry.pectoral, finMaterial);
    fin.rotation.y = side * .55;
    pivot.add(fin);
    root.add(pivot);
    return pivot;
  });
  return { root, fins, uniforms };
}

// ---------------------------------------------------------------- seabed

/** Darkens undersides so objects sit in the sand instead of floating on it. */
function occlude(color: THREE.Color, y: number, low: number, high: number) {
  return color.multiplyScalar(.55 + .45 * THREE.MathUtils.smoothstep(y, low, high));
}

function rockGeometry(random: () => number, base: THREE.Color) {
  let geometry: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 12);
  geometry.deleteAttribute("normal");
  geometry.deleteAttribute("uv");
  geometry = mergeVertices(geometry);
  const waves = Array.from({ length: 7 }, (_, index) => ({
    direction: new THREE.Vector3(random() - .5, random() - .5, random() - .5).normalize(),
    frequency: index < 3 ? 1.2 + random() * 1.4 : 3 + random() * 4,
    phase: random() * Math.PI * 2,
    amplitude: index < 3 ? .08 : .018,
  }));
  const positions = geometry.getAttribute("position");
  const point = new THREE.Vector3(), color = new THREE.Color(), colors: number[] = [];
  for (let index = 0; index < positions.count; index++) {
    point.fromBufferAttribute(positions, index);
    let grain = 0, radius = 1;
    for (const wave of waves) {
      const value = Math.sin(point.dot(wave.direction) * wave.frequency + wave.phase);
      radius += wave.amplitude * value;
      if (wave.amplitude < .05) grain += value;
    }
    point.multiplyScalar(radius);
    if (point.y < -.3) point.y = -.3 + (point.y + .3) * .25;
    positions.setXYZ(index, point.x, point.y, point.z);
    occlude(color.copy(base).multiplyScalar(.94 + grain * .03), point.y, -.35, .7);
    colors.push(color.r, color.g, color.b);
  }
  setColors(geometry, colors);
  geometry.computeVertexNormals();
  return geometry;
}

function starfishGeometry(palette: SeaPalette, random: () => number) {
  const radial = 30, around = 240, arms = 5;
  const twist = Array.from({ length: arms }, () => (random() - .5) * .25);
  const reach = (angle: number) => {
    const arm = .5 + .5 * Math.cos(arms * angle);
    const which = Math.round(angle / (Math.PI * 2 / arms)) % arms;
    return { arm, radius: .26 + (.6 + twist[(which + arms) % arms]) * Math.pow(arm, 1.5) };
  };
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const color = new THREE.Color(), tip = palette.starfish.clone().lerp(palette.paper, .35), core = palette.starfish.clone().lerp(palette.shell, .35);
  positions.push(0, .16, 0);
  colors.push(...occlude(core.clone(), .16, -.02, .09).toArray());
  for (let ring = 1; ring <= radial; ring++) {
    const rho = ring / radial;
    for (let step = 0; step < around; step++) {
      const angle = step / around * Math.PI * 2;
      const { arm, radius } = reach(angle);
      const height = .16 * Math.pow(Math.max(0, 1 - rho * rho), .55) * (.45 + .55 * arm);
      positions.push(Math.cos(angle) * radius * rho, height, -Math.sin(angle) * radius * rho);
      color.copy(core).lerp(palette.starfish, THREE.MathUtils.smoothstep(rho, .05, .4)).lerp(tip, THREE.MathUtils.smoothstep(rho, .7, 1) * arm);
      occlude(color, height, -.02, .09);
      colors.push(color.r, color.g, color.b);
    }
  }
  const at = (ring: number, step: number) => ring === 0 ? 0 : 1 + (ring - 1) * around + (step % around);
  for (let ring = 0; ring < radial; ring++) for (let step = 0; step < around; step++) {
    if (ring === 0) { indices.push(0, at(1, step), at(1, step + 1)); continue; }
    const a = at(ring, step), b = at(ring, step + 1), c = at(ring + 1, step), d = at(ring + 1, step + 1);
    indices.push(a, c, b, b, c, d);
  }
  const star = new THREE.BufferGeometry();
  star.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  setColors(star, colors);
  star.setIndex(indices);
  star.computeVertexNormals();

  // Rows of tube-foot bumps along each arm ridge, merged into one draw call.
  const bumps: THREE.BufferGeometry[] = [];
  const shade = palette.sand.clone().lerp(palette.paper, .3);
  for (let arm = 0; arm < arms; arm++) {
    const angle = arm * Math.PI * 2 / arms;
    const { radius } = reach(angle);
    const along = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
    const across = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    for (let dot = 0; dot < 6; dot++) for (const side of [-1, 0, 1]) {
      const rho = .14 + dot * .13;
      if (side && dot > 4) continue;
      const lateral = side * .06 * (1 - rho * .7);
      const height = .16 * Math.pow(1 - rho * rho, .55) - Math.abs(lateral) * .5;
      const bump = new THREE.SphereGeometry(.03 * (1.1 - rho * .6) * (side ? .7 : 1), 12, 8);
      bump.deleteAttribute("uv");
      const at = along.clone().multiplyScalar(rho * radius).addScaledVector(across, lateral);
      bump.translate(at.x, height, at.z);
      setColors(bump, Array.from({ length: bump.getAttribute("position").count }, () => shade.toArray()).flat());
      bumps.push(bump);
    }
  }
  const merged = mergeGeometries([star, ...bumps]);
  [star, ...bumps].forEach(geometry => geometry.dispose());
  return merged;
}

function shellGeometry(palette: SeaPalette) {
  const rings = 44, ribs = 144;
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const color = new THREE.Color(), light = palette.shell.clone().lerp(palette.paper, .45), dark = palette.shell.clone().multiplyScalar(.7);
  for (let ring = 0; ring <= rings; ring++) {
    const r = Math.max(ring / rings, .015);
    for (let rib = 0; rib <= ribs; rib++) {
      const angle = -1.12 + rib / ribs * 2.24;
      const ridge = Math.pow(Math.abs(Math.cos(angle * 8.5)), .7);
      const flare = 1 + .05 * Math.pow(Math.abs(angle) / 1.12, 3);
      positions.push(Math.sin(angle) * r * flare, Math.cos(angle) * r, Math.sin(r * Math.PI * .92) * .2 * (1 - .25 * (angle / 1.12) ** 2) + ridge * .03 * r);
      const growth = .5 + .5 * Math.cos(r * Math.PI * 9);
      color.copy(dark).lerp(palette.shell, THREE.MathUtils.smoothstep(r, 0, .35)).lerp(light, ridge * .45 * r + growth * .12);
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let ring = 0; ring < rings; ring++) for (let rib = 0; rib < ribs; rib++) {
    const a = ring * (ribs + 1) + rib, b = a + ribs + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  setColors(geometry, colors);
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A soft radial blot used as a contact shadow; one texture is shared per scene. */
export function createShadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(.55, "rgba(255,255,255,.45)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}
function contactShadow(palette: SeaPalette, texture: THREE.Texture, width: number, depth: number) {
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicMaterial({
    map: texture, color: palette.abyss, transparent: true, opacity: .5, depthWrite: false,
  }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = .005;
  shadow.renderOrder = -1;
  return shadow;
}

export function createSeabedObject(kind: SeabedItem["kind"], palette: SeaPalette, seed: number, shadow: THREE.Texture) {
  const random = seededRandom(seed);
  const root = new THREE.Group();
  let lid: THREE.Group | null = null;
  if (kind === "pebbles") {
    const tones = [palette.crate, palette.sand.clone().lerp(palette.crate, .3), palette.waterDeep.clone().lerp(palette.ink, .3), palette.sand];
    const count = 3 + Math.floor(random() * 2);
    for (let index = 0; index < count; index++) {
      const tone = tones[(index + seed) % tones.length];
      const rock = new THREE.Mesh(rockGeometry(random, tone), new THREE.MeshPhysicalMaterial({
        vertexColors: true, roughness: .82, clearcoat: .15, clearcoatRoughness: .6,
      }));
      const size = index === 0 ? .46 : .22 + random() * .18;
      rock.scale.set(size * (1 + random() * .3), size * (.55 + random() * .2), size * (.85 + random() * .2));
      const angle = index * 2.3 + random();
      const spread = index === 0 ? 0 : .45 + random() * .2;
      rock.position.set(Math.cos(angle) * spread, rock.scale.y * .3, Math.sin(angle) * spread * .6);
      rock.rotation.y = random() * Math.PI;
      root.add(rock);
    }
    root.add(contactShadow(palette, shadow, 2.2, 1.5));
  } else if (kind === "starfish") {
    const star = new THREE.Mesh(starfishGeometry(palette, random), new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: .62, sheen: .6, sheenRoughness: .5, sheenColor: palette.paper,
    }));
    star.position.y = .02;
    root.add(star, contactShadow(palette, shadow, 2, 2));
  } else {
    const shellMaterial = new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: .42, clearcoat: .55, clearcoatRoughness: .3, side: THREE.DoubleSide,
      iridescence: .25, iridescenceIOR: 1.4,
    });
    const geometry = shellGeometry(palette);
    const base = new THREE.Mesh(geometry, shellMaterial);
    base.rotation.x = -Math.PI / 2;
    root.add(base);
    lid = new THREE.Group();
    lid.rotation.x = -Math.PI / 2 + .16;
    lid.position.y = .06;
    lid.add(new THREE.Mesh(geometry, shellMaterial));
    root.add(lid);
    const pearl = new THREE.Mesh(new THREE.SphereGeometry(.11, 32, 24), new THREE.MeshPhysicalMaterial({
      color: palette.paper, roughness: .12, clearcoat: 1, clearcoatRoughness: .05, iridescence: .8, iridescenceIOR: 1.6,
      sheen: .6, sheenColor: palette.water,
    }));
    pearl.position.set(0, .11, -.38);
    root.add(pearl, contactShadow(palette, shadow, 2, 1.9));
  }
  return { root, lid };
}
