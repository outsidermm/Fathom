import styles from "./decor.module.css";

export function Starfish({ size = 82, className = "" }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" className={`${styles.float} ${className}`} width={size} height={size} viewBox="0 0 100 100">
      <path d="M50 8 Q54 8 57 17 L63 38 L85 34 Q94 33 95 40 Q96 45 87 50 L69 60 L80 79 Q85 88 79 92 Q74 96 67 89 L50 73 L33 89 Q26 96 21 92 Q15 88 20 79 L31 60 L13 50 Q4 45 5 40 Q6 33 15 34 L37 38 L43 17 Q46 8 50 8Z" fill="var(--starfish, #e5a83d)" stroke="var(--plank-dark, #a45e37)" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="43" cy="53" r="2" fill="var(--driftwood, #503120)" />
      <circle cx="57" cy="53" r="2" fill="var(--driftwood, #503120)" />
      <path d="M45 62 Q50 66 55 62" fill="none" stroke="var(--driftwood, #503120)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="49" cy="30" r="2" fill="var(--sand-light, #f8eee1)" opacity=".75" />
      <circle cx="29" cy="47" r="2" fill="var(--sand-light, #f8eee1)" opacity=".75" />
      <circle cx="70" cy="48" r="2" fill="var(--sand-light, #f8eee1)" opacity=".75" />
    </svg>
  );
}
