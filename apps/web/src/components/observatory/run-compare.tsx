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
  const runs = useStreamStore((state) => state.runs);
  const baselineId = useStreamStore((state) => state.baselineRunId);
  const activeId = useStreamStore((state) => state.activeRunId);
  const features = useStreamStore((state) => state.features);
  const baseline = runs.find((run) => run.id === baselineId);
  const steered = runs.find(
    (run) => run.id === activeId && Object.keys(run.clamps).length > 0,
  );
  const ready =
    !!baseline &&
    !!steered &&
    baseline.id !== steered.id &&
    baseline.status === "done" &&
    steered.status === "done";
  const [dismissedRunId, setDismissedRunId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const open = ready && (manualOpen || steered?.id !== dismissedRunId);
  const diff = useMemo(
    () =>
      baseline && steered && ready
        ? wordDiff(words(baseline), words(steered))
        : null,
    [baseline, steered, ready],
  );
  const label = steered
    ? Object.entries(steered.clamps)
        .map(
          ([id, value]) =>
            `${features[id]?.label ?? id} ${value > 0 ? "+" : ""}${value.toFixed(1)}`,
        )
        .join(", ")
    : "";
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
          if (!value && steered) setDismissedRunId(steered.id);
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
                <PaperNote pin={false} rotate={-0.5}>
                  <h3 className="mb-2 font-ui text-lg font-bold text-harbor">
                    Baseline
                  </h3>
                  <p className="mb-3 font-mono text-xs">
                    {baseline!.flags.length} flags
                  </p>
                  <DiffText
                    words={diff.a}
                    same={diff.leftSame}
                    mode="removed"
                  />
                </PaperNote>
                <PaperNote pin={false} rotate={0.5}>
                  <h3 className="mb-2 font-ui text-lg font-bold text-harbor">
                    Steered: {label}
                  </h3>
                  <p className="mb-3 font-mono text-xs">
                    {steered!.flags.length} flags
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
