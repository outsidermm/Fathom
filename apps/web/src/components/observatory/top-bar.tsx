"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStreamStore } from "@/lib/stream-store";
import type { Model } from "@/lib/contract";

export function TopBar({ model, onModelChange }: { model: Model; onModelChange: (model: Model) => void }) {
  const connection = useStreamStore((state) => state.connection);
  return <header className="relative z-20 flex flex-wrap items-center justify-between gap-3 rounded-[20px] bg-sand-light/95 px-5 py-3 text-slate shadow-[0_6px_0_rgb(0_0_0_/_0.06)]">
    <div><h1 className="font-display text-3xl leading-none text-ink">Oracle of the Deep</h1><p className="font-body text-xs">Model behavior, as it surfaces</p></div>
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 font-ui text-sm font-bold" htmlFor="model-select">Model
        <select id="model-select" value={model} onChange={(event) => onModelChange(event.target.value as Model)} className="rounded-lg border-2 border-crate bg-paper px-2 py-1 text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-harbor">
          <option value="qwen2.5-7b">Qwen 2.5 7B</option><option value="gemma-2b" disabled>Gemma 2B (unavailable)</option>
        </select>
      </label>
      <Tooltip><TooltipTrigger asChild><span tabIndex={0} className="inline-flex items-center gap-2 rounded-lg px-2 py-1 text-xs focus-visible:outline-3 focus-visible:outline-harbor" aria-label={`Connection ${connection}`}><span aria-hidden className={`size-2 rounded-full ${connection === "open" ? "bg-ink" : "bg-coral"}`} />{connection === "open" ? "Connected" : connection === "retrying" ? "Retrying" : connection === "connecting" ? "Connecting" : "Offline"}</span></TooltipTrigger><TooltipContent variant="chalkboard">{connection === "retrying" ? "The tide went out. Reconnecting…" : connection === "open" ? "Live Qwen text is connected." : "Waiting for the tide…"}</TooltipContent></Tooltip>
    </div>
  </header>;
}
