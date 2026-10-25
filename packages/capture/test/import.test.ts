import { applyOperation, captureToHomeMatrix, captureToPlan, createHome, polygonArea, sameOutline, wallLength, type Home, type Vec2 } from '@fullscale/core';
import { describe, expect, it } from 'vitest';
import { importScan, readRoomPlan, syntheticRoomPlan, transformPoint, type SyntheticRoom } from '../src/index.ts';

/** A world turned 30° and shifted, as an AR session starts wherever the phone happens to be. */
const WORLD = { yaw: 30, offset: [3, -1.2, -2] as [number, number, number] };

const rectangle = (w: number, d: number): Vec2[] => [
  [0, 0],
  [w, 0],
  [w, d],
  [0, d],
];

function imported(rooms: SyntheticRoom[], world = WORLD, home: Home = createHome({ name: 't' })) {
  const result = importScan(home, { path: 'captures/test', rooms: rooms.map((r, i) => ({ id: `room-${i}`, name: r.name ?? `Room ${i + 1}`, layout: syntheticRoomPlan(r, world) })) });
  return { result, home: applyOperation(home, result.operation, { by: 'user' }).home };
}

describe('importing a scanned room', () => {
  it('gives back a 4 × 3 m room, turned square to the plan', () => {
    const { home, result } = imported([{ corners: rectangle(4, 3), height: 2.6 }]);
    expect(home.walls).toHaveLength(4);
    for (const w of home.walls) {
      // Every wall runs along an axis once the capture's turn is undone.
      expect(Math.min(Math.abs(w.end[0] - w.start[0]), Math.abs(w.end[1] - w.start[1]))).toBeLessThan(1e-6);
      expect(w.line).toBe('right');
      expect(w.sources?.thickness?.kind).toBe('estimate');
    }
    expect(home.walls.map(wallLength).sort()).toEqual([expect.closeTo(3, 6), expect.closeTo(3, 6), expect.closeTo(4, 6), expect.closeTo(4, 6)]);
    expect(home.rooms).toHaveLength(1);
    expect(polygonArea(home.rooms[0]!.polygon)).toBeCloseTo(12, 6);
    expect(home.levels[0]!.height).toBeCloseTo(2.6, 6);
    // The import turned the capture back by the angle the AR world happened to start at.
    expect(result.toHome.yaw).toBeCloseTo(-WORLD.yaw, 6);
  });

  it('records where the capture went, so its mesh and detailed model line up with the walls', () => {
    const room = { corners: rectangle(4, 3), height: 2.6 };
    const { home, result } = imported([room]);
    const ends = home.walls.flatMap((w) => [w.start, w.end]);
    for (const w of readRoomPlan(syntheticRoomPlan(room, WORLD)).walls) {
      for (const side of [-0.5, 0.5]) {
        const p = transformPoint(w.transform, [w.size[0] * side, 0, 0]);
        const [x, z] = captureToPlan(result.toHome, p[0], p[2]);
        expect(Math.min(...ends.map((e) => Math.hypot(e[0] - x, e[1] - z)))).toBeLessThan(1e-5);
      }
    }
    const m = captureToHomeMatrix(result.toHome, home.levels[0]!.elevation);
    // The capture's floor height lands on the level's floor.
    expect(WORLD.offset[1] + m[13]!).toBeCloseTo(home.levels[0]!.elevation, 6);
  });

  it('marks scanned numbers with their source and uncertainty', () => {
    const { home } = imported([{ corners: rectangle(4, 3), height: 2.6, confidence: 'medium' }]);
    expect(home.walls[0]!.source).toMatchObject({ kind: 'scan', uncertainty: 0.04 });
    expect(home.captures[0]).toMatchObject({ kind: 'phone-capture', path: 'captures/test' });
  });

  it('keeps an L-shaped room’s shape, door and window exactly', () => {
    const corners: Vec2[] = [
      [0, 0],
      [6, 0],
      [6, 2],
      [2, 2],
      [2, 5],
      [0, 5],
    ];
    const { home } = imported([{ corners, height: 2.5, doors: [{ wall: 0, offset: 1, width: 0.9, height: 2.1 }], windows: [{ wall: 1, offset: 0.5, width: 1, height: 1.2, sill: 0.8 }] }]);
    expect(polygonArea(home.rooms[0]!.polygon)).toBeCloseTo(6 * 2 + 2 * 3, 6);
    const door = home.openings.find((o) => o.type === 'door')!;
    const window = home.openings.find((o) => o.type === 'window')!;
    expect(door).toMatchObject({ sill: 0 });
    expect(door.width).toBeCloseTo(0.9, 6);
    expect(window.sill).toBeCloseTo(0.8, 6);
    expect(window.height).toBeCloseTo(1.2, 6);
    // The door is 1 m from the corner its wall starts at, wherever the importer started it.
    const wall = home.walls.find((w) => w.id === door.wall)!;
    expect([door.offset, wallLength(wall) - door.offset - door.width].some((d) => Math.abs(d - 1) < 1e-6)).toBe(true);
  });

  it('finds the room side of each wall without a scanned floor', () => {
    const { home } = imported([{ corners: rectangle(5, 4), height: 2.6, noFloor: true }]);
    expect(polygonArea(home.rooms[0]!.polygon)).toBeCloseTo(20, 6);
  });

  it('places furniture at its scanned spot, size and turn', () => {
    const { home } = imported([{ corners: rectangle(5, 4), height: 2.6, objects: [{ category: 'sofa', position: [2.5, 0.5], size: [2.2, 0.8, 0.95], rotation: 0 }] }]);
    const sofa = home.items[0]!;
    expect(sofa).toMatchObject({ catalog: 'sofa-3', name: 'Sofa', size: [2.2, 0.8, 0.95] });
    expect(sofa.sources?.size).toMatchObject({ kind: 'scan' });
    // Same distance from the nearest wall as in the room it was scanned in.
    const room = home.rooms[0]!.polygon;
    const minZ = Math.min(...room.map((p) => p[1]));
    const minX = Math.min(...room.map((p) => p[0]));
    const maxX = Math.max(...room.map((p) => p[0]));
    const maxZ = Math.max(...room.map((p) => p[1]));
    const gaps = [sofa.position[2] - minZ, maxZ - sofa.position[2], sofa.position[0] - minX, maxX - sofa.position[0]];
    expect(gaps.some((g) => Math.abs(g - 0.5) < 1e-6)).toBe(true);
  });

  it('measures a wall’s thickness when both of its sides were scanned', () => {
    // Two rooms with a 10 cm wall between them, each scanned on its own.
    const left = { name: 'Left', corners: rectangle(4, 3), height: 2.6 };
    const right = { name: 'Right', corners: rectangle(3, 3).map(([x, z]) => [x + 4.1, z] as Vec2), height: 2.6 };
    const { home } = imported([left, right]);
    const shared = home.walls.filter((w) => w.sources?.thickness?.kind === 'scan');
    expect(shared).toHaveLength(2);
    for (const w of shared) expect(w.thickness).toBeCloseTo(0.05, 6);
    expect(home.rooms.map((r) => r.name).sort()).toEqual(['Left', 'Right']);
  });

  it('sits next to what is already on the level', () => {
    const start = applyOperation(createHome({ name: 't' }), { op: 'addRectangularRoom', name: 'Existing', x: 0, z: 0, width: 3, depth: 3 }).home;
    const { home } = imported([{ corners: rectangle(4, 3), height: 2.7 }], WORLD, start);
    const scanned = home.rooms.find((r) => r.name !== 'Existing')!;
    expect(Math.min(...scanned.polygon.map((p) => p[0]))).toBeGreaterThan(3);
  });
});

