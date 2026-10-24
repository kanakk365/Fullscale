// Wall edits. Moving a wall end carries along the ends of walls that share that corner,
// and keeps doors and windows where they are in the room.
import { z } from 'zod';
import { EditError } from '../errors.ts';
import { distance, wallDirection, wallLength } from '../geometry.ts';
import { takeId } from '../ids.ts';
import { blockingProblem, CONNECTED, openingProblems, wallLengthProblem } from '../rules.ts';
import { FieldSourcesSchema, IdSchema, SourceSchema, Vec2Schema, type Home, type Vec2, type Wall } from '../schema.ts';
import { assignPatch, defineCommand, find, levelFor, mergeSources, type Draft } from './edit.ts';
import { Length, SourcesInput } from './inputs.ts';

export const DEFAULT_WALL_THICKNESS = 0.12;

const WallLine = z.enum(['center', 'left', 'right']);
const WallMaterials = z.strictObject({ left: IdSchema.optional(), right: IdSchema.optional() });

export const AddWallInput = z.strictObject({
  id: IdSchema.optional(),
  level: IdSchema.optional(),
  start: Vec2Schema,
  end: Vec2Schema,
  thickness: Length.optional(),
  /** leave out to follow the level's height */
  height: Length.optional(),
  line: WallLine.optional(),
  materials: WallMaterials.optional(),
  source: SourceSchema.optional(),
  sources: FieldSourcesSchema.optional(),
});

/** Add a wall on a draft and return its id. */
export function insertWall(d: Draft, input: z.output<typeof AddWallInput>): string {
  const home = d.home;
  const level = levelFor(home, input.level);
  const id = takeId(home, input.id, 'wall');
  const defaultPaint = home.materials.some((m) => m.id === 'paint-white') ? 'paint-white' : undefined;
  const wall: Wall = {
    id,
    level,
    start: input.start,
    end: input.end,
    thickness: input.thickness ?? DEFAULT_WALL_THICKNESS,
    line: input.line ?? 'center',
    materials: input.materials ?? (defaultPaint ? { left: defaultPaint, right: defaultPaint } : {}),
    source: input.source ?? { kind: d.ctx.by },
  };
  if (input.height !== undefined) wall.height = input.height;
  if (input.sources) wall.sources = input.sources;
  const problem = wallLengthProblem(wall);
  if (problem) throw problem;
  for (const m of Object.values(wall.materials)) if (m) find(home, 'materials', m);
  home.walls.push(wall);
  return id;
}

export const addWall = defineCommand(AddWallInput, (d, input) => {
  insertWall(d, input);
});

export const updateWall = defineCommand(
  z.strictObject({
    id: IdSchema,
    start: Vec2Schema.optional(),
    end: Vec2Schema.optional(),
    thickness: Length.optional(),
    /** null: follow the level's height again */
    height: Length.nullable().optional(),
    line: WallLine.optional(),
    /** merged into the current materials */
    materials: WallMaterials.optional(),
    source: SourceSchema.optional(),
    sources: SourcesInput.optional(),
  }),
  (d, { id, materials, sources, ...patch }) => {
    const wall = find(d.home, 'walls', id);
    assignPatch(wall, patch);
    if (materials) {
      for (const m of Object.values(materials)) if (m) find(d.home, 'materials', m);
      wall.materials = { ...wall.materials, ...materials };
    }
    mergeSources(wall, sources);
    const problem = wallLengthProblem(wall);
    if (problem) throw problem;
    checkOpeningsOn(d.home, wall);
  },
);

export const moveWallEnd = defineCommand(
  z.strictObject({
    id: IdSchema,
    end: z.enum(['start', 'end']),
    to: Vec2Schema,
    /** move only this wall, leaving walls that share the corner where they are */
    detach: z.boolean().optional(),
  }),
  (d, input) => {
    const wall = find(d.home, 'walls', input.id);
    moveCorner(d.home, wall, input.end, input.to, input.detach ?? false);
  },
);

export const setWallLength = defineCommand(
  z.strictObject({
    id: IdSchema,
    length: Length,
    /** the end that stays put; the other end moves along the wall */
    keep: z.enum(['start', 'end']).optional(),
  }),
  (d, input) => {
    const wall = find(d.home, 'walls', input.id);
    const keep = input.keep ?? 'start';
    const dir = wallDirection(wall);
    const to: Vec2 =
      keep === 'start'
        ? [wall.start[0] + dir[0] * input.length, wall.start[1] + dir[1] * input.length]
        : [wall.end[0] - dir[0] * input.length, wall.end[1] - dir[1] * input.length];
    moveCorner(d.home, wall, keep === 'start' ? 'end' : 'start', to, false);
  },
);

/** Move one end of a wall (and, unless detached, every wall end at the same corner). */
function moveCorner(home: Home, wall: Wall, which: 'start' | 'end', to: Vec2, detach: boolean): void {
  const from = wall[which];
  const moving: Array<{ wall: Wall; which: 'start' | 'end' }> = [{ wall, which }];
  if (!detach) {
    for (const other of home.walls) {
      if (other.id === wall.id || other.level !== wall.level) continue;
      for (const end of ['start', 'end'] as const) {
        if (distance(other[end], from) <= CONNECTED) moving.push({ wall: other, which: end });
      }
    }
  }
  for (const m of moving) moveEnd(home, m.wall, m.which, to);
}

// Openings keep their distance from the end that stays put, so they don't move in the room.
function moveEnd(home: Home, wall: Wall, which: 'start' | 'end', to: Vec2): void {
  const oldLength = wallLength(wall);
  wall[which] = [to[0], to[1]];
  const problem = wallLengthProblem(wall);
  if (problem) throw problem;
  if (which === 'start') {
    const grew = wallLength(wall) - oldLength;
    for (const o of home.openings) if (o.wall === wall.id) o.offset += grew;
  }
  checkOpeningsOn(home, wall);
}

/** Refuse an edit that leaves a door or window hanging off the end of its wall. */
function checkOpeningsOn(home: Home, wall: Wall): void {
  for (const o of home.openings) {
    if (o.wall !== wall.id) continue;
    const problem = blockingProblem(
      openingProblems(home, wall, o).filter((p) => p.code === 'opening_outside_wall'),
      false,
    );
    if (problem) {
      throw new EditError(problem.code, `${problem.message} Move or remove "${o.id}" first.`, problem.details);
    }
  }
}
