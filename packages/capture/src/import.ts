// Turning a phone scan into an editable home.
//
// The scanner reports each wall as the face it saw, with no thickness; doors and windows as
// rectangles on those faces; furniture as boxes. The importer turns the whole capture so most
// walls run along the plan's axes, puts it next to anything already on the level, and
// returns one batch of ordinary edit operations, so the import is a single undo step and
// goes through the same checks as any other edit. Every number is marked as scanned, with
// an uncertainty from the scanner's confidence; what the scanner can't see (wall thickness,
// door swing) is marked as an estimate.
import {
  allocateId,
  applyOperation,
  bounds,
  CATALOG_BY_ID,
  cross,
  distance,
  dot,
  EditError,
  findRooms,
  isSimplePolygon,
  leftOf,
  outlineOverlap,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  signedArea,
  sub,
  type BaseOperation,
  type Home,
  type Operation,
  type Source,
  type Vec2,
} from '@fullscale/core';
import type { Manifest, TapeCheck } from './format.ts';
import { column, readRoomPlan, transformPoint, type ScanElement, type ScanRoom, type Vec3 } from './roomplan.ts';

/** ± by the scanner's confidence. Defaults until tape checks on real phones measure them. */
export const SCAN_UNCERTAINTY: Readonly<Record<ScanElement['confidence'], number>> = { high: 0.02, medium: 0.04, low: 0.08, unknown: 0.08 };
/** The scanner sees one face of a wall; until the other side is scanned, this is a guess. */
export const GUESSED_THICKNESS = 0.12;
/** Wall ends this close at a corner are joined where their lines meet… */
const CORNER_REACH = 0.25;
/** …if the walls turn by more than this (degrees)… */
const CORNER_MIN_ANGLE = 20;
/** …and a join that moves an end further than this is reported. */
const CORNER_REPORT = 0.03;
/** Two scanned faces this close, back to back, are the two sides of one wall. */
const PARTITION_MAX = 0.5;
/** Sills lower than this are the floor (doors). */
const SILL_FLOOR = 0.06;
/** Space between a new scan and what is already on the level. */
const GAP_TO_EXISTING = 1.5;

export interface ScanInput {
  /** the rooms of one capture, all in the same AR world */
  rooms: Array<{ id: string; name: string; layout: unknown }>;
  checks?: TapeCheck[];
  /** the capture's folder, relative to the home's folder */
  path: string;
  manifest?: Manifest;
}

export interface ImportOptions {
  /** the level to import into; default the first */
  level?: string;
  /** where the scan's corner with the smallest x and z goes; default next to what is there */
  at?: Vec2;
}

export interface ImportIssue {
  severity: 'warning' | 'info';
  code: string;
  message: string;
  /** the scanner identifier involved */
  scan?: string;
}

export interface CheckResult {
  id: string;
  kind: TapeCheck['kind'];
  /** the home element measured */
  element?: string;
  /** what the imported model says, metres */
  modelM?: number;
  tapeM: number;
  differenceM?: number;
  differencePercent?: number;
  /** green: within 1% and 2 cm; amber: within 2% or 5 cm; red: more */
  band?: 'green' | 'amber' | 'red';
  heldOut: boolean;
  /** an edit that sets the element to the tape's value; applying it is up to the person */
  fix?: Operation;
}

export interface ScanImport {
  operation: { op: 'batch'; label: string; ops: BaseOperation[] };
  /** scanner identifier → id in the home */
  ids: Record<string, string>;
  toHome: { yaw: number; offset: Vec2; floorY: number; level: string };
  issues: ImportIssue[];
  checks: CheckResult[];
  counts: { walls: number; openings: number; items: number; rooms: number };
}

interface PlannedWall {
  scan: ScanElement;
  room: number;
  id: string;
  start: Vec2;
  end: Vec2;
  height: number;
  thickness: number;
  thicknessSource: Source;
  source: Source;
}

