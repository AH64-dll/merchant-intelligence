import type { JSX } from 'react';

/**
 * Custom brand mark: a magnifier lens containing a fingerprint.
 * Matches the دليل التجار identity — evidence inspection + identity.
 * Rendered in the olive-teal palette (--teal family) on transparent.
 */
export function BrandMark({ size = 40, className }: { size?: number; className?: string }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      role="img"
      aria-hidden="true"
    >
      {/* magnifier lens ring */}
      <circle cx="20" cy="20" r="14.5" stroke="#4a7c7e" strokeWidth="2.6" />
      {/* handle */}
      <line x1="31" y1="31" x2="41.5" y2="41.5" stroke="#4a7c7e" strokeWidth="3.4" strokeLinecap="round" />
      {/* fingerprint inside lens */}
      <g stroke="#4a7c7e" strokeWidth="1.9" strokeLinecap="round" fill="none" transform="translate(20 20)">
        <path d="M -6.5 -1.5 A 7 7 0 0 1 6.5 -1.5" />
        <path d="M -7.5 2.5 A 8.2 8.2 0 0 0 -3.4 6.9" />
        <path d="M 7.5 2.5 A 8.2 8.2 0 0 1 3.4 6.9" />
        <path d="M -3.8 -2.6 A 4.2 4.2 0 0 1 3.8 -2.6" />
        <path d="M -4.3 1 A 4.6 4.6 0 0 0 -1.9 4.6" />
        <path d="M 4.3 1 A 4.6 4.6 0 0 1 1.9 4.6" />
        <path d="M 0 -1.4 v 3.4" />
      </g>
    </svg>
  );
}
