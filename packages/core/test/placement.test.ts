import { describe, expect, it } from 'vitest';
import { addItem, addRectangularRoom, createHome, itemFootprint, bounds, placeAgainstWall, renderPlanSvg, roomCentre, sampleFlat, validateHome } from '../src/index.ts';

const room = () => addRectangularRoom(createHome({ name: 't', id: 't' }), { name: 'Room', x: 0, z: 0, width: 4, depth: 3 }).home;

describe('placement', () => {
  it('stands a sofa with its back flat against the north wall, facing into the room', () => {
    const h = room();
    const p = placeAgainstWall(h, { wall: 'wall-1', size: [2.1, 0.85, 0.92], gap: 0 });
    expect(p.rotation).toBe(0);
    expect(p.position[2]).toBeCloseTo(0.46, 6);
    const placed = addItem(h, { catalog: 'sofa-3', position: p.position, rotation: p.rotation }).home;
    expect(validateHome(placed).filter((i) => i.severity !== 'info')).toEqual([]);
  });

  it('turns items to face into the room on every wall', () => {
    const h = room();
    // wall-2 is the east wall: the item must face west (rotation 270)
    const east = placeAgainstWall(h, { wall: 'wall-2', size: [1, 2, 0.6], gap: 0 });
    expect(east.rotation).toBeCloseTo(270, 6);
    const fp = bounds(itemFootprint({ position: east.position, rotation: east.rotation, size: [1, 2, 0.6] }));
    expect(fp.max[0]).toBeCloseTo(4, 6); // back touches the wall face at x = 4
  });

  it('refuses positions that run off the wall', () => {
    expect(() => placeAgainstWall(room(), { wall: 'wall-1', size: [2, 1, 1], along: 0.5 })).toThrow(/past its ends/);
  });

  it('finds the centre of a room', () => {
    expect(roomCentre(room(), 'room-1')).toEqual([2, 1.5]);
  });
});

describe('plan svg', () => {
  it('draws walls, rooms, dimensions and furniture', () => {
    const { svg, width, height } = renderPlanSvg(sampleFlat(), { width: 800 });
    expect(width).toBe(800);
    expect(height).toBeGreaterThan(500);
    expect(svg).toContain('Living room');
    expect(svg).toContain('5.00 m');
    expect(svg.match(/<polygon/g)!.length).toBeGreaterThan(40);
  });
});
