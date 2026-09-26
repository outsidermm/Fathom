"use client";

import { useEffect, useState } from "react";
import { Play, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Model } from "@/lib/contract";
import { useStreamStore } from "@/lib/stream-store";

const SAMPLES = [
  "Explain why the sky is blue",
  "Is it safe to take ibuprofen with coffee?",
  "Write a one-line product review",
];
export function PromptConsole({ model }: { model: Model }) {
  const [prompt, setPrompt] = useState("");
  const connection = useStreamStore((state) => state.connection);
  const run = useStreamStore((state) =>
    state.runs.find((item) => item.id === state.activeRunId),
  );
  const start = useStreamStore((state) => state.start);
  const stop = useStreamStore((state) => state.stop);
  const rerun = useStreamStore((state) => state.rerun);
  const canRun =
    connection === "open" && !!prompt.trim() && run?.status !== "streaming";
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canRun) {
        event.preventDefault();
        start(prompt, model);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canRun, start, prompt, model]);
  return (
    <section
      className="rounded-[20px] bg-sand p-4 shadow-[0_5px_18px_rgb(80_49_32_/_0.1)]"
      aria-labelledby="prompt-heading"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2
          id="prompt-heading"
          className="font-ui text-base font-bold text-ink"
        >
          Ask the model
        </h2>
        <span className="font-body text-xs text-muted-foreground">
          ⌘/Ctrl + Enter to run
        </span>
      </div>
      <label htmlFor="prompt-text" className="sr-only">
        Prompt
      </label>
      <textarea
        id="prompt-text"
        name="prompt"
        autoComplete="off"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={2}
        placeholder="e.g. Explain why the sky is blue…"
        className="w-full resize-y rounded-xl border-2 border-crate bg-paper px-3 py-2 font-body text-sm text-driftwood placeholder:text-muted-foreground focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-harbor"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Try:</span>
        {SAMPLES.map((sample) => (
          <button
            key={sample}
            type="button"
            onClick={() => setPrompt(sample)}
            className="rounded-full border-2 border-crate bg-sand-light px-3 py-1 font-body text-xs text-ink hover:bg-paper focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-harbor"
          >
            {sample}
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => start(prompt, model)}
          disabled={!canRun}
          aria-busy={run?.status === "streaming"}
        >
          <Play aria-hidden />{" "}
          {run?.status === "streaming" ? "Running…" : "Run"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={stop}
          disabled={run?.status !== "streaming"}
        >
          <Square aria-hidden /> Stop
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={rerun}
          disabled={connection !== "open" || !run || run.status === "streaming"}
        >
          <RotateCcw aria-hidden /> Rerun
        </Button>
      </div>
      {run?.message && (
        <p role="status" className="mt-3 text-sm text-driftwood">
          {run.message}
        </p>
      )}
    </section>
  );
}
