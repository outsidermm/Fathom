import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import styles from "./sea.module.css";

type PaperNoteProps = {
  children: ReactNode;
  title?: string;
  rotate?: number;
  pin?: boolean;
  className?: string;
} & HTMLAttributes<HTMLElement>;

export function PaperNote({ children, title, rotate = -1, pin = true, className = "", ...rest }: PaperNoteProps) {
  const style = { "--note-rotate": `${Math.max(-1.5, Math.min(1.5, rotate))}deg` } as CSSProperties;
  return (
    <section className={`${styles.paperNote} ${className}`} style={style} {...rest}>
      {pin ? <span className={styles.paperNotePin} aria-hidden="true" /> : null}
      {title ? <h3 className={styles.paperTitle}>{title}</h3> : null}
      {children}
    </section>
  );
}
