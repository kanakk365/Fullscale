// Small marks drawn over the plan: what the pointer snapped to, and labels in screen pixels.
import type { Snap, Vec2 } from '@fullscale/core';
import type { ReactNode } from 'react';

/** A mark for each kind of snap, the same size on screen at any zoom. */
export function SnapMark({ snap, scale }: { snap: Snap | null; scale: number }) {
  if (!snap?.kind) return null;
  const [x, z] = snap.point;
  const s = 6 / scale;
  switch (snap.kind) {
    case 'corner':
      return <rect className="snap-mark" x={x - s} y={z - s} width={2 * s} height={2 * s} />;
    case 'middle':
      return <polygon className="snap-mark" points={`${x},${z - s * 1.2} ${x + s},${z + s * 0.8} ${x - s},${z + s * 0.8}`} />;
    case 'crossing':
      return <path className="snap-mark" d={`M ${x - s} ${z - s} L ${x + s} ${z + s} M ${x - s} ${z + s} L ${x + s} ${z - s}`} />;
    case 'wall':
      return <circle className="snap-mark" cx={x} cy={z} r={s} />;
    default:
      return <circle className="snap-mark small" cx={x} cy={z} r={s / 2} />;
  }
}

/** A label floating next to a screen point. */
export function Label({ at, children, tone }: { at: Vec2; children: ReactNode; tone?: 'error' }) {
  return (
    <div className={`plan-label${tone ? ` ${tone}` : ''}`} style={{ left: at[0] + 14, top: at[1] + 14 }}>
      {children}
    </div>
  );
}
