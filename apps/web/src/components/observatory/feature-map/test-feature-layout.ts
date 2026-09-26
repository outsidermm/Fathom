// Dev-only test data for designing the feature map before the backend serves
// real coordinates. Enabled on the main page with `?features=test`. Nothing
// here is derived from Qwen — the UI labels it as a test layout.
import type { ActivationSource, MapActivation, MapFeature, MapFlag } from "./fake-activation-bus";

export const TEST_RUN_ID = "test-layout";

const CLUSTERS = [
  { name: "hedging", center: [-13, 11], spread: 3.2, count: 22 },
  { name: "refusal", center: [14, 14], spread: 2.6, count: 14 },
  { name: "unsupported", center: [-4, 1], spread: 2.8, count: 16 },
  { name: "style", center: [-14, -12], spread: 3.8, count: 26 },
  { name: "sentiment", center: [5, 9], spread: 2.4, count: 12 },
  { name: "reasoning", center: [12, -2], spread: 4.2, count: 30 },
  { name: "syntax", center: [2, -15], spread: 3, count: 20 },
] as const;

const LABEL_WORDS = [
  "phrasing", "marker", "pattern", "register", "cue", "shift", "clause", "tone",
  "step", "reference", "token", "hedge", "qualifier", "frame", "transition",
];

// Small seeded PRNG so the layout is identical on every reload.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number) {
  const u = Math.max(random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

function buildFeatures(): MapFeature[] {
  const random = mulberry32(1337);
  const features: MapFeature[] = [];
  let n = 0;
  for (const cluster of CLUSTERS) {
    for (let i = 0; i < cluster.count; i += 1) {
      n += 1;
      const word = LABEL_WORDS[Math.floor(random() * LABEL_WORDS.length)];
      features.push({
        id: `test_${String(n).padStart(4, "0")}`,
        label: `${cluster.name} ${word} ${i + 1}`,
        cluster: cluster.name,
        description: "Test position — not from Qwen",
        coords: {
          x: cluster.center[0] + gaussian(random) * cluster.spread,
          y: cluster.center[1] + gaussian(random) * cluster.spread,
          z: gaussian(random) * 2,
        },
      });
    }
  }
  // A few loners between clusters, like real UMAP output tends to have.
  for (let i = 0; i < 8; i += 1) {
    n += 1;
    features.push({
      id: `test_${String(n).padStart(4, "0")}`,
      label: `outlier ${i + 1}`,
      cluster: "outlier",
      description: "Test position — not from Qwen",
      coords: { x: (random() - 0.5) * 40, y: (random() - 0.5) * 40, z: (random() - 0.5) * 6 },
    });
  }
  return features;
}

export const TEST_FEATURES: readonly MapFeature[] = buildFeatures();

const byCluster = new Map<string, MapFeature[]>();
for (const feature of TEST_FEATURES) {
  byCluster.set(feature.cluster, [...(byCluster.get(feature.cluster) ?? []), feature]);
}

const subscribers = new Set<(batch: MapActivation[]) => void>();
const history: MapActivation[] = [];
const flagListeners = new Set<(flags: readonly MapFlag[]) => void>();
let flags: MapFlag[] = [];
let intervalId: ReturnType<typeof setInterval> | null = null;
let tokenIndex = 0;

function tick() {
  // Activity drifts between clusters so you can see glow move across the map.
  const clusterNames = [...byCluster.keys()];
  const focus = clusterNames[Math.floor(tokenIndex / 12) % clusterNames.length];
  const batch: MapActivation[] = [];
  const count = 2 + Math.floor(Math.random() * 4);
  for (let i = 0; i < count; i += 1) {
    const pool = Math.random() < 0.75 ? byCluster.get(focus)! : TEST_FEATURES;
    const feature = pool[Math.floor(Math.random() * pool.length)];
    batch.push({ tokenIndex, featureId: feature.id, value: 0.2 + Math.random() * 0.8, coords: feature.coords });
  }
  history.push(...batch);
  if (history.length > 2000) history.splice(0, history.length - 2000);
  for (const subscriber of subscribers) subscriber(batch);
  if (["hedging", "refusal", "unsupported"].includes(focus) && tokenIndex % 12 === 6) {
    flags = [...flags.slice(-20), { tokenIndex, signature: focus, confidence: 0.85 }];
    for (const listener of flagListeners) listener(flags);
  }
  tokenIndex += 1;
}

export const testActivationSource: ActivationSource & {
  start(): void;
  stop(): void;
  onFlags(fn: (flags: readonly MapFlag[]) => void): () => void;
} = {
  subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },
  forRun: () => history,
  forToken: (_runId, index) => history.filter((entry) => entry.tokenIndex === index),
  start() {
    if (intervalId === null) intervalId = setInterval(tick, 160);
  },
  stop() {
    if (intervalId !== null) clearInterval(intervalId);
    intervalId = null;
  },
  onFlags(fn) {
    flagListeners.add(fn);
    return () => flagListeners.delete(fn);
  },
};
