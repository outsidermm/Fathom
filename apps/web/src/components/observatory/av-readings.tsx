"use client";

import { PaperNote } from "@/components/sea/paper-note";
import { useStreamStore, type Reading } from "@/lib/stream-store";

export function AvReadings() {
  const run = useStreamStore((state) =>
    state.runs.find((item) => item.id === state.activeRunId),
  );
  const steer = useStreamStore((state) => state.steer);
  const readings = Object.values(run?.readings ?? {}).sort(
    (a, b) => a.checkpointId - b.checkpointId,
  );
  if (!run || readings.length === 0) return null;
  return (
    <PaperNote aria-label="Model focus" pin={false}>
      <h2 className="mb-1 font-ui text-lg font-bold text-harbor">
        Model focus
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        What the model&apos;s state showed just before each section. Pick another
        direction to steer from there.
      </p>
      <ol className="flex flex-col gap-4">
        {readings.map((reading) => (
          <ReadingItem
            key={reading.checkpointId}
            reading={reading}
            pending={run.status === "streaming"}
            onSteer={(alternativeId) =>
              steer(reading.checkpointId, alternativeId)
            }
          />
        ))}
      </ol>
    </PaperNote>
  );
}

function ReadingItem({
  reading,
  pending,
  onSteer,
}: {
  reading: Reading;
  pending: boolean;
  onSteer: (alternativeId: number) => void;
}) {
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
            <fieldset className="mt-3">
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
                      onClick={() => onSteer(alternative.id)}
                      className={`rounded-xl border-2 px-3 py-2 text-left font-body text-sm transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-harbor ${
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
                      {selected && reading.steerMessage && (
                        <span role="status" className="mt-1 block text-xs">
                          Selected · steering coming soon
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : (
            pending && (
              <p className="mt-2 text-xs text-muted-foreground">
                Finding other directions…
              </p>
            )
          )}
        </>
      )}
    </li>
  );
}
