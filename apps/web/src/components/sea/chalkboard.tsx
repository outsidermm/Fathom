import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Chalkboard({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border-[7px] border-plank bg-[#2a2a2a] px-5 py-4 font-ui font-bold text-foam shadow-[0_5px_0_var(--plank-dark)]",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
