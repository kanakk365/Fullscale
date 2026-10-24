// "Will it fit here?" Every answer says what was checked, how, and what was not, and how
// sure the numbers are, so a footprint check is never mistaken for "it will definitely fit".
import { catalogEntry } from './catalog.ts';
import { EditError } from './errors.ts';
import { add, bounds, convexOverlap, itemFootprint, leftOf, pointInPolygon, polygonDistance, scale, wallDirection, wallFootprint } from './geometry.ts';
import { getRoom } from './measure.ts';
import { sourceOf, wallHeight } from './resolve.ts';
import type { Home, Item, Opening, Room, Source, SourceKind, Vec2, Vec3 } from './schema.ts';

/** A door needs this much clear floor on the side it doesn't open to, to walk through. */
export const DOOR_WALKWAY = 0.35;
/** Clear floor on the swing side is at least this deep, even for a narrow leaf. */
export const DOOR_SWING_MIN = 0.65;
/** Keep-outs are this much wider than the door on each side, for the frame and a hand. */
export const DOOR_SIDE_PAD = 0.05;
/** Overlaps smaller than this are rounding, not a clash. */
const OVERLAP_SLACK = 0.001;
/** Step of the search for a free spot. */
const SEARCH_STEP = 0.1;

export type FitProblemCode = 'hits_wall' | 'hits_item' | 'blocks_door' | 'outside_room' | 'too_large_for_room';

export interface FitProblem {
  code: FitProblemCode;
  ids: string[];
  message: string;
}

/** What an answer rests on. */
export interface Evidence {
  /** checked: everything listed was checked with measured or typed sizes; partial: some
   *  sizes are defaults or guesses; insufficient_evidence: a check could not be made */
  status: 'checked' | 'partial' | 'insufficient_evidence';
  method: string;
  /** ± metres on the closest clearance, from the sources of what it was measured between */
  uncertainty?: number;
  /** where the sizes involved came from */
  sources: SourceKind[];
  checked: string[];
  notChecked: string[];
  /** why the status is not "checked" */
  caveats: string[];
}

export interface FitAnswer extends Evidence {
  fits: boolean;
  problems: FitProblem[];
  /** the smallest gap to a wall and to another item at this pose */
  nearest: { wall?: { id: string; gap: number }; item?: { id: string; gap: number } };
  /** the nearest pose in the room where the footprint fits, when this one doesn't */
  suggestion?: { position: Vec3; rotation: number };
}

export interface FitQuery {
  /** [width, height, depth] in metres */
  size: [number, number, number];
  /** [x, z] on the floor, or [x, y, z] with y the bottom of the object */
  position: Vec2 | Vec3;
  rotation?: number;
  level?: string;
  /** keep at least this much space around it */
  clearance?: number;
  /** the room it should stand in; found from the position when left out */
  room?: string;
  /** elements to ignore, e.g. the item being moved */
  ignore?: string[];
  /** where the size came from, if it is not an existing item's */
  sizeSource?: Source;
  /** look for a free spot when it doesn't fit (default true) */
  suggest?: boolean;
}

interface Pose {
  centre: Vec2;
  rotation: number;
}

const m = (v: number) => `${(Math.round(v * 100) / 100).toFixed(2)} m`;

/** Check whether an object of a given size fits at a pose, on the floor plan. */
export function checkFit(home: Home, q: FitQuery): FitAnswer {
  const level = q.level ?? home.levels[0]!.id;
  const bottom = q.position.length === 3 ? q.position[1] : 0;
  const centre: Vec2 = q.position.length === 3 ? [q.position[0], q.position[2]] : q.position;
  const rotation = q.rotation ?? 0;
  const ignore = new Set(q.ignore ?? []);
  const room = q.room ? getRoom(home, q.room) : home.rooms.find((r) => r.level === level && pointInPolygon(centre, r.polygon));
  const ctx = context(home, level, ignore);

  const problems = problemsAt(home, ctx, q, { centre, rotation }, bottom, room);
  const answer = evidenceFor(ctx, q, room);
  const nearest = nearestGaps(ctx, footprint(q, { centre, rotation }));
  if (nearest.wall) answer.uncertainty = combine(answer.uncertainty, sourceOfWall(home, nearest.wall.id));
  const fits = problems.length === 0;
  const result: FitAnswer = { ...answer, fits, problems, nearest };
  if (!fits && room && q.suggest !== false && !problems.some((p) => p.code === 'too_large_for_room')) {
    const spot = findFreeSpot(home, ctx, q, room, { centre, rotation }, bottom);
    if (spot) result.suggestion = { position: [round3(spot.centre[0]), bottom, round3(spot.centre[1])], rotation: spot.rotation };
  }
  return result;
}

