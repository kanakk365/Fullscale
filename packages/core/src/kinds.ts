// The kinds of element in a home and how they relate. This one table drives element
// lookups, what a delete takes with it, reference checks, field-level undo and the
// tracking of where each dimension came from.
import type { Home } from './schema.ts';

export type Kind = 'level' | 'wall' | 'opening' | 'room' | 'item' | 'material' | 'capture';
export type Collection = 'levels' | 'walls' | 'openings' | 'rooms' | 'items' | 'materials' | 'captures';

export interface Reference {
  /** field holding the referenced id; "materials.*" means every value of that record,
   *  "plan.level" a field of an object field */
  path: string;
  target: Kind;
  /** cascade: deleting the target deletes this element too; refuse: the delete is refused */
  onDelete: 'cascade' | 'refuse';
}

export interface KindInfo {
  kind: Kind;
  collection: Collection;
  refs: readonly Reference[];
  /** fields holding sizes and positions; edits to them update the field's source */
  dimensions: readonly string[];
  /** object fields compared one level deeper, so painting one face of a wall and moving
   *  the wall are separate changes that never conflict */
  nested: readonly string[];
}

const kind = (info: KindInfo) => info;

export const KINDS: Readonly<Record<Kind, KindInfo>> = {
  level: kind({ kind: 'level', collection: 'levels', refs: [], dimensions: ['elevation', 'height'], nested: ['sources'] }),
  wall: kind({
    kind: 'wall',
    collection: 'walls',
    refs: [
      { path: 'level', target: 'level', onDelete: 'refuse' },
      { path: 'materials.*', target: 'material', onDelete: 'refuse' },
    ],
    dimensions: ['start', 'end', 'thickness', 'height'],
    nested: ['materials', 'sources'],
  }),
  opening: kind({
    kind: 'opening',
    collection: 'openings',
    refs: [
      { path: 'wall', target: 'wall', onDelete: 'cascade' },
      { path: 'materials.*', target: 'material', onDelete: 'refuse' },
    ],
    dimensions: ['offset', 'width', 'height', 'sill', 'depth'],
    nested: ['materials', 'sources'],
  }),
  room: kind({
    kind: 'room',
    collection: 'rooms',
    refs: [
      { path: 'level', target: 'level', onDelete: 'refuse' },
      { path: 'floorMaterial', target: 'material', onDelete: 'refuse' },
      { path: 'ceilingMaterial', target: 'material', onDelete: 'refuse' },
    ],
    dimensions: ['polygon', 'ceilingHeight'],
    nested: ['sources'],
  }),
  item: kind({
    kind: 'item',
    collection: 'items',
    refs: [
      { path: 'level', target: 'level', onDelete: 'refuse' },
      { path: 'materials.*', target: 'material', onDelete: 'refuse' },
    ],
    dimensions: ['position', 'rotation', 'size'],
    nested: ['materials', 'sources'],
  }),
  material: kind({ kind: 'material', collection: 'materials', refs: [], dimensions: [], nested: [] }),
  capture: kind({
    kind: 'capture',
    collection: 'captures',
    refs: [
      { path: 'plan.level', target: 'level', onDelete: 'cascade' },
      { path: 'toHome.level', target: 'level', onDelete: 'cascade' },
    ],
    dimensions: [],
    nested: [],
  }),
};

export const KIND_LIST: readonly KindInfo[] = Object.values(KINDS);
export const COLLECTIONS: readonly Collection[] = KIND_LIST.map((k) => k.collection);

const KIND_BY_COLLECTION = new Map(KIND_LIST.map((k) => [k.collection, k]));

export function kindOfCollection(collection: Collection): KindInfo {
  return KIND_BY_COLLECTION.get(collection)!;
}

/** Any element stored in a home, seen generically. */
export type Element = { id: string } & Record<string, unknown>;

export function elementsOf(home: Home, collection: Collection): Element[] {
  return home[collection] as unknown as Element[];
}

export interface Located {
  info: KindInfo;
  index: number;
  element: Element;
}

/** Find any element by id. */
export function locate(home: Home, id: string): Located | undefined {
  for (const info of KIND_LIST) {
    const list = elementsOf(home, info.collection);
    const index = list.findIndex((x) => x.id === id);
    if (index >= 0) return { info, index, element: list[index]! };
  }
  return undefined;
}

/** Every id in use in a home. */
export function allIds(home: Home): Set<string> {
  const ids = new Set<string>();
  for (const info of KIND_LIST) for (const x of elementsOf(home, info.collection)) ids.add(x.id);
  return ids;
}

/** The ids an element points to through one reference. */
export function referencedIds(element: Element, ref: Reference): string[] {
  const [field, sub] = ref.path.split('.');
  const value = element[field!];
  const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
  if (sub === '*') return isRecord(value) ? Object.values(value).filter((v): v is string => typeof v === 'string') : [];
  const target = sub === undefined ? value : isRecord(value) ? value[sub] : undefined;
  return typeof target === 'string' ? [target] : [];
}

export interface Dependent {
  id: string;
  kind: Kind;
  path: string;
  onDelete: Reference['onDelete'];
}

/** Elements that point at `id`, with what should happen to them if it is deleted. */
export function dependentsOf(home: Home, id: string): Dependent[] {
  const found: Dependent[] = [];
  for (const info of KIND_LIST) {
    if (info.refs.length === 0) continue;
    for (const element of elementsOf(home, info.collection)) {
      for (const ref of info.refs) {
        if (referencedIds(element, ref).includes(id)) {
          found.push({ id: element.id, kind: info.kind, path: ref.path, onDelete: ref.onDelete });
        }
      }
    }
  }
  return found;
}
