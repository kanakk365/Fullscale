// Furniture and other items, at their true size.
import { z } from 'zod';
import { CATALOG, CATALOG_BY_ID } from '../catalog.ts';
import { EditError } from '../errors.ts';
import { takeId } from '../ids.ts';
import { FieldSourcesSchema, IdSchema, ModelRefSchema, SourceSchema, Vec2Schema, Vec3Schema, type Item, type Vec3 } from '../schema.ts';
import { assignPatch, defineCommand, find, levelFor, mergeSources } from './edit.ts';
import { Coordinate, Length, SourcesInput } from './inputs.ts';

const Size = z.tuple([Length, Length, Length]);
/** [x, z] on the floor, or [x, y, z] with y = height of the item's bottom */
const Position = z.union([Vec2Schema, Vec3Schema]);

function toVec3(position: [number, number] | [number, number, number], keepY = 0): Vec3 {
  return position.length === 2 ? [position[0], keepY, position[1]] : position;
}

function catalogFor(id: string) {
  const entry = CATALOG_BY_ID.get(id);
  if (!entry) {
    const some = CATALOG.slice(0, 8).map((c) => c.id).join(', ');
    throw new EditError('not_found', `No catalogue entry "${id}". Try one of: ${some}, … (or "box" for a plain box at any size).`, { id, kind: 'catalog' });
  }
  return entry;
}

export const addItem = defineCommand(
  z.strictObject({
    id: IdSchema.optional(),
    level: IdSchema.optional(),
    catalog: z.string().min(1).max(80),
    name: z.string().min(1).max(80).optional(),
    position: Position,
    /** degrees, counter-clockwise seen from above */
    rotation: Coordinate.optional(),
    /** true outer size [width, height, depth]; leave out for the catalogue size */
    size: Size.optional(),
    materials: z.record(z.string(), IdSchema).optional(),
    model: ModelRefSchema.optional(),
    source: SourceSchema.optional(),
    sources: FieldSourcesSchema.optional(),
  }),
  (d, input) => {
    const entry = catalogFor(input.catalog);
    for (const m of Object.values(input.materials ?? {})) find(d.home, 'materials', m);
    const item: Item = {
      id: takeId(d.home, input.id, entry.id === 'box' ? 'item' : entry.id),
      level: levelFor(d.home, input.level),
      catalog: entry.id,
      name: input.name ?? entry.name,
      position: toVec3(input.position),
      rotation: input.rotation ?? 0,
      size: input.size ?? [...entry.size],
      materials: input.materials ?? {},
      locked: false,
      // Without a size given, the numbers come from the catalogue, not from whoever placed it.
      source: input.source ?? { kind: d.ctx.by },
    };
    if (!input.size && !input.sources?.size) item.sources = { size: { kind: 'catalog' } };
    if (input.sources) item.sources = { ...item.sources, ...input.sources };
    if (input.model) item.model = input.model;
    d.home.items.push(item);
  },
);

export const updateItem = defineCommand(
  z.strictObject({
    id: IdSchema,
    name: z.string().min(1).max(80).optional(),
    position: Position.optional(),
    rotation: Coordinate.optional(),
    size: Size.optional(),
    /** merged into the current part materials; null removes a part's material */
    materials: z.record(z.string(), IdSchema.nullable()).optional(),
    /** null: go back to the catalogue shape */
    model: ModelRefSchema.nullable().optional(),
    locked: z.boolean().optional(),
    level: IdSchema.optional(),
    source: SourceSchema.optional(),
    sources: SourcesInput.optional(),
  }),
  (d, { id, position, materials, sources, ...patch }) => {
    const item = find(d.home, 'items', id);
    if (item.locked && patch.locked !== false) {
      throw new EditError('locked_element', `"${item.name}" (${id}) is locked. Unlock it first.`, { id });
    }
    if (patch.level) find(d.home, 'levels', patch.level);
    assignPatch(item, patch);
    if (position) item.position = toVec3(position, item.position[1]);
    if (materials) {
      const next = { ...item.materials };
      for (const [part, m] of Object.entries(materials)) {
        if (m === null) delete next[part];
        else next[part] = find(d.home, 'materials', m).id;
      }
      item.materials = next;
    }
    mergeSources(item, sources);
  },
);
