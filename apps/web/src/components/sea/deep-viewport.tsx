import type { ReactNode } from "react";
import styles from "./sea.module.css";
import { WaveDivider } from "./wave-divider";
import { SeaLife } from "./sea-life";

export function DeepViewport({ children, className = "", paused = false }: { children: ReactNode; className?: string; paused?: boolean }) {
  return (
    <div className={`${styles.deepViewport} ${className}`}>
      <WaveDivider className={styles.deepWave} paused={paused} />
      <SeaLife paused={paused} />
      <div className={styles.deepContent}>{children}</div>
    </div>
  );
}
