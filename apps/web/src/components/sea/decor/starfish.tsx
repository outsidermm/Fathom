import type { SVGProps } from "react";

export function Starfish(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" {...props}>
      <path
        d="M40 7c4 0 7 17 10 21 4 3 21-4 24 0 3 5-11 17-12 22-1 5 8 20 4 24-4 4-21-6-26-6s-22 10-26 6c-4-4 5-19 4-24C17 45 3 33 6 28c3-4 20 3 24 0 3-4 6-21 10-21Z"
        fill="var(--starfish)"
        stroke="var(--driftwood)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="39" r="2" fill="var(--driftwood)" />
      <circle cx="48" cy="39" r="2" fill="var(--driftwood)" />
      <path d="M34 49c3 3 9 3 12 0" stroke="var(--driftwood)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
