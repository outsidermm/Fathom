import type { ReactNode } from "react";
import styles from "./sea.module.css";
import { WaveDivider } from "./wave-divider";

export function DeepViewport({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`${styles.deepViewport} ${className}`}>
      <WaveDivider className={styles.deepWave} />
      <div className={styles.deepContent}>{children}</div>
    </div>
  );
}
