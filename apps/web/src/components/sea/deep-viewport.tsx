import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";
import { WaveDivider } from "@/components/sea/wave-divider";

export function DeepViewport({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative h-full min-h-0 w-full overflow-hidden bg-[linear-gradient(180deg,var(--trench),var(--deep)_45%,var(--abyss))] text-deep-ink",
        className
      )}
      {...props}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-1/3 bg-[radial-gradient(ellipse_at_20%_0%,rgb(255_255_255_/_0.08),transparent_55%),radial-gradient(ellipse_at_80%_15%,rgb(255_255_255_/_0.05),transparent_48%)] animate-[bob_3.2s_ease-in-out_infinite_alternate]"
      />
      <WaveDivider className="absolute inset-x-0 top-0 z-10" />
      <div className="relative h-full w-full">{children}</div>
    </div>
  );
}
