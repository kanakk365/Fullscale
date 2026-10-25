import { describe, expect, it } from 'vitest';
import { captureToHomeMatrix, captureToPlan, type ToHome } from '../src/index.ts';

const toHome: ToHome = { yaw: 90, offset: [10, 20], floorY: -1.2, level: 'level-0' };

/** Apply a column-major 4 × 4 matrix to a point. */
function apply(m: number[], [x, y, z]: [number, number, number]): number[] {
  return [0, 1, 2].map((r) => m[r]! * x + m[4 + r]! * y + m[8 + r]! * z + m[12 + r]!);
}

describe('placing a capture in the home', () => {
  it('turns counter-clockwise seen from above, then moves', () => {
    // A quarter turn takes the capture's +x to the plan's −z (up on the plan) and +z to +x.
    const [x1, z1] = captureToPlan(toHome, 1, 0);
    expect(x1).toBeCloseTo(10, 12);
    expect(z1).toBeCloseTo(19, 12);
    const [x2, z2] = captureToPlan(toHome, 0, 2);
    expect(x2).toBeCloseTo(12, 12);
    expect(z2).toBeCloseTo(20, 12);
  });

  it('puts the capture’s floor on the level’s floor', () => {
    const m = captureToHomeMatrix(toHome, 3);
    const p = apply(m, [1, -1.2, 0]);
    expect(p[0]).toBeCloseTo(10, 12);
    expect(p[1]).toBeCloseTo(3, 12);
    expect(p[2]).toBeCloseTo(19, 12);
  });

  it('agrees with the plan for any point', () => {
    const turned: ToHome = { yaw: -10.440597, offset: [0.3, -2.1], floorY: -0.95, level: 'level-0' };
    const m = captureToHomeMatrix(turned, 0);
    for (const [x, z] of [
      [0.98, 1.64],
      [-1.5, 0.2],
      [3.1, -0.7],
    ] as const) {
      const p = apply(m, [x, 0.5, z]);
      const [px, pz] = captureToPlan(turned, x, z);
      expect(p[0]).toBeCloseTo(px, 12);
      expect(p[2]).toBeCloseTo(pz, 12);
      expect(p[1]).toBeCloseTo(1.45, 12);
    }
  });
});
