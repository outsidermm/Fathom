"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PaperNote } from "@/components/sea/paper-note";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "observatory:coachmarks-seen";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const steps = [
  {
    title: "This is the model's mind",
    body: "The map shows the concepts active in a model response.",
    target: "map",
  },
  {
    title: "Click a glowing feature",
    body: "Pick a bright dot to see the concept it represents.",
    target: "map",
  },
  {
    title: "Clamp it and rerun",
    body: "Change a feature's strength, then compare the next answer.",
    target: "controls",
  },
] as const;

type Position = { step: number; left: number; top: number };

function subscribeToSeen(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

function hasUnseenTour() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

function serverHasUnseenTour() {
  return false;
}

export function CoachMarks() {
  const unseen = useSyncExternalStore(subscribeToSeen, hasUnseenTour, serverHasUnseenTour);
  const [step, setStep] = useState<number | null>(0);
  const [position, setPosition] = useState<Position | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION_QUERY).matches,
  );
  const noteRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReducedMotion(reduced.matches);
    reduced.addEventListener("change", onChange);
    return () => reduced.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!unseen || step === null) return;
    const target = document.querySelector<HTMLElement>(
      `[data-coach-target="${steps[step].target}"]`,
    );
    if (!target) return;

    const targetRect = target.getBoundingClientRect();
    if (targetRect.bottom < 80 || targetRect.top > window.innerHeight - 80) {
      target.scrollIntoView({ block: "center", behavior: reducedMotion ? "instant" : "smooth" });
    }

    let frame = 0;
    const updatePosition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = target.getBoundingClientRect();
        const width = Math.min(300, window.innerWidth - 32);
        const height = noteRef.current?.getBoundingClientRect().height ?? 190;
        let left: number;
        let top: number;

        if (step === 0) {
          left = rect.left + 20;
          top = rect.top + 62;
        } else if (step === 1) {
          left = rect.right - width - 20;
          top = rect.top + rect.height * 0.45;
        } else {
          left = rect.left - width - 16;
          if (left < 16) {
            left = rect.left + 12;
            top = rect.top - height - 16;
          } else {
            top = rect.top + 105;
          }
        }

        setPosition({
          step,
          left: Math.max(16, Math.min(left, window.innerWidth - width - 16)),
          top: Math.max(16, Math.min(top, window.innerHeight - height - 16)),
        });
      });
    };
    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(target);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [step, reducedMotion, unseen]);

  useEffect(() => {
    if (unseen && step !== null && position?.step === step) {
      if (step === 0 && previousFocus.current === null) {
        previousFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
      }
      primaryRef.current?.focus();
    }
  }, [step, position?.step, unseen]);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Dismiss the tour even if storage becomes unavailable.
    }
    setStep(null);
    setPosition(null);
    previousFocus.current?.focus();
  }, []);

  useEffect(() => {
    if (!unseen || step === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [step, unseen, dismiss]);

  if (!unseen || step === null || position?.step !== step) return null;
  const current = steps[step];
  return (
    <div className="pointer-events-none fixed inset-0 z-50" aria-live="polite">
      <div
        ref={noteRef}
        role="group"
        aria-labelledby="coach-mark-title"
        aria-describedby="coach-mark-body"
        className={`pointer-events-auto absolute w-[min(300px,calc(100vw-32px))] ${reducedMotion ? "" : "animate-[settle_320ms_ease-out_both]"}`}
        style={{ left: position.left, top: position.top }}
      >
        <PaperNote
          pin
          className="max-h-[calc(100vh-32px)] overflow-auto pt-7"
        >
          <p className="font-mono text-xs text-muted-foreground">
            {step + 1} of {steps.length}
          </p>
          <h2 id="coach-mark-title" className="mt-1 font-ui text-lg font-bold text-harbor">
            {current.title}
          </h2>
          <p id="coach-mark-body" className="mt-2 text-sm text-driftwood">
            {current.body}
          </p>
          <div className="mt-4 flex items-center justify-between gap-3">
            <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
              Skip
            </Button>
            <Button
              ref={primaryRef}
              type="button"
              size="sm"
              onClick={() => {
                if (step === steps.length - 1) dismiss();
                else setStep(step + 1);
              }}
            >
              {step === steps.length - 1 ? "Got it" : "Next"}
            </Button>
          </div>
        </PaperNote>
      </div>
    </div>
  );
}
