// Field-level changes between two versions of a home, and how to undo or redo them safely.
//
// A patch lists, for each element that changed, a create, a delete, or the fields that
// changed with their values before and after. Undo and redo check every field first: if
// someone has changed that same field since, the step is refused instead of overwriting
// their work. Changes to other fields of the same element are kept, so a person undoing a
// move never loses the colour an agent painted in the meantime.
import { COLLECTIONS, type Collection, type Element, type Kind, KIND_LIST, kindOfCollection, elementsOf, referencedIds } from './kinds.ts';
import type { Home } from './schema.ts';

/** A field's value before and after. A missing key means the field was absent. */
export interface FieldChange {
  before?: unknown;
  after?: unknown;
}

export type PatchEntry =
  | { op: 'create'; collection: Collection; id: string; index: number; element: Element }
  | { op: 'delete'; collection: Collection; id: string; index: number; element: Element }
  | { op: 'update'; collection: Collection | 'home'; id: string; fields: Record<string, FieldChange> };

export interface Patch {
  entries: PatchEntry[];
}

/** Home-level fields that edits can change. Ids counters and timestamps are not undone. */
const HOME_FIELDS = ['name', 'north'] as const;

// ---------- values ----------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** An undefined value or an empty object means the same as "absent". */
function isAbsent(v: unknown): boolean {
  return v === undefined || (isPlainObject(v) && Object.keys(v).every((k) => v[k] === undefined));
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isAbsent(a) && isAbsent(b)) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const k of keys) if (!deepEqual(ra[k], rb[k])) return false;
  return true;
}

function change(before: unknown, after: unknown): FieldChange {
  const c: FieldChange = {};
  if (!isAbsent(before)) c.before = before;
  if (!isAbsent(after)) c.after = after;
  return c;
}

// Field paths are "name" or "parent.child" (one level deep, for nested fields).
function getField(el: Record<string, unknown>, path: string): unknown {
  const [a, b] = path.split('.');
  const v = el[a!];
  return b === undefined ? v : isPlainObject(v) ? v[b] : undefined;
}

function setField(el: Record<string, unknown>, path: string, value: unknown): void {
  const [a, b] = path.split('.');
  if (b === undefined) {
    if (value === undefined) delete el[a!];
    else el[a!] = structuredClone(value);
    return;
  }
  const parent = isPlainObject(el[a!]) ? { ...(el[a!] as Record<string, unknown>) } : {};
  if (value === undefined) delete parent[b];
  else parent[b] = structuredClone(value);
  el[a!] = parent;
}

// ---------- diff ----------

function diffFields(a: Record<string, unknown>, b: Record<string, unknown>, nested: readonly string[]): Record<string, FieldChange> {
  const fields: Record<string, FieldChange> = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (key === 'id') continue;
    const va = a[key];
    const vb = b[key];
    if (nested.includes(key) && (isPlainObject(va) || isPlainObject(vb))) {
      const oa = isPlainObject(va) ? va : {};
      const ob = isPlainObject(vb) ? vb : {};
      for (const sub of new Set([...Object.keys(oa), ...Object.keys(ob)])) {
        if (!deepEqual(oa[sub], ob[sub])) fields[`${key}.${sub}`] = change(oa[sub], ob[sub]);
      }
    } else if (!deepEqual(va, vb)) {
      fields[key] = change(va, vb);
    }
  }
  return fields;
}

/** Everything that changed from `a` to `b`. */
export function diffHomes(a: Home, b: Home): Patch {
  const entries: PatchEntry[] = [];
  const homeFields: Record<string, FieldChange> = {};
  for (const f of HOME_FIELDS) if (!deepEqual(a[f], b[f])) homeFields[f] = change(a[f], b[f]);
  if (Object.keys(homeFields).length) entries.push({ op: 'update', collection: 'home', id: b.id, fields: homeFields });

  for (const info of KIND_LIST) {
    const before = elementsOf(a, info.collection);
    const after = elementsOf(b, info.collection);
    const afterById = new Map(after.map((x) => [x.id, x]));
    const beforeIds = new Set(before.map((x) => x.id));
    before.forEach((x, index) => {
      const y = afterById.get(x.id);
      if (!y) {
        entries.push({ op: 'delete', collection: info.collection, id: x.id, index, element: x });
        return;
      }
      const fields = diffFields(x, y, info.nested);
      if (Object.keys(fields).length) entries.push({ op: 'update', collection: info.collection, id: x.id, fields });
    });
    after.forEach((y, index) => {
      if (!beforeIds.has(y.id)) entries.push({ op: 'create', collection: info.collection, id: y.id, index, element: y });
    });
  }
  return { entries };
}