/** Plan the import of a capture into a home. Nothing changes until the operation is applied. */
export function importScan(home: Home, input: ScanInput, opts: ImportOptions = {}): ScanImport {
  const level = home.levels.find((l) => l.id === (opts.level ?? home.levels[0]!.id));
  if (!level) throw new EditError('not_found', `No level "${opts.level}".`, { id: opts.level, kind: 'level' });
  const issues: ImportIssue[] = [];
  const scans = input.rooms.map((r) => ({ ...r, scan: readRoomPlan(r.layout) }));
  for (const r of scans) for (const p of r.scan.problems) issues.push({ severity: 'warning', code: 'unreadable_element', message: `${r.name}: ${p}` });
  const allWalls = scans.flatMap((r) => r.scan.walls);
  if (allWalls.length === 0) throw new EditError('invalid_input', 'The capture has no walls the scanner recognised, so there is nothing to build a home from.');

  // The floor: the scanned floor if there is one, else the bottom of the lowest wall.
  const floors = scans.flatMap((r) => r.scan.floors);
  const floorY = floors.length ? Math.min(...floors.map((f) => f.transform[13]!)) : Math.min(...allWalls.map((w) => w.transform[13]! - w.size[1] / 2));

  // Turn the capture so most walls run along the axes: the average wall direction, folded
  // to a quarter turn (4α), weighted by length.
  let sin = 0;
  let cos = 0;
  for (const w of allWalls) {
    const x = column(w.transform, 0);
    const a = Math.atan2(x[2], x[0]);
    sin += w.size[0] * Math.sin(4 * a);
    cos += w.size[0] * Math.cos(4 * a);
  }
  const yaw = Math.atan2(sin, cos) / 4;
  const turn = (x: number, z: number): Vec2 => [x * Math.cos(yaw) + z * Math.sin(yaw), -x * Math.sin(yaw) + z * Math.cos(yaw)];
  const direction = (v: Vec3): Vec2 => {
    const [x, z] = turn(v[0], v[2]);
    const len = Math.hypot(x, z);
    return [x / len, z / len];
  };

  // Where it goes: next to what is already on the level, or at the given corner.
  const turned = [
    ...allWalls.flatMap((w) => endsOf(w).map((p) => turn(p[0], p[2]))),
    ...floors.flatMap((f) => (f.corners ?? []).map((c) => transformPoint(f.transform, c))).map((p) => turn(p[0], p[2])),
  ];
  const box = bounds(turned);
  const existing = home.walls.filter((w) => w.level === level.id);
  const at: Vec2 = opts.at ?? (existing.length ? [bounds(existing.flatMap((w) => [w.start, w.end])).max[0] + GAP_TO_EXISTING, bounds(existing.flatMap((w) => [w.start, w.end])).min[1]] : [0, 0]);
  const offset: Vec2 = [at[0] - box.min[0], at[1] - box.min[1]];
  const toPlan = (p: Vec3): Vec2 => {
    const [x, z] = turn(p[0], p[2]);
    return [round(x + offset[0]), round(z + offset[1])];
  };

  const scratch = structuredClone(home);
  const ids: Record<string, string> = {};
  const floorOutlines = scans.map((r) => floorOutline(r.scan, toPlan));

  // ---- walls ----
  const walls: PlannedWall[] = [];
  scans.forEach((r, room) => {
    const centre = polygonCentroid(r.scan.walls.map((w) => toPlan(column(w.transform, 3))));
    for (const w of r.scan.walls) {
      const c = toPlan(column(w.transform, 3));
      const u = direction(column(w.transform, 0));
      const half = w.size[0] / 2;
      let start: Vec2 = [c[0] - u[0] * half, c[1] - u[1] * half];
      let end: Vec2 = [c[0] + u[0] * half, c[1] + u[1] * half];
      // The scanned face is the room side: keep the room on the wall's right.
      const right: Vec2 = [-leftOf(u)[0], -leftOf(u)[1]];
      const outline = floorOutlines[room];
      const probe: Vec2 = [c[0] + right[0] * 0.05, c[1] + right[1] * 0.05];
      const roomOnRight = outline ? pointInPolygon(probe, outline) : dot(sub(centre, c), right) > 0;
      if (!roomOnRight) [start, end] = [end, start];
      if (w.curved) issues.push({ severity: 'warning', code: 'curved_wall', message: `${r.name}: a curved wall was imported straight.`, scan: w.id });
      const uncertainty = SCAN_UNCERTAINTY[w.confidence];
      const id = allocateId(scratch, 'wall');
      ids[w.id] = id;
      walls.push({
        scan: w,
        room,
        id,
        start,
        end,
        height: w.size[1],
        thickness: GUESSED_THICKNESS,
        thicknessSource: { kind: 'estimate', note: 'the scanner sees only one face of a wall' },
        source: { kind: 'scan', uncertainty, ref: `roomplan:${w.id}` },
      });
    }
  });
  joinCorners(walls, issues);
  measurePartitions(walls, scans, issues);

  // ---- level height ----
  const heights = walls.map((w) => w.height).sort((a, b) => a - b);
  const storey = heights[Math.floor(heights.length / 2)]!;
  const ops: BaseOperation[] = [];
  const levelHeight = existing.length ? level.height : storey;
  if (!existing.length && Math.abs(level.height - storey) > 0.001) {
    ops.push({ op: 'updateLevel', id: level.id, height: round(storey), sources: { height: { kind: 'scan', uncertainty: SCAN_UNCERTAINTY.high, note: 'the middle of the scanned wall heights' } } });
  }
  for (const w of walls) {
    ops.push({
      op: 'addWall',
      id: w.id,
      level: level.id,
      start: w.start,
      end: w.end,
      thickness: round(w.thickness),
      line: 'right',
      source: w.source,
      sources: { thickness: w.thicknessSource },
      ...(Math.abs(w.height - levelHeight) >= 0.01 ? { height: round(w.height) } : {}),
    });
  }

  // ---- doors, windows and openings ----
  let openingCount = 0;
  scans.forEach((r) => {
    for (const [group, type] of [
      ['doors', 'door'],
      ['windows', 'window'],
      ['openings', 'opening'],
    ] as const) {
      for (const o of r.scan[group]) {
        const op = planOpening(o, type, walls, toPlan, floorY, levelHeight, r.name, issues, scratch);
        if (!op) continue;
        ids[o.id] = op.id!;
        ops.push(op);
        openingCount++;
      }
    }
  });

  // ---- rooms: the areas the scanned walls close off, named after the scanned rooms ----
  let withWalls: Home;
  try {
    withWalls = applyOperation(home, { op: 'batch', ops }, { by: 'user' }).home;
  } catch (err) {
    throw new EditError('invalid_input', `The scan could not be turned into walls: ${(err as Error).message}`);
  }
  const before = findRooms(home, level.id);
  const areas = findRooms(withWalls, level.id).filter((a) => !before.some((b) => outlineOverlap(a.polygon, b.polygon) > 0.5));
  const claimed = new Set<number>();
  let roomCount = 0;
  scans.forEach((r, i) => {
    const mine = walls.filter((w) => w.room === i);
    if (!mine.length) return;
    const centre = floorOutlines[i] ? polygonCentroid(floorOutlines[i]!) : polygonCentroid(mine.map((w) => w.start));
    const match = areas.findIndex((a, k) => !claimed.has(k) && pointInPolygon(centre, a.polygon));
    const polygon = match >= 0 ? areas[match]!.polygon : floorOutlines[i];
    if (match >= 0) claimed.add(match);
    else
      issues.push({
        severity: 'warning',
        code: 'room_not_closed',
        message: `${r.name}: the scanned walls don't close the room${polygon ? ', so its scanned floor outline was used' : ' and it has no scanned floor, so it was left out'}. Loose wall ends can be joined in the editor.`,
      });
    if (!polygon) return;
    const id = allocateId(scratch, 'room');
    ops.push({ op: 'addRoom', id, level: level.id, name: r.name || `Room ${i + 1}`, polygon, source: { kind: 'scan', uncertainty: SCAN_UNCERTAINTY.high, ref: `capture-room:${r.id}` } });
    roomCount++;
  });

  // ---- furniture ----
  let itemCount = 0;
  scans.forEach((r) => {
    for (const o of r.scan.objects) {
      const op = planItem(o, toPlan, direction, floorY, level.id, scratch, issues, r.name);
      ids[o.id] = op.id!;
      ops.push(op);
      itemCount++;
    }
  });

  const toHome = { yaw: round((yaw * 180) / Math.PI), offset, floorY: round(floorY), level: level.id };
  const device = input.manifest?.device;
  ops.push({ op: 'addCapture', kind: 'phone-capture', path: input.path, toHome, note: `${scans.length} room(s)${device ? ` scanned with ${device.model} (iOS ${device.osVersion})` : ''}` });
  issues.push({
    severity: 'info',
    code: 'thickness_guessed',
    message: `Wall thicknesses are guesses (${GUESSED_THICKNESS} m) except where both sides of a wall were scanned. Measure and set them where it matters.`,
  });
  if (scans.some((r) => r.scan.doors.length)) issues.push({ severity: 'info', code: 'door_swing_guessed', message: 'Which way doors open is a guess; the scanner does not report it.' });

  return {
    operation: { op: 'batch', label: `Import ${scans.length === 1 ? scans[0]!.name || 'a room' : `${scans.length} rooms`} from a scan`, ops },
    ids,
    toHome,
    issues,
    checks: compareChecks(input.checks ?? [], ids, walls, ops, levelHeight),
    counts: { walls: walls.length, openings: openingCount, items: itemCount, rooms: roomCount },
  };
}

