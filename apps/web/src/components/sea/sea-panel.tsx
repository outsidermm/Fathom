import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function SeaPanel({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl bg-water p-5 text-ink",
        "bg-[radial-gradient(ellipse_at_18%_24%,rgb(255_255_255_/_0.25)_0_2%,transparent_16%),radial-gradient(ellipse_at_67%_68%,rgb(255_255_255_/_0.22)_0_3%,transparent_19%),radial-gradient(ellipse_at_88%_12%,rgb(255_255_255_/_0.18)_0_2%,transparent_13%)]",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
