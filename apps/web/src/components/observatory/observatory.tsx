"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/observatory/top-bar";
import { PromptConsole } from "@/components/observatory/prompt-console";
import { TokenStream } from "@/components/observatory/token-stream";
import { AvReadings } from "@/components/observatory/av-readings";
import { FeatureInspector } from "@/components/observatory/feature-inspector";
import { ClampTray } from "@/components/observatory/clamp-tray";
import { ConnectedFeatureMap, ConnectedDiagnosticsFeed, ConnectedFeatureSearch } from "@/components/observatory/connected-deep";
import { RunCompare } from "@/components/observatory/run-compare";
import { CoachMarks } from "@/components/observatory/coach-marks";
import { mountStreamConnection } from "@/lib/stream-store";
import type { Model } from "@/lib/contract";

export function Observatory() {
  const [model, setModel] = useState<Model>("qwen2.5-7b");
  const [motionPaused, setMotionPaused] = useState(false);
  useEffect(() => mountStreamConnection(), []);
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-paper focus:px-4 focus:py-2 focus:outline-3 focus:outline-harbor"
      >
        Skip to content
      </a>
      <main
        id="main-content"
        className={`mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 bg-sand px-4 py-4 text-ink sm:px-6 ${motionPaused ? "motion-paused" : ""}`}
      >
        <CoachMarks />
        <TopBar
          model={model}
          onModelChange={setModel}
          motionPaused={motionPaused}
          onMotionChange={setMotionPaused}
        />
        <PromptConsole model={model} />
        <div className="flex flex-wrap gap-2">
          <ConnectedFeatureSearch />
          <RunCompare />
        </div>
        <div className="grid min-h-[560px] flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
          <div className="grid content-start grid-rows-[auto_auto_auto] gap-4">
            <ConnectedFeatureMap paused={motionPaused} model={model} />
            <TokenStream />
            <AvReadings />
          </div>
          <aside data-coach-target="controls" className="flex flex-col gap-4">
            <FeatureInspector />
            <ClampTray />
            <ConnectedDiagnosticsFeed />
          </aside>
        </div>
      </main>
    </>
  );
}
