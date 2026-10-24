// Errors raised on purpose by edits and checks. Each carries a stable `code` that programs
// (the editor, MCP tools, tests) can rely on, and a message written for people and agents
// alike: what went wrong, with the numbers involved, and what would work instead.

export type ErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'wrong_kind'
  | 'id_exists'
  | 'in_use'
  | 'last_level'
  | 'locked_element'
  | 'wall_too_short'
  | 'room_too_small'
  | 'invalid_polygon'
  | 'opening_outside_wall'
  | 'opening_overlap'
  | 'opening_too_tall'
  | 'item_past_wall_end'
  | 'nothing_to_paint'
  | 'bad_model'
  | 'home_wipe_blocked'
  | 'bad_length';

export class EditError extends Error {
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'EditError';
    this.code = code;
    this.details = details;
  }

  /** The shape tools send back: `{ error, code, ...details }`. */
  toJSON(): Record<string, unknown> {
    return { error: this.message, code: this.code, ...this.details };
  }
}

/** True for an EditError, even one created by another copy of this package. */
export function isEditError(err: unknown): err is EditError {
  return err instanceof Error && err.name === 'EditError' && typeof (err as { code?: unknown }).code === 'string';
}
