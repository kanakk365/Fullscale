// The studio: the one place the home lives while the server runs. Every edit, from the
// editor, an agent or Blender, goes through `apply`. It is checked by the core, given the
// next revision number, recorded for its actor's undo, saved, and announced to everyone
// listening. Nothing else ever changes the home.
import {
  achievedBy,
  applyOperation,
  describeOperation,
  EditError,
  History,
  invertPatch,
  type Achieved,
  type Actor,
  type EditResult,
  type Home,
  type Operation,
  type Patch,
  type SourceKind,
} from '@fullscale/core';

export interface Change {
  rev: number;
  actor: Actor;
  label: string;
  patch: Patch;
  changed: string[];
  removed: string[];
  notes: string[];
}

export interface Applied {
  rev: number;
  achieved: Achieved;
  changed: string[];
  removed: string[];
  notes: string[];
  dryRun: boolean;
  /** the home after the edit (before it, for a dry run) */
  home: Home;
}

export interface ApplyOptions {
  actor: Actor;
  /** where numbers set by this edit come from: a person types (user), an agent chooses (agent) */
  by: SourceKind;
  label?: string;
  groupKey?: string;
  /** refuse with stale_revision unless the home is still at this revision */
  expectRev?: number;
  dryRun?: boolean;
}

/** The outcome of an undo or redo. */
export type Replayed = { ok: true; rev: number; label: string; achieved: Achieved; changed: string[]; removed: string[] } | { ok: false; reason: 'nothing' | 'conflict'; message: string };

export type StudioEvent =
  | { type: 'changed'; change: Change }
  | { type: 'replaced'; rev: number; home: Home; reason: string }
  | { type: 'selection'; actor: Actor; ids: string[] }
  | { type: 'highlight'; actor: Actor; ids: string[]; note?: string };

export interface StudioOptions {
  home: Home;
  /** called after every change with the new home; should save it */
  save?: (home: Home) => void;
  history?: History;
}

export class Studio {
  private current: Home;
  private revision = 0;
  private readonly history: History;
  private readonly save: (home: Home) => void;
  private readonly listeners = new Set<(event: StudioEvent) => void>();
  private readonly selections = new Map<Actor, string[]>();
  private readonly log: Change[] = [];

  constructor(opts: StudioOptions) {
    this.current = opts.home;
    this.history = opts.history ?? new History();
    this.save = opts.save ?? (() => undefined);
  }

  get home(): Home {
    return this.current;
  }

  get rev(): number {
    return this.revision;
  }

  /** Apply a core operation (or batch). Throws EditError when it is refused; then nothing
   *  has changed. */
  apply(operation: unknown, opts: ApplyOptions): Applied {
    if (opts.expectRev !== undefined && opts.expectRev !== this.revision) {
      throw new EditError('stale_revision', `The home has changed since revision ${opts.expectRev} (it is now at ${this.revision}). Look at it again, then retry.`, {
        expected: opts.expectRev,
        current: this.revision,
      });
    }
    const result = applyOperation(this.current, operation, { by: opts.by });
    if (opts.dryRun || result.achieved.unchanged) {
      return { rev: this.revision, achieved: result.achieved, changed: result.changed, removed: result.removed, notes: result.notes, dryRun: !!opts.dryRun, home: this.current };
    }
    // applyOperation has checked the operation, so it is safe to read as one.
    const label = opts.label ?? describeOperation(operation as Operation);
    this.commit(result, opts.actor, label);
    this.history.record({ patch: result.patch, actor: opts.actor, label, rev: this.revision, ...(opts.groupKey ? { groupKey: opts.groupKey } : {}) });
    return { rev: this.revision, achieved: result.achieved, changed: result.changed, removed: result.removed, notes: result.notes, dryRun: false, home: this.current };
  }

  /** Undo the actor's latest edit. Refused (with the fields in conflict) if someone has
   *  changed the same fields since. */
  undo(actor: Actor): Replayed {
    return this.play(actor, 'undo');
  }

  redo(actor: Actor): Replayed {
    return this.play(actor, 'redo');
  }

  canUndo(actor: Actor): boolean {
    return this.history.canUndo(actor);
  }

  canRedo(actor: Actor): boolean {
    return this.history.canRedo(actor);
  }

  /** Changes after `rev`, oldest first (at most the last 500 are kept). */
  changesSince(rev: number, actor?: Actor): Change[] {
    return this.log.filter((c) => c.rev > rev && (actor === undefined || c.actor === actor));
  }

  /** Swap in a different home (opening another file). Undo history starts again. */
  replace(home: Home, reason: string): void {
    this.current = home;
    this.revision++;
    this.history.clear();
    this.log.length = 0;
    this.save(home);
    this.emit({ type: 'replaced', rev: this.revision, home, reason });
  }

  select(actor: Actor, ids: string[]): void {
    this.selections.set(actor, ids);
    this.emit({ type: 'selection', actor, ids });
  }

  /** What each actor has selected, newest first. */
  selection(): Array<{ actor: Actor; ids: string[] }> {
    return [...this.selections].map(([actor, ids]) => ({ actor, ids }));
  }

  highlight(actor: Actor, ids: string[], note?: string): void {
    this.emit({ type: 'highlight', actor, ids, ...(note ? { note } : {}) });
  }

  on(listener: (event: StudioEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private play(actor: Actor, direction: 'undo' | 'redo'): Replayed {
    const result = direction === 'undo' ? this.history.undo(this.current, actor) : this.history.redo(this.current, actor);
    if (!result.ok) return { ok: false, reason: result.reason, message: result.message };
    const patch = direction === 'undo' ? invertPatch(result.entry.patch) : result.entry.patch;
    const ids = patch.entries;
    const label = `${direction === 'undo' ? 'Undo' : 'Redo'} ${result.entry.label}`;
    this.current = result.home;
    this.revision++;
    const change: Change = {
      rev: this.revision,
      actor,
      label,
      patch,
      changed: ids.filter((e) => e.op !== 'delete').map((e) => e.id),
      removed: ids.filter((e) => e.op === 'delete').map((e) => e.id),
      notes: [],
    };
    this.remember(change);
    this.save(this.current);
    this.emit({ type: 'changed', change });
    return { ok: true, rev: this.revision, label, achieved: achievedBy(patch), changed: change.changed, removed: change.removed };
  }

  private commit(result: EditResult, actor: Actor, label: string): void {
    this.current = result.home;
    this.revision++;
    const change: Change = { rev: this.revision, actor, label, patch: result.patch, changed: result.changed, removed: result.removed, notes: result.notes };
    this.remember(change);
    this.save(this.current);
    this.emit({ type: 'changed', change });
  }

  private remember(change: Change): void {
    this.log.push(change);
    if (this.log.length > 500) this.log.shift();
  }

  private emit(event: StudioEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
