// Selecting and moving things on the plan.
// - Click selects; Shift-click adds or removes; clicking empty floor clears (and drags pan).
// - Drag furniture (it stands against a wall when its back comes close; Alt places freely),
//   a wall sideways, a selected wall's end (it joins corners and walls), or a door or window
//   along its wall (or onto another wall).
// - Click an outside dimension and type a length to set the wall's length.
// - Keys: Delete removes, arrows nudge furniture by the grid step (Shift: ten steps),
//   R turns furniture 15° (Shift: 90°), Escape clears the selection.
import { catalogEntry, cornerWalls, distanceToWallBody, dot, leftOf, parseLength, projectOntoWall, sub, wallDirection, wallLength, type BaseOperation, type Snap, type Vec2 } from '@fullscale/core';
import { useReducer, useRef, useState } from 'react';
import { cancelPreview, commit, preview, removeSelection, select } from '../../app/actions.ts';
import { getState, say } from '../../app/store.ts';
import type { PlanContext, PlanPointer, PlanTool } from '../types.ts';
import { againstWall, round, snapPointer } from './common.ts';
import { Label, SnapMark } from './marks.tsx';

/** A press only becomes a drag after the pointer moves this many pixels. */
const DRAG_SLOP_PX = 4;

interface Drag {
  id: string;
  kind: string;
  handle?: 'start' | 'end';
  start: Vec2;
  moved: boolean;
  /** for openings: how far along the opening the pointer took hold of it */
  grab?: number;
  operation?: BaseOperation;
  error?: string;
  snap?: Snap;
  screen: Vec2;
}

export function useSelectTool(): PlanTool {
  const drag = useRef<Drag | null>(null);
  const pressedDimension = useRef<string | null>(null);
  const [dimension, setDimension] = useState<{ wall: string; at: Vec2; text: string } | null>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  return {
    pansOnEmpty: true,

    down(p, ctx) {
      // The length box opens when the click ends: opening it on press would lose its focus
      // to the press itself.
      if (p.target.dimension) {
        pressedDimension.current = p.target.dimension;
        return;
      }
      const { id, kind, handle } = p.target;
      const selection = getState().selection;
      if (!id) {
        if (!p.shift) select([]);
        return;
      }
      if (p.shift) {
        select(selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id]);
        return;
      }
      if (!selection.includes(id) && !handle) select([id]);
      const d: Drag = { id, kind: kind ?? '', start: p.point, moved: false, screen: p.screen, ...(handle ? { handle } : {}) };
      if (kind === 'opening') {
        const o = ctx.base.openings.find((x) => x.id === id);
        const w = o && ctx.base.walls.find((x) => x.id === o.wall);
        if (o && w) d.grab = projectOntoWall(w, p.point).along - o.offset;
      }
      drag.current = d;
    },

    move(p, ctx) {
      const d = drag.current;
      if (!d) return;
      if (!d.moved && Math.hypot(p.point[0] - d.start[0], p.point[1] - d.start[1]) * ctx.scale < DRAG_SLOP_PX) return;
      d.moved = true;
      d.screen = p.screen;
      const operation = dragOperation(d, p, ctx);
      d.operation = operation ?? undefined;
      d.error = operation ? preview(operation)?.message : undefined;
      if (!operation) cancelPreview();
      redraw();
    },

    up(p, ctx) {
      if (pressedDimension.current) {
        // The plan holds the pointer while it is pressed, so the release comes from the plan
        // itself, not from the dimension: trust the press.
        const wall = ctx.base.walls.find((w) => w.id === pressedDimension.current);
        pressedDimension.current = null;
        if (wall) setDimension({ wall: wall.id, at: p.screen, text: wallLength(wall).toFixed(3) });
        return;
      }
      const d = drag.current;
      drag.current = null;
      if (d?.moved && d.operation && !d.error) void commit(d.operation);
      else cancelPreview();
      redraw();
    },

    key(e, ctx) {
      const selection = getState().selection;
      if (e.key === 'Escape') {
        if (dimension) setDimension(null);
        else if (selection.length) select([]);
        else return false;
        return true;
      }
      if (!selection.length) return false;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        void removeSelection();
        return true;
      }
      const items = ctx.base.items.filter((i) => selection.includes(i.id));
      if (!items.length) return false;
      const arrows: Record<string, Vec2> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[e.key]) {
        const step = ctx.grid * (e.shiftKey ? 10 : 1);
        const [dx, dz] = arrows[e.key]!;
        const ops: BaseOperation[] = items.map((i) => ({ op: 'updateItem', id: i.id, position: [round(i.position[0] + dx * step, 1e-6), i.position[1], round(i.position[2] + dz * step, 1e-6)] }));
        void commit({ op: 'batch', label: 'Nudge', ops }, { groupKey: `nudge:${selection.join(',')}` });
        return true;
      }
      if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey) {
        const turn = e.shiftKey ? 90 : 15;
        const ops: BaseOperation[] = items.map((i) => ({ op: 'updateItem', id: i.id, rotation: (((i.rotation + turn) % 360) + 360) % 360 }));
        void commit({ op: 'batch', label: 'Turn', ops }, { groupKey: `turn:${selection.join(',')}` });
        return true;
      }
      return false;
    },

    overlay(ctx) {
      const d = drag.current;
      return d?.handle && d.moved ? <SnapMark snap={d.snap ?? null} scale={ctx.scale} /> : null;
    },

    hud() {
      const d = drag.current;
      return (
        <>
          {d?.error && (
            <Label at={d.screen} tone="error">
              {d.error}
            </Label>
          )}
          {dimension && (
            <input
              className="dimension-input"
              style={{ left: dimension.at[0] - 50, top: dimension.at[1] - 14 }}
              // biome-ignore lint/a11y/noAutofocus: the box opens because the person clicked a dimension to type a length
              autoFocus
              value={dimension.text}
              onChange={(e) => setDimension({ ...dimension, text: e.target.value })}
              onFocus={(e) => e.target.select()}
              onBlur={() => setDimension(null)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') setDimension(null);
                if (e.key !== 'Enter') return;
                try {
                  const length = parseLength(dimension.text);
                  void commit({ op: 'setWallLength', id: dimension.wall, length });
                  setDimension(null);
                } catch (err) {
                  say('error', (err as Error).message);
                }
              }}
            />
          )}
        </>
      );
    },
  };
}

