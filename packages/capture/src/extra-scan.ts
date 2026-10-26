// Another scan of a room that is already in the home. Three or four scans of one room give
// more photos and depth to build from and check against: they add no walls, only data, once
// they are lined up with the room.
//
// Lining up: when the phone recognised the room from an earlier scan ("relocalized"), the new
// scan shares that scan's coordinates, so it takes the same place in the home. Otherwise it is
// lined up by its shape: turned square like any import, tried at each quarter turn, and slid
// until its walls lie on the room's walls. Either way, how well its walls agree with the
// model is reported: scans that disagree point at drift or a wrong measurement.
import { captureToPlan, EditError, faceOffsets, leftOf, pointInPolygon, wallDirection, type BaseOperation, type Home, type Room, type Vec2 } from '@fullscale/core';
import type { ScanInput } from './import.ts';
import { column, readRoomPlan, transformPoint, type ScanElement, type Vec3 } from './roomplan.ts';

export interface ExtraScan {
  operation: BaseOperation;
  toHome: { yaw: number; offset: Vec2; floorY: number; level: string };
  room: string;
  /** relocalized: the phone recognised the room; shape: lined up by its walls */
  method: 'relocalized' | 'shape';
  /** the capture it shares coordinates with, when relocalized */
  sharesWorldWith?: string;
  /** how far the new scan's wall ends are from the room's walls (average and largest), and
   *  the largest difference in a wall's length, metres */
  fit: { mean: number; worst: number; length: number };
  /** things the new scan found where the model has nothing */
  newObjects: Array<{ category: string; position: Vec2; size: Vec3 }>;
  notes: string[];
}

/** Plan adding a capture as another scan of `roomId` (or, for a relocalized scan, of the
 *  room it adds to). Nothing changes until the operation is applied. */
