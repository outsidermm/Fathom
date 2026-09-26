"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStreamStore } from "@/lib/stream-store";

export function TopBar({ children }: { children?: ReactNode }) {
  const paused = useStreamStore((state) => state.paused);
  const setPaused = useStreamStore((state) => state.setPaused);
  return (
    <header className="surface-panel relative z-20 flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3">
      <div className="flex shrink-0 items-center gap-3">
        {/* Served as-is: /_next/image is not routed on the Vercel Services
            deployment, so an optimized image 404s there. */}
        <Image
          src="/brand/fathom-mark-112.png"
          alt=""
          width={44}
          height={44}
          unoptimized
          className="shrink-0"
        />
        <div className="flex flex-col gap-0.5">
          <h1 className="surface-title text-2xl">Fathom</h1>
          <p className="font-body text-xs max-xl:sr-only">
            See what surfaces. Shape what happens next.
          </p>
        </div>
      </div>
      {/* The prompt, Run/Stop and Pause share one row and one gap. */}
      <div className="flex min-w-0 flex-1 basis-full items-start gap-2 md:basis-auto">
        {children}
        {/* Freezes the answer where it is, and the ocean with it. */}
        <Button
          type="button"
          variant="outline"
          className="h-11 min-w-28"
          onClick={() => setPaused(!paused)}
          aria-pressed={paused}
        >
          {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
          {paused ? "Resume" : "Pause"}
        </Button>
      </div>
    </header>
  );
}
