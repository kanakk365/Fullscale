// Measuring on the plan: click two points (they snap to corners and walls) to see the
// distance between them. A third click starts a new measurement; Escape clears it.
import { formatLength, type Snap, type Vec2 } from '@fullscale/core';
import { useReducer, useRef } from 'react';
import type { PlanTool } from '../types.ts';
import { snapPointer } from './common.ts';
import { Label, SnapMark } from './marks.tsx';

export function useMeasureTool(): PlanTool {
  const points = useRef<Vec2[]>([]);
  const cursor = useRef<{ snap: Snap; screen: Vec2 } | null>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  return {
    cursor: 'crosshair',
    move(p, ctx) {
      cursor.current = { snap: snapPointer(p, { ...ctx, snap: ctx.snap === 'off' ? 'off' : 'lines' }), screen: p.screen };
      redraw();
    },
    down() {
      const at = cursor.current?.snap.point;
      if (!at) return;
      points.current = points.current.length === 1 ? [points.current[0]!, at] : [at];
      redraw();
    },
    key(e) {
      if (e.key !== 'Escape' || !points.current.length) return false;
      points.current = [];
      redraw();
      return true;
    },
    overlay(ctx) {
      const [a, b] = points.current;
      const end = b ?? cursor.current?.snap.point;
      return (
        <g className="measure">
          {a && end && <line x1={a[0]} y1={a[1]} x2={end[0]} y2={end[1]} />}
          {a && <circle cx={a[0]} cy={a[1]} r={3 / ctx.scale} />}
          {b && <circle cx={b[0]} cy={b[1]} r={3 / ctx.scale} />}
          <SnapMark snap={cursor.current?.snap ?? null} scale={ctx.scale} />
        </g>
      );
    },
    hud() {
      const [a, b] = points.current;
      const c = cursor.current;
      if (!c) return null;
      const end = b ?? c.snap.point;
      if (!a) return <Label at={c.screen}>Click the first point</Label>;
      return <Label at={c.screen}>{formatLength(Math.hypot(end[0] - a[0], end[1] - a[1]), { unit: 'cm' })}</Label>;
    },
  };
}
