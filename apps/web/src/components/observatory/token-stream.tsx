"use client";

import { useEffect, useRef } from "react";
import { PaperNote } from "@/components/sea/paper-note";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStreamStore } from "@/lib/stream-store";

export function TokenStream() {
  const run = useStreamStore((state) => state.runs.find((item) => item.id === state.activeRunId));
  const hover = useStreamStore((state) => state.hoverToken);
  const scroller = useRef<HTMLDivElement>(null);
  const paused = useRef(false);
  useEffect(() => { if (!paused.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [run?.tokens.length]);
  const flags = new Map(run?.flags.map((flag) => [flag.tokenIndex, flag]));
  return <PaperNote rotate={-0.4} className="h-full min-h-48" aria-label="Model output">
    <h2 className="mb-3 font-ui text-lg font-bold text-harbor">Model output</h2>
    <div ref={scroller} className="max-h-64 overflow-y-auto pr-2 font-body text-base leading-relaxed whitespace-pre-wrap" onPointerEnter={() => { paused.current = true; }} onPointerLeave={() => { paused.current = false; hover(null); }}>
      {!run ? <p className="text-sm text-muted-foreground">Run a prompt to see live text.</p> : run.tokens.length === 0 ? <p role="status" className="text-sm text-muted-foreground">{run.status === "streaming" ? "Waiting for the first words…" : "No output received."}</p> : run.tokens.map((token) => {
        const flag = flags.get(token.index);
        return <span key={`${run.id}-${token.index}`} onPointerEnter={() => hover(token.index)} className={`motion-safe:animate-[surface_250ms_ease-out_both] ${flag ? "decoration-alert underline decoration-2 underline-offset-4" : ""}`}>
          {token.text}{flag && <Tooltip><TooltipTrigger asChild><button type="button" className="mx-0.5 inline rounded text-alert focus-visible:outline-2 focus-visible:outline-harbor" aria-label={`Flag: ${flag.signature}, ${Math.round(flag.confidence * 100)} percent`}>⚠</button></TooltipTrigger><TooltipContent>{flag.signature} · {Math.round(flag.confidence * 100)}%</TooltipContent></Tooltip>}
        </span>;
      })}
    </div>
    {run && <p className="mt-3 font-mono text-xs text-muted-foreground" role="status">{run.status === "streaming" ? "Streaming…" : run.status === "done" ? "Complete" : run.status === "stopped" ? "Stopped" : `Error${run.message ? `: ${run.message}` : ""}`}</p>}
  </PaperNote>;
}
