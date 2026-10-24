// Rooms: named floor areas with their own floor and ceiling finishes.
import { z } from 'zod';
import { EditError } from '../errors.ts';
import { isSimplePolygon, polygonArea } from '../geometry.ts';
import { takeId } from '../ids.ts';
import { FieldSourcesSchema, IdSchema, SourceSchema, Vec2Schema, type Room, type Vec2 } from '../schema.ts';
import { assignPatch, defineCommand, find, levelFor, mergeSources, type Draft } from './edit.ts';
import { Coordinate, Length, SourcesInput } from './inputs.ts';
import { insertWall } from './walls.ts';

/** Rooms smaller than this on a side are refused by addRectangularRoom. */
export const MIN_ROOM_SIDE = 0.3;
/** Room outlines with less area than this are refused. */
const MIN_ROOM_AREA = 0.01;

const Polygon = z.array(Vec2Schema).min(3);

function checkPolygon(polygon: Vec2[]): void {
  if (!isSimplePolygon(polygon)) {
    throw new EditError('invalid_polygon', 'The room outline crosses itself. List its corners in order around the room.');
  }
  const area = Math.abs(polygonArea(polygon));
  if (area < MIN_ROOM_AREA) {
    throw new EditError('invalid_polygon', `The room outline encloses ${area.toFixed(4)} m², which is too small for a room.`, { area });
  }
}

const AddRoomInput = z.strictObject({
  id: IdSchema.optional(),
  level: IdSchema.optional(),
  name: z.string().min(1).max(80),
  /** floor outline at the finished wall faces */
  polygon: Polygon,
  floorMaterial: IdSchema.optional(),
  ceilingMaterial: IdSchema.optional(),
  /** leave out to follow the level's height */
  ceilingHeight: Length.optional(),
  source: SourceSchema.optional(),
  sources: FieldSourcesSchema.optional(),
});

function insertRoom(d: Draft, input: z.output<typeof AddRoomInput>): string {
  const home = d.home;
  checkPolygon(input.polygon);
  const has = (id: string) => home.materials.some((m) => m.id === id);
  const room: Room = {
    id: takeId(home, input.id, 'room'),
    level: levelFor(home, input.level),
    name: input.name,
    polygon: input.polygon,
    source: input.source ?? { kind: d.ctx.by },
  };
  const floor = input.floorMaterial ?? (has('oak-floor') ? 'oak-floor' : undefined);
  const ceiling = input.ceilingMaterial ?? (has('ceiling-white') ? 'ceiling-white' : undefined);
  if (floor) room.floorMaterial = find(home, 'materials', floor).id;
  if (ceiling) room.ceilingMaterial = find(home, 'materials', ceiling).id;
  if (input.ceilingHeight !== undefined) room.ceilingHeight = input.ceilingHeight;
  if (input.sources) room.sources = input.sources;
  home.rooms.push(room);
  return room.id;
}

export const addRoom = defineCommand(AddRoomInput, (d, input) => {
  insertRoom(d, input);
});

export const updateRoom = defineCommand(
  z.strictObject({
    id: IdSchema,
    name: z.string().min(1).max(80).optional(),
    polygon: Polygon.optional(),
    floorMaterial: IdSchema.nullable().optional(),
    ceilingMaterial: IdSchema.nullable().optional(),
    /** null: follow the level's height again */
    ceilingHeight: Length.nullable().optional(),
    source: SourceSchema.optional(),
    sources: SourcesInput.optional(),
  }),
  (d, { id, sources, ...patch }) => {
    const room = find(d.home, 'rooms', id);
    if (patch.polygon) checkPolygon(patch.polygon);
    for (const m of [patch.floorMaterial, patch.ceilingMaterial]) if (m) find(d.home, 'materials', m);
    assignPatch(room, patch);
    mergeSources(room, sources);
  },
);

const Side = z.enum(['north', 'east', 'south', 'west']);

/**
 * A rectangular room with its four walls. `x, z` is the inside corner with the smallest
 * coordinates; `width` (along x) and `depth` (along z) are exact inside dimensions.
 */
export const addRectangularRoom = defineCommand(
  z.strictObject({
    name: z.string().min(1).max(80),
    x: Coordinate,
    z: Coordinate,
    width: Length,
    depth: Length,
    level: IdSchema.optional(),
    thickness: Length.optional(),
    /** leave out to follow the level's height */
    height: Length.optional(),
    /** sides a neighbouring room already has a wall on */
    skipWalls: z.array(Side).optional(),
  }),
  (d, input) => {
    const { x, z: zz, width: w, depth: dd } = input;
    if (w < MIN_ROOM_SIDE || dd < MIN_ROOM_SIDE) {
      throw new EditError('room_too_small', `A room must be at least ${MIN_ROOM_SIDE} m on each side; this one is ${w} × ${dd} m.`, { width: w, depth: dd });
    }
    const corners: Vec2[] = [
      [x, zz],
      [x + w, zz],
      [x + w, zz + dd],
      [x, zz + dd],
    ];
    // Walking the corners clockwise on screen keeps the room on each wall's right, so
    // line "right" puts every wall's room-side face exactly on the outline.
    const sides = ['north', 'east', 'south', 'west'] as const;
    sides.forEach((side, i) => {
      if (input.skipWalls?.includes(side)) return;
      insertWall(d, {
        level: input.level,
        start: corners[i]!,
        end: corners[(i + 1) % 4]!,
        thickness: input.thickness,
        height: input.height,
        line: 'right',
      });
    });
    insertRoom(d, { name: input.name, level: input.level, polygon: corners });
  },
);
