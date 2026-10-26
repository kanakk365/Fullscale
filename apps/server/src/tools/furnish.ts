// Tools that furnish and finish: furniture, the user's own models, paint and materials.
import {
  addItem,
  CATALOG_BY_ID,
  ceilingHeight,
  checkFit,
  EditError,
  MaterialSchema,
  placeAgainstWall,
  pointInPolygon,
  roomCentre,
  sourceOf,
  type BaseOperation,
  type FitProblem,
  type Home,
  type Item,
  type ModelRefInput,
  type Vec3,
} from '@fullscale/core';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { insideFolder } from '../files.ts';
import { describeModel, listModels } from '../model-files.ts';
import { defineTool, Distance, Id, Point, receiptResult, Size, write, WriteOptions, type ToolContext } from './define.ts';

const ModelInput = z
  .object({
    file: z.string().max(200).describe('path inside the local models folder, as list_models shows it'),
    fit: z.enum(['uniform', 'stretch']).optional().describe('uniform keeps the model’s proportions (default); stretch matches each side'),
    yaw: z
      .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
      .optional()
      .describe('degrees that turn the model so its front faces the item’s front'),
    licence: z.enum(['local-only', 'cc0', 'cc-by']).optional().describe('local-only (default) for downloads that must never leave this computer'),
    credit: z.string().max(200).optional(),
  })
  .describe('the user’s own 3D model to draw at the item’s size');

const Placement = {
  position: Point.optional().describe('[x, z] of the footprint centre'),
  elevation: Distance('height of its bottom above the floor, default 0').optional(),
  rotation: z.number().finite().optional().describe('degrees, counter-clockwise seen from above; 0 faces down the plan (+z)'),
  against: z
    .object({
      wall: Id,
      along: Distance('wall start to the item’s centre; default the middle').optional(),
      gap: Distance('space between the wall and its back, default 1 cm').optional(),
      face: z.enum(['left', 'right']).optional().describe('which face; default the one facing into a room'),
    })
    .optional()
    .describe('stand it with its back to a wall, facing into the room'),
  room: Id.optional().describe('put it in the middle of this room (when no position or wall is given)'),
};

const LightInput = z
  .object({
    on: z.boolean().optional(),
    kelvin: z.number().int().min(1500).max(10000).optional().describe('colour: about 2700 warm yellow, 4000 neutral white, 6500 cool daylight white'),
    lumens: z.number().positive().max(50000).optional().describe('brightness; a 9 W LED bulb gives about 800'),
  })
  .describe('lights only (the catalogue’s lighting group): on or off, and the colour and brightness of the real one');

const ItemInput = z.object({
  catalog: z.string().min(1).max(80).describe('catalogue id (search_catalog), or "box" for a plain box'),
  name: z.string().min(1).max(80).optional(),
  size: Size.optional().describe('the real [width, height, depth]; default the catalogue size'),
  ...Placement,
  model: ModelInput.optional(),
  light: LightInput.optional(),
});

/** Turn a model input into a model reference, reading the file's size. */
function modelRef(ctx: ToolContext, input: z.output<typeof ModelInput>): ModelRefInput {
  const full = insideFolder(ctx.paths.models, input.file);
  if (!full || !existsSync(full)) throw new EditError('bad_model', `No model "${input.file}" in the models folder. list_models shows what is there.`, { file: input.file });
  const info = describeModel(ctx.paths.models, input.file);
  return {
    file: input.file,
    ...(input.fit ? { fit: input.fit } : {}),
    ...(input.yaw !== undefined ? { yaw: input.yaw } : {}),
    ...(input.licence ? { licence: input.licence } : {}),
    ...(input.credit ? { credit: input.credit } : {}),
    ...(info.nativeSize ? { nativeSize: input.yaw === 90 || input.yaw === 270 ? [info.nativeSize[2], info.nativeSize[1], info.nativeSize[0]] : info.nativeSize } : {}),
  };
}

/** Where an item goes: by wall, by position, or in the middle of a room. Things that hang
 *  from the ceiling (fans, ceiling lights) go up to the ceiling unless an elevation is given. */
function poseFor(
  home: Home,
  q: {
    size: [number, number, number];
    position?: [number, number];
    elevation?: number;
    rotation?: number;
    against?: z.output<typeof Placement.against>;
    room?: string;
    hang?: { level: string };
  },
): { position: Vec3; rotation: number } {
  const pose = placeAt(home, q);
  if (q.hang && q.elevation === undefined) {
    const level = home.levels.find((l) => l.id === q.hang!.level) ?? home.levels[0]!;
    const room = home.rooms.find((r) => r.level === level.id && pointInPolygon([pose.position[0], pose.position[2]], r.polygon));
    const ceiling = room ? ceilingHeight(home, room) : level.height;
    pose.position = [pose.position[0], Math.max(0, Math.round((ceiling - q.size[1]) * 1000) / 1000), pose.position[2]];
  }
  return pose;
}

