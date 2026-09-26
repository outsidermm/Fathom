/** Temporary Phase 2 feed. Replace this import with Samuel's activationBus when the store lands. */
export interface MapActivation {
  tokenIndex: number;
  featureId: string;
  value: number;
  coords: { x: number; y: number; z?: number };
}

export interface MapFeature {
  id: string;
  label: string;
  cluster: string;
  coords: { x: number; y: number; z?: number };
}

export interface ActivationSource {
  subscribe(fn: (batch: MapActivation[]) => void): () => void;
  forRun(runId: string): MapActivation[];
  forToken(runId: string, tokenIndex: number): MapActivation[];
}

// Coordinates match the 12 stable positions in apps/api/app/mock_stream.py.
export const MOCK_FEATURES: MapFeature[] = [
  { id: "feat_0001", label: "hedging language", cluster: "hedging", coords: { x: -14.625, y: 13.897 } },
  { id: "feat_0002", label: "refusal pattern", cluster: "refusal", coords: { x: 18.241, y: 17.913 } },
  { id: "feat_0003", label: "unsupported claim", cluster: "unsupported", coords: { x: -10.481, y: 1.769 } },
  { id: "feat_0004", label: "legal register", cluster: "style", coords: { x: -10.558, y: -15.873 } },
  { id: "feat_0005", label: "enthusiastic tone", cluster: "sentiment", coords: { x: 4.916, y: 9.671 } },
  { id: "feat_0006", label: "numeric reasoning", cluster: "reasoning", coords: { x: 11.734, y: 12.878 } },
  { id: "feat_0007", label: "code syntax", cluster: "syntax", coords: { x: -7.047, y: -13.966 } },
  { id: "feat_0008", label: "first-person voice", cluster: "style", coords: { x: -10.932, y: 18.492 } },
  { id: "feat_0009", label: "uncertainty marker", cluster: "hedging", coords: { x: -1.480, y: -5.068 } },
  { id: "feat_0010", label: "named entity", cluster: "reasoning", coords: { x: 2.856, y: -2.844 } },
  { id: "feat_0011", label: "apology pattern", cluster: "refusal", coords: { x: -1.905, y: 2.391 } },
  { id: "feat_0012", label: "fabricated citation", cluster: "unsupported", coords: { x: -1.017, y: 6.299 } },
];

const subscribers = new Set<(batch: MapActivation[]) => void>();
const history = new Map<string, MapActivation[]>();
let activeRunId: string | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
let flushFrame: number | null = null;
let pending: MapActivation[] = [];

function flush() {
  flushFrame = null;
  const batch = pending;
  pending = [];
  if (batch.length === 0) return;
  for (const subscriber of subscribers) subscriber(batch);
}

function publish(runId: string, activations: MapActivation[]) {
  history.get(runId)?.push(...activations);
  pending.push(...activations);
  if (flushFrame === null) flushFrame = requestAnimationFrame(flush);
}

export const fakeActivationBus: ActivationSource & {
  start(prompt: string, onDone: () => void): string;
  stop(): void;
} = {
  subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },
  forRun(runId) {
    return history.get(runId) ?? [];
  },
  forToken(runId, tokenIndex) {
    return (history.get(runId) ?? []).filter((entry) => entry.tokenIndex === tokenIndex);
  },
  start(prompt, onDone) {
    this.stop();
    const runId = crypto.randomUUID();
    activeRunId = runId;
    history.set(runId, []);
    const words = [...prompt.trim().split(/\s+/), ..."The model considers several possibilities before choosing an answer".split(" ")];
    let tokenIndex = 0;
    intervalId = setInterval(() => {
      if (activeRunId !== runId) return;
      const count = 1 + Math.floor(Math.random() * 3);
      const batch: MapActivation[] = [];
      for (let i = 0; i < count; i += 1) {
        const feature = MOCK_FEATURES[Math.floor(Math.random() * MOCK_FEATURES.length)];
        batch.push({
          tokenIndex,
          featureId: feature.id,
          value: 0.2 + Math.random() * 0.8,
          coords: feature.coords,
        });
      }
      publish(runId, batch);
      tokenIndex += 1;
      if (tokenIndex >= words.length) {
        this.stop();
        onDone();
      }
    }, 130);
    return runId;
  },
  stop() {
    if (intervalId !== null) clearInterval(intervalId);
    intervalId = null;
    activeRunId = null;
    // Deliver the final batch before ending a run or starting the next one.
    if (flushFrame !== null) {
      cancelAnimationFrame(flushFrame);
      flush();
    }
  },
};
