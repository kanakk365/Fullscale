// Doors, windows and plain openings in walls. The same fit rules as validation and the
// editor tools (rules.ts) decide what is allowed.
import { z } from 'zod';
import { wallLength } from '../geometry.ts';
import { takeId } from '../ids.ts';
import { blockingProblem, openingProblems } from '../rules.ts';
import { FieldSourcesSchema, IdSchema, SourceSchema, type Opening } from '../schema.ts';
import { assignPatch, defineCommand, find, mergeSources } from './edit.ts';
import { Coordinate, Length, NonNegative, SourcesInput } from './inputs.ts';

export const OPENING_DEFAULTS: Readonly<Record<Opening['type'], { width: number; height: number; sill: number }>> = {
  door: { width: 0.9, height: 2.1, sill: 0 },
  window: { width: 1.2, height: 1.2, sill: 0.9 },
  opening: { width: 0.9, height: 2.1, sill: 0 },
};

const OpeningType = z.enum(['door', 'window', 'opening']);
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
    }
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
