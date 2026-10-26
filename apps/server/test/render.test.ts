import { addOpening, addRectangularRoom, createHome } from '@fullscale/core';
import { describe, expect, it } from 'vitest';
import { lightingFor } from '../src/render.ts';

const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

describe('lighting a render', () => {
  // A 4 × 3 m room with a window in its north wall (z = 0).
  const room = addRectangularRoom(createHome({ name: 't' }), { name: 'R', x: 0, z: 0, width: 4, depth: 3 }).home;
  const north = room.walls.find((w) => Math.abs(w.start[1]) < 1e-9 && Math.abs(w.end[1]) < 1e-9)!;
  const home = addOpening(room, { wall: north.id, type: 'window', offset: 1, width: 1.2, height: 1.2, sill: 0.9 }).home;
  const level = home.levels[0]!.id;

  it('finds the windows on the room side of their wall, facing in', () => {
    const { windows } = lightingFor(home, level, [2, 1.5, 1.5], 'day');
    expect(windows).toHaveLength(1);
    const w = windows[0]!;
    expect(w.width).toBe(1.2);
    expect(w.centre[1]).toBeCloseTo(0.9 + 0.6, 9);
    expect(w.centre[0]).toBeCloseTo(north.start[0] < north.end[0] ? 1.6 : 4 - 1.6, 9);
    // Facing into the room, which lies towards +z.
    expect(w.inward[2]).toBeCloseTo(1, 9);
  });

  it('puts the sun outside the biggest window by day, and nowhere at night', () => {
    const day = lightingFor(home, level, [2, 1.5, 1.5], 'day');
    expect(dot(day.sun!, day.windows[0]!.inward)).toBeLessThan(-0.8);
    expect(day.sun![1]).toBe(0);
    expect(lightingFor(home, level, [2, 1.5, 1.5], 'night').sun).toBeUndefined();
  });
});
