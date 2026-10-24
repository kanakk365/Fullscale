import { describe, expect, it } from 'vitest';
import { addWall, applyOperation, createHome, sourceOf, updateWall, wallInfo } from '../src/index.ts';

/** A wall as a phone scan would record it: position measured ±1 cm, thickness guessed. */
function scanned() {
  return addWall(
    createHome({ name: 't' }),
    {
      start: [0, 0],
      end: [4, 0],
      line: 'right',
      thickness: 0.15,
      source: { kind: 'scan', uncertainty: 0.01, ref: 'roomplan:A1' },
      sources: { thickness: { kind: 'estimate', uncertainty: 0.03 } },
    },
    { by: 'scan' },
  ).home;
}

describe('where each dimension came from', () => {
  it('keeps the source per field', () => {
    const wall = scanned().walls[0]!;
    expect(sourceOf(wall, 'start')).toEqual({ kind: 'scan', uncertainty: 0.01, ref: 'roomplan:A1' });
    expect(sourceOf(wall, 'thickness')).toEqual({ kind: 'estimate', uncertainty: 0.03 });
    expect(wallInfo(scanned(), 'wall-1').sources).toEqual({
      start: 'scan ±1 cm',
      end: 'scan ±1 cm',
      thickness: 'estimate ±3 cm',
      height: 'follows level',
    });
  });

  it('gives an edited dimension the editor as its source, leaving the others alone', () => {
    const h = updateWall(scanned(), { id: 'wall-1', end: [4.2, 0] }, { by: 'user' }).home;
    const wall = h.walls[0]!;
    expect(sourceOf(wall, 'end')).toEqual({ kind: 'user' });
    expect(sourceOf(wall, 'start')).toEqual({ kind: 'scan', uncertainty: 0.01, ref: 'roomplan:A1' });
    expect(sourceOf(wall, 'thickness')).toEqual({ kind: 'estimate', uncertainty: 0.03 });
  });

  it('records an agent’s change as the agent’s', () => {
    const h = applyOperation(scanned(), { op: 'updateWall', id: 'wall-1', thickness: 0.2 }, { by: 'agent' }).home;
    expect(sourceOf(h.walls[0]!, 'thickness')).toEqual({ kind: 'agent' });
  });

  it('keeps a source the edit gave explicitly, e.g. a tape measurement', () => {
    const h = updateWall(scanned(), { id: 'wall-1', thickness: 0.14, sources: { thickness: { kind: 'user', uncertainty: 0.002, note: 'tape' } } }).home;
    expect(sourceOf(h.walls[0]!, 'thickness')).toEqual({ kind: 'user', uncertainty: 0.002, note: 'tape' });
  });

  it('drops a field’s own source when it goes back to following its level', () => {
    let h = updateWall(scanned(), { id: 'wall-1', height: 2.5 }).home;
    expect(h.walls[0]!.sources?.height).toEqual({ kind: 'user' });
    h = updateWall(h, { id: 'wall-1', height: null }).home;
    expect(h.walls[0]!.sources?.height).toBeUndefined();
  });

  it('adds nothing when the editor is already the source', () => {
    const h = addWall(createHome({ name: 't' }), { start: [0, 0], end: [3, 0] }).home;
    expect(updateWall(h, { id: 'wall-1', end: [3.5, 0] }).home.walls[0]!.sources).toBeUndefined();
  });
});
