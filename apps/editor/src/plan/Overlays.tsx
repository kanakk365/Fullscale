// What the plan draws on top of the home: the grid underneath, and outlines for what is
// selected, what an agent pointed out, and what another actor has selected.
import { elementOutline, joinedOutline, levelJoins, type Home, type Vec2 } from '@fullscale/core';

const pts = (p: Vec2[]) => p.map(([x, z]) => `${x},${z}`).join(' ');

/** Grid steps, small to large; the smallest that is at least 12 px apart is drawn. */
const STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25];

export function Grid({ view, scale }: { view: { x: number; y: number; w: number; h: number }; scale: number }) {
  const minor = STEPS.find((s) => s * scale >= 12) ?? 25;
  const major = STEPS.find((s) => s >= Math.max(1, minor * 5)) ?? 50;
  const lines: Array<{ key: string; major: boolean; x1: number; y1: number; x2: number; y2: number }> = [];
  for (let x = Math.floor(view.x / minor) * minor; x <= view.x + view.w; x += minor) {
    const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6;
    lines.push({ key: `x${x.toFixed(3)}`, major: isMajor, x1: x, y1: view.y, x2: x, y2: view.y + view.h });
  }
  for (let y = Math.floor(view.y / minor) * minor; y <= view.y + view.h; y += minor) {
    const isMajor = Math.abs(y / major - Math.round(y / major)) < 1e-6;
    lines.push({ key: `y${y.toFixed(3)}`, major: isMajor, x1: view.x, y1: y, x2: view.x + view.w, y2: y });
  }
  return (
    <g className="grid">
      {lines.map((l) => (
        <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className={l.major ? 'major' : 'minor'} />
      ))}
    </g>
  );
}

/** The outline of an element as drawn: walls with their joined corners. */
export function outlineOf(home: Home, id: string): Vec2[] | null {
  const wall = home.walls.find((w) => w.id === id);
  if (wall) {
    const join = levelJoins(home, wall.level).walls.get(id);
    return join ? joinedOutline(join) : null;
  }
  try {
    const o = elementOutline(home, id);
    return typeof o[0] === 'number' ? null : (o as Vec2[]);
  } catch {
    return null;
  }
}

export function Outlines({ home, ids, className }: { home: Home; ids: readonly string[]; className: string }) {
  return (
    <g className={className}>
      {ids.map((id) => {
        const outline = outlineOf(home, id);
        return outline ? <polygon key={id} points={pts(outline)} /> : null;
      })}
    </g>
  );
}

/** Round handles on a selected wall's ends, for dragging them. */
export function WallHandles({ home, id, scale }: { home: Home; id: string; scale: number }) {
  const wall = home.walls.find((w) => w.id === id);
  if (!wall) return null;
  const r = 6 / scale;
  return (
    <g className="handles">
      {(['start', 'end'] as const).map((end) => (
        <circle key={end} cx={wall[end][0]} cy={wall[end][1]} r={r} data-id={wall.id} data-kind="wall" data-handle={end} />
      ))}
    </g>
  );
}
