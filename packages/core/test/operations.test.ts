import { describe, expect, it } from 'vitest';
import { applyOperation, BaseOperationSchema, createHome, isEditError, roomInfo } from '../src/index.ts';

describe('operations', () => {
  it('applies a batch as one edit and reports what it did', () => {
    const r = applyOperation(createHome({ name: 't', id: 't' }), {
      op: 'batch',
      label: 'bedroom',
      ops: [
        { op: 'addRectangularRoom', name: 'Bedroom', x: 0, z: 0, width: 3.5, depth: 3 },
        { op: 'addOpening', wall: 'wall-1', type: 'door', offset: 0.3 },
        { op: 'addItem', catalog: 'bed-double', position: [1.75, 1.2] },
        { op: 'paint', target: { room: 'room-1', surface: 'walls' }, color: '#d4c5b0' },
      ],
    });
    expect(roomInfo(r.home, 'room-1').area).toBeCloseTo(10.5, 6);
    expect(r.achieved.created).toEqual({ wall: 4, room: 1, opening: 1, item: 1, material: 1 });
  });

  it('lets later steps use ids made earlier in the batch', () => {
    const r = applyOperation(createHome({ name: 't' }), {
      op: 'batch',
      ops: [
        { op: 'addWall', id: 'hall', start: [0, 0], end: [5, 0] },
        { op: 'addOpening', wall: 'hall', type: 'door' },
      ],
    });
    expect(r.home.openings[0]!.wall).toBe('hall');
  });

  it('changes nothing when one step fails, and says which step', () => {
    const h = createHome({ name: 't', id: 't' });
    try {
      applyOperation(h, {
        op: 'batch',
        ops: [
          { op: 'addRectangularRoom', name: 'A', x: 0, z: 0, width: 3, depth: 3 },
          { op: 'addOpening', wall: 'no-such-wall', type: 'door' },
        ],
      });
      expect.unreachable();
    } catch (err) {
      expect(isEditError(err) && err.code).toBe('not_found');
      expect(isEditError(err) && err.details.opIndex).toBe(1);
      expect((err as Error).message).toMatch(/Step 2 \(addOpening\)/);
    }
    expect(h.walls).toHaveLength(0);
  });

  it('refuses malformed input and misspelt fields with a readable message', () => {
    const h = createHome({ name: 't', id: 't' });
    expect(() => applyOperation(h, { op: 'addWall', start: [0, 0] })).toThrow(/Bad operation at end/);
    expect(() => applyOperation(h, { op: 'addWall', start: [0, 0], end: [1, 0], thicknes: 0.2 })).toThrow(/Bad operation/);
    expect(() => applyOperation(h, { op: 'paint', target: { room: 'x', surface: 'floor' } })).toThrow();
  });

  it('tags edits with who made them', () => {
    const r = applyOperation(createHome({ name: 't' }), { op: 'addWall', start: [0, 0], end: [1, 0] }, { by: 'agent' });
    expect(r.home.walls[0]!.source).toEqual({ kind: 'agent' });
  });

  it('covers every command in the operation schema', () => {
    const names = BaseOperationSchema.options.map((o) => o.shape.op.value);
    expect(names).toContain('moveWallEnd');
    expect(names).toContain('clearHome');
    expect(new Set(names).size).toBe(names.length);
  });
});
