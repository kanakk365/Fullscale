// How every edit runs. A command works on a private copy of the home (a draft); when it
// finishes, the result is checked once, the sources of changed dimensions are updated,
// and the exact field-level patch is returned. Nothing is ever half-applied: if a command
// throws, the original home is untouched.
import type { z } from 'zod';
import { EditError } from '../errors.ts';
import { kindOfCollection } from '../kinds.ts';
import { achievedBy, deepEqual, diffHomes, touchedIds, type Achieved, type Patch } from '../patch.ts';
import { sourceOf } from '../resolve.ts';
import { HomeSchema, type Home, type Source, type SourceKind } from '../schema.ts';

/** Who is editing. It becomes the source of every dimension the edit sets or changes. */
export interface EditContext {
  by: SourceKind;
}

export const BY_USER: EditContext = { by: 'user' };

export interface Draft {
  home: Home;
  ctx: EditContext;
  /** short facts worth telling the caller, e.g. "the wall height follows the level" */
  notes: string[];
  /** set only by an explicit clear, so nothing else can empty a home by accident */
  allowEmpty: boolean;
}

export interface EditResult {
  home: Home;
  patch: Patch;
  achieved: Achieved;
  /** ids created or changed */
  changed: string[];
  /** ids removed */
  removed: string[];
  notes: string[];
}

/** Run `fn` on a draft of `home` and return the checked result. */
export function edit(home: Home, ctx: EditContext, fn: (d: Draft) => void): EditResult {
  const draft: Draft = { home: structuredClone(home), ctx, notes: [], allowEmpty: false };
  fn(draft);
  return finish(home, draft);
}

function finish(before: Home, draft: Draft): EditResult {
  const checked = HomeSchema.safeParse(draft.home);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    throw new EditError('invalid_input', `The edit would make the home invalid at ${issue?.path.join('.') || '(root)'}: ${issue?.message}`);
  }
  const after = checked.data;
  trackSources(before, after, draft.ctx);

  const patch = diffHomes(before, after);
  if (patch.entries.length === 0) {
    return { home: before, patch, achieved: achievedBy(patch), changed: [], removed: [], notes: draft.notes };
  }
  if (!draft.allowEmpty && contentCount(before) >= 5 && contentCount(after) === 0) {
    throw new EditError('home_wipe_blocked', 'This edit would remove everything in the home. To start over, clear the home on purpose and give a reason.');
  }
  after.updatedAt = new Date().toISOString();
  return { home: after, patch, achieved: achievedBy(patch), ...touchedIds(patch), notes: draft.notes };
}

function contentCount(home: Home): number {
  return home.walls.length + home.rooms.length + home.items.length;
}

// When a dimension changes and the edit did not say where the new value came from, it now
// comes from whoever made the edit. This is what stops a scanned "±1 cm" label from staying
// on a number a person or an agent has since typed in.
function trackSources(before: Home, after: Home, ctx: EditContext): void {
  for (const entry of diffHomes(before, after).entries) {
    if (entry.op !== 'update' || entry.collection === 'home') continue;
    const info = kindOfCollection(entry.collection);
    if (info.dimensions.length === 0 || 'source' in entry.fields) continue;
    const el = (after[entry.collection] as Array<{ id: string; source?: Source; sources?: Record<string, Source> } & Record<string, unknown>>).find((x) => x.id === entry.id);
    if (!el) continue;
    for (const field of info.dimensions) {
      if (!(field in entry.fields) || `sources.${field}` in entry.fields) continue;
      if (el[field] === undefined) {
        // The value now follows its parent, so its own source no longer applies.
        if (el.sources) delete el.sources[field];
      } else {
        const next: Source = { kind: ctx.by };
        if (!deepEqual(sourceOf(el, field), next)) el.sources = { ...el.sources, [field]: next };
      }
    }
    if (el.sources && Object.keys(el.sources).length === 0) delete el.sources;
  }
}

// ---------- defining commands ----------

/** A named edit with a validated input. Call it directly, or run it on a draft as one
 *  step of a larger edit (a batch). */
export interface Command<S extends z.ZodType> {
  (home: Home, input: z.input<S>, ctx?: EditContext): EditResult;
  readonly schema: S;
  run(d: Draft, input: z.output<S>): void;
}

export function defineCommand<S extends z.ZodType>(schema: S, run: (d: Draft, input: z.output<S>) => void): Command<S> {
  const command = (home: Home, input: z.input<S>, ctx: EditContext = BY_USER) => edit(home, ctx, (d) => run(d, parseInput(schema, input)));
  return Object.assign(command, { schema, run });
}

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join('.') || '(input)';
    throw new EditError('invalid_input', `${path}: ${issue?.message}`, { path });
  }
  return result.data;
}

// ---------- helpers for commands ----------

type Collections = Pick<Home, 'levels' | 'walls' | 'openings' | 'rooms' | 'items' | 'materials'>;

export function find<C extends keyof Collections>(home: Home, collection: C, id: string): Collections[C][number] {
  const list = home[collection] as Array<{ id: string }>;
  const found = list.find((x) => x.id === id);
  if (!found) {
    const what = kindOfCollection(collection).kind;
    throw new EditError('not_found', `No ${what} with id "${id}".`, { id, kind: what });
  }
  return found as Collections[C][number];
}

/** The level an element goes on: the one asked for, or the first. */
export function levelFor(home: Home, level: string | undefined): string {
  return find(home, 'levels', level ?? home.levels[0]!.id).id;
}

/** Merge per-field sources into an element; a null value removes that field's source. */
export function mergeSources(el: { sources?: Record<string, Source> }, input: Record<string, Source | null> | undefined): void {
  if (!input) return;
  const next = { ...el.sources };
  for (const [field, source] of Object.entries(input)) {
    if (source === null) delete next[field];
    else next[field] = source;
  }
  if (Object.keys(next).length) el.sources = next;
  else delete el.sources;
}

/** Copy the defined values of `patch` onto `target`; null deletes the key ("follow the
 *  parent again"). */
export function assignPatch(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete target[key];
    else target[key] = value;
  }
}