// ---------- walls ----------

function endsOf(w: ScanElement): Vec3[] {
  const c = column(w.transform, 3);
  const x = column(w.transform, 0);
  const h = w.size[0] / 2;
  return [
    [c[0] - x[0] * h, c[1], c[2] - x[2] * h],
    [c[0] + x[0] * h, c[1], c[2] + x[2] * h],
  ];
}

/** The scanned floor outline in plan coordinates, if it is usable. */
function floorOutline(scan: ScanRoom, toPlan: (p: Vec3) => Vec2): Vec2[] | undefined {
  const floor = scan.floors.find((f) => f.corners && f.corners.length >= 3);
  if (!floor) return undefined;
  let outline = floor.corners!.map((c) => toPlan(transformPoint(floor.transform, c)));
  if (signedArea(outline) < 0) outline = [...outline].reverse();
  return isSimplePolygon(outline) && polygonArea(outline) >= 0.25 ? outline : undefined;
}

/** Join neighbouring ends within a room where the two walls' faces meet. */
function joinCorners(walls: PlannedWall[], issues: ImportIssue[]): void {
  for (const a of walls) {
    for (const which of ['start', 'end'] as const) {
      let best: { wall: PlannedWall; end: 'start' | 'end'; gap: number } | null = null;
      for (const b of walls) {
        if (b === a || b.room !== a.room) continue;
        for (const other of ['start', 'end'] as const) {
          const gap = distance(a[which], b[other]);
          if (gap <= CORNER_REACH && (!best || gap < best.gap)) best = { wall: b, end: other, gap };
        }
      }
      if (!best || best.gap === 0) continue;
      const da = sub(a.end, a.start);
      const db = sub(best.wall.end, best.wall.start);
      const angle = (Math.asin(Math.min(1, Math.abs(cross(da, db)) / (Math.hypot(...da) * Math.hypot(...db)))) * 180) / Math.PI;
      if (angle < CORNER_MIN_ANGLE) continue;
      const corner = lineMeet(a.start, da, best.wall.start, db);
      if (!corner || distance(corner, a[which]) > CORNER_REACH) continue;
      const moved = Math.max(distance(corner, a[which]), distance(corner, best.wall[best.end]));
      a[which] = corner;
      best.wall[best.end] = corner;
      if (moved > CORNER_REPORT) issues.push({ severity: 'info', code: 'corner_joined', message: `Joined a corner whose scanned ends were ${Math.round(moved * 100)} cm apart.`, scan: a.scan.id });
    }
  }
}