/** Check an existing item where it stands (or at a new pose). */
export function checkItemFit(home: Home, itemId: string, at?: { position?: Vec2 | Vec3; rotation?: number }, clearance = 0): FitAnswer {
  const item = home.items.find((i) => i.id === itemId);
  if (!item) throw new EditError('not_found', `No item with id "${itemId}".`, { id: itemId, kind: 'item' });
  return checkFit(home, {
    size: item.size,
    position: at?.position ?? item.position,
    rotation: at?.rotation ?? item.rotation,
    level: item.level,
    clearance,
    ignore: [item.id],
    sizeSource: sourceOf(item, 'size'),
  });
}

// ---------- the checks ----------

interface Context {
  walls: Home['walls'];
  items: Item[];
  doors: Array<{ opening: Opening; zones: Vec2[][] }>;
}

function context(home: Home, level: string, ignore: Set<string>): Context {
  const walls = home.walls.filter((w) => w.level === level && !ignore.has(w.id));
  const items = home.items.filter((i) => i.level === level && !ignore.has(i.id) && catalogEntry(i.catalog).shape !== 'rug');
  const doors = home.openings.filter((o) => o.type !== 'window' && walls.some((w) => w.id === o.wall)).map((o) => ({ opening: o, zones: doorZones(home, o) }));
  return { walls, items, doors };
}

/** The floor in front of and behind a door that must stay clear. */
export function doorZones(home: Home, o: Opening): Vec2[][] {
  const wall = home.walls.find((w) => w.id === o.wall)!;
  const d = wallDirection(wall);
  const n = leftOf(d);
  const a = add(wall.start, scale(d, o.offset - DOOR_SIDE_PAD));
  const b = add(wall.start, scale(d, o.offset + o.width + DOOR_SIDE_PAD));
  const half = wall.thickness / 2;
  // Centre of the wall's body at the opening, so zones start at the faces.
  const offset = wall.line === 'left' ? -half : wall.line === 'right' ? half : 0;
  const zone = (side: 1 | -1, depth: number): Vec2[] => {
    const from = scale(n, offset + side * half);
    const to = scale(n, offset + side * (half + depth));
    return [add(a, from), add(b, from), add(b, to), add(a, to)];
  };
  if (o.type !== 'door') return [zone(1, DOOR_WALKWAY), zone(-1, DOOR_WALKWAY)];
  const swingSide = o.swing === 'right' ? -1 : 1;
  return [zone(swingSide, Math.max(DOOR_SWING_MIN, o.width)), zone(-swingSide as 1 | -1, DOOR_WALKWAY)];
}

function footprint(q: Pick<FitQuery, 'size' | 'clearance'>, pose: Pose, grow = true): Vec2[] {
  const c = grow ? 2 * (q.clearance ?? 0) : 0;
  return itemFootprint({ position: [pose.centre[0], 0, pose.centre[1]], rotation: pose.rotation, size: [q.size[0] + c, q.size[1], q.size[2] + c] });
}

function problemsAt(home: Home, ctx: Context, q: FitQuery, pose: Pose, bottom: number, room: Room | undefined): FitProblem[] {
  const problems: FitProblem[] = [];
  const fp = footprint(q, pose);
  const top = bottom + q.size[1];

  if (room) {
    const b = bounds(room.polygon).size;
    const [w, , d] = q.size;
    if ((w > b[0] || d > b[1]) && (d > b[0] || w > b[1])) {
      problems.push({
        code: 'too_large_for_room',
        ids: [room.id],
        message: `${m(w)} × ${m(d)} doesn't fit in "${room.name}" (${m(b[0])} × ${m(b[1])} at most) either way round.`,
      });
      return problems;
    }
    const outside = itemFootprint({ position: [pose.centre[0], 0, pose.centre[1]], rotation: pose.rotation, size: q.size }).some((p) => !pointInPolygon(p, room.polygon));
    if (outside) problems.push({ code: 'outside_room', ids: [room.id], message: `Part of it is outside "${room.name}".` });
  }
  for (const w of ctx.walls) {
    if (bottom >= wallHeight(home, w)) continue;
    if (convexOverlap(fp, wallFootprint(w), OVERLAP_SLACK)) problems.push({ code: 'hits_wall', ids: [w.id], message: `It runs into wall "${w.id}".` });
  }
  for (const it of ctx.items) {
    const vertical = bottom < it.position[1] + it.size[1] && it.position[1] < top;
    if (vertical && convexOverlap(fp, itemFootprint(it), OVERLAP_SLACK)) {
      problems.push({ code: 'hits_item', ids: [it.id], message: `It overlaps "${it.name}" (${it.id}).` });
    }
  }
  for (const door of ctx.doors) {
    // Something hung above the door head can't block it.
    if (bottom >= door.opening.sill + door.opening.height) continue;
    const real = footprint(q, pose, false);
    if (door.zones.some((z) => convexOverlap(real, z, OVERLAP_SLACK))) {
      problems.push({ code: 'blocks_door', ids: [door.opening.id], message: `It stands where ${door.opening.type} "${door.opening.id}" needs clear floor.` });
    }
  }
  return problems;
}

