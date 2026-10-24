// Deleting elements. A delete takes its dependants with it where that is safe (a wall
// takes its doors and windows) and is refused where it isn't (a material still in use).
import { z } from 'zod';
import { EditError } from '../errors.ts';
import { dependentsOf, elementsOf, locate } from '../kinds.ts';
import { IdSchema, type Home } from '../schema.ts';
import { defineCommand } from './edit.ts';

/** Everything that deleting `ids` would remove, including cascades. Throws if the delete
 *  must be refused. Lets a person or agent preview "this also removes door-2". */
export function planRemove(home: Home, ids: readonly string[]): string[] {
  const removing = new Set<string>();
  const queue = [...ids];
  while (queue.length) {
    const id = queue.shift()!;
    if (removing.has(id)) continue;
    const found = locate(home, id);
    if (!found) throw new EditError('not_found', `Nothing with id "${id}".`, { id });
    removing.add(id);
    for (const dep of dependentsOf(home, id)) if (dep.onDelete === 'cascade') queue.push(dep.id);
  }

  for (const id of removing) {
    const blockers = dependentsOf(home, id).filter((dep) => dep.onDelete === 'refuse' && !removing.has(dep.id));
    if (blockers.length) {
      const names = blockers.slice(0, 6).map((b) => b.id).join(', ');
      const more = blockers.length > 6 ? ` and ${blockers.length - 6} more` : '';
      throw new EditError('in_use', `Can't delete "${id}": ${names}${more} still use${blockers.length === 1 ? 's' : ''} it. Delete or change ${blockers.length === 1 ? 'it' : 'them'} first.`, {
        id,
        dependents: blockers.map((b) => b.id),
      });
    }
  }

  const levelsLeft = home.levels.filter((l) => !removing.has(l.id)).length;
  if (levelsLeft === 0) throw new EditError('last_level', 'A home needs at least one level.');
  return [...removing];
}

export const remove = defineCommand(z.strictObject({ ids: z.array(IdSchema).min(1).max(500) }), (d, { ids }) => {
  const doomed = new Set(planRemove(d.home, ids));
  for (const collection of ['levels', 'walls', 'openings', 'rooms', 'items', 'materials', 'captures'] as const) {
    const list = elementsOf(d.home, collection);
    const kept = list.filter((x) => !doomed.has(x.id));
    if (kept.length !== list.length) (d.home[collection] as unknown[]) = kept;
  }
});

/** The only way to empty a home on purpose. Keeps levels and materials. */
export const clearHome = defineCommand(z.strictObject({ reason: z.string().min(3).max(300) }), (d, { reason }) => {
  d.home.walls = [];
  d.home.openings = [];
  d.home.rooms = [];
  d.home.items = [];
  d.allowEmpty = true;
  d.notes.push(`Cleared the home: ${reason}`);
});