describe('reading scanner files', () => {
  it('reports elements it can’t read instead of failing', () => {
    const layout = syntheticRoomPlan({ corners: rectangle(4, 3), height: 2.6 }, WORLD) as { walls: Array<Record<string, unknown>> };
    layout.walls.push({ ...layout.walls[0]!, identifier: 'stretched', transform: [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
    layout.walls.push({ ...layout.walls[1]! });
    const room = readRoomPlan(layout);
    expect(room.walls).toHaveLength(4);
    expect(room.problems.join(' ')).toMatch(/stretches or mirrors/);
    expect(room.problems.join(' ')).toMatch(/used twice/);
  });

  it('reports an element with a number the phone wrote as "nan" and reads the rest', () => {
    const layout = syntheticRoomPlan({ corners: rectangle(4, 3), height: 2.6 }, WORLD) as { walls: Array<Record<string, unknown>> };
    layout.walls.push({ ...layout.walls[0]!, identifier: 'not-a-number', dimensions: ['nan', 2.6, 0] });
    const room = readRoomPlan(JSON.parse(JSON.stringify(layout)));
    expect(room.walls).toHaveLength(4);
    expect(room.problems.join(' ')).toMatch(/walls\[4\]: dimensions/);
  });

  it('reads transforms written as four columns', () => {
    const layout = syntheticRoomPlan({ corners: rectangle(4, 3), height: 2.6 }, WORLD) as { walls: Array<{ transform: number[] }> };
    for (const w of layout.walls) (w as unknown as { transform: number[][] }).transform = [0, 1, 2, 3].map((c) => w.transform.slice(4 * c, 4 * c + 4));
    expect(readRoomPlan(layout).walls).toHaveLength(4);
  });

  it('refuses a capture with no walls', () => {
    expect(() => importScan(createHome({ name: 't' }), { path: 'x', rooms: [{ id: 'a', name: 'A', layout: {} }] })).toThrow(/no walls/);
  });
});

describe('tape checks', () => {
  it('compares the scan with the tape and offers the tape value as a fix', () => {
    const layout = syntheticRoomPlan({ corners: rectangle(4, 3), height: 2.6 }, WORLD) as { walls: Array<{ identifier: string; dimensions: number[] }> };
    const wall = layout.walls.find((w) => Math.abs(w.dimensions[0]! - 4) < 1e-9)!;
    const home = createHome({ name: 't' });
    const result = importScan(home, {
      path: 'x',
      rooms: [{ id: 'a', name: 'A', layout }],
      checks: [{ id: 't1', kind: 'wall_length', element: wall.identifier, tapeM: 4.03, heldOut: false, obstructed: false }],
    });
    const check = result.checks[0]!;
    expect(check).toMatchObject({ band: 'amber', heldOut: false });
    expect(check.differenceM).toBeCloseTo(-0.03, 6);
    const fixed = applyOperation(applyOperation(home, result.operation).home, check.fix!).home;
    const w = fixed.walls.find((x) => x.id === check.element)!;
    expect(wallLength(w)).toBeCloseTo(4.03, 6);
    expect(w.sources?.end).toMatchObject({ kind: 'user', note: 'tape measure' });
  });
});

describe('the room outline', () => {
  it('follows the walls, so editing a scanned wall reshapes the room', () => {
    const { home } = imported([{ corners: rectangle(4, 3), height: 2.6 }]);
    const north = home.walls.find((w) => Math.abs(w.start[1] - w.end[1]) < 1e-9 && Math.abs(wallLength(w) - 4) < 1e-6)!;
    const moved = applyOperation(home, { op: 'moveWall', id: north.id, by: 0.5 }).home;
    expect(sameOutline(moved.rooms[0]!.polygon, home.rooms[0]!.polygon)).toBe(false);
  });
});