export function planExtraScan(home: Home, input: ScanInput, opts: { room?: string } = {}): ExtraScan {
  const scans = input.rooms.map((r) => readRoomPlan(r.layout));
  const walls = scans.flatMap((s) => s.walls);
  if (!walls.length) throw new EditError('invalid_input', 'The capture has no walls the scanner recognised, so it can’t be lined up with the room.');
  const floors = scans.flatMap((s) => s.floors);
  const floorY = floors.length ? Math.min(...floors.map((f) => f.transform[13]!)) : Math.min(...walls.map((w) => w.transform[13]! - w.size[1] / 2));

  // The scan it adds to, when the phone carried on in that scan's coordinates.
  const addsTo = input.manifest?.rooms.find((r) => r.addsTo)?.addsTo;
  const earlier = addsTo && input.manifest?.alignment?.method === 'relocalized' ? home.captures.find((c) => c.toHome && c.path.split('/').pop() === addsTo.capture) : undefined;

  const ends = walls.flatMap(wallEnds);
  let toHome: ExtraScan['toHome'];
  let method: ExtraScan['method'];
  let room: Room | undefined;
  if (earlier?.toHome) {
    toHome = { ...earlier.toHome };
    method = 'relocalized';
    const middle = average(ends.map((p) => captureToPlan(toHome, p[0], p[2])));
    room = opts.room ? findRoom(home, opts.room) : home.rooms.find((r) => r.level === toHome.level && pointInPolygon(middle, r.polygon));
    if (!room) throw new EditError('invalid_input', 'The scan it adds to isn’t inside a room of the home. Say which room it is a scan of (room).');
  } else {
    if (!opts.room) {
      throw new EditError(
        'invalid_input',
        'This capture wasn’t lined up with an earlier scan on the phone. Say which room of the home it is another scan of (room), and it will be lined up by its walls.',
      );
    }
    room = findRoom(home, opts.room);
    // Doors and windows tell a room from itself turned halfway round.
    const marks = {
      scanned: scans.flatMap((s) => [...s.doors, ...s.windows]).map((o) => column(o.transform, 3)),
      home: openingCentres(home, room),
    };
    toHome = { ...lineUp(ends, room.polygon, marks), floorY: round(floorY), level: room.level };
    method = 'shape';
  }

  const edges = room.polygon.map((p, i) => [p, room!.polygon[(i + 1) % room!.polygon.length]!] as [Vec2, Vec2]);
  const gaps = ends.map((p) => nearestOnEdges(captureToPlan(toHome, p[0], p[2]), edges).distance);
  // Ends can sit on the room's wall lines while the walls are shorter or longer than the
  // room's: compare each scanned wall with the side of the room it lies along.
  const lengths = walls.map((w) => {
    const [a, b] = wallEnds(w).map((p) => captureToPlan(toHome, p[0], p[2])) as [Vec2, Vec2];
    const middle: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const along = edges
      .filter(([c, d]) => Math.abs(((b[0] - a[0]) * (d[0] - c[0]) + (b[1] - a[1]) * (d[1] - c[1])) / (Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(d[0] - c[0], d[1] - c[1]) || 1)) > 0.95)
      .sort((x, y) => nearestOnEdges(middle, [x]).distance - nearestOnEdges(middle, [y]).distance)[0];
    return along ? Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - Math.hypot(along[1][0] - along[0][0], along[1][1] - along[0][1])) : 0;
  });
  const fit = { mean: round3(gaps.reduce((a, b) => a + b, 0) / gaps.length), worst: round3(Math.max(...gaps)), length: round3(Math.max(...lengths)) };

  const items = home.items.filter((i) => i.level === room!.level);
  const newObjects = scans
    .flatMap((s) => s.objects)
    .map((o) => ({ o, at: captureToPlan(toHome, column(o.transform, 3)[0], column(o.transform, 3)[2]) }))
    .filter(({ at }) => pointInPolygon(at, room!.polygon) && !items.some((i) => Math.hypot(i.position[0] - at[0], i.position[2] - at[1]) < 0.4))
    .map(({ o, at }) => ({ category: o.category, position: [round3(at[0]), round3(at[1])] as Vec2, size: o.size }));

  const notes = [
    method === 'relocalized' ? `The phone recognised ${room.name} from the earlier scan (${earlier!.id}), so this scan shares its place in the home.` : `Lined up with ${room.name} by its walls.`,
    `Its walls are on average ${cm(fit.mean)} from the model's, at most ${cm(fit.worst)}; wall lengths differ by up to ${cm(fit.length)}.`,
  ];
  if (fit.worst > 0.05 || fit.length > 0.05) {
    notes.push(
      'The scans disagree by more than 5 cm: one of them may have drifted (walls at the ends of a long room come out short or long), or a wall is placed wrongly. A tape measure settles it; until then, don’t build the detailed model from both.',
    );
  }
  if (newObjects.length) notes.push(`It found ${newObjects.length} thing(s) where the model has nothing: ${newObjects.map((o) => `${o.category} at [${o.position.join(', ')}]`).join('; ')}.`);

  return {
    operation: {
      op: 'addCapture',
      kind: 'phone-capture',
      path: input.path,
      toHome,
      note: `another scan of ${room.name} (${room.id}), lined up ${method === 'relocalized' ? 'by the phone' : 'by its walls'}`,
    } as BaseOperation,
    toHome,
    room: room.id,
    method,
    ...(earlier ? { sharesWorldWith: earlier.id } : {}),
    fit,
    newObjects,
    notes,
  };
}

/**
 * Line up wall ends (in capture coordinates) with a room's outline: turn them square to the
 * plan, try each quarter turn, slide each onto the outline, and keep the best.
 */
