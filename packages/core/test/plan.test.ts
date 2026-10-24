import { describe, expect, it } from 'vitest';
import { addWall, createHome, labelPoint, planGeometry, pointInPolygon, renderPlanSvg, sampleFlat, signedDistanceToOutline, updateWall, type Vec2 } from '../src/index.ts';

describe('label placement', () => {
  it('puts the label of an L-shaped room inside the room, away from its walls', () => {
    const l: Vec2[] = [
      [0, 0],
      [6, 0],
      [6, 1],
      [1, 1],
      [1, 6],
      [0, 6],
    ];
    const p = labelPoint(l);
    expect(pointInPolygon(p, l)).toBe(true);
    // The arms are 1 m wide, so the best point is about 0.5 m from the nearest edge.
    expect(signedDistanceToOutline(p, l)).toBeGreaterThan(0.49);
  });

  it('finds the middle of a rectangle', () => {
    const p = labelPoint([
      [0, 0],
      [4, 0],
      [4, 2],
      [0, 2],
    ]);
    expect(p[0]).toBeCloseTo(2, 1);
    expect(p[1]).toBeCloseTo(1, 1);
  });
});

describe('plan drawing', () => {
  it('draws every wall, opening, room and item of the sample flat', () => {
    const home = sampleFlat();
    const plan = planGeometry(home);
    const ids = new Set(plan.primitives.map((p) => ('id' in p ? p.id : undefined)));
    for (const x of [...home.walls, ...home.openings, ...home.rooms, ...home.items]) expect(ids.has(x.id), x.id).toBe(true);
  });

  it('shows a scanned length with its ± and an estimated one as a guess', () => {
    let h = createHome({ name: 't' });
    h = addWall(h, { start: [0, 0], end: [3.42, 0], source: { kind: 'scan', uncertainty: 0.007 } }).home;
    h = addWall(h, { start: [0, 2], end: [2.5, 2], source: { kind: 'estimate' } }).home;
    const dims = planGeometry(h).primitives.filter((p) => p.kind === 'dimension');
    expect(dims.find((d) => d.wall === 'wall-1')).toMatchObject({ label: '3.42 m ±1 cm', estimated: false });
    expect(dims.find((d) => d.wall === 'wall-2')).toMatchObject({ label: '2.50 m', estimated: true });
    expect(renderPlanSvg(h).svg).toContain('2.50 m (est.)');
  });

  it('drops the ± once a person types a new length over a scanned one', () => {
    let h = addWall(createHome({ name: 't' }), { start: [0, 0], end: [3.42, 0], source: { kind: 'scan', uncertainty: 0.007 } }).home;
    h = updateWall(h, { id: 'wall-1', end: [3.5, 0] }).home;
    const dim = planGeometry(h).primitives.find((p) => p.kind === 'dimension');
    expect(dim).toMatchObject({ label: '3.50 m' });
  });
});
