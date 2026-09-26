"use client";

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { DeepViewport } from "@/components/sea/deep-viewport";
import { codePointLength } from "@/lib/code-points";
import type { SteerDirection } from "@/lib/contract";
import {
  hasBubble,
  readingChain,
  readingKey,
  useStreamStore,
  type ChainEntry,
  type Reading,
  type SteerInfo,
} from "@/lib/stream-store";
import { DOCK_WIDTH, STAGE_TOP, curve, dockFor, layoutCurrent, type Size } from "./layout";
import styles from "./thought-current.module.css";

// unreached: a stopped run's reading its text never got to.
type Phase = "upcoming" | "current" | "past" | "ancestor" | "unreached";
interface Node {
  key: string;
  entry?: ChainEntry; // absent for a reading still being made
  label: string;
  phase: Phase | "forming";
}

const SAMPLES = [
  "How should I pick a first car on a budget?",
  "Explain why the sky is blue",
  "Plan a weekend trip to Savannah",
];

// The chain as a flat list of stable references, so token events (which
// never touch readings) don't re-render the ocean.
function useChain() {
  const flat = useStreamStore(useShallow((state) =>
    readingChain(state.runs, state.activeRunId)
      .flatMap((entry) => [entry.runId, entry.reading, entry.forkedTo ?? null, entry.leftBehind ?? 0])));
  return useMemo(() => {
    const chain: ChainEntry[] = [];
    for (let index = 0; index < flat.length; index += 4) {
      chain.push({
        runId: flat[index] as string,
        reading: flat[index + 1] as Reading,
        forkedTo: (flat[index + 2] as SteerInfo | null) ?? undefined,
        leftBehind: flat[index + 3] as number,
      });
    }
    return chain;
  }, [flat]);
}

// How many of the active run's readings its text has passed. Changes only
// when the stream crosses a section start.
function useReachedCount() {
  return useStreamStore((state) => {
    const run = state.runs.find((item) => item.id === state.activeRunId);
    if (!run) return 0;
    let length = 0;
    for (const token of run.tokens) length += codePointLength(token.text);
    let reached = 0;
    for (const reading of Object.values(run.readings)) if (reading.position < length) reached++;
    return reached;
  });
}

function useStageSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function ThoughtCurrent({ paused, onSample }: { paused: boolean; onSample: (prompt: string) => void }) {
  const chain = useChain();
  const reached = useReachedCount();
  const activeRunId = useStreamStore((state) => state.activeRunId);
  const status = useStreamStore((state) => state.runs.find((run) => run.id === state.activeRunId)?.status);
  const inspecting = useStreamStore((state) => state.runs.find((run) => run.id === state.activeRunId)?.inspecting);
  const connection = useStreamStore((state) => state.connection);
  const openKey = useStreamStore((state) => state.openReading);
  const hoveredKey = useStreamStore((state) => state.hoveredReading);
  const setOpenReading = useStreamStore((state) => state.setOpenReading);
  const hoverReading = useStreamStore((state) => state.hoverReading);
  const steer = useStreamStore((state) => state.steer);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const size = useStageSize(viewportRef);
  const dock = dockFor(size);
  const [scrollTop, setScrollTop] = useState(0);
  const streaming = status === "streaming";

  const nodes = useMemo(() => {
    const result: Node[] = [];
    let own = 0;
    // The next reading the text is heading into that has no bubble yet.
    let preparing: string | null = null;
    let upcoming = false;
    for (const entry of chain) {
      const key = readingKey(entry.runId, entry.reading.checkpointId);
      let phase: Phase = "ancestor";
      if (entry.runId === activeRunId) {
        phase = own >= reached ? (streaming ? "upcoming" : "unreached")
          : own === reached - 1 && streaming ? "current" : "past";
        own++;
      }
      // A bubble appears once there are other directions to steer to (the
      // reading a steer forked from always stays, to keep the path whole).
      if (!hasBubble(entry.reading) && !entry.forkedTo) {
        if (phase === "upcoming" && !entry.reading.error) preparing ??= entry.reading.label;
        continue;
      }
      if (phase === "upcoming") upcoming = true;
      result.push({ key, entry, label: entry.reading.label, phase });
    }
    // One placeholder for the next section, once the text has caught up
    // with every bubble: the server reads far ahead of what is shown.
    if (streaming && activeRunId && !upcoming) {
      const reading = inspecting && !chain.some((entry) =>
        entry.runId === activeRunId && entry.reading.checkpointId === inspecting.checkpointId);
      const label = preparing ?? (reading ? inspecting.label : null)
        ?? (!chain.some((entry) => entry.runId === activeRunId) ? "Plan" : null);
      if (label) result.push({ key: `${activeRunId}:forming`, label, phase: "forming" });
    }
    return result;
  }, [chain, reached, streaming, activeRunId, inspecting]);

  // Without a choice, follow the next section the model is heading into.
  const autoKey = useMemo(() => {
    const readable = nodes.filter((node) => node.entry && !node.entry.reading.error);
    const upcoming = readable.filter((node) => node.phase === "upcoming");
    if (upcoming.length) return upcoming[0].key;
    if (streaming) return readable.findLast((node) => node.phase === "current")?.key ?? null;
    return readable.findLast((node) => node.entry?.runId === activeRunId)?.key ?? readable.at(-1)?.key ?? null;
  }, [nodes, streaming, activeRunId]);
  // While the pointer or focus is in the dock, new readings don't swap it out.
  const [heldKey, setHeldKey] = useState<string | null>(null);
  const shownKey = openKey ?? heldKey ?? autoKey;
  const shown = nodes.find((node) => node.key === shownKey)?.entry;


  const { width: areaWidth, height: areaHeight } = dock.area;
  const { points, contentHeight } = layoutCurrent(nodes.length, dock.area);
  const anchor = points[nodes.findIndex((node) => node.key === shownKey)];

  const announcement = useMemo(() => {
    const last = chain.at(-1)?.reading;
    if (!last) return "";
    if (last.error) return `${last.label}: reading unavailable.`;
    return `${last.label}: ${last.focus ?? "no clear focus"}.${last.alternatives ? ` ${last.alternatives.length} suggested directions.` : ""}`;
  }, [chain]);

  const dockRef = useRef<HTMLDivElement>(null);
  function toggle(key: string, fromKeyboard: boolean) {
    const opening = openKey !== key;
    setOpenReading(opening ? key : null);
    // Keyboard users continue straight into the bubble's directions.
    if (opening && fromKeyboard)
      requestAnimationFrame(() => dockRef.current?.querySelector<HTMLElement>("button:not(:disabled), input")?.focus());
  }

  // One tab stop for the whole current; arrow keys move between bubbles.
  const [rovingKey, setRovingKey] = useState<string | null>(null);
  const bubbleKeys = nodes.filter((node) => node.entry).map((node) => node.key);
  const tabKey = rovingKey && bubbleKeys.includes(rovingKey) ? rovingKey
    : shownKey && bubbleKeys.includes(shownKey) ? shownKey : bubbleKeys[0];
  function rove(event: React.KeyboardEvent) {
    const moves: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const at = bubbleKeys.indexOf(tabKey ?? "");
    let next = -1;
    if (event.key in moves) next = Math.max(0, Math.min(bubbleKeys.length - 1, at + moves[event.key]));
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = bubbleKeys.length - 1;
    if (next < 0 || !(event.target as HTMLElement).matches("[data-node]")) return;
    event.preventDefault();
    setRovingKey(bubbleKeys[next]);
    stageRef.current?.querySelector<HTMLElement>(`[data-node="${CSS.escape(bubbleKeys[next])}"]`)?.focus();
  }

  // A couple of fish swim over to what the model is heading into next (or
  // the bubble you opened), in fractions of the ocean.
  const lure = nodes.find((node) => node.key === openKey) ?? nodes.find((node) => node.phase === "upcoming");
  const lurePoint = lure && size.width > 0 ? points[nodes.indexOf(lure)] : undefined;
  const lureX = lurePoint ? Math.round((lurePoint.x / size.width) * 50) / 50 : null;
  const lureY = lurePoint ? Math.round(((lurePoint.y - scrollTop) / size.height) * 50) / 50 : null;
  const attractor = useMemo(() => lureX === null || lureY === null ? null : { x: lureX, y: lureY }, [lureX, lureY]);

  const canSteer = connection === "open";
  const sendSteer = (entry: ChainEntry, direction: SteerDirection) =>
    steer(entry.reading.checkpointId, direction, entry.runId);

  const dockStyle: CSSProperties = dock.side
    ? { left: dock.dockLeft, top: STAGE_TOP - 8, bottom: 14, width: DOCK_WIDTH }
    : { left: 10, right: 10, bottom: 10, maxHeight: "62%" };
  // The open bubble's thread runs out of the current to the dock.
  const link = anchor && shown && dock.side
    ? curve({ x: anchor.x, y: anchor.y - scrollTop }, { x: dock.dockLeft, y: STAGE_TOP + 30 }, size.width)
    : null;
  // On a narrow ocean the dock is a sheet that opens only when asked.
  const dockOpen = dock.side || !!openKey;

  return (
    <DeepViewport className="rounded-[20px]" paused={paused} receded={!!activeRunId} attractor={attractor}>
      <div ref={viewportRef} data-coach-target="ocean" className={styles.viewport}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !openKey) return;
          setOpenReading(null);
          stageRef.current?.querySelector<HTMLElement>(`[data-node="${CSS.escape(openKey)}"]`)?.focus();
        }}>
        <div ref={stageRef} className={styles.stage} style={{ width: areaWidth, height: areaHeight }}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
          {size.width > 0 && nodes.length > 0 ? (
            <div className={styles.content} style={{ height: contentHeight }}>
              <svg className={styles.threads} width={areaWidth} height={contentHeight} aria-hidden="true">
                {points.slice(1).map((point, index) => {
                  const next = nodes[index + 1];
                  return <path key={next.key} d={curve(points[index], point, areaWidth)}
                    className={`${styles.thread} ${next.phase === "upcoming" || next.phase === "forming" ? styles.threadAhead : ""} ${next.phase === "ancestor" ? styles.threadOld : ""} ${nodes[index].entry?.forkedTo ? styles.threadFork : ""}`} />;
                })}
              </svg>
              <ol className={styles.nodes} aria-label="Model focus, one bubble per section. Arrow keys move between them." onKeyDown={rove}>
                {nodes.map((node, index) => {
                  const point = points[index];
                  const open = node.key === shownKey;
                  return (
                    <li key={node.key} className={styles.slot}
                      style={{ "--x": `${point.x}px`, "--y": `${point.y}px`, "--delay": `${(index * 0.37) % 2}s` } as CSSProperties}>
                      {node.entry ? (
                        <><Bubble node={node} entry={node.entry} open={open} tabbable={node.key === tabKey}
                          onFocusBubble={() => setRovingKey(node.key)}
                          dimmed={!!openKey && !open} lit={hoveredKey === node.key}
                          onToggle={(fromKeyboard) => toggle(node.key, fromKeyboard)}
                          onHover={(on) => hoverReading(on ? node.key : null)} />
                        {node.entry.leftBehind ? <LeftBehind entry={node.entry} /> : null}</>
                      ) : (
                        <div className={`${styles.node} ${styles.forming}`} role="status">
                          <span className={styles.orbBox}><span className={styles.orb} /></span>
                          <span className={styles.label}><span className={styles.step}>{node.label}</span>Reading the model…</span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
        </div>
        {link ? (
          <svg className={styles.threads} width={size.width} height={size.height} aria-hidden="true">
            <path key={shownKey} d={link} className={styles.link} />
          </svg>
        ) : null}
        {activeRunId && !dockOpen ? (
          <p className={styles.sheetHint}>{nodes.length ? "Tap a bubble to steer from there" : "Bubbles surface before each section"}</p>
        ) : null}
        {activeRunId && dockOpen ? (
          <div ref={dockRef} className={styles.dock} style={dockStyle}
            onPointerEnter={() => setHeldKey(shownKey)} onPointerLeave={() => setHeldKey(null)}
            onFocus={() => setHeldKey((held) => held ?? shownKey)}
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHeldKey(null); }}>
            {!dock.side ? (
              <button type="button" className={styles.sheetClose} onClick={() => setOpenReading(null)}>
                Close
              </button>
            ) : null}
            {shown ? (
              <>
                <SteerColumn key={shownKey} entry={shown} disabled={!canSteer} pinned={!!openKey}
                  onSteer={(direction) => sendSteer(shown, direction)} />
              </>
            ) : (
              <p className={styles.dockHint}>
                A bubble surfaces before each section with what the model was focused on. Open one to steer from there.
              </p>
            )}
          </div>
        ) : null}
        {!activeRunId ? <IdleOcean onSample={onSample} disabled={connection !== "open"} /> : null}
        <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      </div>
    </DeepViewport>
  );
}

// The path a steer left: the rest of the run it branched from, as faded
// bubbles you can go back to.
function LeftBehind({ entry }: { entry: ChainEntry }) {
  const selectRun = useStreamStore((state) => state.selectRun);
  const focuses = useStreamStore(useShallow((state) =>
    Object.values(state.runs.find((run) => run.id === entry.runId)?.readings ?? {})
      .filter((reading) => reading.checkpointId > entry.reading.checkpointId)
      .sort((a, b) => a.checkpointId - b.checkpointId)
      .map((reading) => reading.focus ?? reading.label)));
  const count = entry.leftBehind ?? 0;
  return (
    <button type="button" className={styles.ghost} onClick={() => selectRun(entry.runId)}
      title={focuses.join(" → ")}
      aria-label={`Go back to the path before this steer: ${count} later ${count === 1 ? "section" : "sections"}, ${focuses.join(", ")}`}>
      <span className={styles.ghostDots} aria-hidden="true">
        {Array.from({ length: Math.min(count, 5) }, (_, index) => <span key={index} />)}
      </span>
      earlier path
    </button>
  );
}

function Bubble({ node, entry, open, dimmed, lit, tabbable, onFocusBubble, onToggle, onHover }: {
  node: Node; entry: ChainEntry; open: boolean; dimmed: boolean; lit: boolean;
  tabbable: boolean; onFocusBubble: () => void;
  onToggle: (fromKeyboard: boolean) => void; onHover: (on: boolean) => void;
}) {
  const { reading, forkedTo } = entry;
  const count = reading.alternatives?.length ?? 0;
  return (
    <button type="button" data-node={node.key} tabIndex={tabbable ? 0 : -1}
      className={`${styles.node} ${styles[node.phase]} ${open ? styles.open : ""} ${dimmed ? styles.dimmed : ""} ${lit ? styles.lit : ""} ${reading.error ? styles.error : ""} ${reading.steering ? styles.steering : ""}`}
      aria-expanded={open}
      aria-label={`${reading.label}: ${reading.error ? "reading unavailable" : reading.focus ?? "no clear focus"}${node.phase === "upcoming" ? ", coming up" : node.phase === "unreached" ? ", not reached before the answer stopped" : ""}${forkedTo ? `, steered ${forkedTo.kind === "away" ? "away from" : "toward"} ${forkedTo.focus}` : ""}${count ? `, ${count} other directions` : ""}`}
      onClick={(event) => onToggle(event.detail === 0)}
      onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)}
      onFocus={() => { onHover(true); onFocusBubble(); }} onBlur={() => onHover(false)}>
      <span className={styles.bob}>
        <span className={styles.orbBox}>
          <span className={styles.orb} />
          {count && !open ? <span className={styles.badge} aria-hidden="true">+{count}</span> : null}
        </span>
        <span className={styles.label}>
          <span className={styles.step}>{node.phase === "upcoming" ? `${reading.label} · coming up` : node.phase === "unreached" ? `${reading.label} · not reached` : reading.label}</span>
          {reading.error ? "Reading unavailable" : reading.focus ?? "No clear focus"}
          {forkedTo ? (
            <span className={styles.fork}>↳ steered {forkedTo.kind === "away" ? "away" : `toward ${forkedTo.focus}`}</span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function SteerColumn({ entry, disabled, pinned, onSteer }: {
  entry: ChainEntry; disabled: boolean; pinned: boolean;
  onSteer: (direction: SteerDirection) => void;
}) {
  const { reading } = entry;
  const [text, setText] = useState("");
  if (reading.error) return null;
  const alternatives = reading.alternatives ?? [];
  const busy = disabled || !!reading.steering;
  const inputId = `steer-${entry.runId}-${reading.checkpointId}`;
  return (
    <fieldset className={`${styles.column} ${pinned ? styles.columnPinned : ""}`} disabled={busy}>
      <legend className={styles.columnTitle}>
        From {reading.label}, go another way
        <span>Suggested by Qwen, not read from the model</span>
      </legend>
      <div className={styles.buds}>
        {alternatives.length ? alternatives.map((alternative, index) => {
          const chosen = reading.selectedAlternative === alternative.id;
          return (
            <button key={alternative.id} type="button"
              className={`${styles.bud} ${chosen ? styles.chosen : ""}`}
              style={{ "--i": index } as CSSProperties}
              aria-pressed={chosen}
              aria-label={`Steer toward ${alternative.focus} (suggested by Qwen, not read from the model): ${alternative.detail}`}
              onClick={() => onSteer({ alternative_id: alternative.id })}>
              <span className={styles.budDot} aria-hidden="true" />
              {alternative.focus}
            </button>
          );
        }) : (
          <p className={styles.waiting}>Finding other directions…</p>
        )}
      </div>
      <form className={styles.own} onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim()) return;
        onSteer({ text: text.trim() });
        setText("");
      }}>
        <label htmlFor={inputId} className="sr-only">Tell the model where to go from {reading.label}</label>
        <input id={inputId} value={text} maxLength={300} autoComplete="off"
          placeholder="Or tell it where to go instead…" onChange={(event) => setText(event.target.value)} />
        <button type="submit" disabled={!text.trim()} aria-label="Steer with this direction">→</button>
      </form>
      <p role="status" className={styles.columnStatus}>
        {reading.steering ? `Reconsidering from ${reading.label}…` : reading.steerMessage ?? (disabled ? "Reconnecting to the model…" : "")}
      </p>
    </fieldset>
  );
}

function IdleOcean({ onSample, disabled }: { onSample: (prompt: string) => void; disabled: boolean }) {
  return (
    <div className={styles.idle}>
      <h2 className={styles.idleTitle}>Watch the model think ahead</h2>
      <p className={styles.idleBody}>
        Before each section of Qwen&apos;s answer, a bubble rises here with what its internal state
        was focused on. Open a bubble to steer the answer somewhere else.
      </p>
      <div className={styles.samples}>
        {SAMPLES.map((sample) => (
          <button key={sample} type="button" className={styles.sample} disabled={disabled} onClick={() => onSample(sample)}>
            {sample}
          </button>
        ))}
      </div>
    </div>
  );
}
