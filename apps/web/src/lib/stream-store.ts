"use client";

import { create } from "zustand";
import {
  API_BASE,
  STEERING_ENABLED,
  WS_URL,
  type AVAlternative,
  type Coords,
  type Feature,
  type Model,
  type ServerMessage,
  type Signature,
} from "@/lib/contract";

export type RunStatus = "streaming" | "done" | "error" | "stopped";
export interface TokenEntry {
  index: number;
  text: string;
}
export interface FlagEntry {
  tokenIndex: number;
  signature: Signature;
  confidence: number;
}
export interface ActivationEntry {
  tokenIndex: number;
  featureId: string;
  value: number;
  coords: Coords;
  explanation?: string;
}
// One AV checkpoint: the reading and, once they arrive, Qwen's suggested
// alternatives. selectedAlternative is the user's steer pick.
export interface Reading {
  checkpointId: number;
  position: number;
  label: string;
  focus: string | null;
  detail: string;
  genre: string;
  error?: string;
  alternatives?: AVAlternative[];
  selectedAlternative?: number;
  steerMessage?: string;
}
export interface Run {
  id: string;
  prompt: string;
  rootPrompt: string;
  direction?: string;
  parentRunId?: string;
  model: Model;
  clamps: Record<string, number>;
  tokens: TokenEntry[];
  flags: FlagEntry[];
  readings: Record<number, Reading>;
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
  start: (prompt: string, model: Model, guidance?: { rootPrompt: string; direction: string; parentRunId: string }) => void;
  startGuided: (direction: string) => boolean;
  rerun: () => void;
  stop: () => void;
  setClamp: (featureId: string, value: number) => void;
  resetClamps: () => void;
  selectFeature: (id: string | null) => void;
  hoverToken: (index: number | null) => void;
  steer: (checkpointId: number, alternativeId: number) => void;
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
  subscribe(fn: (batch: ActivationEntry[]) => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  forRun(runId: string) {
    return [...(history.get(runId) ?? [])];
  },
  forToken(runId: string, tokenIndex: number) {
    return (history.get(runId) ?? []).filter(
      (entry) => entry.tokenIndex === tokenIndex,
    );
  },
  publish(runId: string, entry: ActivationEntry) {
    const entries = history.get(runId) ?? [];
    entries.push(entry);
    if (entries.length > HISTORY_LIMIT)
      entries.splice(0, entries.length - HISTORY_LIMIT);
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
const send = (message: object) => {
  if (socket?.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify(message));
};
const patchRun = (id: string, patch: Partial<Run>) =>
  useStreamStore.setState((state) => ({
    runs: state.runs.map((run) => (run.id === id ? { ...run, ...patch } : run)),
  }));
const patchReading = (
  runId: string,
  checkpointId: number,
  patch: (reading: Reading | undefined) => Reading | undefined,
) =>
  useStreamStore.setState((state) => ({
    runs: state.runs.map((run) => {
      if (run.id !== runId) return run;
      const reading = patch(run.readings[checkpointId]);
      return reading
        ? { ...run, readings: { ...run.readings, [checkpointId]: reading } }
        : run;
    }),
  }));
function handleMessage(message: ServerMessage) {
  const { activeRunId } = useStreamStore.getState();
  if (!activeRunId) return;
  const run = useStreamStore
    .getState()
    .runs.find((item) => item.id === activeRunId);
  if (!run) return;
  // Alternatives and steer acks can land after status:done.
  const late = message.type === "av_alternatives" || message.type === "steer_ack";
  if (run.status !== "streaming" && !(late && run.status === "done")) return;
  switch (message.type) {
    case "av":
      patchReading(activeRunId, message.checkpoint_id, (reading) => ({
        ...reading,
        checkpointId: message.checkpoint_id,
        position: message.position,
        label: message.label,
        focus: message.focus ?? null,
        detail: message.detail || message.explanation,
        genre: message.genre,
      }));
      break;
    case "av_error":
      patchReading(activeRunId, message.checkpoint_id, () => ({
        checkpointId: message.checkpoint_id,
        position: message.position,
        label: message.label,
        focus: null,
        detail: "",
        genre: "",
        error: message.message,
      }));
      break;
    case "av_alternatives":
      patchReading(activeRunId, message.checkpoint_id, (reading) =>
        reading && { ...reading, alternatives: message.alternatives },
      );
      break;
    case "steer_ack":
      patchReading(activeRunId, message.checkpoint_id, (reading) =>
        reading?.selectedAlternative === message.alternative_id
          ? { ...reading, steerMessage: message.message }
          : reading,
      );
      break;
    case "token":
      useStreamStore.setState((state) => ({
        runs: state.runs.map((item) =>
          item.id === activeRunId
            ? {
                ...item,
                tokens: [
                  ...item.tokens,
                  { index: message.index, text: message.text },
                ],
              }
            : item,
        ),
      }));
      break;
    case "activation":
      activationBus.publish(activeRunId, {
        tokenIndex: message.token_index,
        featureId: message.feature_id,
        value: message.value,
        coords: message.coords,
        explanation: message.explanation,
      });
      if (!useStreamStore.getState().hasLiveActivations)
        useStreamStore.setState({ hasLiveActivations: true });
      break;
    case "flag":
      useStreamStore.setState((state) => ({
        runs: state.runs.map((item) =>
          item.id === activeRunId
            ? {
                ...item,
                flags: [
                  ...item.flags,
                  {
                    tokenIndex: message.token_index,
                    signature: message.signature,
                    confidence: message.confidence,
                  },
                ],
              }
            : item,
        ),
      }));
      break;
    case "status":
      if (message.state === "done" || message.state === "error")
        patchRun(activeRunId, {
          status: message.state,
          message: message.message,
        });
      break;
  }
}
function connect() {
  if (typeof window === "undefined" || subscribers === 0) return;
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  if (socket) return;
  const epoch = ++socketEpoch;
  const ws = new WebSocket(WS_URL);
  socket = ws;
  useStreamStore.setState({
    connection: retryCount ? "retrying" : "connecting",
  });
  ws.onopen = () => {
    if (epoch !== socketEpoch) return;
    retryCount = 0;
    useStreamStore.setState({ connection: "open" });
    if (pendingStart) {
      if (STEERING_ENABLED)
        Object.entries(useStreamStore.getState().clamps).forEach(
          ([feature_id, value]) => send({ type: "clamp", feature_id, value }),
        );
      send({ type: "start", ...pendingStart });
      pendingStart = null;
    }
  };
  ws.onmessage = (event) => {
    if (epoch !== socketEpoch) return;
    try {
      handleMessage(JSON.parse(event.data) as ServerMessage);
    } catch {
      /* malformed event */
    }
  };
  ws.onclose = () => {
    if (epoch !== socketEpoch) return;
    socket = null;
    pendingStart = null;
    const active = useStreamStore.getState().activeRunId;
    if (active) {
      const run = useStreamStore
        .getState()
        .runs.find((item) => item.id === active);
      if (run?.status === "streaming")
        patchRun(active, {
          status: "error",
          message: "Connection lost. Run again to start a new generation.",
        });
    }
    if (subscribers === 0) {
      useStreamStore.setState({ connection: "closed" });
      return;
    }
    useStreamStore.setState({ connection: "retrying" });
    retryTimer = setTimeout(connect, Math.min(8000, 500 * 2 ** retryCount++));
  };
  ws.onerror = () => ws.close();
}
export function mountStreamConnection() {
  subscribers++;
  if (subscribers === 1) {
    connect();
    fetch(`${API_BASE}/api/features`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: Feature[]) => {
        useStreamStore.setState({
          features: Object.fromEntries(
            data.map((feature) => [feature.id, feature]),
          ),
        });
      })
      .catch(() => {
        /* the live text path still works without placeholder metadata */
      });
  }
  return () => {
    subscribers--;
    if (subscribers !== 0) return;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    socketEpoch++;
    pendingStart = null;
    socket?.close();
    socket = null;
    const active = useStreamStore.getState().activeRunId;
    const run = useStreamStore.getState().runs.find((item) => item.id === active);
    if (run?.status === "streaming") patchRun(run.id, { status: "stopped" });
    useStreamStore.setState({ connection: "closed" });
  };
}
export const useStreamStore = create<StreamStore>((set, get) => ({
  connection: "closed",
  features: {},
  runs: [],
  activeRunId: null,
  baselineRunId: null,
  clamps: {},
  selectedFeatureId: null,
  hoveredTokenIndex: null,
  hasLiveActivations: false,
  start(prompt, model, guidance) {
    if (!prompt.trim()) return;
    const previous = get().runs.find((run) => run.id === get().activeRunId);
    if (previous?.status === "streaming") {
      send({ type: "stop" });
      patchRun(previous.id, { status: "stopped" });
    }
    const id = crypto.randomUUID();
    const clamps = { ...get().clamps };
    const run: Run = {
      id,
      prompt: prompt.trim(),
      rootPrompt: guidance?.rootPrompt ?? prompt.trim(),
      direction: guidance?.direction,
      parentRunId: guidance?.parentRunId,
      model,
      clamps,
      tokens: [],
      flags: [],
      readings: {},
      status: "streaming",
    };
    set((state) => ({
      runs: [...state.runs, run],
      activeRunId: id,
      baselineRunId:
        Object.keys(clamps).length === 0 ? id : state.baselineRunId,
      hoveredTokenIndex: null,
    }));
    history.set(id, []);
    queued = [];
    pendingStart = { prompt: run.prompt, model };
    // A new socket prevents late messages from a stopped run being assigned
    // to this run until the API supports run_id on every event.
    if (socket?.readyState === WebSocket.OPEN && previous) {
      socketEpoch++;
      socket.close();
      socket = null;
      retryCount = 0;
      connect();
    } else if (socket?.readyState === WebSocket.OPEN) {
      if (STEERING_ENABLED)
        Object.entries(clamps).forEach(([feature_id, value]) =>
          send({ type: "clamp", feature_id, value }),
        );
      send({ type: "start", ...pendingStart });
      pendingStart = null;
    } else if (!socket && subscribers) connect();
  },
  rerun() {
    const run = get().runs.find((item) => item.id === get().activeRunId);
    if (run) get().start(run.prompt, run.model, run.direction ? {
      rootPrompt: run.rootPrompt,
      direction: run.direction,
      parentRunId: run.parentRunId ?? run.id,
    } : undefined);
  },
  startGuided(direction) {
    const run = get().runs.find((item) => item.id === get().activeRunId);
    const trimmed = direction.trim();
    if (!run || !trimmed) return false;
    const guidedPrompt = `The user asked: ${run.rootPrompt}\n\nThey now want a new answer that prioritizes this direction: ${trimmed}\nStart by addressing that direction directly. Keep other parts of the original request only where they support it.`;
    if (guidedPrompt.length > 16000) return false;
    get().start(guidedPrompt, run.model, {
      rootPrompt: run.rootPrompt,
      direction: trimmed,
      parentRunId: run.id,
    });
    return true;
  },
  stop() {
    pendingStart = null;
    send({ type: "stop" });
    const id = get().activeRunId;
    if (id) patchRun(id, { status: "stopped" });
  },
  // The current backend rejects steering. Keep pending values local until a
  // steering-capable backend is explicitly configured.
  setClamp(featureId, value) {
    set((state) => {
      const clamps = { ...state.clamps };
      if (value === 0) delete clamps[featureId];
      else clamps[featureId] = value;
      if (STEERING_ENABLED)
        send({ type: "clamp", feature_id: featureId, value });
      return { clamps };
    });
  },
  resetClamps() {
    if (STEERING_ENABLED) send({ type: "reset_clamps" });
    set({ clamps: {} });
  },
  selectFeature(id) {
    set({ selectedFeatureId: id });
  },
  hoverToken(index) {
    set({ hoveredTokenIndex: index });
  },
  // Always sent, unlike clamps: the backend only acknowledges it for now.
  steer(checkpointId, alternativeId) {
    const id = get().activeRunId;
    if (!id) return;
    patchReading(id, checkpointId, (reading) =>
      reading && {
        ...reading,
        selectedAlternative: alternativeId,
        steerMessage: undefined,
      },
    );
    send({
      type: "steer",
      checkpoint_id: checkpointId,
      alternative_id: alternativeId,
    });
  },
}));
