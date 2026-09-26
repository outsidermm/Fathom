"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { fakeActivationBus, MOCK_FEATURES, type MapFlag, type MapToken } from "./fake-activation-bus";
import { FeatureMap } from "./feature-map";
import styles from "./feature-map-demo.module.css";

export function FeatureMapDemo() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clamps, setClamps] = useState<Record<string, number>>({});
  const [tokens, setTokens] = useState<MapToken[]>([]);
  const [flags, setFlags] = useState<MapFlag[]>([]);
  const [hoveredToken, setHoveredToken] = useState<number | null>(null);
  const selectedFeature = MOCK_FEATURES.find((feature) => feature.id === selectedId);

  useEffect(() => () => fakeActivationBus.stop(), []);

  function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = inputRef.current?.value.trim();
    if (!prompt) return;
    setTokens([]);
    setFlags([]);
    setHoveredToken(null);
    setRunId(fakeActivationBus.start(prompt, () => setRunning(false), (token, newFlags) => {
      setTokens((previous) => [...previous, token]);
      if (newFlags.length) setFlags((previous) => [...previous, ...newFlags]);
    }));
    setRunning(true);
  }

  function setSampleClamp(value: number) {
    if (!selectedId) return;
    setClamps((previous) => {
      const next = { ...previous };
      if (value === 0) delete next[selectedId];
      else next[selectedId] = value;
      return next;
    });
  }

  function stop() {
    fakeActivationBus.stop();
    setRunning(false);
  }

  return (
    <div>
      <form className={styles.controls} onSubmit={run}>
        <label className={styles.field} htmlFor="feature-map-sample-prompt">
          Sample Prompt
          <Input
            ref={inputRef}
            id="feature-map-sample-prompt"
            name="feature-map-sample-prompt"
            autoComplete="off"
            defaultValue="Explain why the sky is blue"
            required
          />
        </label>
        <Button type="submit">Run Sample Stream</Button>
        <Button type="button" variant="outline" onClick={stop} disabled={!running}>Stop</Button>
        <span className={styles.status} role="status" aria-live="polite">
          {running ? "Sample streaming…" : "Ready"}
        </span>
      </form>
      <div className={styles.sampleControls}>
        <p>{selectedFeature ? `Selected: ${selectedFeature.label}` : "Select a dot to try its sample clamp rings."}</p>
        <Button type="button" variant="outline" disabled={!selectedId} onClick={() => setSampleClamp(.8)}>Sample Clamp +0.8</Button>
        <Button type="button" variant="outline" disabled={!selectedId} onClick={() => setSampleClamp(-.6)}>Sample Clamp −0.6</Button>
        <Button type="button" variant="ghost" disabled={!selectedId || !clamps[selectedId]} onClick={() => setSampleClamp(0)}>Clear Clamp</Button>
      </div>
      <div className={styles.viewport}>
        <FeatureMap features={MOCK_FEATURES} source={fakeActivationBus}
          activeRunId={runId} selectedFeatureId={selectedId} onSelectFeature={setSelectedId}
          clamps={clamps} flags={flags} hoveredTokenIndex={hoveredToken} />
      </div>
      <div className={styles.tokens} aria-label="Sample tokens">
        <p>Sample Tokens · Hover or focus a word to isolate its features. These are demonstration events.</p>
        {tokens.length ? tokens.map((token) => {
          const flag = flags.find((entry) => entry.tokenIndex === token.index);
          return <button type="button" key={token.index} className={flag ? styles.flaggedToken : undefined}
            aria-label={`Token ${token.index + 1}: ${token.text}${flag ? `, flagged ${flag.signature}` : ""}`}
            aria-pressed={hoveredToken === token.index}
            onPointerEnter={() => setHoveredToken(token.index)} onPointerLeave={() => setHoveredToken(null)}
            onFocus={() => setHoveredToken(token.index)} onBlur={() => setHoveredToken(null)}
            onClick={() => setHoveredToken(token.index)}>
            {token.text}{flag ? <span aria-hidden="true"> ⚠</span> : null}
          </button>;
        }) : <span>Run a sample stream to see tokens here.</span>}
      </div>
    </div>
  );
}
