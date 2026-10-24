// Undo and redo that stay safe when a person and an agent edit at the same time.
//
// Every edit is recorded as a field-level patch (see patch.ts). Each actor has their own
// undo stack, so undoing the person's last edit never throws away the agent's later work.
// If a field the undo would restore has been changed by someone else since, the undo is
// refused and the conflicting fields are named, instead of silently losing work.
import { applyPatch, isEmptyPatch, mergeUpdates, onlyUpdates, patchConflicts, type Conflict, type Patch } from './patch.ts';
import type { Home } from './schema.ts';

/** Who made an edit: "person", "agent", or a client id. */
export type Actor = string;

export interface LogEntry {
  rev: number;
  actor: Actor;
  label: string;
  at: string;
  patch: Patch;
  /** edits with the same key, by the same actor, close together become one undo step */
  groupKey?: string;
}

export type UndoResult =
  | { ok: true; home: Home; entry: LogEntry }
  | { ok: false; reason: 'nothing' | 'conflict'; conflicts: Conflict[]; message: string };

export interface HistoryOptions {
  /** how many entries to keep per actor and in the shared log */
  limit?: number;
  /** how close together grouped edits must be to merge */
  mergeWindowMs?: number;
  /** clock, injectable for tests */
  now?: () => number;
}

interface Recorded extends LogEntry {
  time: number;
}

export class History {
  private readonly log: Recorded[] = [];
  private readonly undoStacks = new Map<Actor, Recorded[]>();
  private readonly redoStacks = new Map<Actor, Recorded[]>();
  private readonly limit: number;
  private readonly mergeWindowMs: number;
  private readonly now: () => number;

  constructor(opts: HistoryOptions = {}) {
    this.limit = opts.limit ?? 500;
    this.mergeWindowMs = opts.mergeWindowMs ?? 1000;
    this.now = opts.now ?? Date.now;
  }

  /** Record an edit. Returns the entry it was stored in, or null if nothing changed. */
  record(input: { patch: Patch; actor: Actor; label: string; rev: number; groupKey?: string }): LogEntry | null {
    if (isEmptyPatch(input.patch)) return null;
    const time = this.now();
    const stack = this.stack(this.undoStacks, input.actor);
    const top = stack[stack.length - 1];
    this.redoStacks.set(input.actor, []);

    if (
      input.groupKey !== undefined &&
      top?.groupKey === input.groupKey &&
      time - top.time <= this.mergeWindowMs &&
      onlyUpdates(top.patch) &&
      onlyUpdates(input.patch)
    ) {
      top.patch = mergeUpdates(top.patch, input.patch);
      top.rev = input.rev;
      top.time = time;
      return top;
    }

    const entry: Recorded = { ...input, at: new Date(time).toISOString(), time };
    push(this.log, entry, this.limit);
    push(stack, entry, this.limit);
    return entry;
  }

  undo(home: Home, actor: Actor): UndoResult {
    return this.play(home, actor, 'undo');
  }

  redo(home: Home, actor: Actor): UndoResult {
    return this.play(home, actor, 'redo');
  }

  /** Drop the actor's latest undo step, e.g. after a conflict they chose not to resolve. */
  forget(actor: Actor): void {
    this.stack(this.undoStacks, actor).pop();
  }

  /** Recent edits, newest last. */
  list(limit = 50): Array<Omit<LogEntry, 'patch'> & { ids: string[] }> {
    return this.log.slice(-limit).map(({ patch, time: _time, ...rest }) => ({ ...rest, ids: patch.entries.map((e) => e.id) }));
  }

  canUndo(actor: Actor): boolean {
    return this.stack(this.undoStacks, actor).length > 0;
  }

  canRedo(actor: Actor): boolean {
    return this.stack(this.redoStacks, actor).length > 0;
  }

  /** Forget everything, e.g. after a different home is loaded. */
  clear(): void {
    this.log.length = 0;
    this.undoStacks.clear();
    this.redoStacks.clear();
  }

  private play(home: Home, actor: Actor, direction: 'undo' | 'redo'): UndoResult {
    const from = this.stack(direction === 'undo' ? this.undoStacks : this.redoStacks, actor);
    const to = this.stack(direction === 'undo' ? this.redoStacks : this.undoStacks, actor);
    const entry = from[from.length - 1];
    if (!entry) return { ok: false, reason: 'nothing', conflicts: [], message: `There is nothing to ${direction} for ${actor}.` };

    const conflicts = patchConflicts(home, entry.patch, direction);
    if (conflicts.length > 0) {
      const names = conflicts.map((c) => (c.field ? `${c.id}.${c.field}` : c.id)).join(', ');
      return {
        ok: false,
        reason: 'conflict',
        conflicts,
        message: `Can't ${direction} "${entry.label}": ${names} changed since. Edit ${conflicts.length === 1 ? 'it' : 'them'} directly instead.`,
      };
    }
    from.pop();
    to.push(entry);
    return { ok: true, home: applyPatch(home, entry.patch, direction), entry };
  }

  private stack(map: Map<Actor, Recorded[]>, actor: Actor): Recorded[] {
    let s = map.get(actor);
    if (!s) {
      s = [];
      map.set(actor, s);
    }
    return s;
  }
}

function push<T>(list: T[], value: T, limit: number): void {
  list.push(value);
  if (list.length > limit) list.shift();
}
