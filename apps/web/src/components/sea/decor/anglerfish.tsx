import type { SVGProps } from "react";

export function Anglerfish(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 120 90" fill="none" aria-hidden="true" {...props}>
      <path d="M27 36 9 20l1 27L3 60l23 1" fill="var(--glow-1)" stroke="var(--glow-4)" strokeWidth="3" strokeLinejoin="round" />
      <path d="M32 26 46 9l10 20M58 64 49 82 75 69" fill="var(--glow-2)" stroke="var(--glow-4)" strokeWidth="3" strokeLinejoin="round" />
      <path d="M22 45c0-19 17-31 41-31 24 0 45 15 48 34-3 20-24 32-49 32-24 0-40-15-40-35Z" fill="var(--glow-1)" stroke="var(--glow-4)" strokeWidth="3" />
      <path d="M72 16c0-14 12-17 21-11 6 4 7 12 6 16" stroke="var(--glow-4)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="100" cy="21" r="7" fill="var(--glow-5)" />
      <circle cx="82" cy="35" r="8" fill="var(--deep)" stroke="var(--glow-5)" strokeWidth="2" />
      <circle cx="84" cy="33" r="2" fill="var(--glow-5)" />
      <path d="M68 56c10 4 22 4 34-2l-5 9-8-5-7 7-7-7-7 5Z" fill="var(--deep)" stroke="var(--glow-4)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
