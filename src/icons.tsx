import React from 'react';

// Lucide-style line icons so the plugin matches the host's outline look (no emoji).
export function Icon({ d, size = '1em', stroke = 2, style }: { d: (string | { c: [number, number, number] })[]; size?: string; stroke?: number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, display: 'block', ...style }} aria-hidden>
      {d.map((p, i) => (typeof p === 'string' ? <path key={i} d={p} /> : <circle key={i} cx={p.c[0]} cy={p.c[1]} r={p.c[2]} />))}
    </svg>
  );
}

export const I = {
  plus: ['M5 12h14', 'M12 5v14'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
  check: ['M20 6 9 17l-5-5'],
  back: ['M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Z', 'm18 9-6 6', 'm12 9 6 6'],
  cart: [{ c: [8, 21, 1] as [number, number, number] }, { c: [19, 21, 1] as [number, number, number] }, 'M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12'],
  shift: ['M9 18v-6H5l7-7 7 7h-4v6H9z'],
  rotate: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
};