export function lineUp(ends: Vec3[], polygon: Vec2[], marks?: { scanned: Vec3[]; home: Vec2[] }): { yaw: number; offset: Vec2 } {
  const edges = polygon.map((p, i) => [p, polygon[(i + 1) % polygon.length]!] as [Vec2, Vec2]);
  const squared = squaringYaw(ends);
  let best: { yaw: number; offset: Vec2; error: number } | null = null;
  for (let k = 0; k < 4; k++) {
    const yaw = squared + (k * Math.PI) / 2;
    const turned = ends.map((p) => turn(yaw, p));
    // Start with the middles together, then slide towards the nearest walls a few times.
    const target = average(polygon);
    const start = average(turned);
    let offset: Vec2 = [target[0] - start[0], target[1] - start[1]];
    for (let step = 0; step < 20; step++) {
      let dx = 0;
      let dz = 0;
      for (const p of turned) {
        const near = nearestOnEdges([p[0] + offset[0], p[1] + offset[1]], edges);
        dx += near.point[0] - (p[0] + offset[0]);
        dz += near.point[1] - (p[1] + offset[1]);
      }
      offset = [offset[0] + dx / turned.length, offset[1] + dz / turned.length];
    }
    let error = turned.reduce((sum, p) => sum + nearestOnEdges([p[0] + offset[0], p[1] + offset[1]], edges).distance, 0) / turned.length;
    if (marks?.scanned.length && marks.home.length) {
      const missed = marks.scanned.map((m) => {
        const [x, z] = turn(yaw, m);
        return Math.min(1, ...marks.home.map((h) => Math.hypot(x + offset[0] - h[0], z + offset[1] - h[1])));
      });
      error += missed.reduce((a, b) => a + b, 0) / missed.length;
    }
    if (!best || error < best.error) best = { yaw, offset, error };
  }
  return { yaw: round((best!.yaw * 180) / Math.PI), offset: [round(best!.offset[0]), round(best!.offset[1])] };
}

// The same squaring as the importer: the average wall direction folded to a quarter turn.
function squaringYaw(ends: Vec3[]): number {
  let sin = 0;
  let cos = 0;
  for (let i = 0; i + 1 < ends.length; i += 2) {
    const [a, b] = [ends[i]!, ends[i + 1]!];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const angle = Math.atan2(b[2] - a[2], b[0] - a[0]);
    sin += len * Math.sin(4 * angle);
    cos += len * Math.cos(4 * angle);
  }
  return Math.atan2(sin, cos) / 4;
}

function turn(yaw: number, p: Vec3): Vec2 {
  return [p[0] * Math.cos(yaw) + p[2] * Math.sin(yaw), -p[0] * Math.sin(yaw) + p[2] * Math.cos(yaw)];
}

function wallEnds(w: ScanElement): Vec3[] {
  const half = w.size[0] / 2;
  return [transformPoint(w.transform, [-half, 0, 0]), transformPoint(w.transform, [half, 0, 0])];
}

function nearestOnEdges(p: Vec2, edges: Array<[Vec2, Vec2]>): { point: Vec2; distance: number } {
  let best = { point: p, distance: Infinity };
  for (const [a, b] of edges) {
    const abx = b[0] - a[0];
    const abz = b[1] - a[1];
    const len2 = abx * abx + abz * abz || 1e-12;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / len2));
    const q: Vec2 = [a[0] + abx * t, a[1] + abz * t];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best.distance) best = { point: q, distance: d };
  }
  return best;
}

/** The middles of the doors and windows on a room's walls, on the plan. */
function openingCentres(home: Home, room: Room): Vec2[] {
  return home.openings.flatMap((o) => {
    const wall = home.walls.find((w) => w.id === o.wall && w.level === room.level);
    if (!wall || (o.type !== 'door' && o.type !== 'window')) return [];
    const d = wallDirection(wall);
    const n = leftOf(d);
    const off = faceOffsets(wall);
    const mid = (off.left + off.right) / 2;
    const along = o.offset + o.width / 2;
    return [[wall.start[0] + d[0] * along + n[0] * mid, wall.start[1] + d[1] * along + n[1] * mid] as Vec2];
  });
}

function findRoom(home: Home, id: string): Room {
  const room = home.rooms.find((r) => r.id === id);
  if (!room) throw new EditError('not_found', `No room "${id}".`, { id, kind: 'room' });
  return room;
}

function average(points: Vec2[]): Vec2 {
  return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const cm = (m: number) => `${Math.round(m * 1000) / 10} cm`;
