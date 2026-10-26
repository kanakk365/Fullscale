// Doors, windows, plain openings and niches (alcoves) in walls. The same fit rules as
// validation and the editor tools (rules.ts) decide what is allowed.
import { z } from 'zod';
import { faceOffsets, leftOf, pointInPolygon, wallDirection, wallLength } from '../geometry.ts';
import { takeId } from '../ids.ts';
import { blockingProblem, openingProblems } from '../rules.ts';
import { FieldSourcesSchema, IdSchema, SourceSchema, type Home, type Opening, type Wall } from '../schema.ts';
import { assignPatch, defineCommand, find, mergeSources } from './edit.ts';
import { Coordinate, Length, NonNegative, SourcesInput } from './inputs.ts';

export const OPENING_DEFAULTS: Readonly<Record<Opening['type'], { width: number; height: number; sill: number }>> = {
  door: { width: 0.9, height: 2.1, sill: 0 },
  window: { width: 1.2, height: 1.2, sill: 0.9 },
  opening: { width: 0.9, height: 2.1, sill: 0 },
  niche: { width: 0.8, height: 1.2, sill: 0.9 },
};

/** A niche goes this deep when no depth is given, if the wall is thick enough. */
export const NICHE_DEPTH = 0.15;

const OpeningType = z.enum(['door', 'window', 'opening', 'niche']);
const OpenDegrees = z.number().min(0).max(120);
const Shelves = z.number().int().min(0).max(12);
const Leaves = z.union([z.literal(1), z.literal(2)]);
const Panels = z.number().int().min(0).max(6);
const Panes = z.tuple([z.number().int().min(1).max(6), z.number().int().min(1).max(8)]);

/** The face of a wall that a room is on: niches open into the room by default. */
export function roomFace(home: Home, wall: Wall): 'left' | 'right' | null {
  const len = wallLength(wall);
  const d = wallDirection(wall);
  const n = leftOf(d);
  const off = faceOffsets(wall);
  const mid: [number, number] = [wall.start[0] + d[0] * len * 0.5, wall.start[1] + d[1] * len * 0.5];
  const rooms = home.rooms.filter((r) => r.level === wall.level);
  const roomAt = (offset: number) => rooms.some((r) => pointInPolygon([mid[0] + n[0] * offset, mid[1] + n[1] * offset], r.polygon));
  if (roomAt(off.left + 0.05)) return 'left';
  if (roomAt(off.right - 0.05)) return 'right';
  return null;
}
/** allow overlapping another opening on purpose */
const Force = z.boolean().optional();

export const addOpening = defineCommand(
  z.strictObject({
    id: IdSchema.optional(),
    wall: IdSchema,
    type: OpeningType,
    /** distance from the wall's start to the opening's near edge; leave out to centre it */
    offset: Coordinate.optional(),
    width: Length.optional(),
    height: Length.optional(),
    sill: NonNegative.optional(),
    hinge: z.enum(['start', 'end']).optional(),
    swing: z.enum(['left', 'right']).optional(),
    /** doors: how far the leaf stands open, in degrees (0 = shut) */
    openDegrees: OpenDegrees.optional(),
    /** niches: how deep, which face, and how many built-in shelves */
    depth: Length.optional(),
    face: z.enum(['left', 'right']).optional(),
    shelves: Shelves.optional(),
    /** doors and windows: one leaf or two; doors' raised panels; windows' panes */
    leaves: Leaves.optional(),
    panels: Panels.optional(),
    panes: Panes.optional(),
    style: z.string().max(40).optional(),
    source: SourceSchema.optional(),
    sources: FieldSourcesSchema.optional(),
    force: Force,
  }),
  (d, input) => {
    const wall = find(d.home, 'walls', input.wall);
    const defaults = OPENING_DEFAULTS[input.type];
    const width = input.width ?? defaults.width;
    const opening: Opening = {
      id: takeId(d.home, input.id, input.type),
      wall: wall.id,
      type: input.type,
      offset: input.offset ?? (wallLength(wall) - width) / 2,
      width,
      height: input.height ?? defaults.height,
      sill: input.sill ?? defaults.sill,
      source: input.source ?? { kind: d.ctx.by },
    };
    if (input.type === 'door') {
      opening.hinge = input.hinge ?? 'start';
      opening.swing = input.swing ?? 'left';
      if (input.openDegrees !== undefined) opening.openDegrees = input.openDegrees;
    }
    if (input.type === 'niche') {
      opening.depth = input.depth ?? Math.min(NICHE_DEPTH, wall.thickness * 0.7);
      opening.face = input.face ?? roomFace(d.home, wall) ?? 'left';
      if (input.shelves !== undefined) opening.shelves = input.shelves;
    }
    if (input.leaves !== undefined && (input.type === 'door' || input.type === 'window')) opening.leaves = input.leaves;
    if (input.panels !== undefined && input.type === 'door') opening.panels = input.panels;
    if (input.panes !== undefined && input.type === 'window') opening.panes = input.panes;
    if (input.style) opening.style = input.style;
    if (input.sources) opening.sources = input.sources;
    const problem = blockingProblem(openingProblems(d.home, wall, opening), input.force);
    if (problem) throw problem;
    d.home.openings.push(opening);
  },
);

export const updateOpening = defineCommand(
  z.strictObject({
    id: IdSchema,
    /** move it to another wall */
    wall: IdSchema.optional(),
    offset: Coordinate.optional(),
    width: Length.optional(),
    height: Length.optional(),
    sill: NonNegative.optional(),
    hinge: z.enum(['start', 'end']).nullable().optional(),
    swing: z.enum(['left', 'right']).nullable().optional(),
    openDegrees: OpenDegrees.nullable().optional(),
    depth: Length.optional(),
    face: z.enum(['left', 'right']).optional(),
    shelves: Shelves.nullable().optional(),
    leaves: Leaves.nullable().optional(),
    panels: Panels.nullable().optional(),
    panes: Panes.nullable().optional(),
    style: z.string().max(40).nullable().optional(),
    source: SourceSchema.optional(),
    sources: SourcesInput.optional(),
    force: Force,
  }),
  (d, { id, sources, force, ...patch }) => {
    const opening = find(d.home, 'openings', id);
    assignPatch(opening, patch);
    mergeSources(opening, sources);
    const wall = find(d.home, 'walls', opening.wall);
    const problem = blockingProblem(openingProblems(d.home, wall, opening), force);
    if (problem) throw problem;
  },
);
