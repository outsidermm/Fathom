"use client";

import { memo, useCallback, useId, useMemo } from "react";
import { Pebbles } from "./decor/pebbles";
import { Shell } from "./decor/shell";
import { Starfish } from "./decor/starfish";
import { createSeabed } from "./seabed-layout";
import { useSeaScene } from "./use-sea-scene";
import styles from "./sea-life.module.css";

const DECORATIONS = { pebbles: Pebbles, shell: Shell, starfish: Starfish };

export const SeaLife = memo(function SeaLife({ paused = false, receded = false, attractor = null }: {
  paused?: boolean; receded?: boolean; attractor?: { x: number; y: number } | null;
}) {
  const id = useId();
  const layout = useMemo(() => createSeabed(id), [id]);
  const load = useCallback(async () => {
    const { createSeaScene } = await import("./sea-scene");
    return (host: HTMLDivElement, initiallyPaused: boolean) => createSeaScene(host, layout, initiallyPaused);
  }, [layout]);
  const hostRef = useSeaScene(load, paused, receded, attractor);

  return (
    <div ref={hostRef} className={styles.scene} aria-hidden="true" data-sea-life>
      <div className={styles.fallback}>
        {layout.map((decor, index) => {
          const Decoration = DECORATIONS[decor.kind];
          return <div key={index} className={styles.decoration}
            style={{ left: `${decor.x * 100}%`, bottom: `${decor.depth * 6 + 3}%`,
              opacity: .23, transform: `translateX(-50%) rotate(${decor.rotation}rad)` }}>
            <Decoration size={decor.size * 64} className={styles.settled} />
          </div>;
        })}
      </div>
    </div>
  );
});
