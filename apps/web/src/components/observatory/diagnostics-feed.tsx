"use client";

import * as Accordion from "@radix-ui/react-accordion";
import { memo, useMemo } from "react";

import type { ActivationSource, MapActivation, MapFeature, MapFlag, MapToken } from "./feature-map/fake-activation-bus";
import styles from "./diagnostics-feed.module.css";

const percent = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 0 });
const strength = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function TopFeatures({ runId, flag, source, features, onSelectFeature }: {
  runId: string; flag: MapFlag; source: ActivationSource;
  features: ReadonlyMap<string, MapFeature>; onSelectFeature: (id: string | null) => void;
}) {
  const top = useMemo(() => {
    const unique = new Map<string, MapActivation>();
    for (const entry of source.forToken(runId, flag.tokenIndex)) {
      if (entry.value > (unique.get(entry.featureId)?.value ?? -1)) unique.set(entry.featureId, entry);
    }
    return [...unique.values()].sort((a, b) => b.value - a.value || a.featureId.localeCompare(b.featureId)).slice(0, 3);
  }, [runId, flag.tokenIndex, source]);

  return (
    <div className={styles.details}>
      <p>Strongest features on this token</p>
      {top.length ? <ol>{top.map((entry) => (
        <li key={entry.featureId}>
          <button type="button" className={styles.feature} onClick={() => onSelectFeature(entry.featureId)}>
            <span>{features.get(entry.featureId)?.label ?? entry.featureId}</span>
            <span className={styles.value}>{strength.format(entry.value)}</span>
          </button>
          {entry.explanation ? <p className={styles.explanation}>{entry.explanation}</p> : null}
        </li>
      ))}</ol> : <p>No activation details were captured for this token.</p>}
    </div>
  );
}

export const DiagnosticsFeed = memo(function DiagnosticsFeed({
  activeRunId, flags, tokens, features, source, onSelectFeature, headingLevel = 3,
}: {
  activeRunId: string | null; flags: readonly MapFlag[]; tokens: readonly MapToken[];
  features: readonly MapFeature[]; source: ActivationSource;
  onSelectFeature: (id: string | null) => void;
  headingLevel?: 3 | 4;
}) {
  const Heading = headingLevel === 4 ? "h4" : "h3";
  const byId = useMemo(() => new Map(features.map((feature) => [feature.id, feature])), [features]);
  const tokensByIndex = useMemo(() => new Map(tokens.map((token) => [token.index, token.text])), [tokens]);

  if (!activeRunId || flags.length === 0) {
    return <p className={styles.empty}>{activeRunId ? "No flags in this run." : "Run a prompt to see flagged tokens here."}</p>;
  }

  return (
    <div className={styles.feed}>
      <p className={styles.summary} role="status">{flags.length} flagged {flags.length === 1 ? "token" : "tokens"}</p>
      <Accordion.Root key={activeRunId} type="multiple" className={styles.accordion}>
        {flags.map((flag, index) => (
          <Accordion.Item key={`${flag.tokenIndex}:${flag.signature}:${index}`}
            value={`${flag.tokenIndex}:${flag.signature}:${index}`} className={styles.item}>
            <Accordion.Header asChild><Heading className={styles.heading}>
              <Accordion.Trigger className={styles.trigger}>
                <span className={styles.flagIcon} aria-hidden="true">⚠</span>
                <span className={styles.label}>{flag.signature} · {percent.format(flag.confidence)}
                  <span className={styles.token}>Token {flag.tokenIndex + 1} “{tokensByIndex.get(flag.tokenIndex) ?? "…"}”</span>
                </span>
                <span className={styles.chevron} aria-hidden="true">⌄</span>
              </Accordion.Trigger>
            </Heading></Accordion.Header>
            <Accordion.Content className={styles.content}>
              <TopFeatures runId={activeRunId} flag={flag} source={source} features={byId} onSelectFeature={onSelectFeature} />
            </Accordion.Content>
          </Accordion.Item>
        ))}
      </Accordion.Root>
    </div>
  );
});
