"use client";

import { create } from "zustand";
import { API_BASE, WS_URL, type Coords, type Feature, type Model, type ServerMessage, type Signature } from "@/lib/contract";

export type RunStatus = "streaming" | "done" | "error" | "stopped";
export interface TokenEntry { index: number; text: string }
export interface FlagEntry { tokenIndex: number; signature: Signature; confidence: number }
export interface ActivationEntry { tokenIndex: number; featureId: string; value: number; coords: Coords; explanation?: string }
export interface Run {
  id: string;
  prompt: string;
  model: Model;
  clamps: Record<string, number>;
  tokens: TokenEntry[];
  flags: FlagEntry[];
  status: RunStatus;
  message?: string;
}
interface StreamStore {
  connection: "connecting" | "open" | "retrying" | "closed";
  features: Record<string, Feature>;
  runs: Run[];
  activeRunId: string | null;
  baselineRunId: string | null;
  clamps: Record<string, number>;
  selectedFeatureId: string | null;
  hoveredTokenIndex: number | null;
  hasLiveActivations: boolean;
  start: (prompt: string, model: Model) => void;
  rerun: () => void;
  stop: () => void;
  setClamp: (featureId: string, value: number) => void;
  resetClamps: () => void;
  selectFeature: (id: string | null) => void;
  hoverToken: (index: number | null) => void;
}

