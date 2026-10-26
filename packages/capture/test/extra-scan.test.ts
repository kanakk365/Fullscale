import { applyOperation, captureToPlan, createHome, type Vec2 } from '@fullscale/core';
import { describe, expect, it } from 'vitest';
import { importScan, planExtraScan, readRoomPlan, syntheticRoomPlan, transformPoint, type ScanInput } from '../src/index.ts';

const rectangle = (w: number, d: number): Vec2[] => [
  [0, 0],
  [w, 0],
  [w, d],
  [0, d],
];
const ROOM = { corners: rectangle(4.7, 2.45), height: 2.8, doors: [{ wall: 0, offset: 3.2, width: 1, height: 2 }] };

/** A home with one scanned room, from a session that started at some turn and place. */
function homeWithRoom() {
  const input: ScanInput = { path: 'captures/first', rooms: [{ id: 'r1', name: 'Bedroom', layout: syntheticRoomPlan(ROOM, { yaw: 30, offset: [3, -1.2, -2] }) }] };
  const plan = importScan(createHome({ name: 't' }), input);
  return applyOperation(createHome({ name: 't' }), plan.operation, { by: 'user' }).home;
}

describe('another scan of a room', () => {
  it('lines a scan from a fresh session up with the room by its walls, whichever way it started', () => {
    const home = homeWithRoom();
    const room = home.rooms[0]!;
    // The same room, scanned again from a session turned 107° and moved elsewhere.
    const layout = syntheticRoomPlan(ROOM, { yaw: 107, offset: [-4, 0.3, 6] });
    const plan = planExtraScan(home, { path: 'captures/second', rooms: [{ id: 'r1', name: 'Bedroom', layout }] }, { room: room.id });
    expect(plan.method).toBe('shape');
    expect(plan.fit.mean).toBeLessThan(0.005);
    expect(plan.fit.length).toBeLessThan(0.005);
    // Its walls land on the room's: every scanned wall end is on the room's outline.
    for (const w of readRoomPlan(layout).walls) {
      const end = transformPoint(w.transform, [w.size[0] / 2, 0, 0]);
      const [x, z] = captureToPlan(plan.toHome, end[0], end[2]);
      const onEdge = room.polygon.some((p, i) => {
        const q = room.polygon[(i + 1) % room.polygon.length]!;
        return Math.abs((q[0] - p[0]) * (z - p[1]) - (q[1] - p[1]) * (x - p[0])) / Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.005;
      });
      expect(onEdge).toBe(true);
    }
    // The room is a rectangle, the same turned halfway round: its door tells which way.
    const door = readRoomPlan(layout).doors[0]!;
    const centre = transformPoint(door.transform, [0, 0, 0]);
    const [dx, dz] = captureToPlan(plan.toHome, centre[0], centre[2]);
    const homeDoor = home.openings[0]!;
    const wall = home.walls.find((w) => w.id === homeDoor.wall)!;
    const len = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
    const t = (homeDoor.offset + homeDoor.width / 2) / len;
    const want: Vec2 = [wall.start[0] + (wall.end[0] - wall.start[0]) * t, wall.start[1] + (wall.end[1] - wall.start[1]) * t];
    expect(Math.hypot(dx - want[0], dz - want[1])).toBeLessThan(0.2);
    // It adds a capture and nothing else.
    expect(plan.operation).toMatchObject({ op: 'addCapture', path: 'captures/second' });
  });

  it('says when the scans disagree, as when one drifted', () => {
    const home = homeWithRoom();
    const shorter = syntheticRoomPlan({ ...ROOM, corners: rectangle(4.6, 2.45) }, { yaw: 50, offset: [1, 0, 1] });
    const plan = planExtraScan(home, { path: 'captures/second', rooms: [{ id: 'r1', name: 'Bedroom', layout: shorter }] }, { room: home.rooms[0]!.id });
    expect(plan.fit.length).toBeCloseTo(0.1, 2);
    expect(plan.notes.join(' ')).toMatch(/disagree by more than 5 cm/);
  });

  it('takes the earlier scan’s place when the phone recognised the room', () => {
    const home = homeWithRoom();
    const layout = syntheticRoomPlan(ROOM, { yaw: 30, offset: [3, -1.2, -2] });
    const manifest = {
      format: 'fullscale-capture/1' as const,
      revision: 2,
      id: 'second',
      status: 'complete' as const,
      createdAt: '2026-10-26T00:00:00Z',
      rooms: [{ id: 'r1', name: 'Bedroom', dir: 'rooms/r1', addsTo: { capture: 'first', room: 'r1' } }],
      alignment: { method: 'relocalized' as const },
    };
    const plan = planExtraScan(home, { path: 'captures/second', manifest, rooms: [{ id: 'r1', name: 'Bedroom', layout }] });
    expect(plan.method).toBe('relocalized');
    expect(plan.toHome).toEqual(home.captures[0]!.toHome);
    expect(plan.fit.worst).toBeLessThan(0.005);
  });

  it('asks which room when the phone didn’t line the scan up', () => {
    const home = homeWithRoom();
    const layout = syntheticRoomPlan(ROOM, { yaw: 5, offset: [0, 0, 0] });
    expect(() => planExtraScan(home, { path: 'captures/second', rooms: [{ id: 'r1', name: 'Bedroom', layout }] })).toThrow(/Say which room/);
  });
});
