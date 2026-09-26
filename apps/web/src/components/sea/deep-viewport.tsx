import type { ReactNode } from "react";
import styles from "./sea.module.css";
import { WaveDivider } from "./wave-divider";
import { SeaLife } from "./sea-life";

/** `receded` fogs the sea life so data drawn over it (the feature map) reads first. */
export function DeepViewport({ children, className = "", paused = false, receded = false }: { children: ReactNode; className?: string; paused?: boolean; receded?: boolean }) {
  return (
    <div className={`${styles.deepViewport} ${className}`}>
      <WaveDivider className={styles.deepWave} paused={paused} />
      <SeaLife paused={paused} receded={receded} />
      <div className={styles.deepContent}>{children}</div>
    </div>
  );
}