function placeAt(
  home: Home,
  q: { size: [number, number, number]; position?: [number, number]; elevation?: number; rotation?: number; against?: z.output<typeof Placement.against>; room?: string },
): { position: Vec3; rotation: number } {
  const elevation = q.elevation ?? 0;
  if (q.against) {
    const p = placeAgainstWall(home, { wall: q.against.wall, size: q.size, elevation, ...strip({ along: q.against.along, gap: q.against.gap, face: q.against.face, room: q.room }) });
    return { position: p.position, rotation: q.rotation ?? p.rotation };
  }
  if (q.position) return { position: [q.position[0], elevation, q.position[1]], rotation: q.rotation ?? 0 };
  if (q.room) {
    const c = roomCentre(home, q.room);
    return { position: [c[0], elevation, c[1]], rotation: q.rotation ?? 0 };
  }
  throw new EditError('invalid_input', 'Say where it goes: a position, a wall to stand against, or a room.');
}

const strip = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

const problemText = (problems: FitProblem[]) => problems.map((p) => p.message).join(' ');

export const addItems = defineTool({
  name: 'add_items',
  title: 'Add furniture',
  description:
    'Add up to 30 items in one undo step. Each is placed by position, against a wall (back to the wall, facing the room) or in the middle of a room, then checked against walls, furniture, door swings and its room. Items that don’t fit are left out with the reason and the nearest spot that works, unless force is set. Give real product sizes when known.',
  input: z.object({
    items: z.array(ItemInput).min(1).max(30),
    level: Id.optional(),
    clearance: Distance('space to keep around each item, default 0').optional(),
    force: z.boolean().optional().describe('place items even where they don’t fit'),
    ...WriteOptions,
  }),
  effect: 'write',
  run(ctx, q) {
    let scratch = ctx.studio.home;
    const ops: BaseOperation[] = [];
    const refused: Array<{ index: number; catalog: string; problems: FitProblem[]; suggestion?: { position: Vec3; rotation: number } }> = [];
    q.items.forEach((item, index) => {
      const entry = CATALOG_BY_ID.get(item.catalog);
      if (!entry) throw new EditError('not_found', `Item ${index + 1}: no catalogue entry "${item.catalog}". Try search_catalog, or "box" for a plain box.`, { index, catalog: item.catalog });
      const size = item.size ?? entry.size;
      const pose = poseFor(scratch, { ...item, size, ...(entry.ceiling ? { hang: { level: q.level ?? scratch.levels[0]!.id } } : {}) });
      const fit = checkFit(scratch, { size, position: pose.position, rotation: pose.rotation, ...(q.level ? { level: q.level } : {}), ...(q.clearance ? { clearance: q.clearance } : {}) });
      if (!fit.fits && !q.force) {
        refused.push({ index, catalog: item.catalog, problems: fit.problems, ...(fit.suggestion ? { suggestion: fit.suggestion } : {}) });
        return;
      }
      const op: BaseOperation = {
        op: 'addItem',
        catalog: item.catalog,
        position: pose.position,
        rotation: pose.rotation,
        ...(q.level ? { level: q.level } : {}),
        ...(item.name ? { name: item.name } : {}),
        ...(item.size ? { size: item.size } : {}),
        ...(item.model ? { model: modelRef(ctx, item.model) } : {}),
        ...(item.light ? { light: item.light } : {}),
        source: { kind: ctx.by },
      };
      ops.push(op);
      // Later items are checked against the ones placed before them.
      const { op: _op, ...input } = op;
      scratch = addItem(scratch, input as Parameters<typeof addItem>[1], { by: ctx.by }).home;
    });

    const lines = refused.map((r) => {
      const s = r.suggestion;
      return `Item ${r.index + 1} (${r.catalog}) left out: ${problemText(r.problems)}${s ? ` It would fit at [${s.position[0]}, ${s.position[2]}], turned ${s.rotation}°.` : ''}`;
    });
    if (!ops.length) {
      throw new EditError('does_not_fit', `Nothing was placed. ${lines.join(' ')}`, { refused });
    }
    const receipt = write(ctx, { op: 'batch', label: `Add ${ops.length} item${ops.length === 1 ? '' : 's'}`, ops }, q);
    receipt.notes.push(...lines);
    return receiptResult(receipt, { refused });
  },
});

