// Placing doors, windows and plain openings: move over a wall to see where it would go
// (centred on the pointer, kept inside the wall), click to place. The same rules as the
// studio decide whether it fits; a red ghost says why not.
import {
  add,
  blockingProblem,
  distanceToWallBody,
  faceOffsets,
  leftOf,
  OPENING_DEFAULTS,
  openingProblems,
  projectOntoWall,
  scale as scaleVec,
  wallDirection,
  wallLength,
  type Vec2,
  type Wall,
} from '@fullscale/core';
import { useReducer, useRef } from 'react';
import { commit } from '../../app/actions.ts';
import type { PlanTool } from '../types.ts';
import { levelWalls, round } from './common.ts';
import { Label } from './marks.tsx';

/** A door or window snaps to a wall the pointer is within this many pixels of. */
const REACH_PX = 24;

interface Spot {
  wall: Wall;
  offset: number;
  problem?: string;
  screen: Vec2;
}

export function useOpeningTool(type: 'door' | 'window' | 'opening'): PlanTool {
  const spot = useRef<Spot | null>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const size = OPENING_DEFAULTS[type];

  return {
    cursor: 'copy',
    move(p, ctx) {
      const walls = levelWalls(ctx)
        .map((w) => ({ w, d: distanceToWallBody(w, p.point) }))
        .filter((x) => x.d * ctx.scale <= REACH_PX)
        .sort((a, b) => a.d - b.d);
      const wall = walls[0]?.w;
      if (!wall) {
        spot.current = null;
        redraw();
        return;
      }
      let offset = projectOntoWall(wall, p.point).along - size.width / 2;
      if (ctx.snap === 'grid' && !p.alt) offset = round(offset, ctx.grid);
      offset = Math.min(Math.max(0, offset), Math.max(0, wallLength(wall) - size.width));
      const problem = blockingProblem(openingProblems(ctx.home, wall, { offset, ...size }), false);
      spot.current = { wall, offset, screen: p.screen, ...(problem ? { problem: problem.message } : {}) };
      redraw();
    },
    down() {
      const s = spot.current;
      if (!s || s.problem) return;
      void commit({ op: 'addOpening', wall: s.wall.id, type, offset: round(s.offset, 1e-6) }, { label: `Add a ${type}` });
    },
    overlay() {
      const s = spot.current;
      if (!s) return null;
      const d = wallDirection(s.wall);
      const n = leftOf(d);
      const off = faceOffsets(s.wall);
      const at = (along: number, face: number) => add(add(s.wall.start, scaleVec(d, along)), scaleVec(n, face));
      const pts = [at(s.offset, off.left), at(s.offset + size.width, off.left), at(s.offset + size.width, off.right), at(s.offset, off.right)];
      return <polygon className={`opening-ghost${s.problem ? ' bad' : ''}`} points={pts.map((p) => p.join(',')).join(' ')} />;
    },
    hud() {
      const s = spot.current;
      if (!s) return null;
      return s.problem ? (
        <Label at={s.screen} tone="error">
          {s.problem}
        </Label>
      ) : (
        <Label at={s.screen}>
          {type} {Math.round(size.width * 100)} cm, {Math.round(s.offset * 100) / 100} m from the wall’s start
        </Label>
      );
    },
  };
}
