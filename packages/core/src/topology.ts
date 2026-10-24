// Walls as a network: where they meet, which areas they close off (rooms), and which ends
// are left loose.
//
// Walls are joined the way a person reads a plan, not only where their lines touch. A wall
// drawn up to another wall's face (common when each room's walls are drawn at the room's
// inside faces) still meets it: its line is carried on along its own direction until it
// reaches the other wall's line, if that is within the other wall's thickness. Walls that
// cross are joined where they cross. Rooms are the closed areas of this network, outlined
// at the wall faces on the room side, which is the `Room.polygon` rule.
import { add, bounds, cross, distance, dot, faceOffsets, isSimplePolygon, leftOf, pointInPolygon, scale, signedArea, sub, wallDirection, wallLength } from './geometry.ts';
import { JOIN_TOLERANCE } from './joins.ts';
import { MIN_WALL_LENGTH } from './rules.ts';
import type { Home, Vec2, Wall } from './schema.ts';

/** Closed areas smaller than this are gaps between walls, not rooms. */
export const ROOM_MIN_AREA = 0.25;
/** Closed areas larger than this are a drawing mistake, not a room. */
export const ROOM_MAX_AREA = 10_000;
/** How far a loose wall end looks for something to join. */
export const OPEN_END_REACH = 0.5;

export type WallEndName = 'start' | 'end';

/** One stretch of a wall between two junctions. `from` and `to` follow the wall's own
 *  direction, so `along0 < along1`. */
export interface GraphEdge {
  wall: Wall;
  from: number;
  to: number;
  along0: number;
  along1: number;
}

export interface WallGraph {
  /** junction points */
  nodes: Vec2[];
  edges: GraphEdge[];
  /** the junction each wall end attaches to */
  ends: Map<string, Record<WallEndName, number>>;
}

interface Line {
  point: Vec2;
  dir: Vec2;
}

/** Where line a meets line b, as distances along each from its point; null if parallel. */
function meet(a: Line, b: Line): { s: number; u: number } | null {
  const det = cross(a.dir, b.dir);
  if (Math.abs(det) < 1e-9) return null;
  const rel = sub(b.point, a.point);
  return { s: cross(rel, b.dir) / det, u: cross(rel, a.dir) / det };
}

const centreLine = (w: Wall): Line => ({ point: w.start, dir: wallDirection(w) });
const outward = (w: Wall, which: WallEndName): Vec2 => (which === 'end' ? wallDirection(w) : scale(wallDirection(w), -1));
const alongWall = (w: Wall, p: Vec2) => dot(sub(p, w.start), wallDirection(w));

export interface AxisHit {
  host: Wall;
  point: Vec2;
  /** how far the end would move along its own direction: positive extends the wall,
   *  negative shortens it */
  gap: number;
}

/**
 * Where a wall end meets another wall if its line is carried on along its own direction
 * (forwards, or back into the wall) by at most `reach` metres. With `touching`, only walls
 * the end already touches count. The nearest such wall wins.
 */
export function axisHit(walls: readonly Wall[], wall: Wall, which: WallEndName, opts: { reach: number; touching?: boolean }): AxisHit | null {
  const p = wall[which];
  const out = outward(wall, which);
  let best: AxisHit | null = null;
  for (const host of walls) {
    if (host.id === wall.id || host.level !== wall.level) continue;
    if (opts.touching && distanceToWallBody(host, p) > JOIN_TOLERANCE) continue;
    const hit = meet({ point: p, dir: out }, centreLine(host));
    if (!hit) continue;
    if (hit.u < -JOIN_TOLERANCE || hit.u > wallLength(host) + JOIN_TOLERANCE) continue;
    if (Math.abs(hit.s) > opts.reach) continue;
    // Carrying the line backwards must not use the wall up.
    if (hit.s < 0 && -hit.s > wallLength(wall) - MIN_WALL_LENGTH) continue;
    if (!best || Math.abs(hit.s) < Math.abs(best.gap)) best = { host, point: add(p, scale(out, hit.s)), gap: hit.s };
  }
  return best;
}

