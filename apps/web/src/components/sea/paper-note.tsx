import type { CSSProperties, HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function PaperNote({
  className,
  children,
  rotate = 0,
  pin = true,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  rotate?: number;
  pin?: boolean;
}) {
  const angle = Math.max(-1.5, Math.min(1.5, rotate));
  return (
    <div
      className={cn(
        "paper-note relative rounded-[4px] bg-paper p-5 text-driftwood shadow-[0_10px_24px_rgb(80_49_32_/_0.18)]",
        pin &&
          "before:absolute before:left-1/2 before:top-2 before:size-2 before:-translate-x-1/2 before:rounded-full before:bg-coral before:shadow-[0_1px_2px_rgb(80_49_32_/_0.35)]",
        className
      )}
      style={{ "--paper-rotate": `${angle}deg`, ...style } as CSSProperties}
      {...props}
    >
      {children}
    </div>
  );
}
