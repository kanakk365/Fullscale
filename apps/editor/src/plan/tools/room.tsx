// Drawing a rectangular room: drag from one inside corner to the opposite one. Corners snap
// to wall faces, because a room is its inside outline. The walls go outside the rectangle,
// so its inside sizes are exactly what the label shows; a side that an existing wall
// already covers shares that wall.
import { formatLength, joinedOutline, levelJoins, MIN_ROOM_SIDE, snapToFaces, type Snap, type Vec2 } from '@fullscale/core';
import { useReducer, useRef } from 'react';
import { commit } from '../../app/actions.ts';
import { radiiAt, type PlanContext, type PlanPointer, type PlanTool } from '../types.ts';
import { Label, SnapMark } from './marks.tsx';

function snapCorner(p: PlanPointer, ctx: PlanContext): Snap {
  const faces = [...levelJoins(ctx.home, ctx.level).walls].map(([wall, join]) => ({ wall, points: joinedOutline(join) }));
  return snapToFaces(faces, p.point, { mode: p.alt ? 'off' : ctx.snap === 'angles' ? 'grid' : ctx.snap, grid: ctx.grid, radius: radiiAt(ctx.scale) });
}

export function useRoomTool(): PlanTool {
  const from = useRef<Vec2 | null>(null);
  const to = useRef<{ snap: Snap; screen: Vec2 } | null>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  const rect = (): Vec2[] | null => {
    const a = from.current;
    const b = to.current?.snap.point;
    if (!a || !b) return null;
    return [
      [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
      [Math.max(a[0], b[0]), Math.min(a[1], b[1])],
      [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
      [Math.min(a[0], b[0]), Math.max(a[1], b[1])],
    ];
  };

  return {
    cursor: 'crosshair',
    down(p, ctx) {
      from.current = snapCorner(p, ctx).point;
      to.current = null;
    },
    move(p, ctx) {
      to.current = { snap: snapCorner(p, ctx), screen: p.screen };
      redraw();
    },
    up(_p, ctx) {
      const r = rect();
      from.current = null;
      redraw();
      if (!r) return;
      const width = r[1]![0] - r[0]![0];
      const depth = r[3]![1] - r[0]![1];
      if (width < MIN_ROOM_SIDE || depth < MIN_ROOM_SIDE) return;
      const name = `Room ${ctx.base.rooms.filter((x) => x.level === ctx.level).length + 1}`;
      void commit({ op: 'drawRoom', name, level: ctx.level, polygon: r }, { label: `Draw ${name}` });
    },
    key(e) {
      if (e.key !== 'Escape' || !from.current) return false;
      from.current = null;
      redraw();
      return true;
    },
    overlay(ctx) {
      const r = rect();
      return (
        <g className="drawing">
          {r && <polygon className="room-ghost" points={r.map((p) => p.join(',')).join(' ')} />}
          <SnapMark snap={to.current?.snap ?? null} scale={ctx.scale} />
        </g>
      );
    },
    hud() {
      const r = rect();
      const at = to.current?.screen;
      if (!at) return null;
      if (!r) return <Label at={at}>Drag from one inside corner to the other</Label>;
      return (
        <Label at={at}>
          {formatLength(r[1]![0] - r[0]![0])} × {formatLength(r[3]![1] - r[0]![1])} inside
        </Label>
      );
    },
  };
}
