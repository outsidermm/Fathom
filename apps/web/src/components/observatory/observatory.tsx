"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { TopBar } from "@/components/observatory/top-bar";
import { PromptConsole } from "@/components/observatory/prompt-console";
import { TokenStream } from "@/components/observatory/token-stream";
import { ConnectedFeatureMap } from "@/components/observatory/connected-deep";
import { CoachMarks } from "@/components/observatory/coach-marks";
import { ThoughtCurrent } from "@/components/observatory/thought-current/thought-current";
import { mountStreamConnection, useStreamStore } from "@/lib/stream-store";

// `?features=test` shows the fish-brain feature map with a fake layout.
function useFeatureTestFlag() {
  return useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("features") === "test",
    () => false,
  );
}

export function Observatory() {
  const [prompt, setPrompt] = useState("");
  const paused = useStreamStore((state) => state.paused);
  const start = useStreamStore((state) => state.start);
  // The fish-brain map only has something to show once the API streams
  // activations (or with the test layout); until then the page fits one screen.
  const liveActivations = useStreamStore((state) => state.hasLiveActivations);
  const showInternals = useFeatureTestFlag() || liveActivations;
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
        className={`mx-auto flex w-full max-w-[1800px] flex-col gap-3 bg-sand p-3 text-ink sm:px-4 ${showInternals ? "min-h-svh" : "min-h-svh lg:h-svh"} ${paused ? "motion-paused" : ""}`}
      >
        <CoachMarks />
        <TopBar>
          <PromptConsole prompt={prompt} onPromptChange={setPrompt} />
        </TopBar>
        <div className={`grid gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(360px,1fr)] ${showInternals ? "lg:h-[calc(100svh-7rem)]" : "min-h-0 flex-1"}`}>
          <div className="relative h-[62svh] min-h-[460px] lg:h-auto">
            <ThoughtCurrent
              paused={paused}
              onSample={(sample) => {
                setPrompt(sample);
                start(sample, "qwen2.5-7b");
              }}
            />
          </div>
          <TokenStream />
        </div>
        {showInternals && (
          <section aria-label="Feature map">
            <ConnectedFeatureMap paused={paused} model="qwen2.5-7b" />
          </section>
        )}
      </main>
    </>
  );
}