function lineMeet(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const det = cross(d, e);
  if (Math.abs(det) < 1e-9) return null;
  const t = cross(sub(q, p), e) / det;
  return [round(p[0] + d[0] * t), round(p[1] + d[1] * t)];
}

/**
 * Walls of two rooms scanned back to back are the two faces of one wall, so the gap
 * between them is the wall's real thickness. Each keeps its own room-side face and takes
 * half the measured thickness, so the two together fill the wall exactly.
 */
function measurePartitions(walls: PlannedWall[], scans: Array<{ name: string }>, issues: ImportIssue[]): void {
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i]!;
      const b = walls[j]!;
      if (a.room === b.room) continue;
      const da = unit(sub(a.end, a.start));
      const db = unit(sub(b.end, b.start));
      // Back to back: parallel, running opposite ways (each keeps its room on its right).
      if (Math.abs(cross(da, db)) > Math.sin((3 * Math.PI) / 180) || dot(da, db) > 0) continue;
      const left = leftOf(da);
      const gap = dot(sub(b.start, a.start), left);
      if (gap <= 0.03 || gap > PARTITION_MAX) continue;
      const along = (p: Vec2) => dot(sub(p, a.start), da);
      const [b0, b1] = [along(b.end), along(b.start)];
      const shared = Math.min(distance(a.start, a.end), b1) - Math.max(0, b0);
      const shorter = Math.min(distance(a.start, a.end), distance(b.start, b.end));
      if (shared < 0.5 * shorter) continue;
      if (shared < 0.8 * Math.max(distance(a.start, a.end), distance(b.start, b.end))) {
        issues.push({
          severity: 'info',
          code: 'partition_found',
          message: `${scans[a.room]!.name} and ${scans[b.room]!.name} share a wall about ${Math.round(gap * 100)} cm thick; set its thickness if it matters.`,
          scan: a.scan.id,
        });
        continue;
      }
      const uncertainty = Math.hypot(a.source.uncertainty ?? 0, b.source.uncertainty ?? 0) / 2;
      for (const w of [a, b]) {
        w.thickness = gap / 2;
        w.thicknessSource = { kind: 'scan', uncertainty, note: `half of a ${Math.round(gap * 100)} cm wall scanned from both sides` };
      }
    }
  }
}