export const updateItem = defineTool({
  name: 'update_item',
  title: 'Change an item',
  description:
    'Move, turn, resize, rename, lock or unlock an item, give it one of the user’s own models (null goes back to the catalogue shape), or switch a light on or off and set its colour and brightness (null goes back to the catalogue’s). A new pose is checked like add_items; force places it anyway.',
  input: z.object({
    id: Id,
    name: z.string().min(1).max(80).optional(),
    size: Size.optional(),
    ...Placement,
    model: ModelInput.nullable().optional(),
    light: LightInput.nullable().optional(),
    locked: z.boolean().optional(),
    force: z.boolean().optional().describe('move it even where it doesn’t fit'),
    ...WriteOptions,
  }),
  effect: 'write',
  run(ctx, q) {
    const home = ctx.studio.home;
    const item = home.items.find((i) => i.id === q.id);
    if (!item) throw new EditError('not_found', `No item with id "${q.id}".`, { id: q.id, kind: 'item' });
    const size = q.size ?? item.size;
    const moves = q.position || q.against || q.room || q.rotation !== undefined || q.elevation !== undefined || q.size;
    const pose = moves
      ? poseFor(home, {
          size,
          position: q.position ?? (q.against || q.room ? undefined : [item.position[0], item.position[2]]),
          elevation: q.elevation ?? item.position[1],
          rotation: q.rotation ?? (q.against ? undefined : item.rotation),
          ...strip({ against: q.against, room: q.room }),
        })
      : undefined;
    if (pose && !q.force) {
      const fit = checkFit(home, { size, position: pose.position, rotation: pose.rotation, level: item.level, ignore: [item.id], sizeSource: q.size ? { kind: ctx.by } : sourceOf(item, 'size') });
      if (!fit.fits) {
        const s = fit.suggestion;
        throw new EditError(
          'does_not_fit',
          `"${item.name}" doesn't fit there: ${problemText(fit.problems)}${s ? ` It would fit at [${s.position[0]}, ${s.position[2]}], turned ${s.rotation}°.` : ''}`,
          {
            problems: fit.problems,
            ...(s ? { suggestion: s } : {}),
          },
        );
      }
    }
    const op: BaseOperation = {
      op: 'updateItem',
      id: item.id,
      ...strip({ name: q.name, size: q.size, locked: q.locked }),
      ...(pose ? { position: pose.position, rotation: pose.rotation } : {}),
      ...(q.model === null ? { model: null } : q.model ? { model: modelRef(ctx, q.model) } : {}),
      ...(q.light !== undefined ? { light: q.light } : {}),
    };
    return receiptResult(write(ctx, op, q));
  },
});

export const PaintTarget = z.union([
  z.object({ wall: Id, face: z.enum(['left', 'right', 'both']) }),
  z.object({ room: Id, surface: z.enum(['walls', 'floor', 'ceiling']) }),
  z.object({ item: Id, part: z.string().max(40).optional().describe('a named part like "body" or "legs"; default the main part') }),
  z.object({
    opening: Id,
    part: z.enum(['frame', 'leaf', 'glass']).optional().describe('frame, a door’s leaf or a window’s glass; default a door’s leaf or a window’s frame'),
  }),
]);

export const paint = defineTool({
  name: 'paint',
  title: 'Paint and finish',
  description:
    'Give surfaces a colour or a material: wall faces, a room’s walls, floor or ceiling, part of an item, or a door’s leaf, a window’s glass or either one’s frame. A colour like "#9caf88" makes (or reuses) a paint; for tinted glass make a glass material with upsert_material (opacity below 1) and give its id.',
  input: z.object({
    targets: z.array(PaintTarget).min(1).max(50),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional()
      .describe('#rrggbb'),
    material: Id.optional().describe('an existing material id'),
    name: z.string().max(80).optional().describe('name for a new paint colour, e.g. "Sage green"'),
    ...WriteOptions,
  }),
  effect: 'write',
  run(ctx, q) {
    if (!q.color === !q.material) throw new EditError('invalid_input', 'Give a colour or a material id.');
    const ops: BaseOperation[] = q.targets.map((target) => ({ op: 'paint', target, ...strip({ color: q.color, material: q.material, name: q.name }) }) as BaseOperation);
    return receiptResult(write(ctx, { op: 'batch', label: `Paint ${q.targets.length} surface${q.targets.length === 1 ? '' : 's'}`, ops }, q));
  },
});

export const upsertMaterial = defineTool({
  name: 'upsert_material',
  title: 'Add or change a material',
  description: 'Add a material (paint, wood, tile, stone…) or change one, by id. tileSize is the real size of one texture tile in metres.',
  input: z.object({ material: MaterialSchema, ...WriteOptions }),
  effect: 'write',
  run(ctx, q) {
    return receiptResult(write(ctx, { op: 'upsertMaterial', material: q.material }, q));
  },
});

export const listModelsTool = defineTool({
  name: 'list_models',
  title: 'Your own 3D models',
  description:
    'The user’s own 3D model files (glTF/GLB) in the local models folder, with each model’s size in its own units. Give one to an item with add_items or update_item; it is drawn at the item’s true size. These files never leave this computer.',
  input: z.object({}),
  effect: 'read',
  run(ctx) {
    const models = listModels(ctx.paths.models);
    const used = new Map<string, string[]>();
    for (const it of ctx.studio.home.items as Item[]) if (it.model) used.set(it.model.file, [...(used.get(it.model.file) ?? []), it.id]);
    const text = models.length
      ? models
          .map(
            (mdl) =>
              `${mdl.file}: ${mdl.nativeSize ? mdl.nativeSize.map((v) => v.toFixed(3)).join(' × ') : `size unknown (${mdl.problem})`}${used.has(mdl.file) ? `; used by ${used.get(mdl.file)!.join(', ')}` : ''}`,
          )
          .join('\n')
      : 'No models yet. Put .glb or .gltf files in the models folder (data/models/ by default).';
    return { text, data: { folder: ctx.paths.models, models: models.map((mdl) => ({ ...mdl, usedBy: used.get(mdl.file) ?? [] })) } };
  },
});
