import type { SVGProps } from "react";

export function Shell(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" {...props}>
      <path
        d="M13 56c-6-7-6-16 1-22 0-11 9-17 18-15 6-8 18-8 24 0 10-1 18 6 17 16 6 7 4 16-2 22L42 70 13 56Z"
        fill="var(--shell)"
        stroke="var(--driftwood)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M42 69 18 31M42 69 31 21M42 69V17M42 69 55 21M42 69 68 31" stroke="var(--coral)" strokeWidth="2" />
      <path d="M29 63c7 5 19 5 26 0" stroke="var(--driftwood)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
