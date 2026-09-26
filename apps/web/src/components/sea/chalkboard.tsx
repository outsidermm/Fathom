import type { ReactNode } from "react";
import styles from "./sea.module.css";

export function Chalkboard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`${styles.chalkboard} ${className}`}>{children}</div>;
}
