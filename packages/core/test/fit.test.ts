import { describe, expect, it } from 'vitest';
import { addItem, addLevel, addOpening, addRectangularRoom, checkFit, checkItemFit, createHome, doorZones, measureBetween, polygonArea, type Home } from '../src/index.ts';

/** An alcove 2.30 m wide and 1.15 m deep. */
function alcove(): Home {
  return addRectangularRoom(createHome({ name: 't' }), { name: 'Alcove', x: 0, z: 0, width: 2.3, depth: 1.15 }).home;
}

/** A 4 × 3 m room with a 0.9 m door in the middle of its south wall (wall-3), opening inwards. */
function roomWithDoor(): Home {
  const h = addRectangularRoom(createHome({ name: 't' }), { name: 'Room', x: 0, z: 0, width: 4, depth: 3 }).home;
  // wall-3 runs east to west along z = 3; its left face looks into the room.
  return addOpening(h, { id: 'door', wall: 'wall-3', type: 'door', offset: 1.55, width: 0.9, swing: 'left' }).home;
}

describe('will it fit', () => {
  it('fits a 2.00 × 0.60 m cabinet into a 2.30 × 1.15 m alcove one way round only', () => {
    const along = checkFit(alcove(), { size: [2, 0.8, 0.6], position: [1.15, 0.4] });
    expect(along.fits).toBe(true);
    const across = checkFit(alcove(), { size: [2, 0.8, 0.6], position: [1.15, 0.575], rotation: 90 });
    expect(across.fits).toBe(false);
    expect(across.problems.map((p) => p.code)).toContain('hits_wall');
    // The nearest pose that works is the same spot, turned back.
    expect(across.suggestion?.rotation).toBe(0);
  });

  it('refuses something too big for the room either way round', () => {
    const r = checkFit(alcove(), { size: [3, 0.9, 0.9], position: [1.15, 0.575] });
    expect(r.problems).toEqual([expect.objectContaining({ code: 'too_large_for_room' })]);
    expect(r.problems[0]!.message).toContain('2.30 m × 1.15 m');
  });

  it('keeps the clearance asked for: 5 cm apart is too close for 8 cm', () => {
    let h = alcove();
    h = addItem(h, { catalog: 'box', size: [0.5, 0.5, 0.5], position: [0.5, 0.5] }).home;
    const q = { size: [0.5, 0.5, 0.5] as [number, number, number], position: [1.05, 0.5] as [number, number] };
    expect(checkFit(h, q).fits).toBe(true);
    expect(checkFit(h, { ...q, clearance: 0.08 }).problems.map((p) => p.code)).toContain('hits_item');
  });

  it('keeps the floor clear where a door swings, but not above its head', () => {
    const h = roomWithDoor();
    const inFront = checkFit(h, { size: [0.6, 0.8, 0.4], position: [2, 2.6] });
    expect(inFront.problems).toEqual([expect.objectContaining({ code: 'blocks_door', ids: ['door'] })]);
    expect(checkFit(h, { size: [0.6, 0.3, 0.4], position: [2, 0.4, 2.6] }).problems).toEqual([expect.objectContaining({ code: 'blocks_door' })]);
    expect(checkFit(h, { size: [0.6, 0.3, 0.4], position: [2, 2.2, 2.6] }).fits).toBe(true);
  });

  it('sizes the swing zone to the door leaf', () => {
    const h = roomWithDoor();
    const [swing, walkway] = doorZones(h, h.openings[0]!);
    expect(polygonArea(swing!)).toBeCloseTo((0.9 + 0.1) * 0.9, 9);
    expect(polygonArea(walkway!)).toBeCloseTo((0.9 + 0.1) * 0.35, 9);
  });

  it('never lets furniture upstairs block a door downstairs', () => {
    let h = roomWithDoor();
    h = addLevel(h, { name: 'Upstairs', elevation: 2.8 }).home;
    expect(checkFit(h, { size: [0.6, 0.8, 0.4], position: [2, 2.6], level: 'level-1' }).problems.map((p) => p.code)).not.toContain('blocks_door');
  });

  it('says door access was not checked when no doors are drawn', () => {
    const r = checkFit(alcove(), { size: [1, 1, 0.5], position: [1.15, 0.5] });
    expect(r.status).toBe('insufficient_evidence');
    expect(r.notChecked.join(' ')).toContain('no doors');
  });

  it('marks an answer as partial when the size is only the catalogue default', () => {
    let h = roomWithDoor();
    h = addItem(h, { id: 'sofa', catalog: 'sofa-3', position: [2, 0.6] }).home;
    const r = checkItemFit(h, 'sofa');
    expect(r.fits).toBe(true);
    expect(r.status).toBe('partial');
    expect(r.caveats[0]).toContain('catalogue default');
    expect(r.nearest.wall?.gap).toBeCloseTo(0.6 - 0.46, 2);
  });
});

describe('measuring between things', () => {
  it('gives the gap between two items and how sure it is', () => {
    let h = alcove();
    h = addItem(h, { id: 'a', catalog: 'box', size: [0.5, 0.5, 0.5], position: [0.5, 0.5], source: { kind: 'scan', uncertainty: 0.02 } }).home;
    h = addItem(h, { id: 'b', catalog: 'box', size: [0.5, 0.5, 0.5], position: [1.5, 0.5], source: { kind: 'user', uncertainty: 0.015 } }).home;
    expect(measureBetween(h, 'a', 'b')).toEqual({ distance: 0.5, uncertainty: 0.025, method: 'shortest gap between outlines', sources: ['scan', 'user'] });
    expect(measureBetween(h, 'a', 'b', 'centres').distance).toBe(1);
  });
});
