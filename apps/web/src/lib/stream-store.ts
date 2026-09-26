"use client";

import { create } from "zustand";
import {
  API_BASE,
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
import { codePointLength, codePointToUtf16 } from "@/lib/code-points";

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
  checkpointId: number; // the parent's checkpoint it branched at
  opening?: string;
  anchored: boolean;
  note?: string;
  score?: { before: SteerScore; after: SteerScore };
}
export interface Run {
  id: string;
  prompt: string;
  model: Model;
  // The text shown so far; received text waits in the pacer (see below).
  tokens: TokenEntry[];
  flags: FlagEntry[];
  readings: Record<number, Reading>;
  status: RunStatus;
  message?: string;
  parentRunId?: string;
  steer?: SteerInfo;
  // Paced runs: text is held while this checkpoint's reading is made.
  inspecting?: { checkpointId: number; label: string };
  // Readings cancelled because they missed their section.
  avDropped?: number;
}
// One reading on the active run's path: its own readings, after its
// ancestors' readings up to each branch point.
export interface ChainEntry {
  runId: string;
  reading: Reading;
  // Set on the reading a later run on the path was steered from, with how
  // many of this run's later readings that path left behind.
  forkedTo?: SteerInfo;
  leftBehind?: number;
}
// A reading is addressed across runs as `${runId}:${checkpointId}`.
export const readingKey = (runId: string, checkpointId: number) =>
  `${runId}:${checkpointId}`;
