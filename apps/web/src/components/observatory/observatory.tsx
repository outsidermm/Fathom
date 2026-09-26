"use client";

import { useEffect, useState } from "react";
import { DeepViewport } from "@/components/sea/deep-viewport";
import { TopBar } from "@/components/observatory/top-bar";
import { PromptConsole } from "@/components/observatory/prompt-console";
import { TokenStream } from "@/components/observatory/token-stream";
import { FeatureMap } from "@/components/observatory/feature-map/feature-map";
import { FeatureInspector } from "@/components/observatory/feature-inspector";
import { ClampTray } from "@/components/observatory/clamp-tray";
import { Legend } from "@/components/observatory/legend";
import { mountStreamConnection } from "@/lib/stream-store";
import type { Model } from "@/lib/contract";

export function Observatory() {
  const [model, setModel] = useState<Model>("qwen2.5-7b");
  useEffect(() => mountStreamConnection(), []);
  return <>
    <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-paper focus:px-4 focus:py-2 focus:outline-3 focus:outline-harbor">Skip to content</a>
    <main id="main-content" className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 bg-sand px-4 py-4 text-ink sm:px-6">
      <TopBar model={model} onModelChange={setModel} />
      <PromptConsole model={model} />
      <div className="grid min-h-[560px] flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div className="grid min-h-[560px] grid-rows-[minmax(350px,1fr)_auto] gap-4">
          <DeepViewport className="min-h-[350px] rounded-[20px]"><FeatureMap /><Legend /></DeepViewport>
          <TokenStream />
        </div>
        <aside className="flex flex-col gap-4"><FeatureInspector /><ClampTray /></aside>
      </div>
    </main>
  </>;
}
