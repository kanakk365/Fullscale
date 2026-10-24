// Values that follow something else unless they are set. A wall without its own height is
// as tall as its level; a room without its own ceiling height uses its level's. Read them
// through these functions, never with a fallback number elsewhere, so the document keeps
// showing which values were really set or measured.
import { EditError } from './errors.ts';
import type { Home, Level, Room, Source, Wall } from './schema.ts';

export function levelById(home: Home, id: string): Level {
  const level = home.levels.find((l) => l.id === id);
  if (!level) throw new EditError('not_found', `No level with id "${id}".`, { id });
  return level;
}

export function wallHeight(home: Home, wall: Wall): number {
  return wall.height ?? levelById(home, wall.level).height;
}

export function ceilingHeight(home: Home, room: Room): number {
  return room.ceilingHeight ?? levelById(home, room.level).height;
}

/** Where one field's value came from: its own source if it has one, else the element's. */
export function sourceOf(element: { source?: Source; sources?: Record<string, Source> }, field?: string): Source | undefined {
  return (field ? element.sources?.[field] : undefined) ?? element.source;
}