function unit(v: Vec2): Vec2 {
  const l = Math.hypot(v[0], v[1]);
  return [v[0] / l, v[1] / l];
}

// ---------- openings ----------

function planOpening(
  o: ScanElement,
  type: 'door' | 'window' | 'opening',
  walls: PlannedWall[],
  toPlan: (p: Vec3) => Vec2,
  floorY: number,
  levelHeight: number,
  roomName: string,
  issues: ImportIssue[],
  scratch: Home,
): Extract<BaseOperation, { op: 'addOpening' }> | null {
  const c3 = column(o.transform, 3);
  const c = toPlan(c3);
  let wall = walls.find((w) => w.scan.id === o.parent);
  if (!wall) {
    // No wall named: take the wall whose face the opening sits on.
    wall = walls.find((w) => distanceToSegment(c, w.start, w.end) < 0.3);
    if (!wall) {
      issues.push({ severity: 'warning', code: 'opening_without_wall', message: `${roomName}: a ${type} is not on any scanned wall, so it was left out.`, scan: o.id });
      return null;
    }
    issues.push({ severity: 'info', code: 'opening_wall_guessed', message: `${roomName}: a ${type} named no wall; it was put on the nearest one.`, scan: o.id });
  }
  const len = distance(wall.start, wall.end);
  const dir = unit(sub(wall.end, wall.start));
  let width = o.size[0];
  if (width > len) {
    issues.push({ severity: 'warning', code: 'opening_trimmed', message: `${roomName}: a ${type} was wider than its wall and was trimmed to fit.`, scan: o.id });
    width = len;
  }
  const centreAlong = dot(sub(c, wall.start), dir);
  const offset = Math.min(Math.max(0, centreAlong - width / 2), len - width);
  let sill = c3[1] - floorY - o.size[1] / 2;
  if (sill < SILL_FLOOR) sill = 0;
  const wallTop = Math.abs(wall.height - levelHeight) >= 0.01 ? wall.height : levelHeight;
  let height = o.size[1];
  if (sill + height > wallTop) {
    issues.push({ severity: 'info', code: 'opening_trimmed', message: `${roomName}: a ${type} reached above its wall and was trimmed to the wall's height.`, scan: o.id });
    height = wallTop - sill;
  }
  const id = allocateId(scratch, type);
  return {
    op: 'addOpening',
    id,
    wall: wall.id,
    type,
    offset: round(offset),
    width: round(width),
    height: round(height),
    sill: round(sill),
    force: true,
    source: { kind: 'scan', uncertainty: SCAN_UNCERTAINTY[o.confidence], ref: `roomplan:${o.id}` },
  };
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
  return distance(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]);
}

