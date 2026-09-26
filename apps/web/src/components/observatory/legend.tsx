import styles from "./legend.module.css";

export function Legend() {
  const glows = ["#1d6270", "#228596", "#25aabe", "#53cfdc", "#9deff3"];
  return (
    <aside className={styles.legend} aria-label="Feature map legend">
      <p className={styles.caption}>Activation</p>
      <div className={styles.strength}>
        <span>Weak</span>
        <span className={styles.ramp} aria-hidden="true">
          {glows.map((fallback, index) => <span key={fallback} style={{ background: `var(--glow-${index + 1}, ${fallback})` }} />)}
        </span>
        <span>Strong</span>
      </div>
      <div className={styles.keys}>
        <span><b className={styles.alert} aria-hidden="true">⚠</b>Flagged</span>
      </div>
    </aside>
  );
}
