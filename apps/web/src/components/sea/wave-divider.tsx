import { cn } from "@/lib/utils";

/** Two slow, offset foam layers mark the boundary between Surface and Deep. */
export function WaveDivider({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none relative h-12 w-full overflow-hidden", className)}
    >
      <svg
        viewBox="0 0 2880 48"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-[200%] animate-[drift_14s_linear_infinite] opacity-50"
      >
        <path
          d="M0 25 C180 5 360 45 540 25 S900 5 1080 25 S1260 45 1440 25 C1620 5 1800 45 1980 25 S2340 5 2520 25 S2700 45 2880 25 V48 H0Z"
          fill="var(--water-deep)"
        />
        <path
          d="M0 25 C180 5 360 45 540 25 S900 5 1080 25 S1260 45 1440 25 C1620 5 1800 45 1980 25 S2340 5 2520 25 S2700 45 2880 25"
          fill="none"
          stroke="var(--foam)"
          strokeWidth="3"
        />
      </svg>
      <svg
        viewBox="0 0 2880 48"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-[200%] animate-[drift_14s_linear_infinite_reverse]"
      >
        <path
          d="M0 31 C240 12 480 42 720 31 S1200 12 1440 31 C1680 12 1920 42 2160 31 S2640 12 2880 31 V48 H0Z"
          fill="var(--trench)"
        />
        <path
          d="M0 31 C240 12 480 42 720 31 S1200 12 1440 31 C1680 12 1920 42 2160 31 S2640 12 2880 31"
          fill="none"
          stroke="var(--foam)"
          strokeWidth="3"
        />
      </svg>
    </div>
  );
}
