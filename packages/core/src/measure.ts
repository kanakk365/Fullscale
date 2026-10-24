// Measurements on a home document. Everything returns metres (or square metres) and says
// how sure it is, so agents and people can quote numbers with confidence.
import { catalogEntry } from './catalog.ts';
import {
  add,
  bounds,
  distance,
  faceOffsets,
  itemFootprint,
  leftOf,
  lerp,
  pointInPolygon,
  pointSegmentDistance,
  polygonArea,
  polygonDistance,
  polygonPerimeter,
  round,
  scale,
  wallDirection,
  wallFootprint,
  wallLength,
} from './geometry.ts';
import { EditError } from './errors.ts';
import { ceilingHeight, sourceOf, wallHeight } from './resolve.ts';
import { findRooms, sameOutline } from './topology.ts';
import { locate } from './kinds.ts';
import type { Home, Opening, Room, Source, SourceKind, Vec2, Wall } from './schema.ts';

const r3 = (v: number) => round(v, 0.001);

function sourceLabel(s: Source | undefined): string {
  if (!s) return 'unknown';
  return s.uncertainty !== undefined ? `${s.kind} ±${Math.round(s.uncertainty * 1000) / 10} cm` : s.kind;
}

const notFound = (kind: string, id: string) => new EditError('not_found', `No ${kind} with id "${id}".`, { id, kind });

export function getWall(home: Home, id: string): Wall {
  const w = home.walls.find((x) => x.id === id);
  if (!w) throw notFound('wall', id);
  return w;
}

export function getRoom(home: Home, id: string): Room {
  const r = home.rooms.find((x) => x.id === id);
  if (!r) throw notFound('room', id);
  return r;
}

export function wallOpenings(home: Home, wallId: string): Opening[] {
  return home.openings.filter((o) => o.wall === wallId).sort((a, b) => a.offset - b.offset);
}

export function wallInfo(home: Home, id: string) {
  const w = getWall(home, id);
  const len = wallLength(w);
  const openings = wallOpenings(home, id);
  const height = wallHeight(home, w);
  const openingArea = openings.reduce((s, o) => s + o.width * Math.min(o.height, Math.max(0, height - o.sill)), 0);
  const gross = len * height;
  return {
    id: w.id,
    length: r3(len),
    thickness: r3(w.thickness),
    height: r3(height),
    /** true when the wall has no height of its own and follows its level */
    heightFollowsLevel: w.height === undefined,
    line: w.line,
    openings: openings.map((o) => ({ id: o.id, type: o.type, offset: r3(o.offset), width: r3(o.width), height: r3(o.height), sill: r3(o.sill) })),
    /** paintable area of one face, openings removed (corner joins not counted) */
    faceArea: r3(gross - openingArea),
    source: sourceLabel(w.source),
    /** where each dimension came from, e.g. { start: "scan ±1 cm", thickness: "estimate" } */
    sources: {
      start: sourceLabel(sourceOf(w, 'start')),
      end: sourceLabel(sourceOf(w, 'end')),
      thickness: sourceLabel(sourceOf(w, 'thickness')),
      height: w.height === undefined ? 'follows level' : sourceLabel(sourceOf(w, 'height')),
    },
  };
}

export interface RoomFace {
  wall: string;
  face: 'left' | 'right';
  /** the stretch of the face that borders the room, as distances along the wall */
  from: number;
  to: number;
  length: number;
}

/** Which wall faces line this room's outline, and which stretch of each. Exact when the
 *  room is the area its walls close off; otherwise faces are found by sampling. */
export function roomWallFaces(home: Home, roomId: string): RoomFace[] {
  const room = getRoom(home, roomId);
  const enclosed = findRooms(home, room.level).find((f) => sameOutline(f.polygon, room.polygon, 0.001));
  if (enclosed) return enclosed.spans.map((s) => ({ wall: s.wall, face: s.face, from: r3(s.from), to: r3(s.to), length: r3(s.to - s.from) }));

  const poly = room.polygon;
  const out: RoomFace[] = [];
  for (const w of home.walls) {
    if (w.level !== room.level) continue;
    const n = leftOf(wallDirection(w));
    const offsets = faceOffsets(w);
    for (const face of ['left', 'right'] as const) {
      const sign = face === 'left' ? 1 : -1;
      const off = offsets[face];
      // Sample the face at three points so walls that only partly border the room count.
      let hits = 0;
      for (const t of [0.25, 0.5, 0.75]) {
        const onFace = add(lerp(w.start, w.end, t), scale(n, off));
        const probe = add(onFace, scale(n, sign * 0.05));
        const nearOutline = minDistanceToOutline(onFace, poly) < 0.06;
        if (nearOutline && pointInPolygon(probe, poly)) hits++;
      }
      if (hits >= 2) out.push({ wall: w.id, face, from: 0, to: r3(wallLength(w)), length: r3(wallLength(w)) });
    }
  }
  return out;
}

