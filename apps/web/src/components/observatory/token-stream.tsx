"use client";

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PaperNote } from "@/components/sea/paper-note";
import { Button } from "@/components/ui/button";
import { MarkdownOutput } from "./markdown-output";
import { useStreamStore } from "@/lib/stream-store";

export function TokenStream() {
  const run = useStreamStore((state) =>
    state.runs.find((item) => item.id === state.activeRunId),
  );
  const hover = useStreamStore((state) => state.hoverToken);
  const hovered = useStreamStore((state) => state.hoveredTokenIndex);
  const scroller = useRef<HTMLDivElement>(null);
  const paused = useRef(false);
  useEffect(() => {
    if (!paused.current)
      scroller.current?.scrollTo({
        top: scroller.current.scrollHeight,
        behavior: "smooth",
      });
  }, [run?.tokens.length]);
  const tokens = run?.tokens ?? [];
  const position = tokens.findIndex((token) => token.index === hovered);
  return (
    <PaperNote
      className="h-full min-h-48"
      aria-label="Model output"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-ui text-lg font-bold text-harbor">Model output</h2>
        <div className="flex items-center gap-1">
          <span className="mr-1 font-mono text-xs text-muted-foreground">
            {hovered === null ? "Explore tokens" : `Token ${hovered}`}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Previous token"
            disabled={!tokens.length || position === 0}
            onClick={() => {
              paused.current = true;
              hover(
                tokens[position < 0 ? tokens.length - 1 : position - 1].index,
              );
            }}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Next token"
            disabled={!tokens.length || position === tokens.length - 1}
            onClick={() => {
              paused.current = true;
              hover(tokens[position + 1].index);
            }}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
      <div
        ref={scroller}
        className="max-h-64 overflow-y-auto break-words pr-2 font-body text-base leading-relaxed"
        onPointerEnter={() => {
          paused.current = true;
        }}
        onPointerLeave={() => {
          paused.current = false;
          hover(null);
        }}
      >
        {!run ? (
          <p className="text-sm text-muted-foreground">
            Run a prompt to see live text.
          </p>
        ) : run.tokens.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            {run.status === "streaming"
              ? "Waiting for the first words…"
              : "No output received."}
          </p>
        ) : (
          <MarkdownOutput tokens={run.tokens} flags={run.flags} />
        )}
      </div>
      {run && (
        <p
          className="mt-3 font-mono text-xs text-muted-foreground"
          role="status"
        >
          {run.status === "streaming"
            ? "Streaming…"
            : run.status === "done"
              ? "Complete"
              : run.status === "stopped"
                ? "Stopped"
                : `Error${run.message ? `: ${run.message}` : ""}`}
        </p>
      )}
    </PaperNote>
  );
}
