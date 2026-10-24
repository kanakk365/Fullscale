import { describe, expect, it } from 'vitest';
import { addLevel, addPlanPicture, calibrateScale, createHome, isEditError, pictureToPlan, placePlanPicture, planRemove, scalePlanPicture } from '../src/index.ts';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (isEditError(err)) return err.code;
    throw err;
  }
  return undefined;
}

describe('scaling a plan picture', () => {
  it('reads the scale from one known length', () => {
    const s = calibrateScale([{ a: [100, 100], b: [600, 100], metres: 10 }]);
    expect(s.metresPerPixel).toBeCloseTo(0.02, 12);
    expect(s.residual).toBe(0);
    // Two clicks good to ±2 px on a 500 px line: about 0.57%.
    expect(s.uncertainty).toBeCloseTo((Math.SQRT2 * 2) / 500, 9);
  });

  it('gets surer with more lengths that agree', () => {
    const one = calibrateScale([{ a: [0, 0], b: [500, 0], metres: 10 }]);
    const two = calibrateScale([
      { a: [0, 0], b: [500, 0], metres: 10 },
      { a: [0, 0], b: [0, 400], metres: 8.01 },
    ]);
    expect(two.uncertainty).toBeLessThan(one.uncertainty);
    expect(two.residual).toBeGreaterThan(0);
  });

  it('refuses lengths that disagree by 4%, naming the odd one out', () => {
    try {
      calibrateScale([
        { a: [0, 0], b: [500, 0], metres: 10 },
        { a: [0, 0], b: [0, 500], metres: 10.4 },
      ]);
      expect.unreachable();
    } catch (err) {
      expect(isEditError(err) && err.code).toBe('scale_inconsistent');
      expect((err as Error).message).toMatch(/Known length \d/);
    }
  });

  it('needs at least one length', () => {
    expect(codeOf(() => calibrateScale([]))).toBe('scale_unknown');
  });

  it('turns picture pixels into plan points, rows running down the screen', () => {
    const place = { origin: [2, 3] as [number, number], rotation: 0, metresPerPixel: 0.01 };
    expect(pictureToPlan([100, 50], place)).toEqual([3, 3.5]);
    const turned = pictureToPlan([100, 0], { ...place, rotation: 90 });
    expect(turned[0]).toBeCloseTo(2, 12);
    expect(turned[1]).toBeCloseTo(2, 12);
  });
});

describe('plan picture commands', () => {
  it('adds, scales and places a picture under a level', () => {
    let h = addPlanPicture(createHome({ name: 't' }), { path: 'plans/ground.png', pixels: [2000, 1400] }).home;
    const r = scalePlanPicture(h, { id: 'plan-picture-1', known: [{ a: [100, 100], b: [1100, 100], metres: 5 }] });
    h = r.home;
    expect(h.captures[0]!.plan!.metresPerPixel).toBeCloseTo(0.005, 12);
    expect(r.notes[0]).toContain('1 px = 0.500 cm');
    h = placePlanPicture(h, { id: 'plan-picture-1', origin: [-1, -1], locked: true }).home;
    expect(codeOf(() => placePlanPicture(h, { id: 'plan-picture-1', rotation: 5 }))).toBe('locked_element');
  });

  it('refuses paths that leave the home folder', () => {
    expect(codeOf(() => addPlanPicture(createHome({ name: 't' }), { path: '../secret.png', pixels: [10, 10] }))).toBe('invalid_input');
  });

  it('goes with its level when the level is deleted', () => {
    let h = addLevel(createHome({ name: 't' }), { name: 'Up', elevation: 2.8 }).home;
    h = addPlanPicture(h, { path: 'up.png', level: 'level-1', pixels: [100, 100] }).home;
    expect(planRemove(h, ['level-1']).sort()).toEqual(['level-1', 'plan-picture-1']);
  });
});
