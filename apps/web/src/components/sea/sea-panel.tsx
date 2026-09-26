import type { ReactNode } from "react";
import styles from "./sea.module.css";

export function SeaPanel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`${styles.seaPanel} ${className}`}>
      <svg aria-hidden="true" className={styles.seaCaustics} preserveAspectRatio="xMidYMid slice" viewBox="0 0 600 260">
        <g fill="none" stroke="var(--foam, #fff)" strokeLinecap="round" strokeWidth="3">
          <path d="M-40 38 Q18 9 78 34 T196 32 T314 34 T432 32 T550 34 T668 32" opacity=".19" />
          <path d="M-70 92 Q-10 63 51 88 T172 86 T293 88 T414 86 T535 88 T656 86" opacity=".13" />
          <path d="M-20 151 Q40 123 101 148 T222 146 T343 148 T464 146 T585 148 T706 146" opacity=".17" />
          <path d="M-70 212 Q-10 183 51 208 T172 206 T293 208 T414 206 T535 208 T656 206" opacity=".12" />
        </g>
      </svg>
      <div className={styles.seaPanelContent}>{children}</div>
    </div>
  );
}
