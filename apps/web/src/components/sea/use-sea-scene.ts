"use client";

import { useEffect, useRef } from "react";
import type { SeaScene } from "./sea-renderer";

/**
 * Loads a WebGL scene only once its host nears the screen, keeps it in sync with `paused`,
 * and marks the host `data-renderer="fallback"` if the GPU path fails. `load` must be stable.
 */
export function useSeaScene(load: () => Promise<(host: HTMLDivElement, paused: boolean) => SeaScene>, paused: boolean) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SeaScene | null>(null);
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
    sceneRef.current?.setPaused(paused);
  }, [paused]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let loading = false;
    const observer = new IntersectionObserver(async ([entry]) => {
      if (!entry.isIntersecting || loading) return;
      loading = true;
      observer.disconnect();
      try {
        const create = await load();
        if (disposed) return;
        sceneRef.current = create(host, pausedRef.current);
      } catch {
        host.dataset.renderer = "fallback";
      }
    }, { rootMargin: "200px" });
    observer.observe(host);
    return () => {
      disposed = true;
      observer.disconnect();
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [load]);

  return hostRef;
}
