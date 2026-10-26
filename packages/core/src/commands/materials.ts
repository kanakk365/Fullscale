// Materials and painting. "Paint it #9caf88" works without creating a material first.
import { z } from 'zod';
import { catalogEntry } from '../catalog.ts';
import { EditError } from '../errors.ts';
import { allocateId } from '../ids.ts';
import { roomWallFaces } from '../measure.ts';
import { HexColorSchema, IdSchema, MaterialSchema, type Home } from '../schema.ts';
import { defineCommand, find } from './edit.ts';

export const upsertMaterial = defineCommand(z.strictObject({ material: MaterialSchema }), (d, { material }) => {
  const i = d.home.materials.findIndex((m) => m.id === material.id);
  if (i >= 0) d.home.materials[i] = material;
  else d.home.materials.push(material);
});

export const PaintTargetSchema = z.union([
  z.strictObject({ wall: IdSchema, face: z.enum(['left', 'right', 'both']) }),
  z.strictObject({ room: IdSchema, surface: z.enum(['walls', 'floor', 'ceiling']) }),
  z.strictObject({ item: IdSchema, part: z.string().optional() }),
  z.strictObject({ opening: IdSchema, part: z.enum(['frame', 'leaf', 'glass']).optional() }),
]);

export type PaintTarget = z.infer<typeof PaintTargetSchema>;

/** Find or create a paint material for a colour. */
function paintFor(home: Home, color: string, name?: string): string {
  const hex = color.toLowerCase();
  const existing = home.materials.find((m) => m.kind === 'paint' && m.color.toLowerCase() === hex);
  if (existing) return existing.id;
  const id = allocateId(home, 'paint');
  home.materials.push({ id, name: name ?? `Paint ${hex}`, kind: 'paint', color: hex, roughness: 0.9, metalness: 0, opacity: 1 });
  return id;
}

/** Apply a material (by id) or a colour to a wall face, a room's surfaces, an item, or part of a door or window. */
export const paint = defineCommand(
  z.strictObject({
    target: PaintTargetSchema,
    material: IdSchema.optional(),
    color: HexColorSchema.optional(),
    /** name for a new paint colour */
    name: z.string().max(80).optional(),
  }),
  (d, { target, material, color, name }) => {
    const home = d.home;
    if (!material && !color) throw new EditError('invalid_input', 'paint needs a material id or a colour like "#9caf88".');
    const id = material ? find(home, 'materials', material).id : paintFor(home, color!, name);

    if ('wall' in target) {
      const wall = find(home, 'walls', target.wall);
      if (target.face !== 'right') wall.materials.left = id;
      if (target.face !== 'left') wall.materials.right = id;
    } else if ('room' in target) {
      const room = find(home, 'rooms', target.room);
      if (target.surface === 'floor') room.floorMaterial = id;
      else if (target.surface === 'ceiling') room.ceilingMaterial = id;
      else {
        const faces = roomWallFaces(home, room.id);
        if (faces.length === 0) {
          throw new EditError('nothing_to_paint', `Room "${room.id}" has no walls along its outline to paint.`, { id: room.id });
        }
        for (const f of faces) find(home, 'walls', f.wall).materials[f.face] = id;
      }
    } else if ('opening' in target) {
      const opening = find(home, 'openings', target.opening);
      // A door's leaf or a window's frame unless a part is named.
      const part = target.part ?? (opening.type === 'door' ? 'leaf' : 'frame');
      if (part === 'leaf' && opening.type !== 'door') throw new EditError('invalid_input', `"${opening.id}" is a ${opening.type}; only doors have a leaf.`, { id: opening.id });
      if (part === 'glass' && opening.type !== 'window') throw new EditError('invalid_input', `"${opening.id}" is a ${opening.type}; only windows have glass.`, { id: opening.id });
      opening.materials = { ...opening.materials, [part]: id };
    } else {
      const item = find(home, 'items', target.item);
      const parts = target.part ? [target.part] : catalogEntry(item.catalog).parts.slice(0, 1);
      for (const p of parts) item.materials[p] = id;
    }
  },
);