// ---------- furniture ----------

/** Scanner categories → a catalogue entry for the stand-in shape. The size always comes
 *  from the scan. */
function catalogFor(category: string, size: Vec3): { catalog: string; name: string } {
  const [w, h] = size;
  switch (category) {
    case 'sofa':
      return { catalog: w < 1.1 ? 'armchair' : w < 1.8 ? 'sofa-2' : 'sofa-3', name: w < 1.1 ? 'Armchair' : 'Sofa' };
    case 'bed':
      return { catalog: w < 1.2 ? 'bed-single' : 'bed-double', name: 'Bed' };
    case 'table':
      return { catalog: h < 0.55 ? 'coffee-table' : 'dining-table-4', name: 'Table' };
    case 'chair':
      return { catalog: 'chair', name: 'Chair' };
    case 'storage':
      return { catalog: h >= 1.4 ? 'wardrobe' : 'tv-unit', name: 'Storage' };
    case 'refrigerator':
      return { catalog: 'fridge', name: 'Fridge' };
    case 'stove':
    case 'oven':
      return { catalog: 'cooker', name: category === 'oven' ? 'Oven' : 'Cooker' };
    case 'dishwasher':
      return { catalog: 'kitchen-base', name: 'Dishwasher' };
    case 'sink':
      return { catalog: 'basin', name: 'Sink' };
    case 'toilet':
      return { catalog: 'toilet', name: 'Toilet' };
    case 'bathtub':
      return { catalog: 'bathtub', name: 'Bathtub' };
    case 'washerDryer':
      return { catalog: 'box', name: 'Washer / dryer' };
    case 'television':
      return { catalog: 'box', name: 'Television' };
    case 'fireplace':
      return { catalog: 'box', name: 'Fireplace' };
    case 'stairs':
      return { catalog: 'box', name: 'Stairs' };
    default:
      return { catalog: 'box', name: category.charAt(0).toUpperCase() + category.slice(1) };
  }
}

