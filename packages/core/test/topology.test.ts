import { describe, expect, it } from 'vitest';
import {
  addOpening,
  addRectangularRoom,
  addWall,
  createHome,
  detectRooms,
  findRooms,
  openWallEnds,
  outlineOverlap,
  polygonArea,
  roomInfo,
  roomWallFaces,
  sameOutline,
  sampleFlat,
  wallCovering,
  type Home,
  type Vec2,
} from '../src/index.ts';

type WallSpec = { start: Vec2; end: Vec2; line?: 'center' | 'left' | 'right'; thickness?: number };

function walls(list: WallSpec[]): Home {
  let h = createHome({ name: 't' });
  for (const w of list) h = addWall(h, { thickness: 0.2, ...w }).home;
  return h;
}

/** A closed loop of centre-line walls through the given corners. */
function loop(corners: Vec2[], extra: WallSpec[] = []): Home {
  return walls([...corners.map((c, i) => ({ start: c, end: corners[(i + 1) % corners.length]! })), ...extra]);
}

const square: Vec2[] = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
];

describe('finding rooms', () => {
  it('finds the room inside four walls, outlined at the inner faces', () => {
    const rooms = findRooms(loop(square), 'level-0');
    expect(rooms).toHaveLength(1);
    expect(
      sameOutline(rooms[0]!.polygon, [
        [0.1, 0.1],
        [3.9, 0.1],
        [3.9, 2.9],
        [0.1, 2.9],
      ]),
    ).toBe(true);
    expect(rooms[0]!.area).toBeCloseTo(3.8 * 2.8, 9);
  });

  it('gives each face that borders the room, with the stretch that borders it', () => {
    const [room] = findRooms(loop(square), 'level-0');
    const north = room!.spans.find((s) => s.wall === 'wall-1')!;
    // wall-1 runs west to east; the room is south of it, on its right face.
    expect(north.face).toBe('right');
    expect(north.from).toBeCloseTo(0.1, 9);
    expect(north.to).toBeCloseTo(3.9, 9);
  });

  it('finds the same four rooms the sample flat was built with', () => {
    const home = sampleFlat();
    const found = findRooms(home, 'level-0');
    expect(found).toHaveLength(4);
    for (const room of home.rooms) {
      expect(
        found.some((f) => sameOutline(f.polygon, room.polygon, 1e-9)),
        room.name,
      ).toBe(true);
    }
  });

  it('ignores a wall that stops in the middle of a room', () => {
    const rooms = findRooms(loop(square, [{ start: [2, 0], end: [2, 1.5] }]), 'level-0');
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.area).toBeCloseTo(3.8 * 2.8, 9);
  });

  it('splits a room in two where a wall crosses it', () => {
    const rooms = findRooms(loop(square, [{ start: [2, 0], end: [2, 3] }]), 'level-0');
    expect(rooms.map((r) => r.area).sort()).toEqual([expect.closeTo(1.8 * 2.8, 9), expect.closeTo(1.8 * 2.8, 9)]);
  });

  it('joins walls that cross without ending at each other', () => {
    const h = loop(square, [
      { start: [2, -1], end: [2, 4] },
      { start: [-1, 1.5], end: [5, 1.5] },
    ]);
    expect(findRooms(h, 'level-0')).toHaveLength(4);
  });

  it('joins a wall drawn up to another wall’s face, not only to its line', () => {
    // The divider stops at the inner face of the north and south walls (0.1 m short).
    const rooms = findRooms(loop(square, [{ start: [2, 0.1], end: [2, 2.9] }]), 'level-0');
    expect(rooms).toHaveLength(2);
  });

  it('finds no room when a corner is left open by 3 cm', () => {
    const h = walls([
      { start: [0, 0], end: [4, 0] },
      { start: [4, 0], end: [4, 3] },
      { start: [4, 3], end: [0, 3] },
      { start: [0, 3], end: [0, 0.23] },
    ]);
    expect(findRooms(h, 'level-0')).toHaveLength(0);
    const open = openWallEnds(h, 'level-0');
    expect(open.map((o) => `${o.wall}.${o.end}`).sort()).toEqual(['wall-1.start', 'wall-4.end']);
    const fix = open.find((o) => o.wall === 'wall-4')!.candidate!;
    expect(fix.kind).toBe('wall');
    expect(fix.wall).toBe('wall-1');
    expect(fix.gap).toBeCloseTo(0.23, 9);
  });

  it('steps the outline where a wall changes thickness part-way', () => {
    const h = walls([
      { start: [0, 0], end: [2, 0], thickness: 0.2 },
      { start: [2, 0], end: [4, 0], thickness: 0.4 },
      { start: [4, 0], end: [4, 3] },
      { start: [4, 3], end: [0, 3] },
      { start: [0, 3], end: [0, 0] },
    ]);
    const [room] = findRooms(h, 'level-0');
    expect(room!.polygon).toHaveLength(6);
    expect(room!.area).toBeCloseTo(3.8 * 2.8 - 1.9 * 0.1, 9);
  });

  it('keeps rooms on their own level', () => {
    let h = addRectangularRoom(createHome({ name: 't' }), { name: 'A', x: 0, z: 0, width: 3, depth: 3 }).home;
    expect(findRooms(h, 'level-0')).toHaveLength(1);
    h = { ...h, levels: [...h.levels, { id: 'level-1', name: 'Up', elevation: 2.7, height: 2.5 }] };
    expect(findRooms(h, 'level-1')).toHaveLength(0);
  });
});

