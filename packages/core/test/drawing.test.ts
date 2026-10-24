import { describe, expect, it } from 'vitest';
import {
  addOpening,
  addRectangularRoom,
  addWall,
  applyPatch,
  createHome,
  drawWall,
  isEditError,
  joinWallEnd,
  mergeWalls,
  moveWall,
  moveWallEnd,
  polygonArea,
  remove,
  sameOutline,
  setWallLength,
  splitWall,
  wallLength,
  type EditResult,
  type Home,
  type Vec2,
} from '../src/index.ts';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (isEditError(err)) return err.code;
    throw err;
  }
  return undefined;
}

const wall = (h: Home, id: string) => h.walls.find((w) => w.id === id)!;
const room = (h: Home, id: string) => h.rooms.find((r) => r.id === id)!;

/** Draw a chain of walls through the points, the way the wall tool does. */
function chain(h: Home, points: Vec2[], opts: { close?: boolean; thickness?: number } = {}): EditResult {
  let result: EditResult | undefined;
  const pts = opts.close ? [...points, points[0]!] : points;
  for (let i = 0; i + 1 < pts.length; i++) {
    result = drawWall(result?.home ?? h, { start: pts[i]!, end: pts[i + 1]!, thickness: opts.thickness ?? 0.2 });
  }
  return result!;
}

const box: Vec2[] = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
];

describe('drawing walls', () => {
  it('makes a room when the last wall closes the loop', () => {
    const r = chain(createHome({ name: 't' }), box, { close: true });
    expect(r.home.rooms).toHaveLength(1);
    expect(polygonArea(r.home.rooms[0]!.polygon)).toBeCloseTo(3.8 * 2.8, 9);
    expect(r.notes.some((n) => n.startsWith('New room'))).toBe(true);
  });

  it('can leave rooms out', () => {
    let h = chain(createHome({ name: 't' }), box.slice(0, 4)).home;
    h = drawWall(h, { start: [0, 3], end: [0, 0], thickness: 0.2, rooms: false }).home;
    expect(h.rooms).toHaveLength(0);
  });

  it('snaps an end that lands near a corner onto it', () => {
    let h = drawWall(createHome({ name: 't' }), { start: [0, 0], end: [4, 0] }).home;
    const r = drawWall(h, { start: [4.03, 0.02], end: [4, 3] });
    h = r.home;
    expect(wall(h, 'wall-2').start).toEqual([4, 0]);
    expect(r.notes).toContain('The start joins the corner of wall-1.');
  });

  it('places ends exactly when snapping is off', () => {
    const h = drawWall(drawWall(createHome({ name: 't' }), { start: [0, 0], end: [4, 0] }).home, { start: [4.03, 0.02], end: [4, 3], snap: 0 }).home;
    expect(wall(h, 'wall-2').start).toEqual([4.03, 0.02]);
  });

  it('splits the wall another wall ends on, so each room gets its own wall', () => {
    let h = chain(createHome({ name: 't' }), box, { close: true }).home;
    const r = drawWall(h, { start: [2, 0], end: [2, 3], thickness: 0.1 });
    h = r.home;
    // wall-1 (north) and wall-3 (south) were split at x = 2.
    expect(wall(h, 'wall-1').end).toEqual([2, 0]);
    expect(h.walls.filter((w) => w.thickness === 0.2)).toHaveLength(6);
    expect(h.rooms).toHaveLength(2);
    // The first room kept the larger half (here: the first of two equal halves) and a new room was made.
    expect(r.notes.some((n) => n.includes('follows its walls'))).toBe(true);
    expect(r.notes.some((n) => n.startsWith('New room'))).toBe(true);
  });

  it('splits walls it crosses', () => {
    let h = chain(createHome({ name: 't' }), box, { close: true }).home;
    h = drawWall(h, { start: [2, -1], end: [2, 4], thickness: 0.1 }).home;
    // The new wall is cut where it crosses the north and south walls: 3 pieces.
    expect(h.walls.filter((w) => w.thickness === 0.1)).toHaveLength(3);
    expect(h.rooms).toHaveLength(2);
  });

  it('refuses a wall that is already there', () => {
    const h = chain(createHome({ name: 't' }), box, { close: true }).home;
    expect(codeOf(() => drawWall(h, { start: [1, 0], end: [3, 0] }))).toBe('wall_exists');
  });

  it('draws only the part an existing wall does not cover', () => {
    const h = drawWall(createHome({ name: 't' }), { start: [0, 0], end: [2, 0] }).home;
    const r = drawWall(h, { start: [1, 0], end: [5, 0], snap: 0 });
    expect(wall(r.home, 'wall-2').start).toEqual([2, 0]);
    expect(wall(r.home, 'wall-2').end).toEqual([5, 0]);
  });

  it('refuses to split a wall through a door, and changes nothing', () => {
    let h = chain(createHome({ name: 't' }), box, { close: true }).home;
    h = addOpening(h, { wall: 'wall-1', type: 'door', offset: 1.6, width: 0.9 }).home;
    expect(codeOf(() => drawWall(h, { start: [2, 0], end: [2, 3] }))).toBe('opening_in_the_way');
  });

  it('moves a door to the piece of the wall it ends up on', () => {
    let h = chain(createHome({ name: 't' }), box, { close: true }).home;
    h = addOpening(h, { id: 'door-1', wall: 'wall-1', type: 'door', offset: 3, width: 0.8 }).home;
    h = drawWall(h, { start: [2, 0], end: [2, 3] }).home;
    const door = h.openings[0]!;
    expect(door.wall).not.toBe('wall-1');
    expect(door.offset).toBeCloseTo(1, 9);
  });
});