/** Distance from a point to a wall's solid body (its square-ended footprint); 0 inside. */
export function distanceToWallBody(wall: Wall, p: Vec2): number {
  const d = wallDirection(wall);
  const rel = sub(p, wall.start);
  const a = dot(rel, d);
  const across = dot(rel, leftOf(d));
  const off = faceOffsets(wall);
  const outAlong = Math.max(0, -a, a - wallLength(wall));
  const outAcross = Math.max(0, off.right - across, across - off.left);
  return Math.hypot(outAlong, outAcross);
}

/** Group points closer than `tolerance` (chains count). Returns a group number per point,
 *  numbered in order of first appearance. */
function cluster(points: readonly Vec2[], tolerance: number): number[] {
  const parent = points.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (distance(points[i]!, points[j]!) <= tolerance) parent[root(i)] = root(j);
    }
  }
  const number = new Map<number, number>();
  return points.map((_, i) => {
    const r = root(i);
    if (!number.has(r)) number.set(r, number.size);
    return number.get(r)!;
  });
}

/** A point where a wall meets the network. */
interface Stop {
  wall: Wall;
  along: number;
  point: Vec2;
  end?: WallEndName;
}

/** The network of walls on one level. */
export function wallGraph(home: Home, levelId: string): WallGraph {
  const walls = home.walls.filter((w) => w.level === levelId && wallLength(w) >= MIN_WALL_LENGTH).sort((a, b) => a.id.localeCompare(b.id));
  const stops: Stop[] = [];

  // Each end attaches where it meets other ends; failing that, where its line reaches
  // another wall within that wall's thickness; failing that, it stays loose.
  const maxThickness = Math.max(0, ...walls.map((w) => w.thickness));
  const endGroup = cluster(
    walls.flatMap((w) => [w.start, w.end]),
    JOIN_TOLERANCE,
  );
  const groupSize = new Map<number, number>();
  for (const g of endGroup) groupSize.set(g, (groupSize.get(g) ?? 0) + 1);
  walls.forEach((wall, i) => {
    (['start', 'end'] as const).forEach((which, k) => {
      const shared = groupSize.get(endGroup[2 * i + k]!)! > 1;
      // A wall that stops against another wall's face is carried on to that wall's line.
      const hit = shared ? null : axisHit(walls, wall, which, { reach: maxThickness + JOIN_TOLERANCE, touching: true });
      if (!hit) {
        stops.push({ wall, along: which === 'start' ? 0 : wallLength(wall), point: wall[which], end: which });
        return;
      }
      stops.push({ wall, along: alongWall(wall, hit.point), point: hit.point, end: which });
      stops.push({ wall: hit.host, along: alongWall(hit.host, hit.point), point: hit.point });
    });
  });

  // Walls that cross away from their ends meet where they cross.
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i]!;
      const b = walls[j]!;
      const hit = meet(centreLine(a), centreLine(b));
      const inside = (t: number, w: Wall) => t > JOIN_TOLERANCE && t < wallLength(w) - JOIN_TOLERANCE;
      if (!hit || !inside(hit.s, a) || !inside(hit.u, b)) continue;
      const point = add(a.start, scale(wallDirection(a), hit.s));
      stops.push({ wall: a, along: hit.s, point }, { wall: b, along: hit.u, point });
    }
  }

  const nodeOf = cluster(
    stops.map((s) => s.point),
    JOIN_TOLERANCE,
  );
  const sums: Array<{ sum: Vec2; n: number }> = [];
  stops.forEach((s, i) => {
    const node = nodeOf[i]!;
    const acc = sums[node] ?? { sum: [0, 0] as Vec2, n: 0 };
    sums[node] = { sum: add(acc.sum, s.point), n: acc.n + 1 };
  });
  const nodes = sums.map((s) => scale(s.sum, 1 / s.n));

  const ends = new Map<string, Record<WallEndName, number>>();
  const byWall = new Map<string, Array<{ along: number; node: number }>>(walls.map((w) => [w.id, []]));
  stops.forEach((s, i) => {
    byWall.get(s.wall.id)!.push({ along: s.along, node: nodeOf[i]! });
    if (s.end) ends.set(s.wall.id, { ...(ends.get(s.wall.id) ?? { start: -1, end: -1 }), [s.end]: nodeOf[i]! });
  });

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const wall of walls) {
    const list = byWall.get(wall.id)!.sort((a, b) => a.along - b.along);
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i]!;
      const b = list[i + 1]!;
      if (a.node === b.node) continue;
      // Walls drawn over each other would give the same stretch twice; keep one.
      const key = a.node < b.node ? `${a.node}|${b.node}` : `${b.node}|${a.node}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ wall, from: a.node, to: b.node, along0: a.along, along1: b.along });
    }
  }
  return { nodes, edges, ends };
}

// ---------- rooms ----------

/** The part of one wall face that borders a room. */
export interface FaceSpan {
  wall: string;
  face: 'left' | 'right';
  /** distances along the wall, from its start, where the room's border on that face runs */
  from: number;
  to: number;
}

export interface FoundRoom {
  /** outline at the room-side wall faces, in the same turning direction as rooms drawn by
   *  `addRectangularRoom` */
  polygon: Vec2[];
  area: number;
  /** the walls around the room, with the stretch of each face that borders it */
  spans: FaceSpan[];
}

interface HalfEdge {
  edge: GraphEdge;
  /** walking the wall's own direction */
  forward: boolean;
}

const tail = (h: HalfEdge) => (h.forward ? h.edge.from : h.edge.to);
const head = (h: HalfEdge) => (h.forward ? h.edge.to : h.edge.from);

/** The face line of a wall on one side. Walking a wall forwards, the area on your
 *  counter-clockwise side (in x/z) is on the wall's "right" face. */
function faceLine(wall: Wall, face: 'left' | 'right'): Line {
  const d = wallDirection(wall);
  return { point: add(wall.start, scale(leftOf(d), faceOffsets(wall)[face])), dir: d };
}

const sideOf = (h: HalfEdge): 'left' | 'right' => (h.forward ? 'right' : 'left');

/** Every area closed off by walls on a level, smallest ids first. */
export function findRooms(home: Home, levelId: string): FoundRoom[] {
  const graph = wallGraph(home, levelId);
  const edges = withoutLooseBranches(graph);

  const outgoing = new Map<number, HalfEdge[]>();
  const halves: HalfEdge[] = [];
  for (const edge of edges) {
    for (const forward of [true, false]) {
      const h = { edge, forward };
      halves.push(h);
      outgoing.set(tail(h), [...(outgoing.get(tail(h)) ?? []), h]);
    }
  }
  const angleOf = (h: HalfEdge) => {
    const d = sub(graph.nodes[head(h)]!, graph.nodes[tail(h)]!);
    return Math.atan2(d[1], d[0]);
  };
  for (const list of outgoing.values()) list.sort((a, b) => angleOf(a) - angleOf(b));

  // Walk each face keeping it on the counter-clockwise side: at every junction, leave by
  // the edge just clockwise of the one you arrived along.
  const next = (h: HalfEdge): HalfEdge => {
    const list = outgoing.get(head(h))!;
    const back = list.findIndex((o) => o.edge === h.edge && o.forward !== h.forward);
    return list[(back - 1 + list.length) % list.length]!;
  };

  const used = new Set<HalfEdge>();
  const rooms: FoundRoom[] = [];
  for (const start of halves) {
    if (used.has(start)) continue;
    const cycle: HalfEdge[] = [];
    let h = start;
    while (!used.has(h)) {
      used.add(h);
      cycle.push(h);
      h = next(h);
    }
    if (h !== start) continue;
    const centreArea = signedArea(cycle.map((c) => graph.nodes[tail(c)]!));
    if (centreArea <= 0) continue; // the outside of a group of walls
    const room = faceOutline(cycle, graph.nodes);
    if (room && room.area >= ROOM_MIN_AREA && room.area <= ROOM_MAX_AREA) rooms.push(room);
  }
  return rooms;
}

/** Edges that close something off: loose branches (walls that stop in the open, and
 *  whatever hangs off them) are trimmed away. */
function withoutLooseBranches(graph: WallGraph): GraphEdge[] {
  let edges = graph.edges;
  for (;;) {
    const degree = new Map<number, number>();
    for (const e of edges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    const kept = edges.filter((e) => degree.get(e.from)! > 1 && degree.get(e.to)! > 1);
    if (kept.length === edges.length) return kept;
    edges = kept;
  }
}

function faceOutline(cycle: HalfEdge[], nodes: Vec2[]): FoundRoom | null {
  const lines = cycle.map((h) => faceLine(h.edge.wall, sideOf(h)));
  const polygon: Vec2[] = [];
  // Corner i joins half-edge i to half-edge i + 1.
  const corners: Vec2[][] = cycle.map((h, i) => {
    const a = lines[i]!;
    const b = lines[(i + 1) % cycle.length]!;
    const node = nodes[head(h)]!;
    const hit = meet(a, b);
    const limit = 10 * Math.max(h.edge.wall.thickness, cycle[(i + 1) % cycle.length]!.edge.wall.thickness);
    if (hit) {
      const p = add(a.point, scale(a.dir, hit.s));
      if (distance(p, node) <= limit) return [p];
    }
    // Parallel faces (a wall continuing straight on, maybe at another thickness) or a
    // very sharp corner: step across at the junction.
    const pa = project(a, node);
    const pb = project(b, node);
    return distance(pa, pb) < 1e-9 ? [] : [pa, pb];
  });
  for (const c of corners) for (const p of c) if (!polygon.length || distance(polygon[polygon.length - 1]!, p) > 1e-9) polygon.push(p);
  while (polygon.length > 1 && distance(polygon[0]!, polygon[polygon.length - 1]!) < 1e-9) polygon.pop();
  const outline = dropStraightPoints(polygon);
  if (outline.length < 3 || !isSimplePolygon(outline)) return null;
  const area = signedArea(outline);
  if (area <= 0) return null;

  const spans: FaceSpan[] = cycle.map((h, i) => {
    const wall = h.edge.wall;
    const prev = corners[(i - 1 + cycle.length) % cycle.length]!;
    const here = corners[i]!;
    const startPoint = prev.length ? prev[prev.length - 1]! : project(lines[i]!, nodes[tail(h)]!);
    const endPoint = here.length ? here[0]! : project(lines[i]!, nodes[head(h)]!);
    const a = alongWall(wall, startPoint);
    const b = alongWall(wall, endPoint);
    return { wall: wall.id, face: sideOf(h), from: Math.min(a, b), to: Math.max(a, b) };
  });
  return { polygon: outline, area, spans: mergeSpans(spans) };
}

function project(line: Line, p: Vec2): Vec2 {
  return add(line.point, scale(line.dir, dot(sub(p, line.point), line.dir)));
}

/** Remove points that lie on the straight line between their neighbours. */
function dropStraightPoints(poly: Vec2[]): Vec2[] {
  const out = poly.filter((p, i) => {
    const a = poly[(i - 1 + poly.length) % poly.length]!;
    const b = poly[(i + 1) % poly.length]!;
    return Math.abs(cross(sub(p, a), sub(b, p))) > 1e-9 * Math.max(1, distance(a, b));
  });
  return out;
}

function mergeSpans(spans: FaceSpan[]): FaceSpan[] {
  const out: FaceSpan[] = [];
  for (const s of spans) {
    const same = out.find((o) => o.wall === s.wall && o.face === s.face && s.from <= o.to + 1e-9 && o.from <= s.to + 1e-9);
    if (same) {
      same.from = Math.min(same.from, s.from);
      same.to = Math.max(same.to, s.to);
    } else out.push({ ...s });
  }
  return out;
}

// ---------- loose ends ----------

export interface OpenEnd {
  wall: string;
  end: WallEndName;
  point: Vec2;
  /** what the end could join, if anything is within reach */
  candidate: { kind: 'wall'; wall: string; point: Vec2; gap: number } | { kind: 'end'; wall: string; end: WallEndName; point: Vec2; gap: number } | null;
}

/** Wall ends that meet nothing. These stop rooms from closing; after a scan import they
 *  are the first thing to fix. */
export function openWallEnds(home: Home, levelId: string): OpenEnd[] {
  const graph = wallGraph(home, levelId);
  const degree = new Map<number, number>();
  for (const e of graph.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const walls = graph.edges.map((e) => e.wall).filter((w, i, all) => all.indexOf(w) === i);
  const open: OpenEnd[] = [];
  for (const [wallId, ends] of [...graph.ends].sort(([a], [b]) => a.localeCompare(b))) {
    const wall = walls.find((w) => w.id === wallId);
    if (!wall) continue;
    for (const which of ['start', 'end'] as const) {
      if ((degree.get(ends[which]) ?? 0) > 1) continue;
      open.push({ wall: wallId, end: which, point: wall[which], candidate: joinCandidate(home, wall, which) });
    }
  }
  return open;
}

/** The nearest thing a loose wall end could join: another wall its line reaches, or
 *  another wall's end. */
export function joinCandidate(home: Home, wall: Wall, which: WallEndName): OpenEnd['candidate'] {
  const others = home.walls.filter((w) => w.level === wall.level && w.id !== wall.id && wallLength(w) >= MIN_WALL_LENGTH);
  const hit = axisHit(others, wall, which, { reach: OPEN_END_REACH });
  let best: OpenEnd['candidate'] = hit ? { kind: 'wall', wall: hit.host.id, point: hit.point, gap: Math.abs(hit.gap) } : null;
  for (const w of others) {
    for (const end of ['start', 'end'] as const) {
      const gap = distance(w[end], wall[which]);
      if (gap <= OPEN_END_REACH && (!best || gap < best.gap - 1e-9)) best = { kind: 'end', wall: w.id, end, point: w[end], gap };
    }
  }
  return best;
}

// ---------- comparing outlines ----------

/** True when two outlines have the same corners in the same order (from any corner and in
 *  either direction), within `tolerance`. */
export function sameOutline(a: Vec2[], b: Vec2[], tolerance = 1e-6): boolean {
  if (a.length !== b.length) return false;
  const n = a.length;
  for (const dir of [1, -1]) {
    for (let shift = 0; shift < n; shift++) {
      let ok = true;
      for (let i = 0; i < n && ok; i++) ok = distance(a[i]!, b[(((shift + dir * i) % n) + n) % n]!) <= tolerance;
      if (ok) return true;
    }
  }
  return false;
}

/** How much two outlines overlap: shared area ÷ combined area (1 = identical, 0 = apart).
 *  Measured on a grid of about 4,000 points, which is plenty to tell rooms apart. */
export function outlineOverlap(a: Vec2[], b: Vec2[]): number {
  if (sameOutline(a, b)) return 1;
  const box = bounds([...a, ...b]);
  const ba = bounds(a);
  const bb = bounds(b);
  if (ba.max[0] <= bb.min[0] || bb.max[0] <= ba.min[0] || ba.max[1] <= bb.min[1] || bb.max[1] <= ba.min[1]) return 0;
  const step = Math.sqrt((box.size[0] * box.size[1]) / 4000) || 0.01;
  let both = 0;
  let either = 0;
  for (let x = box.min[0] + step / 2; x < box.max[0]; x += step) {
    for (let z = box.min[1] + step / 2; z < box.max[1]; z += step) {
      const inA = pointInPolygon([x, z], a);
      const inB = pointInPolygon([x, z], b);
      if (inA && inB) both++;
      if (inA || inB) either++;
    }
  }
  return either === 0 ? 0 : both / either;
}

// ---------- walls already there ----------

/**
 * An existing wall whose body already covers where a new wall would go: lying along it,
 * overlapping at least half the thinner wall's thickness, over the new wall's whole
 * length. Rooms drawn next to each other use this to share the wall between them.
 */
export function wallCovering(walls: readonly Wall[], w: Pick<Wall, 'start' | 'end' | 'thickness' | 'line'>): Wall | undefined {
  const d = wallDirection(w);
  const n = leftOf(d);
  const len = wallLength(w);
  const own = faceOffsets(w);
  for (const other of walls) {
    if (Math.abs(cross(d, wallDirection(other))) > 1e-6) continue;
    // The other wall's body across n: its faces, flipped if it runs the other way.
    const at = dot(sub(other.start, w.start), n);
    const off = faceOffsets(other);
    const sameWay = dot(d, wallDirection(other)) > 0;
    const [a, b] = sameWay ? [at + off.right, at + off.left] : [at - off.left, at - off.right];
    const across = Math.min(b, own.left) - Math.max(a, own.right);
    if (across < Math.min(w.thickness, other.thickness) / 2) continue;
    const s = dot(sub(other.start, w.start), d);
    const e = dot(sub(other.end, w.start), d);
    if (Math.min(s, e) <= JOIN_TOLERANCE && Math.max(s, e) >= len - JOIN_TOLERANCE) return other;
  }
  return undefined;
}