function minDistanceToOutline(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, pointSegmentDistance(p, poly[i]!, poly[(i + 1) % poly.length]!));
  return best;
}

export function roomInfo(home: Home, id: string) {
  const room = getRoom(home, id);
  const height = ceilingHeight(home, room);
  const area = polygonArea(room.polygon);
  const perimeter = polygonPerimeter(room.polygon);
  const b = bounds(room.polygon);
  const faces = roomWallFaces(home, id);
  // Only the part of each door or window that lies on the stretch of wall bordering this
  // room counts: a long wall can have windows in the room next door.
  let openingArea = 0;
  for (const f of faces) {
    for (const o of wallOpenings(home, f.wall)) {
      const shared = Math.min(o.offset + o.width, f.to) - Math.max(o.offset, f.from);
      if (shared > 0) openingArea += shared * Math.min(o.height, Math.max(0, height - o.sill));
    }
  }
  const items = home.items.filter((i) => i.level === room.level && pointInPolygon([i.position[0], i.position[2]], room.polygon));
  return {
    id: room.id,
    name: room.name,
    area: r3(area),
    perimeter: r3(perimeter),
    /** size of the bounding box along x and z (exact for rectangular rooms) */
    width: r3(b.size[0]),
    depth: r3(b.size[1]),
    ceilingHeight: r3(height),
    volume: r3(area * height),
    /** wall area around the room minus doors and windows: what you would paint */
    paintableWallArea: r3(Math.max(0, perimeter * height - openingArea)),
    walls: faces,
    items: items.map((i) => ({ id: i.id, name: i.name })),
    source: sourceLabel(room.source),
  };
}

/** Can an object of this size be carried through this opening? Allows turning it on its side,
 *  but not tilting it diagonally. `margin` is the space to leave for hands and wrapping. */
export function fitsThrough(home: Home, openingId: string, size: [number, number, number], margin = 0.02): { fits: boolean; clearWidth: number; clearHeight: number; explanation: string } {
  const o = home.openings.find((x) => x.id === openingId);
  if (!o) throw notFound('opening', openingId);
  const W = o.width - margin;
  const H = o.height - margin;
  const [a, b] = [...size].sort((x, y) => x - y) as [number, number, number];
  const fits = (a <= W && b <= H) || (a <= H && b <= W);
  const cm = (v: number) => `${Math.round(v * 100)} cm`;
  const explanation = fits
    ? `Fits: its two smallest sides (${cm(a)} × ${cm(b)}) pass through ${cm(o.width)} × ${cm(o.height)} with ${cm(margin)} to spare.`
    : `Does not fit: its two smallest sides are ${cm(a)} × ${cm(b)}, but the opening is ${cm(o.width)} × ${cm(o.height)} (keeping ${cm(margin)} spare). Tilting diagonally might still work; measure first.`;
  return { fits, clearWidth: r3(o.width), clearHeight: r3(o.height), explanation };
}

/** Plan outline of any element, for distance checks. */
export function elementOutline(home: Home, id: string): Vec2[] | Vec2 {
  const w = home.walls.find((x) => x.id === id);
  if (w) return wallFootprint(w);
  const it = home.items.find((x) => x.id === id);
  if (it) return itemFootprint(it);
  const room = home.rooms.find((x) => x.id === id);
  if (room) return room.polygon;
  const o = home.openings.find((x) => x.id === id);
  if (o) {
    const wall = getWall(home, o.wall);
    const d = wallDirection(wall);
    const a = add(wall.start, scale(d, o.offset));
    const b = add(wall.start, scale(d, o.offset + o.width));
    const n = leftOf(d);
    const off = faceOffsets(wall);
    return [add(a, scale(n, off.left)), add(b, scale(n, off.left)), add(b, scale(n, off.right)), add(a, scale(n, off.right))];
  }
  throw new EditError('not_found', `Nothing with id "${id}".`, { id });
}

