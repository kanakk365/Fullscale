import { describe, expect, it } from 'vitest';
import { addWall, angleSnap, createHome, gridSnap, snapPoint, snapToFaces, type SnapOptions, type Vec2, type Wall } from '../src/index.ts';

function walls(): Wall[] {
  let h = createHome({ name: 't' });
  h = addWall(h, { start: [0, 0], end: [4, 0], thickness: 0.1 }).home;
  h = addWall(h, { start: [4, 0], end: [4, 3], thickness: 0.1 }).home;
  return h.walls;
}

const radius = { corner: 0.3, middle: 0.2, wall: 0.15 };

describe('snapping', () => {
  it('prefers a corner over a wall middle when both are in reach', () => {
    const s = snapPoint(walls(), [3.8, 0.1], { mode: 'lines', radius: { ...radius, middle: 5 } });
    expect(s).toMatchObject({ point: [4, 0], kind: 'corner', walls: ['wall-1', 'wall-2'] });
  });

  it('finds the middle of a wall', () => {
    expect(snapPoint(walls(), [2.1, 0.12], { mode: 'lines', radius })).toMatchObject({ point: [2, 0], kind: 'middle' });
  });

  it('puts the point on a wall line when it is over the wall', () => {
    expect(snapPoint(walls(), [1, 0.04], { mode: 'lines', radius })).toMatchObject({ point: [1, 0], kind: 'wall', walls: ['wall-1'] });
  });

  it('in grid mode, still connects to a wall within 5 cm of its body, but not further', () => {
    const opts: SnapOptions = { mode: 'grid', grid: 0.5, radius };
    // The grid point [1, 0.5] is 0.45 m from the wall's face: left alone.
    expect(snapPoint(walls(), [1.1, 0.4], opts)).toMatchObject({ point: [1, 0.5], kind: 'grid' });
    // [1.1, 0.06] snaps to the grid point [1, 0], which is on the wall.
    expect(snapPoint(walls(), [1.1, 0.06], opts).kind).toBe('wall');
  });

  it('keeps a 45° line exactly on the diagonal', () => {
    const p = angleSnap([0, 0], [2.03, 1.96], 15, 0.1);
    expect(p[0]).toBeCloseTo(p[1], 12);
    expect(Math.hypot(p[0], p[1])).toBeCloseTo(2.8, 9);
  });

  it('returns the raw point when snapping is off', () => {
    expect(snapPoint(walls(), [3.99, 0.01], { mode: 'off', radius })).toEqual({ point: [3.99, 0.01], kind: null, walls: [] });
  });

  it('rounds to the grid without float noise', () => {
    expect(gridSnap([0.30000000000000004, 0.7], 0.1)).toEqual([0.3, 0.7]);
  });

  it('leaves out the walls being dragged', () => {
    const s = snapPoint(walls(), [3.95, 0.05], { mode: 'lines', radius, exclude: new Set(['wall-1', 'wall-2']) });
    expect(s.kind).toBeNull();
  });
});

describe('snapping to wall faces', () => {
  const faces = [
    {
      wall: 'w',
      points: [
        [0, 0],
        [4, 0],
        [4, 0.2],
        [0, 0.2],
      ] as Vec2[],
    },
  ];
  it('lands on a face corner, then on a face, for drawing room outlines', () => {
    expect(snapToFaces(faces, [3.95, 0.24], { mode: 'lines', radius })).toMatchObject({ point: [4, 0.2], kind: 'corner' });
    expect(snapToFaces(faces, [2, 0.26], { mode: 'lines', radius })).toMatchObject({ point: [2, 0.2], kind: 'wall' });
  });
  it('in grid mode, joins a face within 5 cm of the grid point', () => {
    // On a 25 cm grid, [2.02, 0.24] rounds to [2, 0.25], 5 cm from the face: it joins the face.
    expect(snapToFaces(faces, [2.02, 0.24], { mode: 'grid', grid: 0.25, radius })).toMatchObject({ point: [2, 0.2], kind: 'wall' });
    // On a 50 cm grid it rounds to [2, 0.5], 30 cm away: it stays on the grid.
    expect(snapToFaces(faces, [2.02, 0.31], { mode: 'grid', grid: 0.5, radius })).toMatchObject({ point: [2, 0.5], kind: 'grid' });
  });
});
