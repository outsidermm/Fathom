"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PaperNote } from "@/components/sea/paper-note";
import { useStreamStore, type Run } from "@/lib/stream-store";

const MAX_WORDS = 600;
function words(run: Run) {
  return run.tokens
    .map((token) => token.text)
    .join("")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}
function wordDiff(left: string[], right: string[]) {
  const a = left.slice(0, MAX_WORDS),
    b = right.slice(0, MAX_WORDS);
  const rows = Array.from(
    { length: a.length + 1 },
    () => new Uint16Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      rows[i][j] =
        a[i] === b[j]
          ? rows[i + 1][j + 1] + 1
          : Math.max(rows[i + 1][j], rows[i][j + 1]);
  const leftSame = new Set<number>(),
    rightSame = new Set<number>();
  let i = 0,
    j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      leftSame.add(i++);
      rightSame.add(j++);
    } else if (rows[i + 1][j] >= rows[i][j + 1]) i++;
    else j++;
  }
  return {
    a,
    b,
    leftSame,
    rightSame,
    truncated: left.length > MAX_WORDS || right.length > MAX_WORDS,
  };
}
function DiffText({
  words,
  same,
  mode,
}: {
  words: string[];
  same: Set<number>;
  mode: "removed" | "inserted";
}) {
  return (
    <p className="break-words font-body text-sm leading-relaxed">
      {words.map((word, index) => (
        <span
          key={index}
          className={
            !same.has(index)
              ? mode === "removed"
                ? "bg-clamp-down/30 line-through"
                : "bg-gold"
              : undefined
          }
        >
          {word}
          {index < words.length - 1 ? " " : ""}
        </span>
      ))}
    </p>
  );
}
export function RunCompare() {
  // Select the run *statuses* rather than the run objects themselves: a run's
  // tokens/flags arrays get new references on every streamed token, and
  // subscribing to the full `runs` array (or to a `.find(...)` over it) would
  // re-render this dialog on every token of every run, not just when a
  // comparison becomes available.
  const baselineId = useStreamStore((state) => state.baselineRunId);
  const activeId = useStreamStore((state) => state.activeRunId);
  const baselineStatus = useStreamStore(
    (state) => state.runs.find((run) => run.id === baselineId)?.status,
  );
  const steeredId = useStreamStore((state) => {
    const run = state.runs.find((item) => item.id === activeId);
    return run && Object.keys(run.clamps).length > 0 ? run.id : undefined;
  });
  const steeredStatus = useStreamStore(
    (state) => state.runs.find((run) => run.id === steeredId)?.status,
  );
  const ready =
    !!baselineId &&
    !!steeredId &&
    baselineId !== steeredId &&
    baselineStatus === "done" &&
    steeredStatus === "done";
  const [dismissedRunId, setDismissedRunId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const open = ready && (manualOpen || steeredId !== dismissedRunId);
  // Runs are immutable once status is "done", so it's safe to read them out
  // of the store directly here (a snapshot, not a subscription) instead of
  // subscribing to their token/flag arrays.
  const comparison = useMemo(() => {
    if (!ready || !baselineId || !steeredId) return null;
    const { runs, features } = useStreamStore.getState();
    const baseline = runs.find((run) => run.id === baselineId);
    const steered = runs.find((run) => run.id === steeredId);
    if (!baseline || !steered) return null;
    const label = Object.entries(steered.clamps)
      .map(
        ([id, value]) =>
          `${features[id]?.label ?? id} ${value > 0 ? "+" : ""}${value.toFixed(1)}`,
      )
      .join(", ");
    return { baseline, steered, diff: wordDiff(words(baseline), words(steered)), label };
  }, [ready, baselineId, steeredId]);
  const diff = comparison?.diff ?? null;
  const label = comparison?.label ?? "";
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={!ready}
        onClick={() => setManualOpen(true)}
        title={
          !ready
            ? "Compare becomes available after a baseline and a steered run finish."
            : undefined
        }
      >
        Compare Runs
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setManualOpen(value);
          if (!value && steeredId) setDismissedRunId(steeredId);
        }}
      >
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Compare Runs</DialogTitle>
            <DialogDescription>
              Word changes between the baseline and the steered run. Highlighted
              words were inserted; struck words were removed.
            </DialogDescription>
          </DialogHeader>
          {ready && diff && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <PaperNote pin={false}>
                  <h3 className="mb-2 font-ui text-lg font-bold text-harbor">
                    Baseline
                  </h3>
                  <p className="mb-3 font-mono text-xs">
                    {comparison!.baseline.flags.length} flags
                  </p>
                  <DiffText
                    words={diff.a}
                    same={diff.leftSame}
                    mode="removed"
                  />
                </PaperNote>
                <PaperNote pin={false}>
                  <h3 className="mb-2 font-ui text-lg font-bold text-harbor">
                    Steered: {label}
                  </h3>
                  <p className="mb-3 font-mono text-xs">
                    {comparison!.steered.flags.length} flags
                  </p>
                  <DiffText
                    words={diff.b}
                    same={diff.rightSame}
                    mode="inserted"
                  />
                </PaperNote>
              </div>
              {diff.truncated && (
                <p className="text-xs text-muted-foreground">
                  Showing the first {MAX_WORDS} words of each run.
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
