import styles from "./sea.module.css";

export function WaveDivider({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`${styles.wave} ${className}`}
      preserveAspectRatio="none"
      viewBox="0 0 1200 68"
    >
      <g className={styles.waveBack}>
        <path
          d="M0 28 C100 6 200 6 300 28 S500 50 600 28 S800 6 900 28 S1100 50 1200 28 S1400 6 1500 28 S1700 50 1800 28 S2000 6 2100 28 S2300 50 2400 28"
          fill="none"
          stroke="var(--water-mid, #9fd5e6)"
          strokeWidth="22"
        />
      </g>
      <g className={styles.waveFront}>
        <path
          d="M0 35 C100 13 200 13 300 35 S500 57 600 35 S800 13 900 35 S1100 57 1200 35 S1400 13 1500 35 S1700 57 1800 35 S2000 13 2100 35 S2300 57 2400 35"
          fill="none"
          stroke="var(--water-deep, #5896ab)"
          strokeWidth="28"
        />
        <path
          d="M0 21 C100 -1 200 -1 300 21 S500 43 600 21 S800 -1 900 21 S1100 43 1200 21 S1400 -1 1500 21 S1700 43 1800 21 S2000 -1 2100 21 S2300 43 2400 21"
          fill="none"
          stroke="var(--foam, #fff)"
          strokeLinecap="round"
          strokeWidth="4"
        />
      </g>
    </svg>
  );
}
