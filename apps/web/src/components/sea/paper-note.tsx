import type { CSSProperties, ReactNode } from "react";
import styles from "./sea.module.css";

type PaperNoteProps = {
  children: ReactNode;
  title?: string;
  rotate?: number;
  pin?: boolean;
  className?: string;
};

export function PaperNote({ children, title, rotate = -1, pin = true, className = "" }: PaperNoteProps) {
  const style = { "--note-rotate": `${Math.max(-1.5, Math.min(1.5, rotate))}deg` } as CSSProperties;
  return (
    <section className={`${styles.paperNote} ${className}`} style={style}>
      {pin ? <span className={styles.paperNotePin} aria-hidden="true" /> : null}
      {title ? <h3 className={styles.paperTitle}>{title}</h3> : null}
      {children}
    </section>
  );
}
