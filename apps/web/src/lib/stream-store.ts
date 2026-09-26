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
  type SteerDirection,
  type SteerScore,
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
// alternatives. steering is set while a steer from here is on its way;
// steerMessage says why the last one was refused.
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
  steering?: boolean;
  steerMessage?: string;
  steerNote?: string;
}
// How a branch run was steered from its parent.
export interface SteerInfo {
  kind: "toward" | "away";
  focus: string;
  label: string; // the parent reading's label ("Step 1")
  opening?: string;
  anchored: boolean;
  note?: string;
  score?: { before: SteerScore; after: SteerScore };
}
export interface Run {
  id: string;
  prompt: string;
  model: Model;
  clamps: Record<string, number>;
  tokens: TokenEntry[];
  flags: FlagEntry[];
  readings: Record<number, Reading>;
  status: RunStatus;
  message?: string;
  parentRunId?: string;
  steer?: SteerInfo;
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
  steer: (checkpointId: number, direction: SteerDirection) => void;
  selectRun: (id: string) => void;
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
let pendingStart: { prompt: string; model: Model; run_id: string } | null =
  null;
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
function startBranch(message: Extract<ServerMessage, { type: "branch" }>) {
  const { runs } = useStreamStore.getState();
  const parent = runs.find((item) => item.id === message.parent_run_id);
  if (!parent) return;
  const reading = parent.readings[message.checkpoint_id];
  const kept = parent.tokens
    .map((token) => token.text)
    .join("")
    .slice(0, message.position);
  const run: Run = {
    id: message.run_id,
    prompt: parent.prompt,
    model: parent.model,
    clamps: {},
    // The parent's text up to the branch point, as one token.
    tokens: kept ? [{ index: -1, text: kept }] : [],
    flags: [],
    readings: {},
    status: "streaming",
    parentRunId: parent.id,
    steer: {
      kind: message.kind,
      focus: message.focus,
      label: reading?.label ?? "",
      opening: message.opening,
      anchored: message.anchored,
      note: reading?.steerNote,
    },
  };
  history.set(run.id, []);
  useStreamStore.setState((state) => ({
    runs: [
      ...state.runs.map((item) =>
        item.id === parent.id
          ? {
              ...item,
              readings: {
                ...item.readings,
                [message.checkpoint_id]: { ...reading, steering: false },
              },
            }
          : item,
      ),
      run,
    ],
    activeRunId: run.id,
    baselineRunId: parent.id,
    hoveredTokenIndex: null,
  }));
}
function handleMessage(message: ServerMessage) {
  if (message.type === "branch") return startBranch(message);
  const { activeRunId, runs } = useStreamStore.getState();
  // Events name their run; the rest belong to the active one.
  const runId = message.run_id ?? activeRunId;
  const run = runs.find((item) => item.id === runId);
  if (!run || !runId) return;
  // Alternatives, steer acks and scores can land after status:done, and a
  // steer's ack reaches the parent it stopped.
  const late =
    message.type === "av_alternatives" ||
    message.type === "steer_ack" ||
    message.type === "steer_score";
  if (run.status !== "streaming" && !(late && run.status !== "error")) return;
    switch (message.type) {
    case "av":
      patchReading(runId, message.checkpoint_id, (reading) => ({
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
      patchReading(runId, message.checkpoint_id, () => ({
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
      patchReading(runId, message.checkpoint_id, (reading) =>
        reading && { ...reading, alternatives: message.alternatives },
      );
      break;
    case "steer_ack":
      patchReading(runId, message.checkpoint_id, (reading) =>
        reading &&
        (message.applied
          ? { ...reading, steerNote: message.note, steerMessage: undefined }
          : { ...reading, steering: false, steerMessage: message.message }),
      );
      break;
    case "steer_score":
      patchRun(runId, {
        steer: run.steer && {
          ...run.steer,
          score: { before: message.before, after: message.after },
        },
      });
      break;
    case "token":
      useStreamStore.setState((state) => ({
        runs: state.runs.map((item) =>
          item.id === runId
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
      activationBus.publish(runId, {
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
          item.id === runId
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
        patchRun(runId, {
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
  start(prompt, model) {
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
    pendingStart = { prompt: run.prompt, model, run_id: id };
    // A new prompt gets a new socket, so nothing from an earlier one can
    // land here. Steers keep the socket: a run and its branches stay
    // steerable, and their events are told apart by run_id.
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
    if (run) get().start(run.prompt, run.model);
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
  // Branches the active run at a reading; the server replies with steer_ack
  // and, when it applies, a branch event that becomes the new active run.
  steer(checkpointId, direction) {
    const run = get().runs.find((item) => item.id === get().activeRunId);
    if (!run) return;
    if (run.status === "streaming") patchRun(run.id, { status: "stopped" });
    patchReading(run.id, checkpointId, (reading) =>
      reading && {
        ...reading,
        selectedAlternative:
          "alternative_id" in direction ? direction.alternative_id : undefined,
        steering: true,
        steerMessage: undefined,
        steerNote: undefined,
      },
    );
    send({
      type: "steer",
      run_id: run.id,
      checkpoint_id: checkpointId,
      ...direction,
    });
  },
  selectRun(id) {
    const run = get().runs.find((item) => item.id === id);
    if (!run) return;
    set({
      activeRunId: id,
      baselineRunId: run.parentRunId ?? get().baselineRunId,
      hoveredTokenIndex: null,
    });
  },
}));
