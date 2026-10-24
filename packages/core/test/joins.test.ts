import { describe, expect, it } from 'vitest';
import { addWall, createHome, joinedOutline, levelJoins, polygonArea, type Home, type Vec2 } from '../src/index.ts';

function walls(list: Array<{ start: Vec2; end: Vec2; line?: 'center' | 'left' | 'right'; thickness?: number; id?: string }>): Home {
  let h = createHome({ name: 't' });
  for (const w of list) h = addWall(h, { thickness: 0.2, ...w }).home;
  return h;
}

const outline = (h: Home, id: string) => joinedOutline(levelJoins(h, 'level-0').walls.get(id)!);
const close = (a: Vec2, b: Vec2) => {
  expect(a[0]).toBeCloseTo(b[0], 9);
  expect(a[1]).toBeCloseTo(b[1], 9);
};

describe('wall corners', () => {
  it('mitres a right-angle corner so the two walls meet without overlap', () => {
    const h = walls([
      { start: [0, 0], end: [4, 0] },
      { start: [4, 0], end: [4, 3] },
    ]);
    const a = outline(h, 'wall-1');
    const b = outline(h, 'wall-2');
    // Both walls end on the same diagonal: the outer and inner corner points.
    close(a[1]!, [4.1, -0.1]);
    close(a[2]!, [3.9, 0.1]);
    close(b[0]!, [4.1, -0.1]);
    close(b[3]!, [3.9, 0.1]);
    // No overlap: the joined areas add up to the centre-line lengths × thickness.
    expect(Math.abs(polygonArea(a)) + Math.abs(polygonArea(b))).toBeCloseTo((4 + 3) * 0.2, 9);
  });

  it.each([60, 135])('closes a %i° corner', (deg) => {
    const rad = (deg * Math.PI) / 180;
    const end: Vec2 = [4 + 3 * Math.cos(rad), 3 * Math.sin(rad)];
    const h = walls([
      { start: [0, 0], end: [4, 0] },
      { start: [4, 0], end },
    ]);
    const a = outline(h, 'wall-1');
    const b = outline(h, 'wall-2');
    const shared = [a[1]!, a[2]!].map((p) => [b[0]!, b[3]!].some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9));
    expect(shared).toEqual([true, true]);
  });

  it('keeps a scanned room-side face exact at the corner', () => {
    // Room-side faces (line right) on the outline x 0..4, z 0..3, walls outside.
    const h = walls([
      { start: [0, 0], end: [4, 0], line: 'right' },
      { start: [4, 0], end: [4, 3], line: 'right' },
    ]);
    close(outline(h, 'wall-1')[2]!, [4, 0]); // inner corner is the room corner
    close(outline(h, 'wall-1')[1]!, [4.2, -0.2]);
  });

  it('stops a T stem at the near face of the wall it meets', () => {
    for (const line of ['center', 'left', 'right'] as const) {
      const h = walls([
        { start: [0, 0], end: [6, 0], line },
        { start: [3, 0], end: [3, 4] },
      ]);
      const host = outline(h, 'wall-1');
      const stem = outline(h, 'wall-2');
      // The host is untouched: square ends, full length.
      expect(host[0]![0]).toBeCloseTo(0, 9);
      expect(host[1]![0]).toBeCloseTo(6, 9);
      // The stem runs towards +z, so it stops at the host face on that side.
      const nearFace = line === 'left' ? 0.2 : line === 'right' ? 0 : 0.1;
      expect(stem[0]![1]).toBeCloseTo(nearFace, 9);
      expect(stem[3]![1]).toBeCloseTo(nearFace, 9);
    }
  });

  it('leaves free ends and straight continuations square', () => {
    const h = walls([
      { start: [0, 0], end: [3, 0] },
      { start: [3, 0], end: [6, 0] },
    ]);
    close(outline(h, 'wall-1')[1]!, [3, -0.1]);
    close(outline(h, 'wall-1')[0]!, [0, -0.1]);
  });

  it('does not spike at a very sharp angle', () => {
    const rad = (5 * Math.PI) / 180;
    const h = walls([
      { start: [0, 0], end: [4, 0] },
      { start: [4, 0], end: [4 - 3 * Math.cos(rad), 3 * Math.sin(rad)] },
    ]);
    for (const p of outline(h, 'wall-1')) expect(Math.hypot(p[0] - 4, p[1])).toBeLessThan(4.01 + 10 * 0.1);
  });

  it('fills the middle where three walls end at one point', () => {
    const h = walls([
      { start: [0, 0], end: [3, 0] },
      { start: [0, 0], end: [0, 3] },
      { start: [0, 0], end: [-2, -2] },
    ]);
    expect(levelJoins(h, 'level-0').hubs).toHaveLength(1);
  });

  it('gives the same corners whatever order the walls are listed in', () => {
    const list = [
      { start: [0, 0] as Vec2, end: [4, 0] as Vec2, id: 'a' },
      { start: [4, 0] as Vec2, end: [4, 3] as Vec2, id: 'b' },
      { start: [2, 0] as Vec2, end: [2, -2] as Vec2, id: 'c' },
    ];
    const forward = levelJoins(walls(list), 'level-0');
    const backward = levelJoins(walls([...list].reverse()), 'level-0');
    for (const id of ['a', 'b', 'c']) expect(backward.walls.get(id)).toEqual(forward.walls.get(id));
  });
});
