"use client";

import { useSyncExternalStore } from "react";

// `?features=test` shows the fish-brain feature map with a clustered test layout.
export function useFeatureTestFlag() {
  return useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("features") === "test",
    () => false,
  );
}
