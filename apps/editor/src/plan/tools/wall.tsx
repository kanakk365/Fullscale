// Drawing walls. Click to start, click again to place each wall; the chain carries on from
// the last end until it closes on its first point or meets another wall. While drawing,
// type a length ("3.5", "350 cm", "11' 6\"") and press Enter to place the next wall exactly
// that long, in the direction of the pointer. Escape stops the chain; Alt draws without
// snapping. Each wall goes to the studio as a drawWall edit, which joins and splits walls
// and makes rooms of closed areas.
import { add, DEFAULT_WALL_THICKNESS, distance, faceOffsets, formatLength, leftOf, parseLength, scale as scaleVec, sub, type Snap, type Vec2 } from '@fullscale/core';
import { useReducer, useRef } from 'react';
import { commit } from '../../app/actions.ts';
import { say } from '../../app/store.ts';
import type { PlanTool } from '../types.ts';
import { snapPointer } from './common.ts';
import { Label, SnapMark } from './marks.tsx';

/** The chain closes when its end comes back this close to its first point. */
const CLOSE_TO_START = 0.02;

export function useWallTool(): PlanTool {
  const chain = useRef<Vec2[]>([]);
  const cursor = useRef<{ snap: Snap; screen: Vec2 } | null>(null);
  const typed = useRef('');
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  const place = (end: Vec2, endsOnWall: boolean) => {
    const start = chain.current[chain.current.length - 1]!;
    if (distance(start, end) < 0.01) return;
    void commit({ op: 'drawWall', start, end, snap: 0.001 }, { label: 'Draw a wall' });
    const closes = chain.current.length > 1 && distance(end, chain.current[0]!) < CLOSE_TO_START;
    chain.current = closes || endsOnWall ? [] : [...chain.current, end];
    typed.current = '';
    redraw();
  };

  return {
    cursor: 'crosshair',

    move(p, ctx) {
      const from = chain.current[chain.current.length - 1];
      cursor.current = { snap: snapPointer(p, ctx, from ? { from } : {}), screen: p.screen };
      redraw();
    },

    down(p, ctx) {
      const from = chain.current[chain.current.length - 1];
      const snap = snapPointer(p, ctx, from ? { from } : {});
      if (!from) {
        chain.current = [snap.point];
        redraw();
        return;
      }
      place(snap.point, snap.kind === 'corner' || snap.kind === 'wall' || snap.kind === 'middle' || snap.kind === 'crossing');
    },

    key(e) {
      if (!chain.current.length) return false;
      if (e.key === 'Escape') {
        if (typed.current) typed.current = '';
        else chain.current = [];
        redraw();
        return true;
      }
      if (e.key === 'Enter' && typed.current) {
        const start = chain.current[chain.current.length - 1]!;
        let length: number;
        try {
          length = parseLength(typed.current);
        } catch (err) {
          say('error', (err as Error).message);
          return true;
        }
        const toward = cursor.current ? sub(cursor.current.snap.point, start) : ([1, 0] as Vec2);
        const len = Math.hypot(toward[0], toward[1]);
        const dir: Vec2 = len > 1e-9 ? [toward[0] / len, toward[1] / len] : [1, 0];
        place(add(start, scaleVec(dir, length)), false);
        return true;
      }
      if (e.key === 'Backspace' && typed.current) {
        typed.current = typed.current.slice(0, -1);
        redraw();
        return true;
      }
      if (e.key.length === 1 && /[0-9.,'" a-zA-Z/-]/.test(e.key) && !e.metaKey && !e.ctrlKey) {
        // Letters only count once a number has started ("350 cm"), so tool shortcuts still work.
        if (!typed.current && !/[0-9.]/.test(e.key)) return false;
        typed.current += e.key;
        redraw();
        return true;
      }
      return false;
    },

    overlay(ctx) {
      const start = chain.current[chain.current.length - 1];
      const snap = cursor.current?.snap ?? null;
      const end = snap?.point;
      let band: Vec2[] | null = null;
      if (start && end && distance(start, end) > 1e-6) {
        const d = sub(end, start);
        const n = leftOf(scaleVec(d, 1 / Math.hypot(d[0], d[1])));
        const off = faceOffsets({ thickness: DEFAULT_WALL_THICKNESS, line: 'center' });
        band = [add(start, scaleVec(n, off.left)), add(end, scaleVec(n, off.left)), add(end, scaleVec(n, off.right)), add(start, scaleVec(n, off.right))];
      }
      return (
        <g className="drawing">
          {chain.current.length > 0 && <circle className="chain-start" cx={chain.current[0]![0]} cy={chain.current[0]![1]} r={4 / ctx.scale} />}
          {band && <polygon className="wall-ghost" points={band.map((p) => p.join(',')).join(' ')} />}
          <SnapMark snap={snap} scale={ctx.scale} />
        </g>
      );
    },

    hud() {
      const start = chain.current[chain.current.length - 1];
      const c = cursor.current;
      if (!c) return null;
      if (!start) return <Label at={c.screen}>Click to start a wall</Label>;
      const d = sub(c.snap.point, start);
      const angle = Math.round((Math.atan2(-d[1], d[0]) * 180) / Math.PI);
      return (
        <Label at={c.screen}>
          {typed.current ? <strong>{typed.current}▏</strong> : `${formatLength(Math.hypot(d[0], d[1]))} · ${angle}°`}
          <span className="hint">{typed.current ? 'Enter to place' : 'type a length, or click'}</span>
        </Label>
      );
    },
  };
}
