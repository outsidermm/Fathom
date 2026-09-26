"use client";

import { useState } from "react";
import { PaperNote } from "@/components/sea/paper-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SteerDirection } from "@/lib/contract";
import {
  useStreamStore,
  type Reading,
  type Run,
  type SteerInfo,
} from "@/lib/stream-store";

export function AvReadings() {
  const run = useStreamStore((state) =>
    state.runs.find((item) => item.id === state.activeRunId),
  );
  const steer = useStreamStore((state) => state.steer);
  const readings = Object.values(run?.readings ?? {}).sort(
    (a, b) => a.checkpointId - b.checkpointId,
  );
  if (!run || (readings.length === 0 && !run.steer)) return null;
  return (
    <PaperNote aria-label="Model focus" pin={false}>
      <h2 className="mb-1 font-ui text-lg font-bold text-harbor">
        Model focus
      </h2>
      <SteerChain run={run} />
      <p className="mb-3 text-xs text-muted-foreground">
        What the model&apos;s state showed just before each section. Pick
        another direction to steer from there.
      </p>
      <ol className="flex flex-col gap-4">
        {readings.map((reading) => (
          <ReadingItem
            key={reading.checkpointId}
            reading={reading}
            pending={run.status === "streaming"}
            onSteer={(direction) => steer(reading.checkpointId, direction)}
          />
        ))}
      </ol>
    </PaperNote>
  );
}

// The runs this one was steered from, oldest first, each one selectable.
function SteerChain({ run }: { run: Run }) {
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
    <nav aria-label="Steering history" className="mb-3">
      <ol className="flex flex-wrap items-center gap-1 text-xs">
        {chain.map((item, index) => (
          <li key={item.id} className="flex items-center gap-1">
            {index > 0 && <span aria-hidden>→</span>}
            <button
              type="button"
              aria-current={item.id === run.id ? "page" : undefined}
              onClick={() => selectRun(item.id)}
              className="rounded-md border-2 border-crate bg-sand-light px-2 py-0.5 text-ink hover:bg-paper focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-harbor aria-[current=page]:border-harbor aria-[current=page]:bg-harbor aria-[current=page]:text-paper"
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
    <div className="mt-2 text-xs text-slate">
      <p>
        {steer.kind === "away"
          ? `Steered away from “${steer.focus}” at ${steer.label}: the model's layer-20 state was pushed toward the other directions and it wrote the section itself.`
          : `Steered toward “${steer.focus}” at ${steer.label}: the model's layer-20 state was moved to where it is when opening that section${
              steer.anchored ? ", and the section opens with that heading" : ""
            }.`}
      </p>
      {steer.note && <p className="mt-1">Understood as: {steer.note}</p>}
      {score && (
        <p className="mt-1 font-mono">
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

function ReadingItem({
  reading,
  pending,
  onSteer,
}: {
  reading: Reading;
  pending: boolean;
  onSteer: (direction: SteerDirection) => void;
}) {
  const [text, setText] = useState("");
  return (
    <li className="border-t-2 border-crate/50 pt-3 first:border-t-0 first:pt-0">
      <p className="font-mono text-xs text-muted-foreground">{reading.label}</p>
      {reading.error ? (
        <p className="text-sm text-muted-foreground">
          Reading unavailable for this section.
        </p>
      ) : (
        <>
          <p className="font-body text-base font-semibold text-ink">
            {reading.focus ?? "No clear focus"}
          </p>
          {reading.detail && (
            <details className="mt-1 text-sm">
              <summary className="cursor-pointer rounded text-xs text-harbor focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-harbor">
                Full reading
              </summary>
              <p className="mt-1 text-slate">{reading.detail}</p>
            </details>
          )}
          {reading.alternatives ? (
            <fieldset className="mt-3" disabled={reading.steering}>
              <legend className="mb-2 text-xs text-muted-foreground">
                Other directions · suggested by Qwen, not read from the model
              </legend>
              <div className="flex flex-col gap-2">
                {reading.alternatives.map((alternative) => {
                  const selected =
                    reading.selectedAlternative === alternative.id;
                  return (
                    <button
                      key={alternative.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        onSteer({ alternative_id: alternative.id })
                      }
                      className={`rounded-xl border-2 px-3 py-2 text-left font-body text-sm transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-harbor disabled:opacity-60 ${
                        selected
                          ? "border-harbor bg-harbor text-paper"
                          : "border-crate bg-sand-light text-ink hover:bg-paper"
                      }`}
                    >
                      <span className="block font-semibold">
                        {alternative.focus}
                      </span>
                      <span
                        className={`block text-xs ${selected ? "text-paper/90" : "text-muted-foreground"}`}
                      >
                        {alternative.detail}
                      </span>
                    </button>
                  );
                })}
              </div>
              <form
                className="mt-2 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!text.trim()) return;
                  onSteer({ text: text.trim() });
                  setText("");
                }}
              >
                <label className="sr-only" htmlFor={`steer-${reading.checkpointId}`}>
                  Tell the model where to go from {reading.label}
                </label>
                <Input
                  id={`steer-${reading.checkpointId}`}
                  value={text}
                  maxLength={300}
                  placeholder="Or tell it where to go…"
                  onChange={(event) => setText(event.target.value)}
                />
                <Button type="submit" variant="outline" disabled={!text.trim()}>
                  Steer
                </Button>
              </form>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1"
                onClick={() => onSteer({ away: true })}
              >
                Steer away from this
              </Button>
            </fieldset>
          ) : (
            pending && (
              <p className="mt-2 text-xs text-muted-foreground">
                Finding other directions…
              </p>
            )
          )}
          <div role="status" className="mt-1 text-xs">
            {reading.steering && (
              <span className="text-harbor">Reconsidering from {reading.label}…</span>
            )}
            {reading.steerMessage && (
              <span className="text-slate">{reading.steerMessage}</span>
            )}
          </div>
        </>
      )}
    </li>
  );
}
