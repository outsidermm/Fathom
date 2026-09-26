"use client";

import { useEffect } from "react";
import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MODEL_LABELS, type Model } from "@/lib/contract";
import { useStreamStore } from "@/lib/stream-store";

// Qwen is the only model the API serves.
const MODEL: Model = "qwen2.5-7b";
const CONNECTION_LABELS = {
  open: `Connected to ${MODEL_LABELS[MODEL]}`,
  connecting: "Connecting…",
  retrying: "Reconnecting…",
  closed: "Disconnected",
} as const;

export function PromptConsole({ prompt, onPromptChange }: {
  prompt: string; onPromptChange: (prompt: string) => void;
}) {
  const connection = useStreamStore((state) => state.connection);
  const running = useStreamStore((state) =>
    state.runs.find((item) => item.id === state.activeRunId)?.status === "streaming",
  );
  const start = useStreamStore((state) => state.start);
  const stop = useStreamStore((state) => state.stop);
  const canRun = connection === "open" && !!prompt.trim() && !running;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canRun) {
        event.preventDefault();
        start(prompt, MODEL);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canRun, start, prompt]);
  return (
    <form
      className="flex min-w-0 flex-1 items-start gap-2"
      aria-label="Ask the model"
      onSubmit={(event) => {
        event.preventDefault();
        if (canRun) start(prompt, MODEL);
      }}
    >
      <label htmlFor="prompt-text" className="sr-only">
        Prompt
      </label>
      <div className="relative min-w-0 flex-1">
        <textarea
          id="prompt-text"
          name="prompt"
          autoComplete="off"
          maxLength={16000}
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={(event) => {
            // Enter runs; Shift+Enter adds a line.
            if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
              event.preventDefault();
              if (canRun) start(prompt, MODEL);
            }
          }}
          rows={1}
          placeholder="Ask Qwen anything… (Enter to run)"
          className={`field-sizing-content block max-h-24 min-h-11 w-full resize-none rounded-xl border-2 border-crate bg-paper py-2.5 pl-3 ${connection === "open" ? "pr-9" : "pr-32"} font-body text-sm text-driftwood placeholder:text-muted-foreground focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-harbor`}
        />
        <span
          className="pointer-events-none absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1.5 font-body text-xs text-muted-foreground"
          role="status"
          title={CONNECTION_LABELS[connection]}
        >
          <span
            aria-hidden
            className={`size-2 rounded-full ${connection === "open" ? "bg-glow-3" : connection === "closed" ? "bg-muted-foreground" : "animate-pulse bg-sand-beach"}`}
          />
          <span className={connection === "open" ? "sr-only" : ""}>{CONNECTION_LABELS[connection]}</span>
        </span>
      </div>
      {/* One button: Run, and Stop while the answer is coming in. Stop keeps
          the answer where it is. h-10 plus its 4px shadow matches the h-11
          prompt and Pause. */}
      {running ? (
        <Button key="stop" type="button" className="h-10 min-w-24" onClick={stop}>
          <Square aria-hidden /> Stop
        </Button>
      ) : (
        <Button key="run" type="submit" className="h-10 min-w-24" disabled={!canRun}>
          <Play aria-hidden /> Run
        </Button>
      )}
    </form>
  );
}
