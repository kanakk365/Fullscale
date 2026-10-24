// Tools for sources, removing, raw edits, undo, starting over and plan pictures.
import { readFileSync } from 'node:fs';
import { COMMANDS, EditError, KINDS, locate, MAX_BATCH, SourceSchema, type BaseOperation } from '@fullscale/core';
import { z } from 'zod';
import { insideFolder } from '../files.ts';
import { pictureInfo, type PictureInfo } from '../images.ts';
import { defineTool, Distance, Id, Length, Point, receiptResult, write, WriteOptions } from './define.ts';

const UPDATE_BY_KIND = { level: 'updateLevel', wall: 'updateWall', opening: 'updateOpening', room: 'updateRoom', item: 'updateItem' } as const;

export const setSource = defineTool({
  name: 'set_source',
  title: 'Say where a number came from',
  description:
    'Record where elements’ dimensions came from and how sure they are: a tape measure (user ±0.5 cm), a scan, a plan, the maker’s listed size, an estimate. With `field`, only that dimension (e.g. "thickness" of a wall, "size" of an item). Never claim a measurement that wasn’t made.',
  input: z.object({
    ids: z.array(Id).min(1).max(100),
    field: z.string().max(40).optional().describe('one dimension, e.g. "thickness", "height", "size"; default the whole element'),
    source: SourceSchema,
    ...WriteOptions,
  }),
  effect: 'write',
  run(ctx, q) {
    const home = ctx.studio.home;
    const ops: BaseOperation[] = q.ids.map((id) => {
      const at = locate(home, id);
      if (!at) throw new EditError('not_found', `Nothing with id "${id}".`, { id });
      const kind = at.info.kind;
      if (!(kind in UPDATE_BY_KIND)) throw new EditError('wrong_kind', `"${id}" is a ${kind}; sources are kept for levels, walls, openings, rooms and items.`, { id, kind });
      if (q.field && !KINDS[kind].dimensions.includes(q.field)) {
        throw new EditError('invalid_input', `A ${kind} has no dimension "${q.field}". It has: ${KINDS[kind].dimensions.join(', ')}.`, { id, field: q.field });
      }
      const op = UPDATE_BY_KIND[kind as keyof typeof UPDATE_BY_KIND];
      return (q.field ? { op, id, sources: { [q.field]: q.source } } : { op, id, source: q.source }) as BaseOperation;
    });
    return receiptResult(write(ctx, { op: 'batch', label: `Set source on ${q.ids.length} element${q.ids.length === 1 ? '' : 's'}`, ops }, q));
  },
});

export const remove = defineTool({
  name: 'remove',
  title: 'Remove',
  description: 'Remove elements. A wall takes its doors and windows with it; a level or material still in use is refused, naming what uses it. Use dry_run to see everything that would go.',
  input: z.object({ ids: z.array(Id).min(1).max(500), ...WriteOptions }),
  effect: 'destructive',
  run(ctx, q) {
    return receiptResult(write(ctx, { op: 'remove', ids: q.ids }, q));
  },
});

export const applyEdits = defineTool({
  name: 'apply_edits',
  title: 'Apply raw edits',
  description: `Apply core edit operations as one all-or-nothing undo step: each is {"op": name, ...fields}. Names: ${Object.keys(COMMANDS).join(', ')}. Fields are plain metres and [x, z] pairs here. A failed step is reported with its position (opIndex) and nothing changes. Prefer the specific tools; use this for batches.`,
  input: z.object({
    ops: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_BATCH),
    label: z.string().max(120).optional().describe('shown in the history'),
    ...WriteOptions,
  }),
  effect: 'destructive',
  run(ctx, q) {
    return receiptResult(write(ctx, { op: 'batch', ops: q.ops, ...(q.label ? { label: q.label } : {}) }, q));
  },
});

function undoTool(direction: 'undo' | 'redo') {
  return defineTool({
    name: direction,
    title: direction === 'undo' ? 'Undo' : 'Redo',
    description:
      direction === 'undo'
        ? 'Undo your own latest edit (the person’s and other agents’ edits are theirs to undo). Refused, naming the fields, if someone has since changed the same things.'
        : 'Redo your latest undone edit.',
    input: z.object({}),
    effect: 'write',
    run(ctx) {
      const r = direction === 'undo' ? ctx.studio.undo(ctx.actor) : ctx.studio.redo(ctx.actor);
      if (!r.ok) throw new EditError(r.reason === 'nothing' ? 'nothing_to_undo' : 'undo_conflict', r.message);
      return { text: `${r.label}. Revision ${r.rev}.`, data: { rev: r.rev, label: r.label } };
    },
  });
}

export const undo = undoTool('undo');
export const redo = undoTool('redo');

export const clearHome = defineTool({
  name: 'clear_home',
  title: 'Start over',
  description: 'Remove every wall, opening, room and item (levels and materials stay). The only way to empty a home; other edits that would empty it are refused. Give the reason.',
  input: z.object({ reason: z.string().min(3).max(300), ...WriteOptions }),
  effect: 'destructive',
  run(ctx, q) {
    return receiptResult(write(ctx, { op: 'clearHome', reason: q.reason }, q));
  },
});

export const addPlanPicture = defineTool({
  name: 'add_plan_picture',
  title: 'Lay a floor plan picture under a level',
  description: 'Add a floor plan picture (PNG or JPEG, in the home’s folder) under a level, to trace over. Scale it next with scale_plan_picture.',
  input: z.object({
    path: z.string().max(300).describe('the picture, relative to the home’s folder'),
    level: Id.optional(),
    note: z.string().max(500).optional(),
    ...WriteOptions,
  }),
  effect: 'write',
  run(ctx, q) {
    const full = insideFolder(ctx.paths.homeDir, q.path);
    if (!full) throw new EditError('invalid_input', `"${q.path}" is not inside the home's folder.`, { path: q.path });
    let info: PictureInfo;
    try {
      info = pictureInfo(readFileSync(full));
    } catch (err) {
      throw new EditError('invalid_input', `Can't read "${q.path}": ${(err as Error).message}.`, { path: q.path });
    }
    return receiptResult(write(ctx, { op: 'addPlanPicture', path: q.path, pixels: [info.width, info.height], ...(q.level ? { level: q.level } : {}), ...(q.note ? { note: q.note } : {}) }, q));
  },
});

export const scalePlanPicture = defineTool({
  name: 'scale_plan_picture',
  title: 'Scale a floor plan picture',
  description:
    'Set a plan picture’s scale from lengths you know: two points on the picture (in its own pixels, as view_plan_picture shows them) and the real length between them. Two or more lengths are checked against each other; if one is more than 2% off, the plan may not be to scale and the scale is refused.',
  input: z.object({
    id: Id,
    known: z
      .array(
        z.object({
          a: Point.describe('[x, y] picture pixels'),
          b: Point.describe('[x, y] picture pixels'),
          length: Length('the real length between them'),
          uncertainty: Distance('± on that length, if known').optional(),
        }),
      )
      .min(1)
      .max(20),
    ...WriteOptions,
  }),
  effect: 'write',
  run(ctx, q) {
    const known = q.known.map((k) => ({ a: k.a, b: k.b, metres: k.length, ...(k.uncertainty !== undefined ? { uncertainty: k.uncertainty } : {}) }));
    return receiptResult(write(ctx, { op: 'scalePlanPicture', id: q.id, known }, q));
  },
});
