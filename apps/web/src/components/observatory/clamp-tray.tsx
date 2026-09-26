"use client";

import { PanelEmptyState } from "./panel-empty-state";
import { Button } from "@/components/ui/button";
import { STEERING_ENABLED } from "@/lib/contract";
import { useStreamStore } from "@/lib/stream-store";

export function ClampTray() {
  const clamps = useStreamStore((state) => state.clamps);
  const features = useStreamStore((state) => state.features);
  const setClamp = useStreamStore((state) => state.setClamp);
  const reset = useStreamStore((state) => state.resetClamps);
  const entries = Object.entries(clamps).filter(([, value]) => value !== 0);
  return (
    <section
      className="rounded-xl bg-sand-light p-4"
      aria-label="Pending clamps"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-ui text-base font-bold text-ink">Clamp tray</h2>
        {entries.length > 0 && (
          <Button variant="link" size="xs" onClick={reset}>
            Reset all
          </Button>
        )}
      </div>
      {entries.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {entries.map(([id, value]) => (
            <span
              key={id}
              className={`inline-flex items-center gap-1 rounded-full border-2 bg-paper px-2 py-1 text-xs ${value > 0 ? "border-clamp-up" : "border-clamp-down"}`}
            >
              {features[id]?.label ?? id} {value > 0 ? "+" : ""}
              {value.toFixed(1)}
              <button
                type="button"
                onClick={() => setClamp(id, 0)}
                className="rounded px-1 focus-visible:outline-2 focus-visible:outline-harbor"
                aria-label={`Remove clamp for ${features[id]?.label ?? id}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <PanelEmptyState>
          {STEERING_ENABLED
            ? "No clamps selected."
            : "Feature controls aren't available yet. Try an idea bubble or write a direction in the ocean."}
        </PanelEmptyState>
      )}
    </section>
  );
}
