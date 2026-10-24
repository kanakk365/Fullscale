// Rooms follow their walls. A room whose outline is exactly the area its walls close off
// keeps that outline through wall edits: move a wall and the room grows, add a wall across
// it and it keeps the larger part. Rooms drawn by hand (an open-plan zone, or a scanned floor
// that doesn't match the walls exactly) are never reshaped on their own.
import { bounds, polygonArea } from '../geometry.ts';
import { findRooms, outlineOverlap, sameOutline, type FoundRoom } from '../topology.ts';
import type { Room } from '../schema.ts';
import type { Draft } from './edit.ts';
import { insertRoom } from './rooms.ts';

/** A room counts as following its walls when its outline matches theirs this closely. */
const FOLLOWS = 0.001;
/** After an edit, the area that still overlaps the old one this much is the same room. */
const SAME_ROOM = 0.3;
/** A closed area that an existing room covers this much is not a new room. */
const ALREADY_A_ROOM = 0.5;

export interface FollowOptions {
  /** turn newly closed areas into rooms */
  create: boolean;
}

/** Run `change` on the draft, then update rooms that follow their walls. */
export function keepRoomsOnWalls(d: Draft, opts: FollowOptions, change: () => void): void {
  const levels = d.home.levels.map((l) => l.id);
  const before = new Map(levels.map((l) => [l, findRooms(d.home, l)]));
  change();
  for (const level of d.home.levels.map((l) => l.id)) {
    followLevel(d, level, before.get(level) ?? [], findRooms(d.home, level), opts);
  }
}

function followLevel(d: Draft, level: string, before: FoundRoom[], after: FoundRoom[], opts: FollowOptions): void {
  const rooms = d.home.rooms.filter((r) => r.level === level);
  const claimed = new Set<FoundRoom>();

  // Rooms that followed their walls and whose area changed shape.
  const moved: Array<{ room: Room; was: FoundRoom }> = [];
  for (const room of rooms) {
    const was = before.find((f) => sameOutline(f.polygon, room.polygon, FOLLOWS));
    if (!was) continue;
    const unchanged = after.find((f) => sameOutline(f.polygon, was.polygon, FOLLOWS));
    if (unchanged) claimed.add(unchanged);
    else moved.push({ room, was });
  }

  // Pair each with what its area became, best matches first, so when two rooms merge into
  // one area the one that covered more of it keeps it.
  const pairs = moved
    .flatMap(({ room, was }) => after.map((area) => ({ room, area, overlap: outlineOverlap(was.polygon, area.polygon) })))
    .filter((p) => p.overlap >= SAME_ROOM)
    .sort((a, b) => b.overlap - a.overlap || a.room.id.localeCompare(b.room.id));
  const placed = new Set<Room>();
  for (const { room, area } of pairs) {
    if (placed.has(room) || claimed.has(area)) continue;
    placed.add(room);
    claimed.add(area);
    const from = polygonArea(room.polygon);
    room.polygon = area.polygon;
    d.notes.push(`Room "${room.name}" (${room.id}) follows its walls: ${from.toFixed(2)} m² → ${area.area.toFixed(2)} m².`);
  }
  for (const { room } of moved) {
    if (!placed.has(room)) d.notes.push(`Room "${room.name}" (${room.id}) is no longer closed off by walls, so its outline was kept as it was.`);
  }

  if (!opts.create) return;
  for (const area of after) {
    if (claimed.has(area)) continue;
    const covered = d.home.rooms.some((r) => r.level === level && outlineOverlap(r.polygon, area.polygon) >= ALREADY_A_ROOM);
    if (covered) continue;
    const name = `Room ${d.home.rooms.filter((r) => r.level === level).length + 1}`;
    const id = insertRoom(d, { name, level, polygon: area.polygon });
    const size = bounds(area.polygon).size;
    d.notes.push(`New room "${name}" (${id}): ${area.area.toFixed(2)} m², about ${size[0].toFixed(2)} × ${size[1].toFixed(2)} m.`);
  }
}
