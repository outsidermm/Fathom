"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { fakeActivationBus, MOCK_FEATURES } from "./fake-activation-bus";
import { FeatureMap } from "./feature-map";
import styles from "./feature-map-demo.module.css";

export function FeatureMapDemo() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => () => fakeActivationBus.stop(), []);

  function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = inputRef.current?.value.trim();
    if (!prompt) return;
    fakeActivationBus.start(prompt, () => setRunning(false));
    setRunning(true);
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
      <div className={styles.viewport}>
        <FeatureMap features={MOCK_FEATURES} source={fakeActivationBus} />
      </div>
    </div>
  );
}
