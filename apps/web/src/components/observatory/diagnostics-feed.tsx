"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { activationBus, useStreamStore } from "@/lib/stream-store";

export function DiagnosticsFeed() {
  const run = useStreamStore((state) =>
    state.runs.find((item) => item.id === state.activeRunId),
  );
  const features = useStreamStore((state) => state.features);
  const select = useStreamStore((state) => state.selectFeature);
  return (
    <section
      className="rounded-xl bg-sand-light p-4"
      aria-labelledby="diagnostics-title"
    >
      <h2
        id="diagnostics-title"
        className="font-ui text-base font-bold text-ink"
      >
        Diagnostics
      </h2>
      {!run?.flags.length ? (
        <p className="mt-2 font-body text-sm text-muted-foreground">
          No diagnostic flags from this run.
        </p>
      ) : (
        <Accordion type="single" collapsible className="mt-3">
          {run.flags.map((flag, index) => {
            const token =
              run.tokens.find((item) => item.index === flag.tokenIndex)?.text ??
              "";
            const top = activationBus
              .forToken(run.id, flag.tokenIndex)
              .sort((a, b) => b.value - a.value)
              .slice(0, 3);
            return (
              <AccordionItem
                key={`${flag.tokenIndex}-${flag.signature}-${index}`}
                value={`flag-${index}`}
              >
                <AccordionTrigger className="min-h-10 px-3 py-2 text-sm">
                  ⚠ {flag.signature} · {Math.round(flag.confidence * 100)}% ·
                  token {flag.tokenIndex} “{token.trim() || "—"}”
                </AccordionTrigger>
                <AccordionContent>
                  {top.length ? (
                    <>
                      <p className="mb-2 font-ui text-xs font-bold">
                        Top active features
                      </p>
                      <div className="flex flex-col items-start gap-1">
                        {top.map((entry) => (
                          <button
                            key={entry.featureId}
                            type="button"
                            onClick={() => select(entry.featureId)}
                            className="rounded px-2 py-1 text-left text-harbor underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-harbor"
                          >
                            {features[entry.featureId]?.label ??
                              entry.featureId}{" "}
                            · {Math.round(entry.value * 100)}%
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p>No activation data for this flagged token.</p>
                  )}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </section>
  );
}
