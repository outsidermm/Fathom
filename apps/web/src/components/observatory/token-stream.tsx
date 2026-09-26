"use client";

import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { codePointToUtf16 } from "@/lib/code-points";
import { MarkdownOutput, type OutputSection } from "./markdown-output";
import { hasBubble, readingChain, readingKey, useStreamStore, type Reading, type Run, type SteerInfo } from "@/lib/stream-store";

const NO_SECTIONS: readonly OutputSection[] = [];

// Where each reading's section starts in the active text. The list stays the
// same object until a reading arrives or the stream reaches a new section,
// so the rendered Markdown keeps its components.
function useSections(run: Run | undefined) {
  const flat = useStreamStore(useShallow((state) =>
    readingChain(state.runs, state.activeRunId).flatMap((entry) => [entry.runId, entry.reading])));
  const text = run?.tokens.map((token) => token.text).join("") ?? "";
  const offsets: number[] = [];
  for (let index = 1; index < flat.length; index += 2) {
    const reading = flat[index] as Reading;
    const offset = codePointToUtf16(text, reading.position);
    // Upcoming readings get their marker once the text reaches them; like
    // bubbles, only readings with other directions get one.
    if (hasBubble(reading) && offset < text.length) offsets.push(offset);
    else offsets.push(-1);
  }
  const key = offsets.join(",");
  return useMemo(() => {
    const sections: OutputSection[] = [];
    key.split(",").forEach((value, index) => {
      const offset = Number(value);
      if (!value || offset < 0) return;
      const reading = flat[index * 2 + 1] as Reading;
      sections.push({ offset, key: readingKey(flat[index * 2] as string, reading.checkpointId), label: reading.label, focus: reading.focus });
    });
    return sections.length ? sections : NO_SECTIONS;
  }, [flat, key]);
}

export function TokenStream() {
  const run = useStreamStore((state) =>
    state.runs.find((item) => item.id === state.activeRunId),
  );
  const openReading = useStreamStore((state) => state.openReading);
  const sections = useSections(run);
  const scroller = useRef<HTMLDivElement>(null);
  const paused = useRef(false);
  useEffect(() => {
    if (!paused.current && !openReading)
      scroller.current?.scrollTo({
        top: scroller.current.scrollHeight,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  }, [run?.tokens.length, openReading]);
  // Opening a bubble in the ocean brings its section into view.
  useEffect(() => {
    const box = scroller.current;
    const dot = openReading && box?.querySelector(`[data-section-key="${CSS.escape(openReading)}"]`);
    if (!box || !dot) return;
    // Scroll only the answer, never the page (the ocean stays in view).
    box.scrollTo({
      top: box.scrollTop + dot.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 3,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }, [openReading]);
  return (
    <section
      data-coach-target="answer"
      className="flex min-h-0 flex-col rounded-[20px] bg-paper text-driftwood shadow-[0_10px_24px_rgb(80_49_32_/_0.18)]"
      aria-labelledby="answer-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-crate/40 px-5 pt-4 pb-3">
        <div className="flex items-baseline gap-3">
          <h2 id="answer-heading" className="font-ui text-lg font-bold text-harbor">
            Answer
          </h2>
          {run && (
            <p className="font-mono text-xs text-muted-foreground" role="status">
              {run.status === "streaming"
                ? run.inspecting
                  ? `Reading ${run.inspecting.label}…`
                  : "Streaming…"
                : run.status === "done"
                  ? "Complete"
                  : run.status === "stopped"
                    ? "Stopped"
                    : `Error${run.message ? `: ${run.message}` : ""}`}
            </p>
          )}
        </div>
      </div>
      {run?.steer && <SteerPath run={run} />}
      <div
        ref={scroller}
        className="min-h-48 flex-1 overflow-y-auto px-5 py-4 break-words font-body text-base leading-relaxed"
        onPointerEnter={() => {
          paused.current = true;
        }}
        onPointerLeave={() => {
          paused.current = false;
        }}
      >
        {!run ? (
          <p className="text-sm text-muted-foreground">
            The answer streams here. Dots in the text mark where each bubble&apos;s section begins.
          </p>
        ) : run.tokens.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            {run.status === "streaming"
              ? "Waiting for the first words…"
              : "No output received."}
          </p>
        ) : (
          <MarkdownOutput tokens={run.tokens} sections={sections} />
        )}
      </div>
      {!!run?.avDropped && (
        <p className="border-t-2 border-crate/40 px-5 py-2 text-xs text-muted-foreground">
          {run.avDropped} {run.avDropped === 1 ? "reading was" : "readings were"} dropped
          because the answer passed {run.avDropped === 1 ? "its section" : "their sections"} first.
        </p>
      )}
    </section>
  );
}

// The runs this one was steered from, oldest first, each one selectable.
function SteerPath({ run }: { run: Run }) {
  const runs = useStreamStore((state) => state.runs);
  const selectRun = useStreamStore((state) => state.selectRun);
  if (!run.steer) return null;
  const chain: Run[] = [];
  for (let item: Run | undefined = run; item; ) {
    chain.unshift(item);
    const parentId: string | undefined = item.parentRunId;
    item = parentId ? runs.find((other) => other.id === parentId) : undefined;
  }
  return (
    <nav aria-label="Steering history" className="border-b-2 border-crate/40 bg-sand-light/60 px-5 py-2">
      <ol className="flex flex-wrap items-center gap-1 text-xs">
        {chain.map((item, index) => (
          <li key={item.id} className="flex items-center gap-1">
            {index > 0 && <span aria-hidden>→</span>}
            <button
              type="button"
              aria-current={item.id === run.id ? "page" : undefined}
              onClick={() => selectRun(item.id)}
              className="rounded-md border-2 border-crate bg-paper px-2 py-0.5 text-ink hover:bg-sand-light focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-harbor aria-[current=page]:border-harbor aria-[current=page]:bg-harbor aria-[current=page]:text-paper"
            >
              {item.steer ? steerLabel(item.steer) : "Original"}
            </button>
          </li>
        ))}
      </ol>
      <SteerSummary steer={run.steer} />
    </nav>
  );
}

function steerLabel(steer: SteerInfo) {
  return `${steer.label}: ${steer.kind === "away" ? "away from" : "toward"} ${steer.focus}`;
}

function SteerSummary({ steer }: { steer: SteerInfo }) {
  const { score } = steer;
  return (
    <div className="mt-1.5 text-xs text-slate">
      <p>
        {steer.kind === "away"
          ? `Pushed the model's layer-20 state away from “${steer.focus}” at ${steer.label}; it wrote the section itself.`
          : `Moved the model's layer-20 state toward “${steer.focus}” at ${steer.label}${
              steer.anchored ? ", opening with that heading" : ""
            }.`}
        {steer.note && ` Understood as: ${steer.note}`}
      </p>
      {score && (
        <p className="mt-0.5 font-mono">
          AR match with the original focus {score.before.current.toFixed(2)} →{" "}
          {score.after.current.toFixed(2)}
          {score.before.target !== undefined &&
            score.after.target !== undefined &&
            ` · with the new direction ${score.before.target.toFixed(2)} → ${score.after.target.toFixed(2)}`}
        </p>
      )}
    </div>
  );
}