function planItem(
  o: ScanElement,
  toPlan: (p: Vec3) => Vec2,
  direction: (v: Vec3) => Vec2,
  floorY: number,
  level: string,
  scratch: Home,
  issues: ImportIssue[],
  roomName: string,
): Extract<BaseOperation, { op: 'addItem' }> {
  const { catalog, name } = catalogFor(o.category, o.size);
  if (o.category === 'stairs' || o.category === 'fireplace') {
    issues.push({ severity: 'info', code: 'architecture_as_item', message: `${roomName}: ${name.toLowerCase()} imported as a plain box; it is part of the building.`, scan: o.id });
  }
  const c3 = column(o.transform, 3);
  const c = toPlan(c3);
  const bottom = c3[1] - o.size[1] / 2 - floorY;
  // The item's front is its local +z; a turn a points it along (sin a, cos a).
  const front = direction(column(o.transform, 2));
  const rotation = (((Math.round(((Math.atan2(front[0], front[1]) * 180) / Math.PI) * 1000) / 1000) % 360) + 360) % 360;
  const id = allocateId(scratch, catalog === 'box' ? 'item' : catalog);
  const uncertainty = SCAN_UNCERTAINTY[o.confidence];
  return {
    op: 'addItem',
    id,
    level,
    catalog: CATALOG_BY_ID.has(catalog) ? catalog : 'box',
    name,
    position: [c[0], round(Math.abs(bottom) < 0.03 ? 0 : bottom), c[1]],
    rotation,
    size: [round(o.size[0]), round(o.size[1]), round(o.size[2])],
    source: { kind: 'scan', uncertainty, ref: `roomplan:${o.id}` },
    sources: { size: { kind: 'scan', uncertainty } },
  };
}

// ---------- tape checks ----------

/** Allows for float noise at the band edges (1.98 m against 2.00 m is exactly 2 cm). */
const EDGE = 1e-9;

/**
 * How well a scanned length agrees with the tape: green within 1% and 2 cm, amber within 2%
 * or 5 cm, red beyond. The phone apps grade the same way (fixtures/tape-checks.json).
 */
export function tapeBand(scanM: number, tapeM: number): 'green' | 'amber' | 'red' {
  const off = Math.abs(scanM - tapeM);
  const share = off / tapeM;
  if (off <= 0.02 + EDGE && share <= 0.01 + EDGE) return 'green';
  if (off <= 0.05 + EDGE || share <= 0.02 + EDGE) return 'amber';
  return 'red';
}

function compareChecks(checks: TapeCheck[], ids: Record<string, string>, walls: PlannedWall[], ops: BaseOperation[], levelHeight: number): CheckResult[] {
  const tape: Source = { kind: 'user', uncertainty: 0.005, note: 'tape measure' };
  return checks.map((check) => {
    const element = check.element ? ids[check.element] : undefined;
    let modelM: number | undefined;
    let fix: Operation | undefined;
    const wall = walls.find((w) => w.id === element);
    const opening = ops.find((op) => op.op === 'addOpening' && op.id === element) as Extract<BaseOperation, { op: 'addOpening' }> | undefined;
    if (check.kind === 'wall_length' && wall) {
      modelM = distance(wall.start, wall.end);
      fix = {
        op: 'batch',
        label: `Set ${wall.id} to the tape's ${check.tapeM} m`,
        ops: [
          { op: 'setWallLength', id: wall.id, length: check.tapeM },
          { op: 'updateWall', id: wall.id, sources: { start: tape, end: tape } },
        ],
      };
    } else if ((check.kind === 'door_width' || check.kind === 'window_width') && opening) {
      modelM = opening.width;
      fix = { op: 'updateOpening', id: opening.id!, width: check.tapeM, sources: { width: tape } };
    } else if (check.kind === 'door_height' && opening) {
      modelM = opening.height;
      fix = { op: 'updateOpening', id: opening.id!, height: check.tapeM, sources: { height: tape } };
    } else if (check.kind === 'ceiling_height') {
      modelM = wall ? wall.height : levelHeight;
    } else if (check.a && check.b) {
      modelM = Math.hypot(check.a[0]! - check.b[0]!, check.a[1]! - check.b[1]!, check.a[2]! - check.b[2]!);
    }
    const result: CheckResult = { id: check.id, kind: check.kind, tapeM: check.tapeM, heldOut: check.heldOut, ...(element ? { element } : {}) };
    if (modelM === undefined) return result;
    const differenceM = round(modelM - check.tapeM);
    const differencePercent = Math.round((Math.abs(differenceM) / check.tapeM) * 10000) / 100;
    return { ...result, modelM: round(modelM), differenceM, differencePercent, band: tapeBand(modelM, check.tapeM), ...(fix && !check.heldOut ? { fix } : {}) };
  });
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;