interface StreamStore {
  connection: "connecting" | "open" | "retrying" | "closed";
  features: Record<string, Feature>;
  runs: Run[];
  activeRunId: string | null;
  // Reading keys: hovered in the ocean or the text, and the one opened to steer.
  hoveredReading: string | null;
  openReading: string | null;
  hasLiveActivations: boolean;
  // Pause freezes the answer where it is (and the ocean's motion).
  paused: boolean;
  setPaused: (paused: boolean) => void;
  start: (prompt: string, model: Model) => void;
  rerun: () => void;
  stop: () => void;
  hoverReading: (key: string | null) => void;
  setOpenReading: (key: string | null) => void;
  // Branches runId (default: the active run) at one of its readings.
  steer: (checkpointId: number, direction: SteerDirection, runId?: string) => void;
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
// The answer is revealed at a reading pace, pausing where a reading's
// section begins, so each bubble has a moment as the next thing the model
// is heading into. The server's own pace is much faster.
const pacing = {
  charsPerSecond: 55,
  sectionDwellMs: 1500,
  // Before the first words: at least startHoldMs, and up to startHoldMaxMs
  // until a bubble (a reading with its alternatives) is ready.
  startHoldMs: 4000,
  startHoldMaxMs: 8000,
  // At a section, how long to wait for its bubble before going on without it.
  alternativesWaitMs: 4000,
};
/** charsPerSecond 0 shows text as it arrives (tests). */
export function configurePacing(options: Partial<typeof pacing>) {
  Object.assign(pacing, options);
}
interface Pace {
  queue: TokenEntry[];
  shown: number; // code points on screen
  budget: number; // code points that may be revealed now
  holdUntil: number;
  dwelled: Set<number>;
  final?: Partial<Run>; // status that waits for the text to finish
  // Frozen while a steer is on its way, so the rest of the answer never
  // flashes up before the branch replaces it.
  paused?: boolean;
  startedAt: number;
  started?: boolean; // past the hold before the first words
  waitingSince?: number; // held at a section for its bubble
}
// When each run began, for the hold before its first words.
const runStartedAt = new Map<string, number>();
/** A reading gets a bubble once its alternatives are ready. */
export const hasBubble = (reading: Reading) => !reading.error && !!reading.alternatives?.length;
const TICK_MS = 50;
const paces = new Map<string, Pace>();
let ticker: ReturnType<typeof setTimeout> | null = null;
const appendTokens = (runId: string, tokens: TokenEntry[]) =>
  useStreamStore.setState((state) => ({
    runs: state.runs.map((item) =>
      item.id === runId ? { ...item, tokens: [...item.tokens, ...tokens] } : item,
    ),
  }));
function enqueue(runId: string, token: TokenEntry) {
  if (pacing.charsPerSecond <= 0) return appendTokens(runId, [token]);
  let pace = paces.get(runId);
  if (!pace) {
    const run = useStreamStore.getState().runs.find((item) => item.id === runId);
    pace = {
      queue: [],
      shown: codePointLength(run?.tokens.map((item) => item.text).join("") ?? ""),
      budget: 0,
      holdUntil: 0,
      dwelled: new Set(),
      startedAt: runStartedAt.get(runId) ?? Date.now(),
    };
    paces.set(runId, pace);
  }
  pace.queue.push(token);
  if (ticker === null) ticker = setTimeout(tick, TICK_MS);
}
// Status for a run whose text is still being revealed waits for it.
function finish(runId: string, patch: Partial<Run>) {
  const pace = paces.get(runId);
  if (pace?.queue.length) pace.final = patch;
  else patchRun(runId, patch);
}
// Text Stop never showed, kept so a steer from past the visible text still
// continues its run's full answer.
const unrevealed = new Map<string, string>();
/** Stops revealing a run where it is; the rest is never shown. */
function dropRun(runId: string) {
  const pace = paces.get(runId);
  if (!pace) return;
  paces.delete(runId);
  if (pace.queue.length) unrevealed.set(runId, pace.queue.map((token) => token.text).join(""));
}
/** Shows everything received for a run at once. */
function flushRun(runId: string) {
  const pace = paces.get(runId);
  if (!pace) return;
  paces.delete(runId);
  if (pace.queue.length) appendTokens(runId, pace.queue);
  if (pace.final) patchRun(runId, pace.final);
}
function tick() {
  ticker = null;
  if (useStreamStore.getState().paused) return; // setPaused(false) restarts it
  const now = Date.now();
  for (const [runId, pace] of paces) {
    if (pace.paused || now < pace.holdUntil) continue;
    const run = useStreamStore.getState().runs.find((item) => item.id === runId);
    if (!run) {
      paces.delete(runId);
      continue;
    }
    const readings = Object.values(run.readings);
    if (!pace.started) {
      // Give the first bubble time to surface before any words.
      const age = now - pace.startedAt;
      if (age < pacing.startHoldMs || (age < pacing.startHoldMaxMs && !readings.some(hasBubble))) continue;
      pace.started = true;
      // The bubbles shown during the hold have had their moment.
      for (const reading of readings) if (reading.position <= pace.shown) pace.dwelled.add(reading.checkpointId);
    }
    pace.budget = Math.min(pace.budget + (pacing.charsPerSecond * TICK_MS) / 1000, pacing.charsPerSecond);
    const released: TokenEntry[] = [];
    while (pace.queue.length) {
      const token = pace.queue[0];
      const length = codePointLength(token.text);
      // Pause where a reading's section starts, before revealing it: wait
      // for its bubble (its alternatives), then give the bubble a moment.
      const section = readings.find((reading) =>
        !pace.dwelled.has(reading.checkpointId) && !reading.error &&
        reading.position >= pace.shown && reading.position < pace.shown + Math.max(1, length));
      if (section) {
        const ready = hasBubble(section);
        if (!ready) {
          pace.waitingSince ??= now;
          if (now - pace.waitingSince < pacing.alternativesWaitMs) break;
        }
        pace.waitingSince = undefined;
        pace.dwelled.add(section.checkpointId);
        if (ready) {
          pace.holdUntil = now + pacing.sectionDwellMs;
          break;
        }
        continue;
      }
      if (pace.budget < length) break;
      pace.budget -= length;
      pace.shown += length;
      released.push(pace.queue.shift()!);
    }
    if (released.length) appendTokens(runId, released);
    if (!pace.queue.length && pace.final) {
      paces.delete(runId);
      patchRun(runId, pace.final);
    }
  }
  if ([...paces.values()].some((pace) => !pace.paused && (pace.queue.length || pace.final)))
    ticker = setTimeout(tick, TICK_MS);
}

function startBranch(message: Extract<ServerMessage, { type: "branch" }>) {
  const { runs } = useStreamStore.getState();
  const parent = runs.find((item) => item.id === message.parent_run_id);
  if (!parent) return;
  // Runs frozen for this steer catch up off screen: the branch takes over
  // the view in the same update. The branch keeps its parent's full text.
  for (const [runId, pace] of paces) if (pace.paused || runId === parent.id) flushRun(runId);
  const parentText = useStreamStore.getState().runs.find((item) => item.id === parent.id)?.tokens ?? parent.tokens;
  const reading = parent.readings[message.checkpoint_id];
  const text = parentText
    .map((token) => token.text)
    .join("") + (unrevealed.get(parent.id) ?? "");
  const kept = text.slice(0, codePointToUtf16(text, message.position));
  const run: Run = {
    id: message.run_id,
    prompt: parent.prompt,
    model: parent.model,
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
      checkpointId: message.checkpoint_id,
      opening: message.opening,
      anchored: message.anchored,
      note: reading?.steerNote,
    },
  };
  history.set(run.id, []);
  runStartedAt.set(run.id, Date.now());
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
    openReading: null,
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
      // A refused steer lets the frozen text carry on.
      if (!message.applied) {
        for (const pace of paces.values()) pace.paused = false;
        if (ticker === null && paces.size) ticker = setTimeout(tick, TICK_MS);
      }
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
      enqueue(runId, { index: message.index, text: message.text });
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
        finish(runId, {
          status: message.state,
          message: message.message,
          avDropped: message.av_dropped,
          inspecting: undefined,
        });
      else if (message.state === "inspecting" && message.checkpoint_id !== undefined)
        patchRun(runId, {
          inspecting: { checkpointId: message.checkpoint_id, label: message.label ?? "" },
        });
      else if (message.state === "streaming" && run.inspecting)
        patchRun(runId, { inspecting: undefined });
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
      if (run?.status === "streaming") {
        dropRun(active);
        patchRun(active, {
          status: "error",
          message: "Connection lost. Run again to start a new generation.",
        });
      }
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
    if (run?.status === "streaming") {
      dropRun(run.id);
      patchRun(run.id, { status: "stopped" });
    }
    useStreamStore.setState({ connection: "closed" });
  };
}
export const useStreamStore = create<StreamStore>((set, get) => ({
  connection: "closed",
  features: {},
  runs: [],
  activeRunId: null,
  hoveredReading: null,
  openReading: null,
  hasLiveActivations: false,
  paused: false,
  setPaused(paused) {
    set({ paused });
    if (!paused && ticker === null && paces.size) ticker = setTimeout(tick, TICK_MS);
  },
  start(prompt, model) {
    if (!prompt.trim()) return;
    if (get().paused) get().setPaused(false);
    const previous = get().runs.find((run) => run.id === get().activeRunId);
    if (previous?.status === "streaming") {
      send({ type: "stop" });
      dropRun(previous.id);
      patchRun(previous.id, { status: "stopped" });
    }
    const id = crypto.randomUUID();
    const run: Run = {
      id,
      prompt: prompt.trim(),
      model,
      tokens: [],
      flags: [],
      readings: {},
      status: "streaming",
    };
    set((state) => ({
      runs: [...state.runs, run],
      activeRunId: id,
      openReading: null,
    }));
    history.set(id, []);
    runStartedAt.set(id, Date.now());
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
    if (!id) return;
    dropRun(id);
    patchRun(id, { status: "stopped" });
  },
  hoverReading(key) {
    set({ hoveredReading: key });
  },
  setOpenReading(key) {
    set({ openReading: key });
  },
  // Branches a run at a reading; the server stops whatever is streaming and
  // replies with steer_ack and, when it applies, a branch event that becomes
  // the new active run.
  steer(checkpointId, direction, runId) {
    const active = get().runs.find((item) => item.id === get().activeRunId);
    const run = runId ? get().runs.find((item) => item.id === runId) : active;
    if (!run) return;
    if (active?.status === "streaming") {
      const pace = paces.get(active.id);
      if (pace) pace.paused = true;
      patchRun(active.id, { status: "stopped" });
    }
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
    set({ activeRunId: id, openReading: null });
  },
}));

/** The readings along the active run's path, oldest first. */
export function readingChain(runs: readonly Run[], activeRunId: string | null): ChainEntry[] {
  const path: Run[] = [];
  for (let run = runs.find((item) => item.id === activeRunId); run; ) {
    path.unshift(run);
    const parentId = run.parentRunId;
    run = parentId ? runs.find((item) => item.id === parentId) : undefined;
  }
  const chain: ChainEntry[] = [];
  path.forEach((run, index) => {
    const child = path[index + 1];
    const cut = child?.steer?.checkpointId;
    const readings = Object.values(run.readings).sort((a, b) => a.checkpointId - b.checkpointId);
    for (const reading of readings) {
      if (cut !== undefined && reading.checkpointId > cut) break;
      chain.push({
        runId: run.id,
        reading,
        forkedTo: cut === reading.checkpointId ? child.steer : undefined,
        leftBehind: cut === reading.checkpointId
          ? readings.filter((other) => other.checkpointId > cut).length
          : undefined,
      });
    }
  });
  return chain;
}