const HISTORY_LIMIT = 6000;
const history = new Map<string, ActivationEntry[]>();
const listeners = new Set<(batch: ActivationEntry[]) => void>();
let queued: ActivationEntry[] = [];
let frame: number | null = null;
function flush() {
  frame = null;
  const batch = queued;
  queued = [];
  if (batch.length) listeners.forEach((fn) => fn(batch));
}
export const activationBus = {
  subscribe(fn: (batch: ActivationEntry[]) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  forRun(runId: string) { return [...(history.get(runId) ?? [])]; },
  forToken(runId: string, tokenIndex: number) { return (history.get(runId) ?? []).filter((entry) => entry.tokenIndex === tokenIndex); },
  publish(runId: string, entry: ActivationEntry) {
    const entries = history.get(runId) ?? [];
    entries.push(entry);
    if (entries.length > HISTORY_LIMIT) entries.splice(0, entries.length - HISTORY_LIMIT);
    history.set(runId, entries);
    queued.push(entry);
    if (frame === null) frame = requestAnimationFrame(flush);
  },
};

let socket: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryCount = 0;
let subscribers = 0;
let pendingStart: { prompt: string; model: Model } | null = null;
let socketEpoch = 0;
const send = (message: object) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
const patchRun = (id: string, patch: Partial<Run>) => useStreamStore.setState((state) => ({
  runs: state.runs.map((run) => run.id === id ? { ...run, ...patch } : run),
}));
function handleMessage(message: ServerMessage) {
  const { activeRunId } = useStreamStore.getState();
  if (!activeRunId) return;
  const run = useStreamStore.getState().runs.find((item) => item.id === activeRunId);
  if (!run || run.status !== "streaming") return;
  switch (message.type) {
    case "token":
      useStreamStore.setState((state) => ({ runs: state.runs.map((item) => item.id === activeRunId ?
        { ...item, tokens: [...item.tokens, { index: message.index, text: message.text }] } : item) }));
      break;
    case "activation":
      activationBus.publish(activeRunId, { tokenIndex: message.token_index, featureId: message.feature_id, value: message.value, coords: message.coords, explanation: message.explanation });
      if (!useStreamStore.getState().hasLiveActivations) useStreamStore.setState({ hasLiveActivations: true });
      break;
    case "flag":
      useStreamStore.setState((state) => ({ runs: state.runs.map((item) => item.id === activeRunId ?
        { ...item, flags: [...item.flags, { tokenIndex: message.token_index, signature: message.signature, confidence: message.confidence }] } : item) }));
      break;
    case "status":
      if (message.state === "done" || message.state === "error") patchRun(activeRunId, { status: message.state, message: message.message });
      break;
  }
}
function connect() {
  if (typeof window === "undefined" || subscribers === 0) return;
  const epoch = ++socketEpoch;
  const ws = new WebSocket(WS_URL);
  socket = ws;
  useStreamStore.setState({ connection: retryCount ? "retrying" : "connecting" });
  ws.onopen = () => {
    if (epoch !== socketEpoch) return;
    retryCount = 0;
    useStreamStore.setState({ connection: "open" });
    if (pendingStart) { send({ type: "start", ...pendingStart }); pendingStart = null; }
  };
  ws.onmessage = (event) => {
    if (epoch !== socketEpoch) return;
    try { handleMessage(JSON.parse(event.data) as ServerMessage); } catch { /* malformed event */ }
  };
  ws.onclose = () => {
    if (epoch !== socketEpoch) return;
    socket = null;
    const active = useStreamStore.getState().activeRunId;
    if (active) {
      const run = useStreamStore.getState().runs.find((item) => item.id === active);
      if (run?.status === "streaming") patchRun(active, { status: "error", message: "Connection lost. Run again to start a new generation." });
    }
    if (subscribers === 0) { useStreamStore.setState({ connection: "closed" }); return; }
    useStreamStore.setState({ connection: "retrying" });
    retryTimer = setTimeout(connect, Math.min(8000, 500 * 2 ** retryCount++));
  };
  ws.onerror = () => ws.close();
}
export function mountStreamConnection() {
  subscribers++;
  if (subscribers === 1) {
    connect();
    fetch(`${API_BASE}/api/features`).then((response) => response.ok ? response.json() : Promise.reject()).then((data: Feature[]) => {
      useStreamStore.setState({ features: Object.fromEntries(data.map((feature) => [feature.id, feature])) });
    }).catch(() => { /* the live text path still works without placeholder metadata */ });
  }
  return () => {
    subscribers--;
    if (subscribers !== 0) return;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    socketEpoch++;
    socket?.close();
    socket = null;
    useStreamStore.setState({ connection: "closed" });
  };
}
export const useStreamStore = create<StreamStore>((set, get) => ({
  connection: "closed", features: {}, runs: [], activeRunId: null, baselineRunId: null,
  clamps: {}, selectedFeatureId: null, hoveredTokenIndex: null, hasLiveActivations: false,
  start(prompt, model) {
    if (!prompt.trim()) return;
    const previous = get().runs.find((run) => run.id === get().activeRunId);
    if (previous?.status === "streaming") { send({ type: "stop" }); patchRun(previous.id, { status: "stopped" }); }
    const id = crypto.randomUUID();
    const clamps = { ...get().clamps };
    const run: Run = { id, prompt: prompt.trim(), model, clamps, tokens: [], flags: [], status: "streaming" };
    set((state) => ({ runs: [...state.runs, run], activeRunId: id,
      baselineRunId: Object.keys(clamps).length === 0 ? id : state.baselineRunId,
      hoveredTokenIndex: null }));
    history.set(id, []);
    queued = [];
    pendingStart = { prompt: run.prompt, model };
    // A new socket prevents late messages from a stopped run being assigned
    // to this run until the API supports run_id on every event.
    if (socket?.readyState === WebSocket.OPEN && previous) {
      socketEpoch++;
      socket.close(); socket = null; retryCount = 0; connect();
    } else if (socket?.readyState === WebSocket.OPEN) {
      send({ type: "start", ...pendingStart }); pendingStart = null;
    } else if (!socket && subscribers) connect();
  },
  rerun() {
    const run = get().runs.find((item) => item.id === get().activeRunId);
    if (run) get().start(run.prompt, run.model);
  },
  stop() {
    send({ type: "stop" });
    const id = get().activeRunId;
    if (id) patchRun(id, { status: "stopped" });
  },
  // The current backend rejects steering. Keep pending values local for the
  // future contract, but never send or describe them as applied today.
  setClamp(featureId, value) { set((state) => {
    const clamps = { ...state.clamps };
    if (value === 0) delete clamps[featureId]; else clamps[featureId] = value;
    return { clamps };
  }); },
  resetClamps() { set({ clamps: {} }); },
  selectFeature(id) { set({ selectedFeatureId: id }); },
  hoverToken(index) { set({ hoveredTokenIndex: index }); },
}));