export function isEmptyPatch(patch: Patch): boolean {
  return patch.entries.length === 0;
}

// ---------- undo and redo ----------

export type Direction = 'undo' | 'redo';

export interface Conflict {
  id: string;
  field?: string;
  reason: 'changed_since' | 'missing' | 'exists' | 'in_use' | 'parent_missing';
}

// What an entry does when played in a direction: insert or remove a whole element, or
// move fields from one set of values to another.
type Step =
  | { kind: 'insert'; entry: Extract<PatchEntry, { op: 'create' | 'delete' }> }
  | { kind: 'remove'; entry: Extract<PatchEntry, { op: 'create' | 'delete' }> }
  | { kind: 'fields'; entry: Extract<PatchEntry, { op: 'update' }>; from: 'before' | 'after'; to: 'before' | 'after' };

/** Parents before children: a door needs its wall, a painted room needs its paint. */
const PARENT_FIRST: readonly Collection[] = ['levels', 'materials', 'walls', 'openings', 'rooms', 'items', 'captures'];
const rank = (c: Collection) => PARENT_FIRST.indexOf(c);

// Steps run in a safe order: insert whole elements (parents first), then change fields,
// then remove whole elements (children first). So a field never points at something
// missing, and nothing is removed while something still points at it.
function stepsFor(patch: Patch, direction: Direction): Step[] {
  const steps = patch.entries.map((entry): Step => {
    if (entry.op === 'update') {
      return direction === 'undo' ? { kind: 'fields', entry, from: 'after', to: 'before' } : { kind: 'fields', entry, from: 'before', to: 'after' };
    }
    const inserts = (entry.op === 'create') === (direction === 'redo');
    return { kind: inserts ? 'insert' : 'remove', entry };
  });
  const inserts = steps
    .filter((s): s is Extract<Step, { kind: 'insert' }> => s.kind === 'insert')
    .sort((a, b) => rank(a.entry.collection) - rank(b.entry.collection) || a.entry.index - b.entry.index);
  const fields = steps.filter((s) => s.kind === 'fields');
  const removes = steps
    .filter((s): s is Extract<Step, { kind: 'remove' }> => s.kind === 'remove')
    .sort((a, b) => rank(b.entry.collection) - rank(a.entry.collection));
  return [...inserts, ...fields, ...removes];
}

function current(home: Home, collection: Collection | 'home', id: string): Record<string, unknown> | undefined {
  if (collection === 'home') return home as unknown as Record<string, unknown>;
  return elementsOf(home, collection).find((x) => x.id === id);
}

function exists(home: Home, id: string): boolean {
  return COLLECTIONS.some((c) => elementsOf(home, c).some((x) => x.id === id));
}

function isReferenced(home: Home, id: string): boolean {
  return KIND_LIST.some((info) => elementsOf(home, info.collection).some((el) => info.refs.some((ref) => referencedIds(el, ref).includes(id))));
}

function stepConflicts(home: Home, step: Step): Conflict[] {
  const { entry } = step;
  const el = current(home, entry.collection, entry.id);
  if (step.kind === 'fields') {
    if (!el) return [{ id: entry.id, reason: 'missing' }];
    const found: Conflict[] = [];
    for (const [field, ch] of Object.entries(step.entry.fields)) {
      const now = getField(el, field);
      if (!deepEqual(now, ch[step.to]) && !deepEqual(now, ch[step.from])) found.push({ id: entry.id, field, reason: 'changed_since' });
    }
    return found;
  }
  if (step.kind === 'remove') {
    if (!el) return [{ id: entry.id, reason: 'missing' }];
    if (!deepEqual(el, step.entry.element)) return [{ id: entry.id, reason: 'changed_since' }];
    return isReferenced(home, entry.id) ? [{ id: entry.id, reason: 'in_use' }] : [];
  }
  const found: Conflict[] = el ? [{ id: entry.id, reason: 'exists' }] : [];
  for (const ref of kindOfCollection(step.entry.collection).refs) {
    for (const target of referencedIds(step.entry.element, ref)) {
      if (!exists(home, target)) found.push({ id: entry.id, field: ref.path, reason: 'parent_missing' });
    }
  }
  return found;
}

