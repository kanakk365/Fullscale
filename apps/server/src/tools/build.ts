// Tools that build: walls, rooms, doors and windows.
import { EditError, lengthField, OPENING_DEFAULTS, wallLength, type BaseOperation, type Vec2 } from '@fullscale/core';
import { z } from 'zod';
import { defineTool, Distance, Id, Length, m, Point, receiptResult, write, WriteOptions } from './define.ts';

const WallLine = z.enum(['center', 'left', 'right']).describe('which line the points describe: the wall’s centre (default), or its left or right face walking from start to end');

const find = <T extends { id: string }>(list: readonly T[], id: string, kind: string): T => {
  const found = list.find((x) => x.id === id);
  if (!found) throw new EditError('not_found', `No ${kind} with id "${id}".`, { id, kind });
  return found;
};

export const drawWalls = defineTool({
  name: 'draw_walls',
  title: 'Draw walls',
  description:
    'Draw walls through a chain of points, as a person does in the editor: ends join nearby corners and walls (within `snap`), walls that end on or cross another wall split it there, stretches already covered by a wall are skipped, and areas the walls close off become rooms. One undo step.',
  input: z.object({
    points: z.array(Point).min(2).max(100),
    close: z.boolean().optional().describe('also draw from the last point back to the first'),
    level: Id.optional(),
    thickness: Length('wall thickness, default 0.12 m').optional(),
    height: Length('wall height; leave out to follow the level').optional(),
    line: WallLine.optional(),
    snap: Distance('join ends to walls and corners within this distance; default 5 cm, 0 for exact').optional(),
    rooms: z.boolean().optional().describe('make rooms of closed-off areas (default true)'),
    ...WriteOptions,
  }),
  effect: 'write',
  run(ctx, q) {
    const points = q.close ? [...q.points, q.points[0]!] : q.points;
    const ops: BaseOperation[] = [];
    for (let i = 0; i + 1 < points.length; i++) {
      ops.push({
        op: 'drawWall',
        start: points[i]!,
        end: points[i + 1]!,
        ...(q.level ? { level: q.level } : {}),
        ...(q.thickness !== undefined ? { thickness: q.thickness } : {}),
        ...(q.height !== undefined ? { height: q.height } : {}),
        ...(q.line ? { line: q.line } : {}),
        ...(q.snap !== undefined ? { snap: q.snap } : {}),
        ...(q.rooms !== undefined ? { rooms: q.rooms } : {}),
        source: { kind: ctx.by },
      });
    }
    return receiptResult(write(ctx, { op: 'batch', label: `Draw ${ops.length} wall${ops.length === 1 ? '' : 's'}`, ops }, q));
  },
});

export const addRoom = defineTool({
  name: 'add_room',
  title: 'Add a room',
  description:
    'Add a room by its inside outline: a rectangle (x, z = the inside corner with the smallest coordinates, width along x, depth along z) or a polygon. Walls are drawn outside the outline, so the inside sizes are exact; a side that an existing wall already covers reuses it. With walls false, only the floor area is added (an open-plan zone).',
  input: z.object({
    name: z.string().min(1).max(80),
    level: Id.optional(),
    rect: z
      .object({
        x: z.number().finite(),
        z: z.number().finite(),
        width: Length('inside width along x'),
        depth: Length('inside depth along z'),
      })
      .optional(),
    polygon: z.array(Point).min(3).max(100).optional().describe('inside outline, corners in order'),
    walls: z.boolean().optional().describe('draw walls around it (default true)'),
    thickness: Length('wall thickness, default 0.12 m').optional(),
    height: Length('wall height; leave out to follow the level').optional(),
    ...WriteOptions,
  }),
  effect: 'write',
  run(ctx, q) {
    if (!!q.rect === !!q.polygon) throw new EditError('invalid_input', 'Give either rect or polygon.');
    const polygon: Vec2[] = q.rect
      ? [
          [q.rect.x, q.rect.z],
          [q.rect.x + q.rect.width, q.rect.z],
          [q.rect.x + q.rect.width, q.rect.z + q.rect.depth],
          [q.rect.x, q.rect.z + q.rect.depth],
        ]
      : q.polygon!;
    const op: BaseOperation = {
      op: 'drawRoom',
      name: q.name,
      polygon,
      source: { kind: ctx.by },
      ...(q.level ? { level: q.level } : {}),
      ...(q.walls === false ? { walls: false } : {}),
      ...(q.thickness !== undefined ? { thickness: q.thickness } : {}),
      ...(q.height !== undefined ? { height: q.height } : {}),
    };
    return receiptResult(write(ctx, op, q));
  },
});

