import type { ReactNode } from "react";

export function PanelEmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 rounded-[10px] border border-dashed border-crate bg-paper p-4 font-body text-base text-driftwood">
      {children}
    </p>
  );
}
