import styles from "./decor.module.css";

export function Anglerfish({ size = 116, className = "" }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" className={`${styles.float} ${styles.delayed} ${className}`} width={size} height={size} viewBox="0 0 120 120">
      <path d="M26 67 Q11 54 7 42 Q24 38 37 48 Q52 30 79 39 Q102 44 104 65 Q101 88 73 91 Q47 94 30 78 Q18 86 7 82 Q14 69 26 67Z" fill="var(--water-deep, #5896ab)" stroke="var(--glow-2, #228596)" strokeWidth="3" strokeLinejoin="round" />
      <path d="M68 39 Q66 23 80 19 Q88 16 91 11" fill="none" stroke="var(--sea-glass, #72c3d5)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="93" cy="10" r="8" fill="var(--glow-5, #9deff3)" opacity=".35" />
      <circle cx="93" cy="10" r="4" fill="var(--glow-5, #9deff3)" />
      <circle cx="78" cy="59" r="7" fill="var(--deep-ink, #f6efec)" />
      <circle cx="80" cy="59" r="3" fill="var(--abyss, #061a26)" />
      <path d="M69 74 Q81 81 94 72" fill="none" stroke="var(--abyss, #061a26)" strokeWidth="3" strokeLinecap="round" />
      <path d="M52 43 Q51 32 57 27 M54 89 Q51 99 59 104" fill="none" stroke="var(--glow-2, #228596)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