export const updateWall = defineTool({
  name: 'update_wall',
  title: 'Change a wall',
  description: 'Change a wall’s thickness, height, line or face finishes, or set its length (the `keep` end stays put; walls at the moving corner follow, and rooms follow their walls).',
  input: z.object({
    id: Id,
    length: Length('new length').optional(),
    keep: z.enum(['start', 'end']).optional().describe('the end that stays put when setting the length (default start)'),
    thickness: Length('thickness').optional(),
    height: Length('height').nullable().optional().describe('height in metres; null to follow the level again'),
    line: WallLine.optional(),
    materials: z.object({ left: Id.optional(), right: Id.optional() }).optional().describe('material ids for each face'),
    ...WriteOptions,
  }),
  effect: 'write',
  run(ctx, q) {
    const ops: BaseOperation[] = [];
    const fields = { thickness: q.thickness, height: q.height, line: q.line, materials: q.materials };
    if (Object.values(fields).some((v) => v !== undefined)) {
      ops.push({ op: 'updateWall', id: q.id, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) });
    }
    if (q.length !== undefined) ops.push({ op: 'setWallLength', id: q.id, length: q.length, ...(q.keep ? { keep: q.keep } : {}) });
    if (!ops.length) throw new EditError('invalid_input', 'Nothing to change: give a length, thickness, height, line or materials.');
    return receiptResult(write(ctx, { op: 'batch', label: `Change wall ${q.id}`, ops }, q));
  },
});

export const moveWall = defineTool({
  name: 'move_wall',
  title: 'Move a wall',
  description:
    'Move a whole wall sideways by `by` (towards its left face; negative for right), with walls at its corners stretching and walls ending against it sliding along; or move one `end` to a point `to`, joining a wall there when within `snap`. Rooms follow their walls.',
  input: z.object({
    id: Id,
    by: lengthField().optional().describe('sideways distance towards the wall’s left face, negative for its right face: metres, or text like "-30 cm"'),
    end: z.enum(['start', 'end']).optional(),
    to: Point.optional(),
    snap: Distance('join walls and corners within this distance when moving an end; default 0').optional(),
    detach: z.boolean().optional().describe('move only this wall’s end, leaving walls that share the corner'),
    ...WriteOptions,
  }),
  effect: 'write',
  run(ctx, q) {
    if (q.by !== undefined) {
      if (q.end || q.to) throw new EditError('invalid_input', 'Give either `by`, or `end` and `to`.');
      return receiptResult(write(ctx, { op: 'moveWall', id: q.id, by: q.by }, q));
    }
    if (!q.end || !q.to) throw new EditError('invalid_input', 'Give either `by`, or `end` and `to`.');
    return receiptResult(write(ctx, { op: 'moveWallEnd', id: q.id, end: q.end, to: q.to, ...(q.snap !== undefined ? { snap: q.snap } : {}), ...(q.detach ? { detach: true } : {}) }, q));
  },
});

export const splitWall = defineTool({
  name: 'split_wall',
  title: 'Split a wall',
  description: 'Split a wall in two at a distance from its start; doors and windows stay where they are in the room.',
  input: z.object({ id: Id, at: Length('distance from the wall’s start'), ...WriteOptions }),
  effect: 'write',
  run(ctx, q) {
    return receiptResult(write(ctx, { op: 'splitWall', id: q.id, at: q.at }, q));
  },
});

export const mergeWalls = defineTool({
  name: 'merge_walls',
  title: 'Merge two walls',
  description: 'Join two walls that continue each other in a straight line (same thickness, height and finishes) into one. The refusal says what differs.',
  input: z.object({ ids: z.array(Id).length(2), ...WriteOptions }),
  effect: 'write',
  run(ctx, q) {
    return receiptResult(write(ctx, { op: 'mergeWalls', ids: [q.ids[0]!, q.ids[1]!] }, q));
  },
});

export const joinWallEnd = defineTool({
  name: 'join_wall_end',
  title: 'Close a gap',
  description: 'Carry a loose wall end on to the wall its line reaches, or meet a nearby loose end at a corner. get_level lists loose ends. Closing a gap can make a room.',
  input: z.object({ id: Id, end: z.enum(['start', 'end']), to: Id.optional().describe('the wall to join; default the nearest within 0.5 m'), ...WriteOptions }),
  effect: 'write',
  run(ctx, q) {
    return receiptResult(write(ctx, { op: 'joinWallEnd', id: q.id, end: q.end, ...(q.to ? { to: q.to } : {}) }, q));
  },
});

