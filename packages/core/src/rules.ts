// Building rules shared by the edit commands (which refuse bad edits), validation (which
// reports problems in a loaded home) and the editor tools (which show them while you drag),
// so a person, an agent and a check always agree.
import { EditError } from './errors.ts';
import { wallLength } from './geometry.ts';
import { wallHeight } from './resolve.ts';
import type { Home, Opening, Wall } from './schema.ts';

/** Walls shorter than this are refused: below anything buildable. */
export const MIN_WALL_LENGTH = 0.01;

/** Edges this close only touch; they don't overlap. Well below any buildable difference,
 *  well above floating-point noise. */
export const TOUCHING = 1e-6;

/** Wall ends this close are the same corner and move together. */
export const CONNECTED = 1e-6;

/** Openings may reach this far above a wall's top before they count as too tall
 *  (absorbs rounding in typed and scanned values). */
const HEIGHT_SLACK = 0.001;

const m = (v: number) => `${Math.round(v * 1000) / 1000} m`;

export function wallLengthProblem(wall: Pick<Wall, 'id' | 'start' | 'end'>): EditError | null {
  const len = wallLength(wall);
  if (len >= MIN_WALL_LENGTH) return null;
  return new EditError('wall_too_short', `Wall "${wall.id}" would be ${m(len)} long; walls must be at least ${m(MIN_WALL_LENGTH)}.`, { id: wall.id, length: len, min: MIN_WALL_LENGTH });
}

export type OpeningShape = Pick<Opening, 'offset' | 'width' | 'height' | 'sill'> & { id?: string };

/**
 * Everything wrong with an opening on a wall. `opening_overlap` can be overridden on
 * purpose (e.g. a door inside a wider opening); the others cannot.
 */
export function openingProblems(home: Home, wall: Wall, o: OpeningShape): EditError[] {
  const problems: EditError[] = [];
  const len = wallLength(wall);
  const label = o.id ? `Opening "${o.id}"` : 'The opening';

  if (o.offset < -TOUCHING || o.offset + o.width > len + TOUCHING) {
    const maxOffset = Math.max(0, len - o.width);
    problems.push(
      new EditError(
        'opening_outside_wall',
        o.width > len + TOUCHING
          ? `${label} is ${m(o.width)} wide but wall "${wall.id}" is only ${m(len)} long. Make it narrower.`
          : `${label} runs from ${m(o.offset)} to ${m(o.offset + o.width)} along wall "${wall.id}", which is ${m(len)} long. Use an offset between 0 and ${m(maxOffset)}.`,
        { id: o.id, wall: wall.id, wallLength: len, offset: o.offset, width: o.width },
      ),
    );
  }

  const top = o.sill + o.height;
  const height = wallHeight(home, wall);
  if (top > height + HEIGHT_SLACK) {
    problems.push(
      new EditError('opening_too_tall', `${label} reaches ${m(top)} but wall "${wall.id}" is ${m(height)} high. Lower the sill or the height.`, {
        id: o.id,
        wall: wall.id,
        top,
        wallHeight: height,
      }),
    );
  }

  for (const other of home.openings) {
    if (other.wall !== wall.id || other.id === o.id) continue;
    const alongOverlap = o.offset < other.offset + other.width - TOUCHING && other.offset < o.offset + o.width - TOUCHING;
    const heightOverlap = o.sill < other.sill + other.height - TOUCHING && other.sill < o.sill + o.height - TOUCHING;
    if (alongOverlap && heightOverlap) {
      problems.push(
        new EditError('opening_overlap', `${label} overlaps "${other.id}" (${m(other.offset)} to ${m(other.offset + other.width)}) on wall "${wall.id}". Move it, or place it anyway with force.`, {
          id: o.id,
          wall: wall.id,
          other: other.id,
        }),
      );
    }
  }
  return problems;
}

/** The first problem that can't be overridden, or the first of any if `force` is off. */
export function blockingProblem(problems: EditError[], force: boolean | undefined): EditError | undefined {
  return problems.find((p) => !(force && p.code === 'opening_overlap'));
}