describe('rooms follow their walls', () => {
  const start = () => addRectangularRoom(createHome({ name: 't' }), { name: 'Living', x: 0, z: 0, width: 4, depth: 3 }).home;

  it('grows the room when a corner is dragged out', () => {
    const h = moveWallEnd(start(), { id: 'wall-1', end: 'end', to: [5, 0] }).home;
    // The east wall's start moved with the corner; the room follows the slanted wall.
    expect(polygonArea(room(h, 'room-1').polygon)).toBeCloseTo(((4 + 5) / 2) * 3, 6);
  });

  it('stretches the room when a wall is set longer', () => {
    const h = setWallLength(start(), { id: 'wall-1', length: 5, keep: 'start' }).home;
    expect(polygonArea(room(h, 'room-1').polygon)).toBeCloseTo(((4 + 5) / 2) * 3, 6);
  });

  it('moves a whole wall, stretching the walls at its corners', () => {
    // wall-2 is the east wall, running north to south; its left face looks east.
    const h = moveWall(start(), { id: 'wall-2', by: 1 }).home;
    expect(wallLength(wall(h, 'wall-1'))).toBeCloseTo(5, 9);
    expect(wallLength(wall(h, 'wall-3'))).toBeCloseTo(5, 9);
    expect(polygonArea(room(h, 'room-1').polygon)).toBeCloseTo(15, 9);
  });

  it('slides walls that end against the moved wall', () => {
    let h = start();
    // A partition from the south wall up to the north wall's inner face, then the north wall moves north.
    h = addWall(h, { start: [2, 3], end: [2, 0], thickness: 0.1 }).home;
    h = moveWall(h, { id: 'wall-1', by: 0.5 }).home;
    expect(wall(h, 'wall-5').end).toEqual([2, -0.5]);
  });

  it('keeps the bigger room when a dividing wall is removed', () => {
    let h = chain(createHome({ name: 't' }), box, { close: true }).home;
    h = drawWall(h, { start: [1, 0], end: [1, 3], thickness: 0.1 }).home;
    const big = h.rooms.reduce((a, b) => (polygonArea(a.polygon) > polygonArea(b.polygon) ? a : b));
    const r = remove(h, { ids: [h.walls.find((w) => w.thickness === 0.1)!.id] });
    expect(polygonArea(room(r.home, big.id).polygon)).toBeCloseTo(3.8 * 2.8, 6);
    expect(r.notes.some((n) => n.includes('no longer closed off'))).toBe(true);
  });

  it('never reshapes a room drawn by hand', () => {
    let h = start();
    const before = room(h, 'room-1').polygon;
    h = {
      ...h,
      rooms: [
        {
          ...room(h, 'room-1'),
          polygon: [
            [0.5, 0.5],
            [3.5, 0.5],
            [3.5, 2.5],
            [0.5, 2.5],
          ] as Vec2[],
        },
      ],
    };
    h = moveWall(h, { id: 'wall-2', by: 1 }).home;
    expect(room(h, 'room-1').polygon).not.toEqual(before);
    expect(polygonArea(room(h, 'room-1').polygon)).toBeCloseTo(6, 9);
  });

  it('undoes the wall move and the room change together', () => {
    const h = start();
    const r = moveWall(h, { id: 'wall-2', by: 1 });
    const back = applyPatch(r.home, r.patch, 'undo');
    expect(sameOutline(room(back, 'room-1').polygon, room(h, 'room-1').polygon)).toBe(true);
    expect(wall(back, 'wall-2')).toEqual(wall(h, 'wall-2'));
  });

  it('joins an end dropped on a wall into a T', () => {
    let h = start();
    h = addWall(h, { start: [2, 1.5], end: [2, 2] }).home;
    const r = moveWallEnd(h, { id: 'wall-5', end: 'start', to: [2.02, 0.03], snap: 0.05 });
    expect(wall(r.home, 'wall-5').start).toEqual([2.02, 0]);
    expect(r.home.walls).toHaveLength(6);
  });
});