export const detectRooms = defineTool({
  name: 'detect_rooms',
  title: 'Rooms from walls',
  description: 'Make a room of every area the walls close off that has no room yet. With adopt, rooms that nearly match an area (e.g. from a scan) are reshaped to the walls.',
  input: z.object({ level: Id.optional(), adopt: z.boolean().optional(), ...WriteOptions }),
  effect: 'write',
  run(ctx, q) {
    return receiptResult(write(ctx, { op: 'detectRooms', ...(q.level ? { level: q.level } : {}), ...(q.adopt ? { adopt: true } : {}) }, q));
  },
});

const OpeningFields = {
  width: Length('clear width').optional(),
  height: Length('clear height').optional(),
  sill: Distance('height of the bottom above the floor; 0 for doors').optional(),
  hinge: z.enum(['start', 'end']).optional().describe('doors: the jamb the hinge is on, towards the wall’s start or end'),
  swing: z.enum(['left', 'right']).optional().describe('doors: the side of the wall the leaf opens into, walking from start to end'),
  style: z.string().max(40).optional(),
  force: z.boolean().optional().describe('allow overlapping another opening on purpose'),
};

export const addOpening = defineTool({
  name: 'add_opening',
  title: 'Add a door or window',
  description: `Add a door, window or plain opening to a wall. Place it by \`offset\` (wall start to its near edge) or \`centre\` (wall start to its middle); default centred. Defaults: door ${OPENING_DEFAULTS.door.width} × ${OPENING_DEFAULTS.door.height} m; window ${OPENING_DEFAULTS.window.width} × ${OPENING_DEFAULTS.window.height} m at ${OPENING_DEFAULTS.window.sill} m. Refused if it runs off the wall, is taller than the wall, or overlaps another opening.`,
  input: z.object({
    wall: Id,
    type: z.enum(['door', 'window', 'opening']),
    offset: Distance('wall start to the near edge').optional(),
    centre: Distance('wall start to the middle').optional(),
    ...OpeningFields,
    ...WriteOptions,
  }),
  effect: 'write',
  run(ctx, q) {
    if (q.offset !== undefined && q.centre !== undefined) throw new EditError('invalid_input', 'Give offset or centre, not both.');
    const width = q.width ?? OPENING_DEFAULTS[q.type].width;
    const offset = q.centre !== undefined ? q.centre - width / 2 : q.offset;
    const { expect_rev: _r, dry_run: _d, centre: _c, wall, type, ...rest } = q;
    const fields = Object.fromEntries(Object.entries({ ...rest, offset }).filter(([, v]) => v !== undefined));
    const r = write(ctx, { op: 'addOpening', wall, type, ...fields, source: { kind: ctx.by } }, q);
    const home = ctx.studio.home;
    const w = home.walls.find((x) => x.id === wall);
    if (w && !r.dry_run) r.notes.push(`Wall "${wall}" is ${m(wallLength(w))} long.`);
    return receiptResult(r);
  },
});

export const updateOpening = defineTool({
  name: 'update_opening',
  title: 'Change a door or window',
  description: 'Move or resize a door, window or opening, move it to another wall, or change how a door opens.',
  input: z.object({
    id: Id,
    wall: Id.optional().describe('move it to this wall'),
    offset: Distance('wall start to the near edge').optional(),
    centre: Distance('wall start to the middle').optional(),
    ...OpeningFields,
    ...WriteOptions,
  }),
  effect: 'write',
  run(ctx, q) {
    if (q.offset !== undefined && q.centre !== undefined) throw new EditError('invalid_input', 'Give offset or centre, not both.');
    const current = find(ctx.studio.home.openings, q.id, 'opening');
    const width = q.width ?? current.width;
    const offset = q.centre !== undefined ? q.centre - width / 2 : q.offset;
    const { expect_rev: _r, dry_run: _d, centre: _c, id, ...rest } = q;
    const fields = Object.fromEntries(Object.entries({ ...rest, offset }).filter(([, v]) => v !== undefined));
    return receiptResult(write(ctx, { op: 'updateOpening', id, ...fields }, q));
  },
});