function playStep(home: Home, step: Step): void {
  const { entry } = step;
  if (step.kind === 'fields') {
    const el = current(home, entry.collection, entry.id);
    if (el) for (const [field, ch] of Object.entries(step.entry.fields)) setField(el, field, ch[step.to]);
    return;
  }
  const list = elementsOf(home, step.entry.collection);
  const at = list.findIndex((x) => x.id === entry.id);
  if (step.kind === 'remove') {
    if (at >= 0) list.splice(at, 1);
  } else if (at < 0) {
    list.splice(Math.min(step.entry.index, list.length), 0, structuredClone(step.entry.element));
  }
}

/** Everything that would stop a patch from being played back cleanly. Each step is
 *  checked against the home as the earlier steps leave it. */
export function patchConflicts(home: Home, patch: Patch, direction: Direction): Conflict[] {
  const work = structuredClone(home);
  const conflicts: Conflict[] = [];
  for (const step of stepsFor(patch, direction)) {
    conflicts.push(...stepConflicts(work, step));
    playStep(work, step);
  }
  return conflicts;
}

/** Play a patch backwards (undo) or forwards (redo). Check `patchConflicts` first. */
export function applyPatch(home: Home, patch: Patch, direction: Direction): Home {
  const h = structuredClone(home);
  for (const step of stepsFor(patch, direction)) playStep(h, step);
  h.updatedAt = new Date().toISOString();
  return h;
}

// ---------- summaries ----------

/** What an edit really did, counted from the patch rather than from what a tool claimed. */
export interface Achieved {
  created: Partial<Record<Kind, number>>;
  updated: Partial<Record<Kind | 'home', number>>;
  deleted: Partial<Record<Kind, number>>;
  unchanged: boolean;
}

export function achievedBy(patch: Patch): Achieved {
  const a: Achieved = { created: {}, updated: {}, deleted: {}, unchanged: patch.entries.length === 0 };
  for (const e of patch.entries) {
    const kind = e.collection === 'home' ? 'home' : kindOfCollection(e.collection).kind;
    if (e.op === 'update') a.updated[kind] = (a.updated[kind] ?? 0) + 1;
    else if (kind !== 'home') {
      const bucket = e.op === 'create' ? a.created : a.deleted;
      bucket[kind] = (bucket[kind] ?? 0) + 1;
    }
  }
  return a;
}

/** Ids created or changed, and ids removed. */
export function touchedIds(patch: Patch): { changed: string[]; removed: string[] } {
  const changed: string[] = [];
  const removed: string[] = [];
  for (const e of patch.entries) (e.op === 'delete' ? removed : changed).push(e.id);
  return { changed, removed };
}

/** Combine two patches that only update fields (e.g. several arrow-key nudges). */
export function mergeUpdates(first: Patch, second: Patch): Patch {
  const merged = new Map<string, Extract<PatchEntry, { op: 'update' }>>();
  for (const e of [...first.entries, ...second.entries]) {
    if (e.op !== 'update') throw new Error('mergeUpdates only combines field updates');
    const key = `${e.collection}:${e.id}`;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, { ...e, fields: { ...e.fields } });
      continue;
    }
    for (const [field, ch] of Object.entries(e.fields)) {
      const earlier = prev.fields[field];
      const combined = earlier ? change(earlier.before, ch.after) : ch;
      if (deepEqual(combined.before, combined.after)) delete prev.fields[field];
      else prev.fields[field] = combined;
    }
  }
  return { entries: [...merged.values()].filter((e) => Object.keys(e.fields).length > 0) };
}

export function onlyUpdates(patch: Patch): boolean {
  return patch.entries.every((e) => e.op === 'update');
}
