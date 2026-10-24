// Serializable edits. The editor, the HTTP API, the MCP tools and the Blender add-on all
// send these, so every edit is checked the same way no matter who makes it. A batch is
// all-or-nothing and is one undo step.
import { z } from 'zod';
import {
  addCapture,
  addItem,
  addLevel,
  addOpening,
  addPlanPicture,
  addRectangularRoom,
  addRoom,
  addWall,
  BY_USER,
  clearHome,
  detectRooms,
  drawRoom,
  drawWall,
  edit,
  joinWallEnd,
  mergeWalls,
  moveWall,
  moveWallEnd,
  paint,
  placePlanPicture,
  remove,
  renameHome,
  scalePlanPicture,
  setWallLength,
  splitWall,
  updateItem,
  updateLevel,
  updateOpening,
  updateRoom,
  updateWall,
  upsertMaterial,
  type Command,
  type EditContext,
  type EditResult,
} from './commands/index.ts';
import { EditError, isEditError } from './errors.ts';
import type { Home } from './schema.ts';

/** Every edit that can be sent as data, by name. */
export const COMMANDS = {
  renameHome,
  addLevel,
  updateLevel,
  addWall,
  drawWall,
  updateWall,
  moveWall,
  moveWallEnd,
  setWallLength,
  splitWall,
  mergeWalls,
  joinWallEnd,
  addOpening,
  updateOpening,
  addRoom,
  updateRoom,
  addRectangularRoom,
  drawRoom,
  detectRooms,
  addItem,
  updateItem,
  upsertMaterial,
  paint,
  remove,
  clearHome,
  addPlanPicture,
  scalePlanPicture,
  placePlanPicture,
  addCapture,
} as const;

export type CommandName = keyof typeof COMMANDS;

// Each operation is its command's input plus `op: "<name>"`. Inputs are strict objects,
// so a misspelt field is refused instead of being silently dropped.
function op<N extends CommandName>(name: N) {
  return COMMANDS[name].schema.extend({ op: z.literal(name) });
}

export const BaseOperationSchema = z.discriminatedUnion('op', [
  op('renameHome'),
  op('addLevel'),
  op('updateLevel'),
  op('addWall'),
  op('drawWall'),
  op('updateWall'),
  op('moveWall'),
  op('moveWallEnd'),
  op('setWallLength'),
  op('splitWall'),
  op('mergeWalls'),
  op('joinWallEnd'),
  op('addOpening'),
  op('updateOpening'),
  op('addRoom'),
  op('updateRoom'),
  op('addRectangularRoom'),
  op('drawRoom'),
  op('detectRooms'),
  op('addItem'),
  op('updateItem'),
  op('upsertMaterial'),
  op('paint'),
  op('remove'),
  op('clearHome'),
  op('addPlanPicture'),
  op('scalePlanPicture'),
  op('placePlanPicture'),
  op('addCapture'),
]);

export const MAX_BATCH = 500;

export const BatchSchema = z.strictObject({
  op: z.literal('batch'),
  /** shown in the history, e.g. "Furnish the bedroom" */
  label: z.string().max(120).optional(),
  ops: z.array(BaseOperationSchema).min(1).max(MAX_BATCH),
});

export const OperationSchema = z.union([BaseOperationSchema, BatchSchema]);

/** One edit as data: a command's input plus its name, e.g. `{ op: 'addWall', start, end }`. */
export type BaseOperation = { [N in CommandName]: z.input<(typeof COMMANDS)[N]['schema']> & { op: N } }[CommandName];
/** An edit, or several applied together as one undo step. */
export type Operation = BaseOperation | { op: 'batch'; label?: string; ops: BaseOperation[] };

type ParsedOperation = z.output<typeof OperationSchema>;
type ParsedStep = z.output<typeof BaseOperationSchema>;

function parseOperation(input: unknown): ParsedOperation {
  const isBatch = typeof input === 'object' && input !== null && (input as { op?: unknown }).op === 'batch';
  const result = isBatch ? BatchSchema.safeParse(input) : BaseOperationSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join('.') || '(root)';
    throw new EditError('invalid_input', `Bad operation at ${path}: ${issue?.message}`, { path });
  }
  return result.data;
}

/** Apply one operation, or a batch, as a single edit. Throws EditError on bad input or a
 *  refused edit; a failed batch step names its position in `details.opIndex`. */
export function applyOperation(home: Home, input: unknown, ctx: EditContext = BY_USER): EditResult {
  const operation = parseOperation(input);
  const steps: ParsedStep[] = operation.op === 'batch' ? operation.ops : [operation];
  return edit(home, ctx, (d) => {
    steps.forEach((step, opIndex) => {
      const { op: name, ...stepInput } = step;
      // The union above has already checked `stepInput` against this command's schema.
      const command = COMMANDS[name] as unknown as Command<z.ZodType>;
      try {
        command.run(d, stepInput);
      } catch (err) {
        if (operation.op !== 'batch' || !isEditError(err)) throw err;
        throw new EditError(err.code, `Step ${opIndex + 1} (${name}) failed, so nothing was changed: ${err.message}`, { ...err.details, opIndex });
      }
    });
  });
}

/** A short label for history lists. */
export function describeOperation(operation: Operation): string {
  if (operation.op === 'batch') return operation.label ?? `${operation.ops.length} edits`;
  const id = 'id' in operation && typeof operation.id === 'string' ? ` ${operation.id}` : '';
  return `${operation.op}${id}`;
}
