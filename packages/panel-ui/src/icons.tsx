import type { ReactNode } from 'react';

const paths: Record<string, ReactNode> = {
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  users: (
    <>
      <circle cx="9.5" cy="8" r="3.5" />
      <path d="M3 20v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1M16 4.6a3.5 3.5 0 0 1 0 6.8M21 20v-1a5 5 0 0 0-3-4.6" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l2.5 2.5" />
    </>
  ),
  wake: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.5-6l2.5 2.5" />
      <path d="M20.5 3.5v5h-5" />
    </>
  ),
  leave: <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />,
  shuffle: (
    <path d="M3 7h3c2 0 3 .9 4 2.4l3.6 5.2c1 1.5 2 2.4 4 2.4H21M3 17h3c1.2 0 2-.3 2.8-1M15 8c.8-.7 1.7-1 2.8-1H21M18 4l3 3-3 3M18 14l3 3-3 3" />
  ),
  left: <path d="m15 6-6 6 6 6" />,
  right: <path d="m9 6 6 6-6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  link: (
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  draw: (
    <>
      <rect x="4" y="7" width="11" height="14" rx="2" />
      <path d="M8 3h10a2 2 0 0 1 2 2v12" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  thread: <path d="M5 5h14v10H9l-4 4z" />,
  alert: (
    <>
      <path d="M12 3.5 2.5 20h19z" />
      <path d="M12 10v4.5M12 17.2v.3" />
    </>
  ),
};

export function Glyph({ name, size = 16 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg
      className="ca-glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
