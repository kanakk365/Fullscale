// Creating a home, naming it, and its levels (storeys).
import { z } from 'zod';
import { takeId } from '../ids.ts';
import { FORMAT, HomeSchema, IdSchema, SourceSchema, type Home, type Level } from '../schema.ts';
import { assignPatch, defineCommand, find, mergeSources } from './edit.ts';
import { Coordinate, Length, SourcesInput } from './inputs.ts';

export const DEFAULT_STOREY_HEIGHT = 2.7;

export function createHome(opts: { name: string; id?: string; storeyHeight?: number }): Home {
  const t = new Date().toISOString();
  return HomeSchema.parse({
    format: FORMAT,
    id: opts.id ?? `home-${Math.random().toString(36).slice(2, 10)}`,
    name: opts.name,
    units: 'm',
    createdAt: t,
    updatedAt: t,
    levels: [{ id: 'level-0', name: 'Ground floor', elevation: 0, height: opts.storeyHeight ?? DEFAULT_STOREY_HEIGHT }],
    materials: [
      { id: 'paint-white', name: 'Warm white paint', kind: 'paint', color: '#f1ede4', roughness: 0.9 },
      { id: 'oak-floor', name: 'Oak floor', kind: 'wood', color: '#b08a5e', texture: 'oak', tileSize: 1.2, roughness: 0.6 },
      { id: 'ceiling-white', name: 'Ceiling white', kind: 'paint', color: '#f7f6f2', roughness: 0.95 },
    ],
    nextIds: { level: 1 },
  });
}

export const renameHome = defineCommand(z.strictObject({ name: z.string().min(1).max(120) }), (d, { name }) => {
  d.home.name = name;
});

export const addLevel = defineCommand(
  z.strictObject({
    id: IdSchema.optional(),
    name: z.string().min(1).max(80),
    elevation: Coordinate,
    /** leave out to copy the ground floor's height */
    height: Length.optional(),
    source: SourceSchema.optional(),
  }),
  (d, input) => {
    const level: Level = {
      id: takeId(d.home, input.id, 'level'),
      name: input.name,
      elevation: input.elevation,
      height: input.height ?? d.home.levels[0]!.height,
      source: input.source ?? { kind: d.ctx.by },
    };
    d.home.levels.push(level);
  },
);

export const updateLevel = defineCommand(
  z.strictObject({
    id: IdSchema,
    name: z.string().min(1).max(80).optional(),
    elevation: Coordinate.optional(),
    height: Length.optional(),
    source: SourceSchema.optional(),
    sources: SourcesInput.optional(),
  }),
  (d, { id, sources, ...patch }) => {
    const level = find(d.home, 'levels', id);
    assignPatch(level, patch);
    mergeSources(level, sources);
  },
);
