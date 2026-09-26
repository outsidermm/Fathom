import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Plank({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "wood-grain rounded-[10px] px-5 py-3 font-ui font-bold text-driftwood shadow-[0_5px_0_var(--plank-dark)]",
        "[clip-path:polygon(1%_0,99%_0,100%_9%,99%_100%,0_100%,1%_92%)]",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