describe('comparing outlines', () => {
  const a: Vec2[] = [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
  ];

  it('treats the same corners from another start or direction as the same outline', () => {
    expect(sameOutline(a, [a[2]!, a[1]!, a[0]!, a[3]!])).toBe(true);
    expect(sameOutline(a, [a[0]!, a[2]!, a[1]!, a[3]!])).toBe(false);
  });

  it('measures overlap as shared area over combined area', () => {
    const half: Vec2[] = [
      [0, 0],
      [1, 0],
      [1, 2],
      [0, 2],
    ];
    expect(outlineOverlap(a, half)).toBeCloseTo(polygonArea(half) / polygonArea(a), 1);
    expect(
      outlineOverlap(a, [
        [5, 5],
        [6, 5],
        [6, 6],
      ]),
    ).toBe(0);
  });
});

describe('rooms along shared walls', () => {
  it('counts only the doors and windows on the stretch of wall that borders the room', () => {
    // One long north wall across two rooms, with a window in the east room only.
    let h = loop(
      [
        [0, 0],
        [8, 0],
        [8, 3],
        [0, 3],
      ],
      [{ start: [4, 0], end: [4, 3], thickness: 0.1 }],
    );
    h = detectRooms(h, {}).home;
    h = addOpening(h, { wall: 'wall-1', type: 'window', offset: 5, width: 1, height: 1, sill: 1 }).home;
    const [west, east] = [...h.rooms].sort((a, b) => a.polygon[0]![0] - b.polygon[0]![0]);
    const westInfo = roomInfo(h, west!.id);
    expect(westInfo.paintableWallArea).toBeCloseTo(westInfo.perimeter * 2.7, 3);
    const eastInfo = roomInfo(h, east!.id);
    expect(eastInfo.paintableWallArea).toBeCloseTo(eastInfo.perimeter * 2.7 - 1, 3);
    // The north wall borders each room for its own stretch.
    const north = roomWallFaces(h, west!.id).find((f) => f.wall === 'wall-1')!;
    expect(north.from).toBeCloseTo(0.1, 9);
    expect(north.to).toBeCloseTo(3.95, 9);
  });
});

describe('walls already there', () => {
  it('sees that a neighbouring room’s wall already covers a new room’s side', () => {
    const home = sampleFlat();
    // The kitchen's west side, drawn like addRectangularRoom draws sides, lies on the
    // living room's east wall.
    const west = { start: [5.12, 4] as Vec2, end: [5.12, 0] as Vec2, thickness: 0.12, line: 'right' as const };
    expect(wallCovering(home.walls, west)?.id).toBe('wall-2');
    // Moved 0.3 m east it no longer overlaps.
    expect(wallCovering(home.walls, { ...west, start: [5.42, 4], end: [5.42, 0] })).toBeUndefined();
  });
});