function evidenceFor(ctx: Context, q: FitQuery, room: Room | undefined): Evidence {
  const caveats: string[] = [];
  const kinds = new Set<SourceKind>();
  const sizeKind = q.sizeSource?.kind ?? 'user';
  kinds.add(sizeKind);
  if (sizeKind === 'catalog' || sizeKind === 'estimate') caveats.push(`The size is ${sizeKind === 'catalog' ? 'the catalogue default' : 'a guess'}; enter the real product size to be sure.`);
  for (const w of ctx.walls) {
    const k = sourceOf(w, 'start')?.kind;
    if (k) kinds.add(k);
    if (k === 'estimate') caveats.push(`Wall "${w.id}" is placed by estimate.`);
  }
  const checked = ['footprint against walls', 'footprint against furniture'];
  const notChecked = ['height under beams or sloped ceilings', 'getting it into the room (check the doors with fits_through)', 'skirting boards, radiators and sockets, which are not in the model'];
  if (room) checked.push(`inside "${room.name}"`);
  else notChecked.push('which room it is in (it is not inside any room)');
  let status: Evidence['status'] = caveats.length ? 'partial' : 'checked';
  if (ctx.doors.length) checked.push('door swing and walkway areas');
  else {
    notChecked.push('door access: no doors are drawn on this level');
    status = 'insufficient_evidence';
  }
  const wallU = ctx.walls.map((w) => sourceOf(w, 'start')?.uncertainty).filter((u): u is number => u !== undefined);
  const uncertainty = combine(q.sizeSource?.uncertainty, ...(wallU.length ? [Math.max(...wallU)] : []));
  return { status, method: 'plan footprint at the given pose', ...(uncertainty !== undefined ? { uncertainty } : {}), sources: [...kinds].sort(), checked, notChecked, caveats };
}

function nearestGaps(ctx: Context, fp: Vec2[]): FitAnswer['nearest'] {
  const nearest: FitAnswer['nearest'] = {};
  for (const w of ctx.walls) {
    const gap = polygonDistance(fp, wallFootprint(w));
    if (!nearest.wall || gap < nearest.wall.gap) nearest.wall = { id: w.id, gap: round3(gap) };
  }
  for (const it of ctx.items) {
    const gap = polygonDistance(fp, itemFootprint(it));
    if (!nearest.item || gap < nearest.item.gap) nearest.item = { id: it.id, gap: round3(gap) };
  }
  return nearest;
}

/** The free pose closest to the one asked for: spots on a 10 cm grid inside the room, tried
 *  nearest first, each facing the way asked and then turned by quarter turns. */
function findFreeSpot(home: Home, ctx: Context, q: FitQuery, room: Room, wanted: Pose, bottom: number): Pose | null {
  const box = bounds(room.polygon);
  const steps = (from: number, to: number) => [Math.floor(from / SEARCH_STEP), Math.ceil(to / SEARCH_STEP)] as const;
  const [i0, i1] = steps(box.min[0] - wanted.centre[0], box.max[0] - wanted.centre[0]);
  const [j0, j1] = steps(box.min[1] - wanted.centre[1], box.max[1] - wanted.centre[1]);
  const spots: Array<{ centre: Vec2; move: number }> = [];
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const centre: Vec2 = [round3(wanted.centre[0] + i * SEARCH_STEP), round3(wanted.centre[1] + j * SEARCH_STEP)];
      if (pointInPolygon(centre, room.polygon)) spots.push({ centre, move: Math.hypot(i, j) });
    }
  }
  spots.sort((a, b) => a.move - b.move);
  // The pose asked for first, then the smallest turns (a quarter turn back before forward).
  const turns = [0, -90, 90, 180].map((t) => (((wanted.rotation + t) % 360) + 360) % 360);
  for (const { centre } of spots) {
    for (const rotation of turns) {
      if (problemsAt(home, ctx, q, { centre, rotation }, bottom, room).length === 0) return { centre, rotation };
    }
  }
  return null;
}

// ---------- helpers ----------

function sourceOfWall(home: Home, id: string): number | undefined {
  const w = home.walls.find((x) => x.id === id);
  return w ? sourceOf(w, 'start')?.uncertainty : undefined;
}

/** Root-sum-square of the known uncertainties; undefined if none are known. */
export function combine(...values: Array<number | undefined>): number | undefined {
  const known = values.filter((v): v is number => v !== undefined);
  return known.length ? Math.hypot(...known) : undefined;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