/** Shortest plan distance between two elements or points (0 when touching). */
export function planDistance(home: Home, a: string | Vec2, b: string | Vec2): number {
  const ga = typeof a === 'string' ? elementOutline(home, a) : a;
  const gb = typeof b === 'string' ? elementOutline(home, b) : b;
  const isPoint = (g: Vec2[] | Vec2): g is Vec2 => typeof g[0] === 'number';
  if (isPoint(ga) && isPoint(gb)) return r3(distance(ga, gb));
  if (isPoint(ga)) return r3(polygonDistance([ga, ga, ga], gb as Vec2[]));
  if (isPoint(gb)) return r3(polygonDistance(ga, [gb, gb, gb]));
  return r3(polygonDistance(ga, gb));
}

/** Free space around an item: nearest wall and nearest other item. */
export function clearance(home: Home, itemId: string) {
  const item = home.items.find((i) => i.id === itemId);
  if (!item) throw notFound('item', itemId);
  const fp = itemFootprint(item);
  let nearestWall: { id: string; distance: number } | null = null;
  for (const w of home.walls) {
    if (w.level !== item.level) continue;
    const d = polygonDistance(fp, wallFootprint(w));
    if (!nearestWall || d < nearestWall.distance) nearestWall = { id: w.id, distance: r3(d) };
  }
  let nearestItem: { id: string; distance: number } | null = null;
  for (const other of home.items) {
    if (other.id === item.id || other.level !== item.level) continue;
    if (catalogEntry(other.catalog).shape === 'rug' || catalogEntry(item.catalog).shape === 'rug') continue;
    const d = polygonDistance(fp, itemFootprint(other));
    if (!nearestItem || d < nearestItem.distance) nearestItem = { id: other.id, distance: r3(d) };
  }
  return { item: item.id, nearestWall, nearestItem };
}

export interface Measurement {
  /** metres */
  distance: number;
  /** ± metres, from the sources of both ends (root-sum-square), when known */
  uncertainty?: number;
  method: 'shortest gap between outlines' | 'between centres';
  /** where the positions involved came from */
  sources: SourceKind[];
}

function centreOf(home: Home, id: string): Vec2 {
  const outline = elementOutline(home, id);
  if (typeof outline[0] === 'number') return outline as Vec2;
  const item = home.items.find((x) => x.id === id);
  if (item) return [item.position[0], item.position[2]];
  const b = bounds(outline as Vec2[]);
  return [b.min[0] + b.size[0] / 2, b.min[1] + b.size[1] / 2];
}

function positionSource(home: Home, id: string): Source | undefined {
  const located = locate(home, id);
  if (!located) return undefined;
  const el = located.element as { source?: Source; sources?: Record<string, Source> };
  const field = located.info.kind === 'wall' ? 'start' : located.info.kind === 'item' ? 'position' : located.info.kind === 'opening' ? 'offset' : 'polygon';
  return sourceOf(el, field);
}

/** Distance between two elements or points, with how sure it is. */
export function measureBetween(home: Home, a: string | Vec2, b: string | Vec2, mode: 'gap' | 'centres' = 'gap'): Measurement {
  const distance_ = mode === 'gap' ? planDistance(home, a, b) : r3(distance(typeof a === 'string' ? centreOf(home, a) : a, typeof b === 'string' ? centreOf(home, b) : b));
  const ends = [a, b].map((x) => (typeof x === 'string' ? positionSource(home, x) : { kind: 'user' as const, uncertainty: 0 }));
  const known = ends.map((s) => s?.uncertainty);
  const result: Measurement = {
    distance: distance_,
    method: mode === 'gap' ? 'shortest gap between outlines' : 'between centres',
    sources: [...new Set(ends.map((s) => s?.kind).filter((k): k is SourceKind => k !== undefined))].sort(),
  };
  if (known.every((u) => u !== undefined)) result.uncertainty = r3(Math.hypot(...(known as number[])));
  return result;
}