/** The edit a drag stands for, from where it started to where the pointer is now. */
function dragOperation(d: Drag, p: PlanPointer, ctx: PlanContext): BaseOperation | null {
  const delta = sub(p.point, d.start);
  const free = p.alt;
  const base = ctx.base;

  if (d.kind === 'item') {
    const item = base.items.find((i) => i.id === d.id);
    if (!item) return null;
    let centre: Vec2 = [item.position[0] + delta[0], item.position[2] + delta[1]];
    if (ctx.snap === 'grid' && !free) centre = [round(centre[0], ctx.grid), round(centre[1], ctx.grid)];
    let rotation = item.rotation;
    const pose = !free && catalogEntry(item.catalog).shape !== 'rug' ? againstWall({ ...base, items: base.items.filter((i) => i.id !== item.id) }, item.level, item.size, centre, ctx.scale) : null;
    if (pose) {
      centre = [pose.position[0], pose.position[2]];
      rotation = pose.rotation;
    }
    return { op: 'updateItem', id: item.id, position: [round(centre[0], 1e-6), item.position[1], round(centre[1], 1e-6)], rotation };
  }

  if (d.kind === 'wall' && d.handle) {
    const wall = base.walls.find((w) => w.id === d.id);
    if (!wall) return null;
    const moving = new Set(free ? [wall.id] : cornerWalls(base, wall, wall[d.handle]).map((m) => m.wall.id));
    const snap = snapPointer(p, { ...ctx, home: base }, { exclude: moving });
    d.snap = snap;
    return { op: 'moveWallEnd', id: wall.id, end: d.handle, to: snap.point, snap: 0.001, ...(free ? { detach: true } : {}) };
  }

  if (d.kind === 'wall') {
    const wall = base.walls.find((w) => w.id === d.id);
    if (!wall) return null;
    let by = dot(delta, leftOf(wallDirection(wall)));
    if (ctx.snap === 'grid' && !free) by = round(by, ctx.grid);
    return Math.abs(by) < 1e-9 ? null : { op: 'moveWall', id: wall.id, by };
  }

  if (d.kind === 'opening') {
    const o = base.openings.find((x) => x.id === d.id);
    let wall = o && base.walls.find((w) => w.id === o.wall);
    if (!o || !wall) return null;
    // Far from its wall and over another one: move it there.
    let grab = d.grab ?? o.width / 2;
    if (distanceToWallBody(wall, p.point) > 0.5) {
      const other = base.walls.find((w) => w.level === wall!.level && w.id !== wall!.id && distanceToWallBody(w, p.point) < 0.3);
      if (other) {
        wall = other;
        grab = o.width / 2;
      }
    }
    let offset = projectOntoWall(wall, p.point).along - grab;
    if (ctx.snap === 'grid' && !free) offset = round(offset, ctx.grid);
    offset = Math.min(Math.max(0, offset), wallLength(wall) - o.width);
    return { op: 'updateOpening', id: o.id, offset: round(offset, 1e-6), ...(wall.id !== o.wall ? { wall: wall.id } : {}) };
  }
  return null;
}
