import styles from "./decor.module.css";

export function Pebbles({ size = 100, className = "" }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" className={`${styles.float} ${styles.later} ${className}`} width={size} height={size * 0.58} viewBox="0 0 100 58">
      <path d="M4 49 Q4 31 19 27 Q33 24 38 38 Q42 50 32 54 L13 54 Q7 54 4 49Z" fill="var(--crate, #c5a97c)" stroke="var(--driftwood, #503120)" strokeWidth="2" />
      <path d="M30 51 Q29 21 49 16 Q67 17 72 43 Q74 52 66 55 L39 55 Q34 55 30 51Z" fill="var(--sand-light, #f8eee1)" stroke="var(--plank-dark, #a45e37)" strokeWidth="2" />
      <path d="M65 50 Q68 34 81 32 Q93 32 96 48 Q97 54 88 55 L73 55 Q68 55 65 50Z" fill="var(--sea-glass, #72c3d5)" stroke="var(--ink, #055958)" strokeWidth="2" />
      <path d="M41 40 Q44 29 51 28 M12 44 Q15 36 21 35 M77 45 Q80 38 85 38" fill="none" stroke="var(--foam, #fff)" strokeWidth="2" strokeLinecap="round" opacity=".7" />
    </svg>
  );
}
