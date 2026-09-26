"use client";

import Image from "next/image";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Model } from "@/lib/contract";

export function TopBar({
  model,
  onModelChange,
  motionPaused,
  onMotionChange,
}: {
  model: Model;
  onModelChange: (model: Model) => void;
  motionPaused: boolean;
  onMotionChange: (paused: boolean) => void;
}) {
  return (
    <header className="surface-panel relative z-20 flex flex-wrap items-center justify-between gap-4 px-5 py-4">
      <div className="flex items-center gap-3">
        <Image
          src="/brand/fathom-mark.png"
          alt=""
          width={56}
          height={56}
          className="shrink-0"
        />
        <div className="flex flex-col gap-1">
          <h1 className="surface-title">Fathom</h1>
          <p className="font-body text-xs">
            See what surfaces. Shape what happens next.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 font-ui text-sm font-bold">
          <label htmlFor="model-select">Model</label>
          <Select
            name="model"
            value={model}
            onValueChange={(value) => onModelChange(value as Model)}
          >
            <SelectTrigger id="model-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end" sideOffset={8}>
              <SelectItem value="qwen2.5-7b">Qwen 2.5 7B</SelectItem>
              <SelectItem value="gemma-2b" disabled>
                Gemma 2B (unavailable)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          onClick={() => onMotionChange(!motionPaused)}
          aria-pressed={motionPaused}
        >
          {motionPaused ? "Resume Motion" : "Pause Motion"}
          {motionPaused ? <Play aria-hidden /> : <Pause aria-hidden />}
        </Button>
      </div>
    </header>
  );
}
