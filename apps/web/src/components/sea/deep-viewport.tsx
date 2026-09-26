import type { ReactNode } from "react";
import styles from "./sea.module.css";
import { WaveDivider } from "./wave-divider";
import { SeaLife } from "./sea-life";

/**
 * `receded` fogs the sea life so data drawn over it reads first; `attractor`
 * (fractions of the viewport) draws a couple of fish to circle that point.
 */
export function DeepViewport({ children, className = "", paused = false, receded = false, attractor = null }: {
  children: ReactNode; className?: string; paused?: boolean; receded?: boolean; attractor?: { x: number; y: number } | null;
}) {
  return (
    <div className={`${styles.deepViewport} ${className}`}>
      <WaveDivider className={styles.deepWave} paused={paused} />
      <SeaLife paused={paused} receded={receded} attractor={attractor} />
      <div className={styles.deepContent}>{children}</div>
    </div>
  );
}
