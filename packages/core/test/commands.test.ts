import { describe, expect, it } from 'vitest';
import {
  addItem,
  addOpening,
  addRectangularRoom,
  addWall,
  bounds,
  clearance,
  clearHome,
  createHome,
  fitsThrough,
  isEditError,
  itemFootprint,
  moveWallEnd,
  paint,
  planDistance,
  planRemove,
  remove,
  roomInfo,
  roomWallFaces,
  setWallLength,
  summarizeHome,
  updateItem,
  updateWall,
  validateHome,
  wallFootprint,
  wallHeight,
  wallInfo,
  type Home,
} from '../src/index.ts';

function flat(): Home {
  return addRectangularRoom(createHome({ name: 'Test flat', id: 'test' }), { name: 'Living room', x: 0, z: 0, width: 4, depth: 3 }).home;
}

/** Run `fn` and return the EditError code it throws. */
function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (isEditError(err)) return err.code;
    throw err;
  }
  return undefined;
}

describe('rectangular rooms', () => {
  it('keeps exact inside dimensions', () => {
    const h = flat();
    const info = roomInfo(h, 'room-1');
    expect([info.area, info.width, info.depth]).toEqual([12, 4, 3]);
    expect(h.walls).toHaveLength(4);
  });

  it('puts wall thickness outside the room', () => {
    const b = bounds(wallFootprint(flat().walls[0]!));
    expect(b.max[1]).toBeCloseTo(0, 6);
    expect(b.min[1]).toBeCloseTo(-0.12, 6);
  });

  it('finds the four wall faces around the room', () => {
    const faces = roomWallFaces(flat(), 'room-1');
    expect(faces).toHaveLength(4);
    expect(new Set(faces.map((f) => f.face))).toEqual(new Set(['right']));
  });

  it('has no validation errors', () => {
    expect(validateHome(flat()).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('refuses rooms too small to stand in', () => {
    expect(codeOf(() => addRectangularRoom(createHome({ name: 't' }), { name: 'x', x: 0, z: 0, width: 0.2, depth: 3 }))).toBe('room_too_small');
  });
});

describe('heights follow the level unless set', () => {
  it('stores no height on new walls and reads the level height', () => {
    const h = flat();
    expect(h.walls[0]!.height).toBeUndefined();
    expect(wallHeight(h, h.walls[0]!)).toBe(2.7);
  });

  it('keeps an explicit height, and null goes back to following', () => {
    let h = updateWall(flat(), { id: 'wall-1', height: 2.4 }).home;
    expect(wallHeight(h, h.walls[0]!)).toBe(2.4);
    h = updateWall(h, { id: 'wall-1', height: null }).home;
    expect(h.walls[0]!.height).toBeUndefined();
  });
});

describe('ids', () => {
  it('never hands out a deleted id again', () => {
    let h = createHome({ name: 't' });
    for (let i = 0; i < 3; i++) h = addWall(h, { start: [0, i], end: [3, i] }).home;
    h = remove(h, { ids: ['wall-3'] }).home;
    h = addWall(h, { start: [0, 5], end: [3, 5] }).home;
    expect(h.walls.map((w) => w.id)).toEqual(['wall-1', 'wall-2', 'wall-4']);
  });

  it('refuses an id that is already used', () => {
    expect(codeOf(() => addWall(flat(), { id: 'wall-1', start: [0, 5], end: [1, 5] }))).toBe('id_exists');
  });

  it('keeps counters ahead of ids chosen by hand', () => {
    let h = addWall(createHome({ name: 't' }), { id: 'wall-7', start: [0, 0], end: [1, 0] }).home;
    h = addWall(h, { start: [0, 1], end: [1, 1] }).home;
    expect(h.walls.map((w) => w.id)).toEqual(['wall-7', 'wall-8']);
  });
});

describe('paint', () => {
  it('paints the walls of a room with a new colour', () => {
    const res = paint(flat(), { target: { room: 'room-1', surface: 'walls' }, color: '#9CAF88', name: 'Sage' });
    const sage = res.home.materials.find((m) => m.color === '#9caf88');
    expect(sage?.name).toBe('Sage');
    for (const w of res.home.walls) expect(w.materials.right).toBe(sage!.id);
  });

  it('reuses an existing paint of the same colour', () => {
    let h = paint(flat(), { target: { wall: 'wall-1', face: 'right' }, color: '#123456' }).home;
    h = paint(h, { target: { wall: 'wall-2', face: 'right' }, color: '#123456' }).home;
    expect(h.materials.filter((m) => m.color === '#123456')).toHaveLength(1);
  });

  it('reports no change when painting the same colour twice', () => {
    const h = paint(flat(), { target: { wall: 'wall-1', face: 'right' }, color: '#123456' }).home;
    expect(paint(h, { target: { wall: 'wall-1', face: 'right' }, color: '#123456' }).achieved.unchanged).toBe(true);
  });
});

describe('openings', () => {
  it('centres a door by default', () => {
    const h = addOpening(flat(), { wall: 'wall-1', type: 'door' }).home;
    expect(h.openings[0]!.offset).toBeCloseTo((4 - 0.9) / 2, 6);
    expect(validateHome(h).filter((i) => i.severity === 'error')).toEqual([]);
    expect(wallInfo(h, 'wall-1').faceArea).toBeCloseTo(4 * 2.7 - 0.9 * 2.1, 3);
  });

  it('refuses an opening that runs off the end of its wall, with the numbers', () => {
    try {
      addOpening(flat(), { wall: 'wall-2', type: 'window', offset: 2.5, width: 1 });
      expect.unreachable();
    } catch (err) {
      expect(isEditError(err) && err.code).toBe('opening_outside_wall');
      expect((err as Error).message).toMatch(/between 0 and 2 m/);
    }
  });

  it('refuses overlapping openings unless forced', () => {
    const h = addOpening(flat(), { wall: 'wall-1', type: 'window', offset: 1, width: 1.2 }).home;
    expect(codeOf(() => addOpening(h, { wall: 'wall-1', type: 'window', offset: 1.5, width: 1 }))).toBe('opening_overlap');
    expect(addOpening(h, { wall: 'wall-1', type: 'window', offset: 1.5, width: 1, force: true }).home.openings).toHaveLength(2);
    // Touching edges are not an overlap.
    expect(addOpening(h, { wall: 'wall-1', type: 'window', offset: 2.2, width: 1 }).home.openings).toHaveLength(2);
  });

  it('refuses a window taller than its wall', () => {
    expect(codeOf(() => addOpening(flat(), { wall: 'wall-1', type: 'window', sill: 1.5, height: 1.5 }))).toBe('opening_too_tall');
  });
});

describe('moving wall ends', () => {
  it('sets an exact length and carries the corner with it', () => {
    const h = setWallLength(flat(), { id: 'wall-1', length: 3.25 }).home;
    expect(wallInfo(h, 'wall-1').length).toBe(3.25);
    // The east wall shared that corner, so it moved too and the room stays closed.
    expect(h.walls[1]!.start).toEqual([3.25, 0]);
  });

  it('leaves the other wall alone when detached', () => {
    const h = moveWallEnd(flat(), { id: 'wall-1', end: 'end', to: [3.5, 0], detach: true }).home;
    expect(h.walls[1]!.start).toEqual([4, 0]);
  });

  it('keeps doors where they are in the room when the start moves', () => {
    let h = addOpening(flat(), { wall: 'wall-1', type: 'door', offset: 2 }).home;
    h = setWallLength(h, { id: 'wall-1', length: 4.5, keep: 'end' }).home;
    const wall = h.walls[0]!;
    expect(wall.start[0]).toBeCloseTo(-0.5, 9);
    expect(h.openings[0]!.offset).toBeCloseTo(2.5, 9); // still 2 m from x = 0
  });

  it('refuses to shorten a wall under its door', () => {
    const h = addOpening(flat(), { wall: 'wall-1', type: 'door', offset: 3 }).home;
    expect(codeOf(() => setWallLength(h, { id: 'wall-1', length: 3.5 }))).toBe('opening_outside_wall');
  });
});

describe('deleting', () => {
  it('takes a wall’s openings with it', () => {
    const h = addOpening(flat(), { wall: 'wall-1', type: 'door' }).home;
    const res = remove(h, { ids: ['wall-1'] });
    expect(res.home.openings).toHaveLength(0);
    expect(res.removed).toEqual(expect.arrayContaining(['wall-1', 'door-1']));
    expect(planRemove(h, ['wall-1'])).toEqual(['wall-1', 'door-1']);
  });

  it('refuses to delete a material still in use, naming who uses it', () => {
    try {
      remove(flat(), { ids: ['paint-white'] });
      expect.unreachable();
    } catch (err) {
      expect(isEditError(err) && err.code).toBe('in_use');
      expect((err as Error).message).toMatch(/wall-1/);
    }
  });

  it('refuses to delete the last level', () => {
    expect(codeOf(() => remove(createHome({ name: 't' }), { ids: ['level-0'] }))).toBe('last_level');
  });

  it('refuses to empty a home by accident, but clears it on purpose', () => {
    let h = flat();
    h = addItem(h, { catalog: 'plant', position: [1, 1] }).home;
    const everything = [...h.walls, ...h.rooms, ...h.items].map((x) => x.id);
    expect(codeOf(() => remove(h, { ids: everything }))).toBe('home_wipe_blocked');
    const cleared = clearHome(h, { reason: 'starting the layout again' });
    expect(cleared.home.walls).toHaveLength(0);
    expect(cleared.notes[0]).toMatch(/starting the layout again/);
  });
});

describe('furniture', () => {
  it('uses catalogue sizes and checks door fit', () => {
    let h = addOpening(flat(), { wall: 'wall-1', type: 'door', id: 'front-door' }).home;
    h = addItem(h, { catalog: 'sofa-3', position: [2, 1.5] }).home;
    const sofa = h.items[0]!;
    expect(sofa.size).toEqual([2.1, 0.85, 0.92]);
    expect(sofa.sources?.size).toEqual({ kind: 'catalog' });
    expect(fitsThrough(h, 'front-door', sofa.size).fits).toBe(true);
    expect(fitsThrough(h, 'front-door', [1.6, 0.95, 2.1]).fits).toBe(false);
  });

  it('refuses an unknown catalogue entry with suggestions', () => {
    expect(codeOf(() => addItem(flat(), { catalog: 'sofaa', position: [1, 1] }))).toBe('not_found');
  });

  it('rotating 90° swaps the footprint extents', () => {
    const b = bounds(itemFootprint({ position: [0, 0, 0], rotation: 90, size: [2, 1, 1] }));
    expect(b.size[0]).toBeCloseTo(1, 6);
    expect(b.size[1]).toBeCloseTo(2, 6);
  });

  it('warns when furniture goes into a wall', () => {
    const h = addItem(flat(), { catalog: 'bookshelf', position: [2, 0.1] }).home;
    expect(validateHome(h).some((i) => i.code === 'item_in_wall')).toBe(true);
  });

  it('measures clearance and distance', () => {
    let h = addItem(flat(), { catalog: 'desk', position: [2, 0.35] }).home; // 0.7 deep, back touching the north wall
    h = addItem(h, { catalog: 'chair', position: [2, 1.2] }).home;
    expect(clearance(h, 'desk-1').nearestWall?.distance).toBeCloseTo(0, 3);
    expect(planDistance(h, 'desk-1', 'chair-1')).toBeCloseTo(1.2 - 0.25 - 0.7, 3);
  });

  it('refuses to move a locked item', () => {
    let h = addItem(flat(), { catalog: 'plant', position: [1, 1] }).home;
    h = updateItem(h, { id: 'plant-1', locked: true }).home;
    expect(codeOf(() => updateItem(h, { id: 'plant-1', position: [2, 2] }))).toBe('locked_element');
  });

  it('refuses misspelt fields instead of ignoring them', () => {
    const h = addItem(flat(), { catalog: 'plant', position: [1, 1] }).home;
    expect(codeOf(() => updateItem(h, { id: 'plant-1', colour: '#ffffff' } as never))).toBe('invalid_input');
  });
});

it('summarises for agents', () => {
  expect(summarizeHome(flat())).toContain('12.0 m²');
});
