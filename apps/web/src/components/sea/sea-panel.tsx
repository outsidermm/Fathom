import type { ReactNode } from "react";
import styles from "./sea.module.css";

export function SeaPanel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`${styles.seaPanel} ${className}`}>{children}</div>;
}
