// Draws the plan's shapes (from the core's planGeometry) as SVG in plan metres. Every
// element carries data-id and data-kind, which is how the pointer finds what it is over.
import type { PlanGeometry, PlanPrimitive, Vec2 } from '@fullscale/core';
import { memo } from 'react';

const pts = (p: Vec2[]) => p.map(([x, z]) => `${x},${z}`).join(' ');

/** Text never shrinks below this many pixels on screen. */
const MIN_TEXT_PX = 11;

const KIND_OF_ROLE: Partial<Record<string, string>> = {
  room: 'room',
  wall: 'wall',
  item: 'item',
  rug: 'item',
  window: 'opening',
  opening: 'opening',
  'door-leaf': 'opening',
  'door-swing': 'opening',
  'item-front': 'item',
  'window-glass': 'opening',
};

export const PlanShapes = memo(function PlanShapes({ plan, scale }: { plan: PlanGeometry; scale: number }) {
  const minText = MIN_TEXT_PX / scale;
  return (
    <g className="plan-shapes">
      {plan.primitives.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the list is rebuilt whole from the home on every change; shapes hold no state
        <Shape key={i} p={p} minText={minText} />
      ))}
    </g>
  );
});

function Shape({ p, minText }: { p: PlanPrimitive; minText: number }) {
  const tag = 'id' in p && p.id ? { 'data-id': p.id, 'data-kind': KIND_OF_ROLE[p.kind === 'text' ? '' : p.role] } : {};
  switch (p.kind) {
    case 'polygon':
      return <polygon points={pts(p.points)} className={`p-${p.role}`} {...tag} />;
    case 'line':
      return <line x1={p.a[0]} y1={p.a[1]} x2={p.b[0]} y2={p.b[1]} className={`l-${p.role}`} {...tag} />;
    case 'arc': {
      const turn = (p.from[0] - p.centre[0]) * (p.to[1] - p.centre[1]) - (p.from[1] - p.centre[1]) * (p.to[0] - p.centre[0]);
      return <path d={`M ${p.from[0]} ${p.from[1]} A ${p.radius} ${p.radius} 0 0 ${turn > 0 ? 1 : 0} ${p.to[0]} ${p.to[1]}`} className="a-door-swing" {...tag} />;
    }
    case 'text':
      // Furniture names fit their furniture only at their own size; zoomed out, they hide
      // rather than grow over the plan.
      if (p.role === 'item-name' && p.size < minText) return null;
      return (
        <text x={p.at[0]} y={p.at[1]} fontSize={Math.max(p.size, minText)} className={`t-${p.role}`}>
          {p.text}
        </text>
      );
    case 'dimension': {
      const tick = (end: Vec2) => {
        const a: Vec2 = [end[0] - p.out[0] * 0.08, end[1] - p.out[1] * 0.08];
        const b: Vec2 = [end[0] + p.out[0] * 0.08, end[1] + p.out[1] * 0.08];
        return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />;
      };
      const mid: Vec2 = [(p.a[0] + p.b[0]) / 2 + p.out[0] * 0.14, (p.a[1] + p.b[1]) / 2 + p.out[1] * 0.14];
      let angle = (Math.atan2(p.b[1] - p.a[1], p.b[0] - p.a[0]) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      return (
        <g className={`dimension${p.estimated ? ' estimated' : ''}`}>
          <line x1={p.a[0]} y1={p.a[1]} x2={p.b[0]} y2={p.b[1]} />
          {tick(p.a)}
          {tick(p.b)}
          <text x={mid[0]} y={mid[1]} fontSize={Math.max(0.14, minText)} transform={`rotate(${angle} ${mid[0]} ${mid[1]})`} {...(p.wall ? { 'data-dimension': p.wall } : {})}>
            {p.estimated ? `${p.label} (est.)` : p.label}
          </text>
        </g>
      );
    }
  }
}
