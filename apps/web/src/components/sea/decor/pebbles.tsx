import type { SVGProps } from "react";

export function Pebbles(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 100 60" fill="none" aria-hidden="true" {...props}>
      <path d="M4 43c0-9 8-17 19-17s20 8 20 17c0 7-9 11-20 11S4 50 4 43Z" fill="var(--crate)" stroke="var(--driftwood)" strokeWidth="2" />
      <path d="M37 39c0-12 10-24 25-24s25 12 25 24c0 10-11 16-25 16S37 49 37 39Z" fill="var(--sand-beach)" stroke="var(--driftwood)" strokeWidth="2" />
      <path d="M75 45c0-7 6-14 13-14s11 7 11 14c0 7-5 10-12 10s-12-3-12-10Z" fill="var(--sea-glass)" stroke="var(--ink)" strokeWidth="2" />
      <path d="M49 29c4-5 10-7 16-6" stroke="var(--foam)" strokeWidth="3" strokeLinecap="round" opacity=".7" />
    </svg>
  );
}
