import { describe, expect, it } from 'vitest';
import { addWall, FORMAT, isEditError, loadHome, validateHome } from '../src/index.ts';

/** A home as the first format version saved it. */
function versionZero() {
  return {
    format: 'fullscale/0',
    id: 'old',
    name: 'Old home',
    units: 'm',
    createdAt: '2026-10-24T00:00:00.000Z',
    updatedAt: '2026-10-24T00:00:00.000Z',
    levels: [{ id: 'level-0', name: 'Ground', elevation: 0, height: 2.7 }],
    walls: [
      { id: 'wall-1', level: 'level-0', start: [0, 0], end: [4, 0], thickness: 0.12, height: 2.7, line: 'right', materials: {}, source: { kind: 'user' } },
      { id: 'wall-3', level: 'level-0', start: [4, 0], end: [4, 3], thickness: 0.12, height: 2.7, line: 'right', materials: {}, source: { kind: 'scan', uncertainty: 0.01 } },
    ],
    openings: [{ id: 'door-1', wall: 'wall-1', type: 'door', offset: 1, width: 0.9, height: 2.1 }],
    rooms: [],
    items: [],
    materials: [],
    captures: [],
  };
}

describe('opening old and damaged files', () => {
  it('upgrades version 0, letting copied heights follow the level again', () => {
    const { home, report } = loadHome(versionZero());
    expect(home.format).toBe(FORMAT);
    expect(report.upgraded).toEqual(['fullscale/0 → fullscale/1']);
    expect(home.walls[0]!.height).toBeUndefined();
    // A scanned height was measured, so it stays.
    expect(home.walls[1]!.height).toBe(2.7);
    expect(home.openings[0]!.sill).toBe(0);
  });

  it('never reuses ids from the file', () => {
    const { home } = loadHome(versionZero());
    expect(home.nextIds.wall).toBe(4);
    expect(addWall(home, { start: [0, 5], end: [1, 5] }).home.walls[2]!.id).toBe('wall-4');
  });

  it('sets aside a damaged element instead of dropping it, and reports it', () => {
    const raw = versionZero();
    (raw.walls[1] as Record<string, unknown>).thickness = -1;
    const { home, report } = loadHome(raw);
    expect(home.walls.map((w) => w.id)).toEqual(['wall-1']);
    expect(report.quarantined).toEqual([{ collection: 'walls', id: 'wall-3', problem: expect.stringMatching(/thickness/) }]);
    expect(home.quarantine[0]!.element).toMatchObject({ id: 'wall-3', thickness: -1 });
    expect(validateHome(home).some((i) => i.code === 'quarantined')).toBe(true);
  });

  it('refuses a format it does not know, saying which it reads', () => {
    try {
      loadHome({ format: 'fullscale/99' });
      expect.unreachable();
    } catch (err) {
      expect(isEditError(err) && err.code).toBe('invalid_input');
      expect((err as Error).message).toMatch(/fullscale\/0, fullscale\/1/);
    }
  });

  it('opens a current file unchanged', () => {
    const { home } = loadHome(versionZero());
    const again = loadHome(JSON.parse(JSON.stringify(home)));
    expect(again.home).toEqual(home);
    expect(again.report.upgraded).toEqual([]);
  });
});
