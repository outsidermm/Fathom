import styles from "./decor.module.css";

export function Shell({ size = 84, className = "" }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" className={`${styles.float} ${styles.delayed} ${className}`} width={size} height={size} viewBox="0 0 100 100">
      <path d="M12 71 C7 55 19 29 35 21 Q50 15 65 21 C81 29 93 55 88 71 Q73 77 50 75 Q27 77 12 71Z" fill="var(--shell, #e08b6a)" stroke="var(--plank-dark, #a45e37)" strokeWidth="3" />
      <path d="M50 73 L50 20 M50 72 Q36 45 35 23 M49 72 Q22 52 23 31 M51 72 Q64 45 65 23 M52 72 Q78 52 77 31" fill="none" stroke="var(--paper, #f6efec)" strokeWidth="2.5" strokeLinecap="round" opacity=".8" />
      <path d="M33 74 Q50 81 67 74 L63 85 Q50 90 37 85Z" fill="var(--coral, #e27459)" stroke="var(--plank-dark, #a45e37)" strokeWidth="3" />
    </svg>
  );
}
