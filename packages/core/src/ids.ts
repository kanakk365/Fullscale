// Element ids are readable ("wall-12") and never reused. A counter per prefix only goes
// up, so an id that an agent or a person remembers can never come to mean a different
// element after a delete.
import { EditError } from './errors.ts';
import { allIds } from './kinds.ts';
import type { Home } from './schema.ts';

const NUMBERED = /^(.*)-(\d+)$/;

/** Hand out the next id for a prefix and advance its counter. Mutates `home.nextIds`. */
export function allocateId(home: Home, prefix: string): string {
  const used = allIds(home);
  let n = home.nextIds[prefix] ?? 1;
  while (used.has(`${prefix}-${n}`)) n++;
  home.nextIds[prefix] = n + 1;
  return `${prefix}-${n}`;
}

/** Use an id chosen by the caller, or allocate one. Keeps the counter ahead of numbered
 *  ids chosen by hand, so they can't be handed out again later. Mutates `home.nextIds`. */
export function takeId(home: Home, wanted: string | undefined, prefix: string): string {
  if (wanted === undefined) return allocateId(home, prefix);
  if (allIds(home).has(wanted)) throw new EditError('id_exists', `The id "${wanted}" is already used. Leave the id out to get a new one.`, { id: wanted });
  const match = NUMBERED.exec(wanted);
  if (match) {
    const [, p, num] = match;
    home.nextIds[p!] = Math.max(home.nextIds[p!] ?? 1, Number(num) + 1);
  }
  return wanted;
}

/** Counters that are safe for an existing home: one past the highest number in use. */
export function counterFloor(home: Home): Record<string, number> {
  const counters: Record<string, number> = { ...home.nextIds };
  for (const id of allIds(home)) {
    const match = NUMBERED.exec(id);
    if (!match) continue;
    const [, p, num] = match;
    counters[p!] = Math.max(counters[p!] ?? 1, Number(num) + 1);
  }
  return counters;
}
