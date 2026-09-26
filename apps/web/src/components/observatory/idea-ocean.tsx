"use client";

import { useState, type FormEvent } from "react";
import { ArrowUpRight, Compass, Send } from "lucide-react";
import { DeepViewport } from "@/components/sea/deep-viewport";
import { useStreamStore, type Reading } from "@/lib/stream-store";
import styles from "./idea-ocean.module.css";

const EMPTY_READINGS: Record<number, Reading> = {};

export function IdeaOcean({ paused }: { paused: boolean }) {
  const runId = useStreamStore((state) => state.activeRunId);
  const readings = useStreamStore((state) =>
    state.runs.find((run) => run.id === state.activeRunId)?.readings ?? EMPTY_READINGS,
  );
  const status = useStreamStore((state) =>
    state.runs.find((run) => run.id === state.activeRunId)?.status,
  );
  const direction = useStreamStore((state) =>
    state.runs.find((run) => run.id === state.activeRunId)?.direction,
  );
  const connection = useStreamStore((state) => state.connection);
  const startGuided = useStreamStore((state) => state.startGuided);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<number | null>(null);
  const [customDirection, setCustomDirection] = useState("");
  const [error, setError] = useState("");

  const ordered = Object.values(readings).sort((a, b) => a.checkpointId - b.checkpointId);
  const observed = ordered.filter((reading) => !reading.error);
  const current = observed.at(-1);
  const earlier = observed.slice(0, -1).slice(-4);
  const selected = ordered.find((reading) => reading.checkpointId === selectedCheckpoint) ?? current;
  const alternatives = current?.alternatives ?? [];

  function guide(text: string) {
    if (connection !== "open") {
      setError("Reconnect to try a new direction.");
      return;
    }
    if (!startGuided(text)) {
      setError("This direction is too long for the current request. Shorten it and try again.");
      return;
    }
    setError("");
    setCustomDirection("");
    setSelectedCheckpoint(null);
  }

  function submitCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (customDirection.trim()) guide(customDirection);
  }

  return (
    <DeepViewport className={styles.ocean}>
      <section className={`${styles.layout} ${paused ? styles.paused : ""}`} aria-labelledby="idea-ocean-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Live interpretation</p>
            <h2 id="idea-ocean-title" className={styles.title}>Ideas in motion</h2>
            <p className={styles.subtitle}>A snapshot of the model&apos;s direction as its answer unfolds.</p>
          </div>
          <span className={styles.status} role="status">
            {status === "streaming" ? "Following the answer" : status === "done" ? "Answer complete" : status === "error" ? "Answer interrupted" : runId ? "Waiting for the answer" : "Ready when you are"}
          </span>
        </header>

        <div className={styles.field}>
          <div className={styles.trail} aria-label="Earlier observed directions">
            <span className={styles.groupLabel}>Earlier ideas</span>
            {earlier.length ? earlier.map((reading) => (
              <button
                key={reading.checkpointId}
                type="button"
                className={`${styles.bubble} ${styles.pastBubble}`}
                onClick={() => setSelectedCheckpoint(reading.checkpointId)}
                aria-label={`Read earlier direction: ${reading.focus ?? reading.label}`}
              >
                <span className={styles.bubbleKind}>{reading.label}</span>
                <span className={styles.bubbleText}>{reading.focus ?? "No clear focus"}</span>
              </button>
            )) : <p className={styles.waiting}>Past readings will appear here.</p>}
          </div>

          <div className={styles.center}>
            {current ? (
              <>
                <p className={styles.currentCaption} aria-live="polite">Current observed direction · {current.label}</p>
                <button
                  type="button"
                  className={`${styles.bubble} ${styles.currentBubble}`}
                  onClick={() => setSelectedCheckpoint(current.checkpointId)}
                  aria-label={`Read current direction: ${current.focus ?? current.label}`}
                >
                  <Compass aria-hidden="true" size={25} />
                  <span className={styles.bubbleText}>{current.focus ?? "No clear focus"}</span>
                  <span className={styles.bubbleHint}>Observed from a model-state snapshot</span>
                </button>
              </>
            ) : (
              <div className={styles.empty} role="status">
                <Compass aria-hidden="true" size={30} />
                <p>{ordered.some((reading) => reading.error) ? "No interpretation was available for this section." : runId ? "Waiting for the first model-state reading…" : "Ask a question to watch ideas appear."}</p>
              </div>
            )}
          </div>

          <div className={styles.alternatives} aria-label="Suggested directions">
            <span className={styles.groupLabel}>Other possible directions</span>
            {alternatives.length ? alternatives.map((alternative) => (
              <button
                key={`${current?.checkpointId}-${alternative.id}`}
                type="button"
                className={`${styles.bubble} ${styles.optionBubble}`}
                onClick={() => guide(`${alternative.focus}. ${alternative.detail}`)}
                disabled={connection !== "open"}
                aria-label={`Start a new answer about ${alternative.focus}`}
              >
                <span className={styles.bubbleText}>{alternative.focus}</span>
                <span className={styles.bubbleHint}>Try this direction <ArrowUpRight aria-hidden="true" size={14} /></span>
              </button>
            )) : <p className={styles.waiting}>{current && status === "streaming" ? "Finding other directions…" : "Suggestions appear after a reading."}</p>}
          </div>
        </div>

        {selected && (
          <div className={styles.readingDetail}>
            <strong>{selected.checkpointId === current?.checkpointId ? "Current reading" : `${selected.label} reading`}</strong>
            <span>{selected.detail || "No further detail available."}</span>
          </div>
        )}

        <form className={styles.guideForm} onSubmit={submitCustom}>
          <label htmlFor="idea-direction" className={styles.guideLabel}>Want a different direction?</label>
          <div className={styles.guideRow}>
            <input
              id="idea-direction"
              type="text"
              value={customDirection}
              onChange={(event) => setCustomDirection(event.target.value)}
              maxLength={500}
              placeholder="e.g. Focus on the hidden costs"
              disabled={!runId}
              className={styles.guideInput}
            />
            <button type="submit" className={styles.guideButton} disabled={!runId || !customDirection.trim() || connection !== "open"}>
              <Send aria-hidden="true" size={16} /> Try direction
            </button>
          </div>
          <p className={styles.disclosure}>Suggestions come from Qwen. Readings are approximate, not literal thoughts. Choosing a direction starts a new answer.</p>
          {direction && <p className={styles.activeDirection} role="status">New answer guided toward: {direction}</p>}
          {error && <p className={styles.error} role="alert">{error}</p>}
        </form>
      </section>
    </DeepViewport>
  );
}
