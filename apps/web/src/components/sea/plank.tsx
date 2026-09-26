import type { ReactNode } from "react";
import styles from "./sea.module.css";

export function Plank({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`${styles.plank} ${className}`}>{children}</div>;
}
