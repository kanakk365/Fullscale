// Placing furniture from the catalogue: a ghost follows the pointer, stands against a wall
// when its back comes close (Alt places it freely), and R turns it. Click to place; it
// stays armed to place another, and Escape goes back to selecting.
import { catalogEntry, checkFit, itemFootprint, type Vec2 } from '@fullscale/core';
import { useReducer, useRef } from 'react';
import { commit } from '../../app/actions.ts';
import { getState } from '../../app/store.ts';
import type { PlanTool } from '../types.ts';
import { againstWall, round } from './common.ts';
import { Label } from './marks.tsx';

interface Ghost {
  centre: Vec2;
  rotation: number;
  problem?: string;
  screen: Vec2;
}

export function useItemTool(): PlanTool {
  const ghost = useRef<Ghost | null>(null);
  const turn = useRef(0);
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  return {
    cursor: 'copy',
    move(p, ctx) {
      const entry = catalogEntry(getState().catalog);
      let centre: Vec2 = ctx.snap === 'grid' && !p.alt ? [round(p.point[0], ctx.grid), round(p.point[1], ctx.grid)] : p.point;
      let rotation = turn.current;
      const pose = !p.alt && entry.shape !== 'rug' ? againstWall(ctx.base, ctx.level, entry.size, centre, ctx.scale) : null;
      if (pose) {
        centre = [pose.position[0], pose.position[2]];
        rotation = pose.rotation;
      }
      const fit = checkFit(ctx.base, { size: entry.size, position: centre, rotation, level: ctx.level, suggest: false });
      ghost.current = { centre, rotation, screen: p.screen, ...(fit.fits ? {} : { problem: fit.problems[0]!.message }) };
      redraw();
    },
    down(_p, ctx) {
      const g = ghost.current;
      if (!g) return;
      const catalog = getState().catalog;
      void commit({ op: 'addItem', catalog, level: ctx.level, position: [round(g.centre[0], 1e-6), round(g.centre[1], 1e-6)], rotation: g.rotation }, { label: `Add ${catalogEntry(catalog).name}` });
    },
    key(e) {
      if (e.key.toLowerCase() !== 'r' || e.metaKey || e.ctrlKey) return false;
      turn.current = (turn.current + (e.shiftKey ? 15 : 90)) % 360;
      if (ghost.current) ghost.current.rotation = turn.current;
      redraw();
      return true;
    },
    overlay() {
      const g = ghost.current;
      if (!g) return null;
      const entry = catalogEntry(getState().catalog);
      const fp = itemFootprint({ position: [g.centre[0], 0, g.centre[1]], rotation: g.rotation, size: entry.size });
      return (
        <g className={`item-ghost${g.problem ? ' bad' : ''}`}>
          <polygon points={fp.map((p) => p.join(',')).join(' ')} />
          <line x1={fp[2]![0]} y1={fp[2]![1]} x2={fp[3]![0]} y2={fp[3]![1]} />
        </g>
      );
    },
    hud() {
      const g = ghost.current;
      if (!g) return null;
      const entry = catalogEntry(getState().catalog);
      return (
        <Label at={g.screen} {...(g.problem ? { tone: 'error' as const } : {})}>
          {g.problem ?? `${entry.name}, ${entry.size.map((v) => v.toFixed(2)).join(' × ')} m`}
          <span className="hint">R turns it · Alt places freely · it fits only as a footprint check</span>
        </Label>
      );
    },
  };
}
