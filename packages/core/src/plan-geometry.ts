// A floor plan as a list of plain shapes in plan metres: polygons, lines, arcs, text and
// dimensions, each tagged with what it shows. The SVG plan, the PNG for agents and the
// editor's live plan all draw this same list, so they can never disagree.
import { catalogEntry } from './catalog.ts';
import { add, bounds, faceOffsets, itemFootprint, leftOf, pointInPolygon, polygonCentroid, scale, wallDirection, wallFootprint, wallLength } from './geometry.ts';
import { faceStops, levelJoins, type WallJoin } from './joins.ts';
import { labelPoint } from './label.ts';
import { roomInfo, wallOpenings } from './measure.ts';
import { sourceOf } from './resolve.ts';
import type { Home, Vec2, Wall } from './schema.ts';
import { formatLength } from './units.ts';

export type PlanPrimitive =
  | { kind: 'polygon'; role: 'room' | 'wall' | 'hub' | 'item' | 'rug' | 'window' | 'opening'; points: Vec2[]; id?: string }
  | { kind: 'line'; role: 'item-front' | 'window-glass' | 'door-leaf'; a: Vec2; b: Vec2; id?: string }
  | { kind: 'arc'; role: 'door-swing'; from: Vec2; to: Vec2; centre: Vec2; radius: number; id?: string }
  | { kind: 'text'; role: 'room-name' | 'room-size' | 'item-name'; at: Vec2; text: string; size: number; id?: string }
  | {
      kind: 'dimension';
      /** the dimension line's ends, already set out from what it measures */
      a: Vec2;
      b: Vec2;
      /** unit vector pointing away from what is measured; ticks and label go this way */
      out: Vec2;
      label: string;
      /** the length is a guess (estimate or catalogue), not a measurement */
      estimated: boolean;
      wall?: string;
    };

export interface PlanOptions {
  level?: string;
  furniture?: boolean;
  dimensions?: boolean;
}

export interface PlanGeometry {
  level: string;
  primitives: PlanPrimitive[];
  /** the area the plan covers, before any margin */
  bounds: { min: Vec2; max: Vec2; size: Vec2 };
}

/** Text height for room names, in metres on the plan. */
export const PLAN_TEXT = 0.16;
/** How far dimension lines sit outside the wall face they measure. */
const DIMENSION_GAP = 0.35;

/** ± of a wall's length from the sources of its two ends (root-sum-square), if both known. */
export function wallLengthUncertainty(wall: Wall): number | undefined {
  const a = sourceOf(wall, 'start')?.uncertainty;
  const b = sourceOf(wall, 'end')?.uncertainty;
  return a === undefined || b === undefined ? undefined : Math.hypot(a, b);
}

function isGuess(wall: Wall): boolean {
  return (['start', 'end'] as const).some((f) => {
    const kind = sourceOf(wall, f)?.kind;
    return kind === 'estimate' || kind === 'catalog';
  });
}

export function planGeometry(home: Home, opts: PlanOptions = {}): PlanGeometry {
  const level = opts.level ?? home.levels[0]!.id;
  const walls = home.walls.filter((w) => w.level === level);
  const rooms = home.rooms.filter((r) => r.level === level);
  const items = home.items.filter((i) => i.level === level);
  const out: PlanPrimitive[] = [];

  for (const r of rooms) out.push({ kind: 'polygon', role: 'room', points: r.polygon, id: r.id });

  if (opts.furniture !== false) {
    for (const it of items) {
      const fp = itemFootprint(it);
      const rug = catalogEntry(it.catalog).shape === 'rug';
      out.push({ kind: 'polygon', role: rug ? 'rug' : 'item', points: fp, id: it.id });
      // The front edge is fp[2] → fp[3], the item's local +z side.
      out.push({ kind: 'line', role: 'item-front', a: fp[2]!, b: fp[3]!, id: it.id });
      // Names go on items big enough to hold them (about 0.55 em per letter).
      const size = PLAN_TEXT * 0.8;
      const [w, , d] = it.size;
      const fits = it.name.length * size * 0.55 < Math.max(w, d) * 0.9 && Math.min(w, d) > size * 2;
      if (!rug && fits) out.push({ kind: 'text', role: 'item-name', at: [it.position[0], it.position[2]], text: it.name, size, id: it.id });
    }
  }

  const joins = levelJoins(home, level);
  for (const hub of joins.hubs) out.push({ kind: 'polygon', role: 'hub', points: hub });
  for (const w of walls) wallShapes(home, w, joins.walls.get(w.id), out);

  if (opts.dimensions !== false) {
    for (const w of walls) {
      const dim = outsideDimension(
        w,
        rooms.map((r) => r.polygon),
      );
      if (dim) out.push(dim);
    }
  }

  for (const r of rooms) {
    const info = roomInfo(home, r.id);
    const at = labelPoint(r.polygon);
    out.push({ kind: 'text', role: 'room-name', at, text: r.name, size: PLAN_TEXT * 1.1, id: r.id });
    out.push({
      kind: 'text',
      role: 'room-size',
      at: [at[0], at[1] + PLAN_TEXT * 1.3],
      text: `${info.area.toFixed(1)} m² · ${formatLength(info.width)} × ${formatLength(info.depth)}`,
      size: PLAN_TEXT,
      id: r.id,
    });
  }

  const pts: Vec2[] = [...walls.flatMap((w) => wallFootprint(w)), ...rooms.flatMap((r) => r.polygon)];
  return {
    level,
    primitives: out,
    bounds: bounds(
      pts.length
        ? pts
        : [
            [0, 0],
            [5, 5],
          ],
    ),
  };
}

