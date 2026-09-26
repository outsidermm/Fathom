import type { HTMLAttributes, ReactNode } from "react";
import styles from "./sea.module.css";

type PaperNoteProps = {
  children: ReactNode;
  title?: string;
  pin?: boolean;
  className?: string;
} & HTMLAttributes<HTMLElement>;

export function PaperNote({ children, title, pin = true, className = "", ...rest }: PaperNoteProps) {
  return (
    <section className={`${styles.paperNote} ${className}`} {...rest}>
      {pin ? <span className={styles.paperNotePin} aria-hidden="true" /> : null}
      {title ? <h3 className={styles.paperTitle}>{title}</h3> : null}
      {children}
    </section>
  );
}
