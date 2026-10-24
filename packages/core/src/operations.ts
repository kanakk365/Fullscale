// Serializable edits. The editor, the HTTP API, the MCP tools and the Blender add-on all
// send these, so every edit is checked the same way no matter who makes it. A batch is
// all-or-nothing and is one undo step.
import { z } from 'zod';
import {
  addItem,
  addLevel,
  addOpening,
  addRectangularRoom,
  addRoom,
  addWall,
  BY_USER,
  clearHome,
  edit,
  moveWallEnd,
  paint,
  remove,
  renameHome,
  setWallLength,
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
  updateWall,
  moveWallEnd,
  setWallLength,
  addOpening,
  updateOpening,
  addRoom,
  updateRoom,
  addRectangularRoom,
  addItem,
  updateItem,
  upsertMaterial,
  paint,
  remove,
  clearHome,
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
  op('updateWall'),
  op('moveWallEnd'),
  op('setWallLength'),
  op('addOpening'),
  op('updateOpening'),
  op('addRoom'),
  op('updateRoom'),
  op('addRectangularRoom'),
  op('addItem'),
  op('updateItem'),
  op('upsertMaterial'),
  op('paint'),
  op('remove'),
  op('clearHome'),
]);

export const MAX_BATCH = 500;

export const BatchSchema = z.strictObject({
  op: z.literal('batch'),
  /** shown in the history, e.g. "Furnish the bedroom" */
  label: z.string().max(120).optional(),
  ops: z.array(BaseOperationSchema).min(1).max(MAX_BATCH),
});

export const OperationSchema = z.union([BaseOperationSchema, BatchSchema]);

export type BaseOperation = z.infer<typeof BaseOperationSchema>;
export type Operation = z.infer<typeof OperationSchema>;

function parseOperation(input: unknown): Operation {
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
  const steps: BaseOperation[] = operation.op === 'batch' ? operation.ops : [operation];
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
