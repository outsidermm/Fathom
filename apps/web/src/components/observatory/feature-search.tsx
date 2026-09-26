"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { activationBus, useStreamStore } from "@/lib/stream-store";

function matchScore(text: string, query: string) {
  if (!query) return 0;
  const source = text.toLowerCase(),
    needle = query.toLowerCase();
  const exact = source.indexOf(needle);
  if (exact >= 0) return 100 - exact;
  let at = 0,
    gaps = 0;
  for (const letter of needle) {
    const next = source.indexOf(letter, at);
    if (next < 0) return -1;
    gaps += next - at;
    at = next + 1;
  }
  return 50 - gaps;
}
export function FeatureSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const features = useStreamStore((state) => state.features);
  const runId = useStreamStore((state) => state.activeRunId);
  const hasLiveActivations = useStreamStore(
    (state) => state.hasLiveActivations,
  );
  const select = useStreamStore((state) => state.selectFeature);
  const run = useStreamStore((state) =>
    state.runs.find((item) => item.id === state.activeRunId),
  );
  const ids = useMemo(
    () =>
      runId && run?.status !== "streaming"
        ? [
            ...new Set(
              activationBus.forRun(runId).map((entry) => entry.featureId),
            ),
          ]
        : [],
    [runId, run?.status],
  );
  const ready = hasLiveActivations && ids.length > 0;
  const visibleIds = useMemo(
    () =>
      ids
        .map((id) => ({
          id,
          score: matchScore(
            `${features[id]?.label ?? id} ${features[id]?.cluster ?? ""} ${features[id]?.description ?? ""}`,
            query,
          ),
        }))
        .filter((item) => item.score >= 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 50)
        .map((item) => item.id),
    [ids, features, query],
  );
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        ready
      ) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [ready]);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={!ready}
        title={
          !ready
            ? "Feature search will be available after a run with activation data finishes."
            : undefined
        }
      >
        <Search aria-hidden /> Search Features{" "}
        <kbd className="ml-1 font-mono text-xs">⌘K</kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setQuery("");
        }}
        shouldFilter={false}
        title="Search Features"
        description="Search observed features by label, cluster, or description"
      >
        <CommandInput
          name="feature-search"
          autoComplete="off"
          value={query}
          onValueChange={setQuery}
          placeholder="Search observed features…"
          aria-label="Search observed features"
        />
        <CommandList>
          <CommandEmpty>No matching observed feature.</CommandEmpty>
          <CommandGroup heading="Observed Features">
            {visibleIds.map((id) => {
              const feature = features[id];
              return (
                <CommandItem
                  key={id}
                  value={`${feature?.label ?? id} ${feature?.cluster ?? ""} ${feature?.description ?? ""}`}
                  onSelect={() => {
                    select(id);
                    setOpen(false);
                  }}
                >
                  {feature?.label ?? id}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {feature?.cluster ?? id}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