describe('splitting and joining walls', () => {
  it('splits a wall, keeping doors where they are in the room', () => {
    let h = addRectangularRoom(createHome({ name: 't' }), { name: 'R', x: 0, z: 0, width: 4, depth: 3 }).home;
    h = addOpening(h, { wall: 'wall-1', type: 'window', offset: 2.5, width: 1 }).home;
    h = splitWall(h, { id: 'wall-1', at: 2 }).home;
    expect(wallLength(wall(h, 'wall-1'))).toBeCloseTo(2, 9);
    expect(h.openings[0]!.wall).toBe('wall-5');
    expect(h.openings[0]!.offset).toBeCloseTo(0.5, 9);
  });

  it('merges two walls back into one, with their doors', () => {
    let h = addRectangularRoom(createHome({ name: 't' }), { name: 'R', x: 0, z: 0, width: 4, depth: 3 }).home;
    h = addOpening(h, { wall: 'wall-1', type: 'window', offset: 2.5, width: 1 }).home;
    const split = splitWall(h, { id: 'wall-1', at: 2 }).home;
    const merged = mergeWalls(split, { ids: ['wall-1', 'wall-5'] }).home;
    expect(wall(merged, 'wall-1').end).toEqual([4, 0]);
    expect(merged.openings[0]).toMatchObject({ wall: 'wall-1', offset: 2.5 });
  });

  it('merges walls drawn in opposite directions', () => {
    let h = createHome({ name: 't' });
    h = addWall(h, { start: [0, 0], end: [2, 0], materials: { left: 'paint-white', right: 'oak-floor' } }).home;
    h = addWall(h, { start: [5, 0], end: [2, 0], materials: { left: 'oak-floor', right: 'paint-white' } }).home;
    h = addOpening(h, { wall: 'wall-2', type: 'window', offset: 0.5, width: 1 }).home;
    const merged = mergeWalls(h, { ids: ['wall-1', 'wall-2'] }).home;
    expect(wall(merged, 'wall-1').end).toEqual([5, 0]);
    // On wall-2 the window ran 0.5–1.5 m from x = 5, so 3.5–4.5 m from x = 0.
    expect(merged.openings[0]!.offset).toBeCloseTo(3.5, 9);
  });

  it('refuses to merge walls of different thickness and says why', () => {
    let h = createHome({ name: 't' });
    h = addWall(h, { start: [0, 0], end: [2, 0], thickness: 0.1 }).home;
    h = addWall(h, { start: [2, 0], end: [5, 0], thickness: 0.2 }).home;
    try {
      mergeWalls(h, { ids: ['wall-1', 'wall-2'] });
      expect.unreachable();
    } catch (err) {
      expect(isEditError(err) && err.code).toBe('cannot_merge');
      expect((err as Error).message).toContain('0.1 m thick');
    }
  });

  it('closes a gap by carrying a loose end on to the wall it points at, making a room', () => {
    let h = createHome({ name: 't' });
    for (const [s, e] of [
      [
        [0, 0],
        [4, 0],
      ],
      [
        [4, 0],
        [4, 3],
      ],
      [
        [4, 3],
        [0, 3],
      ],
      [
        [0, 3],
        [0, 0.3],
      ],
    ] as Array<[Vec2, Vec2]>) {
      h = addWall(h, { start: s, end: e, thickness: 0.2 }).home;
    }
    expect(h.rooms).toHaveLength(0);
    const r = joinWallEnd(h, { id: 'wall-4', end: 'end' });
    expect(wall(r.home, 'wall-4').end).toEqual([0, 0]);
    expect(r.home.rooms).toHaveLength(1);
  });

  it('says so when there is nothing to join', () => {
    const h = addWall(createHome({ name: 't' }), { start: [0, 0], end: [4, 0] }).home;
    expect(codeOf(() => joinWallEnd(h, { id: 'wall-1', end: 'end' }))).toBe('nothing_to_join');
  });
});
