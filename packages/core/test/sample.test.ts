import { describe, expect, it } from 'vitest';
import { roomInfo, roomWallFaces, sampleFlat, summarizeHome, validateHome } from '../src/index.ts';

describe('sample flat', () => {
  const h = sampleFlat();

  it('has no errors or warnings', () => {
    const problems = validateHome(h).filter((i) => i.severity !== 'info');
    expect(problems).toEqual([]);
  });

  it('has the planned rooms and exact inside sizes', () => {
    expect(h.rooms.map((r) => [r.name, roomInfo(h, r.id).area])).toEqual([
      ['Living room', 20],
      ['Kitchen', 12],
      ['Bedroom', 16],
      ['Bathroom', 9.6],
    ]);
  });

  it('finds four wall faces around every room, including shared walls', () => {
    for (const r of h.rooms) expect(roomWallFaces(h, r.id)).toHaveLength(4);
  });

  it('summarises', () => {
    expect(summarizeHome(h)).toContain('Total room area: 57.6 m²');
  });
});
