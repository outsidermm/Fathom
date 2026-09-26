"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Command, defaultFilter } from "cmdk";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import type { MapFeature } from "./feature-map/fake-activation-bus";
import styles from "./feature-search.module.css";

type SearchFeature = Pick<MapFeature, "id" | "label" | "cluster" | "description">;

export function FeatureSearch({ features, onSelectFeature }: {
  features: readonly SearchFeature[];
  onSelectFeature: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);
  const results = useMemo(() => {
    const scored = features.map((feature) => ({
      feature,
      score: deferredQuery.trim()
        ? defaultFilter(feature.label, deferredQuery.trim(), [feature.cluster, feature.description ?? "", feature.id])
        : 1,
    })).filter((entry) => entry.score > 0);
    scored.sort((a, b) => b.score - a.score || a.feature.label.localeCompare(b.feature.label));
    return { total: scored.length, visible: scored.slice(0, 50).map((entry) => entry.feature) };
  }, [features, deferredQuery]);

  useEffect(() => {
    function shortcut(event: globalThis.KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.repeat) {
        event.preventDefault();
        setQuery("");
        setOpen((previous) => !previous);
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  function changeOpen(value: boolean) {
    setQuery("");
    setOpen(value);
  }

  return (
    <div className={styles.root}>
      <div ref={setPortalContainer} className={styles.portalHost} />
      <Dialog.Root open={open} onOpenChange={changeOpen}>
        <Dialog.Trigger asChild>
          <Button type="button" variant="outline" aria-keyshortcuts="Meta+K Control+K">Search Features <kbd>⌘ / Ctrl K</kbd></Button>
        </Dialog.Trigger>
        <Dialog.Portal container={portalContainer ?? undefined}>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content className={styles.dialog} onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }}>
            <div className={styles.header}>
              <Dialog.Title className={styles.title}>Search Features</Dialog.Title>
              <Dialog.Close asChild><Button type="button" variant="ghost" aria-label="Close feature search">×</Button></Dialog.Close>
            </div>
            <Dialog.Description className={styles.description}>Find a feature by label, cluster, or description. Arrow keys explore; Enter selects.</Dialog.Description>
            <Command label="Feature search results" shouldFilter={false} loop vimBindings={false}>
              <Command.Input ref={inputRef} className={styles.input} value={query} onValueChange={setQuery}
                aria-label="Search labels, clusters, or descriptions" name="feature-search" autoComplete="off"
                placeholder="Search labels, clusters, or descriptions…" />
              <Command.List className={styles.list} aria-busy={query !== deferredQuery}>
                <Command.Empty className={styles.empty}>{features.length ? "No matching features. Try another label or cluster." : "Feature definitions have not arrived yet."}</Command.Empty>
                {results.visible.map((feature) => (
                  <Command.Item key={feature.id} value={feature.id} asChild className={styles.item}
                    onSelect={() => { onSelectFeature(feature.id); changeOpen(false); }}>
                    <button type="button">
                      <span className={styles.itemTop}><strong>{feature.label}</strong><span className={styles.cluster}>{feature.cluster}</span></span>
                      <span className={styles.itemDescription}>{feature.description || "No description provided."}</span>
                      <span className={styles.id}>{feature.id}</span>
                    </button>
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
            <p className={styles.footer} role="status">{results.total > 50 ? `Showing 50 of ${results.total} matches. Type more to narrow the list.` : `${results.total} ${results.total === 1 ? "feature" : "features"} found`} · Esc closes</p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
