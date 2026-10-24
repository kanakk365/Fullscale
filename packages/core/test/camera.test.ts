import { describe, expect, it } from 'vitest';
import { cameraPose, sampleFlat } from '../src/index.ts';

describe('camera views', () => {
  const home = sampleFlat();

  it('looks straight down from the top, with the plan’s up still up', () => {
    const pose = cameraPose(home, { preset: 'top' }, 4 / 3);
    expect(pose.eye[0]).toBeCloseTo(pose.target[0], 9);
    expect(pose.eye[2]).toBeCloseTo(pose.target[2], 9);
    expect(pose.eye[1]).toBeGreaterThan(pose.target[1]);
    expect(pose.up).toEqual([0, 0, -1]);
  });

  it('stands on the named side', () => {
    const south = cameraPose(home, { preset: 'south' }, 1);
    expect(south.eye[2]).toBeGreaterThan(south.target[2]);
    const west = cameraPose(home, { preset: 'west' }, 1);
    expect(west.eye[0]).toBeLessThan(west.target[0]);
  });

  it('comes closer to frame one element', () => {
    const all = cameraPose(home, { preset: 'three-quarter' }, 1);
    const sofa = cameraPose(home, { preset: 'three-quarter', focus: ['sofa-3-1'] }, 1);
    const dist = (p: typeof all) => Math.hypot(p.eye[0] - p.target[0], p.eye[1] - p.target[1], p.eye[2] - p.target[2]);
    expect(dist(sofa)).toBeLessThan(dist(all));
  });

  it('uses a given eye and target as they are', () => {
    expect(cameraPose(home, { eye: [1, 1.6, 1], target: [3, 1, 3] }, 1)).toMatchObject({ eye: [1, 1.6, 1], target: [3, 1, 3] });
  });
});