/** A wall's solid parts (with joined corners and gaps for openings), windows and doors. */
function wallShapes(home: Home, w: Wall, join: WallJoin | undefined, out: PlanPrimitive[]): void {
  const len = wallLength(w);
  const ops = wallOpenings(home, w.id);
  const d = wallDirection(w);
  const n = leftOf(d);
  const off = faceOffsets(w);
  const at = (along: number, face: number) => add(add(w.start, scale(d, along)), scale(n, face));

  const solid: Array<[number, number]> = [];
  let u = 0;
  // A niche is a recess, not a gap: the wall stays solid across it on the plan.
  for (const o of ops.filter((x) => x.type !== 'niche')) {
    if (o.offset > u) solid.push([u, o.offset]);
    u = Math.max(u, o.offset + o.width);
  }
  if (u < len) solid.push([u, len]);
  const stops = join ? faceStops(w, join) : { start: { left: 0, right: 0 }, end: { left: len, right: len } };
  for (const [a, c] of solid) {
    // The first and last pieces take the wall's joined corners; pieces between openings are square.
    const startLeft = a === 0 ? stops.start.left : a;
    const startRight = a === 0 ? stops.start.right : a;
    const endLeft = c === len ? stops.end.left : c;
    const endRight = c === len ? stops.end.right : c;
    out.push({ kind: 'polygon', role: 'wall', points: [at(startLeft, off.left), at(endLeft, off.left), at(endRight, off.right), at(startRight, off.right)], id: w.id });
  }

  for (const o of ops) {
    const p0 = o.offset;
    const p1 = o.offset + o.width;
    if (o.type === 'window') {
      out.push({ kind: 'polygon', role: 'window', points: [at(p0, off.left), at(p1, off.left), at(p1, off.right), at(p0, off.right)], id: o.id });
      const mid = (off.left + off.right) / 2;
      out.push({ kind: 'line', role: 'window-glass', a: at(p0, mid), b: at(p1, mid), id: o.id });
    } else if (o.type === 'opening') {
      // A plain opening is a gap in the wall; its outline keeps it visible and pickable.
      out.push({ kind: 'polygon', role: 'opening', points: [at(p0, off.left), at(p1, off.left), at(p1, off.right), at(p0, off.right)], id: o.id });
    } else if (o.type === 'niche') {
      // The recess, drawn over the solid wall from the face it opens on.
      const faceAt = o.face === 'right' ? off.right : off.left;
      const back = faceAt + (o.face === 'right' ? 1 : -1) * Math.min(o.depth ?? 0, Math.abs(off.left - off.right));
      out.push({ kind: 'polygon', role: 'opening', points: [at(p0, faceAt), at(p1, faceAt), at(p1, back), at(p0, back)], id: o.id });
    } else {
      // The leaf stands open at 90° on the side it swings to, with its sweep drawn as an arc.
      const hingeAlong = o.hinge === 'end' ? p1 : p0;
      const otherAlong = o.hinge === 'end' ? p0 : p1;
      const side = o.swing === 'right' ? -1 : 1;
      const face = side > 0 ? off.left : off.right;
      const hinge = at(hingeAlong, face);
      const tip = add(hinge, scale(n, side * o.width));
      out.push({ kind: 'line', role: 'door-leaf', a: hinge, b: tip, id: o.id });
      out.push({ kind: 'arc', role: 'door-swing', from: tip, to: at(otherAlong, face), centre: hinge, radius: o.width, id: o.id });
    }
  }
}

/** The length of an outside wall, drawn outside the building. Inside walls (rooms on both
 *  sides) get none: the room labels give those sizes. */
function outsideDimension(w: Wall, rooms: Vec2[][]): PlanPrimitive | null {
  const len = wallLength(w);
  if (len < 0.3) return null;
  const d = wallDirection(w);
  const n = leftOf(d);
  const off = faceOffsets(w);
  const mid = add(w.start, scale(d, len / 2));
  const roomOn = (face: 'left' | 'right') => rooms.some((r) => pointInPolygon(add(mid, scale(n, off[face] + (face === 'left' ? 0.08 : -0.08))), r));
  if (roomOn('left') && roomOn('right')) return null;
  const centre = rooms.length ? polygonCentroid(rooms.flat()) : ([0, 0] as Vec2);
  const towardsCentre = (centre[0] - mid[0]) * n[0] + (centre[1] - mid[1]) * n[1];
  const side = towardsCentre > 0 ? -1 : 1;
  const base = side > 0 ? off.left : off.right;
  const set = (p: Vec2) => add(p, scale(n, base + side * DIMENSION_GAP));
  const uncertainty = wallLengthUncertainty(w);
  return {
    kind: 'dimension',
    a: set(w.start),
    b: set(w.end),
    out: scale(n, side),
    label: formatLength(len, uncertainty === undefined ? {} : { uncertainty }),
    estimated: isGuess(w),
    wall: w.id,
  };
}
