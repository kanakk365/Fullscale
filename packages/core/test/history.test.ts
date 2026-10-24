import { describe, expect, it } from 'vitest';
import {
  addItem,
  addOpening,
  addRectangularRoom,
  addWall,
  applyPatch,
  createHome,
  deepEqual,
  diffHomes,
  History,
  invertPatch,
  paint,
  remove,
  updateItem,
  updateWall,
  type EditResult,
  type Home,
} from '../src/index.ts';

const flat = () => addRectangularRoom(createHome({ name: 't', id: 't' }), { name: 'Room', x: 0, z: 0, width: 4, depth: 3 }).home;

/** A tiny stand-in for the studio server: applies edits and records them per actor. */
function session(start: Home, now: () => number = Date.now) {
  const history = new History({ now });
  let home = start;
  let rev = 0;
  return {
    get home() {
      return home;
    },
    history,
    apply(actor: string, label: string, result: EditResult, groupKey?: string) {
      history.record({ patch: result.patch, actor, label, rev: ++rev, groupKey });
      home = result.home;
    },
    undo(actor: string) {
      const r = history.undo(home, actor);
      if (r.ok) home = r.home;
      return r;
    },
    redo(actor: string) {
      const r = history.redo(home, actor);
      if (r.ok) home = r.home;
      return r;
    },
  };
}

describe('field-level patches', () => {
  it('records only the fields that changed', () => {
    const a = flat();
    const b = paint(a, { target: { wall: 'wall-1', face: 'left' }, color: '#123456' }).home;
    const update = diffHomes(a, b).entries.find((e) => e.id === 'wall-1');
    expect(update?.op).toBe('update');
    expect(update?.op === 'update' && Object.keys(update.fields)).toEqual(['materials.left']);
  });
});

describe('per-actor undo', () => {
  it('undoes the person without losing the agent’s later edits', () => {
    const s = session(flat());
    s.apply('person', 'paint floor', paint(s.home, { target: { room: 'room-1', surface: 'floor' }, color: '#333333' }));
    s.apply('agent', 'add sofa', addItem(s.home, { catalog: 'sofa-3', position: [2, 1] }, { by: 'agent' }));

    expect(s.undo('person').ok).toBe(true);
    expect(s.home.rooms[0]!.floorMaterial).toBe('oak-floor');
    expect(s.home.items).toHaveLength(1); // the agent's sofa survives

    expect(s.redo('person').ok).toBe(true);
    expect(s.home.rooms[0]!.floorMaterial).not.toBe('oak-floor');
  });

  it('keeps another actor’s change to a different field of the same element', () => {
    const s = session(addItem(flat(), { catalog: 'sofa-3', position: [2, 1] }).home);
    s.apply('person', 'move sofa', updateItem(s.home, { id: 'sofa-3-1', position: [2, 2] }));
    s.apply('agent', 'turn sofa', updateItem(s.home, { id: 'sofa-3-1', rotation: 90 }, { by: 'agent' }));
    expect(s.undo('person').ok).toBe(true);
    expect(s.home.items[0]!.position).toEqual([2, 0, 1]);
    expect(s.home.items[0]!.rotation).toBe(90);
  });

  it('refuses an undo when the same field changed since, naming it', () => {
    const s = session(addItem(flat(), { catalog: 'sofa-3', position: [2, 1] }).home);
    s.apply('person', 'move sofa', updateItem(s.home, { id: 'sofa-3-1', position: [2, 2] }));
    s.apply('agent', 'move sofa again', updateItem(s.home, { id: 'sofa-3-1', position: [3, 2] }, { by: 'agent' }));
    const r = s.undo('person');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.conflicts).toContainEqual({ id: 'sofa-3-1', field: 'position', reason: 'changed_since' });
      expect(r.message).toMatch(/sofa-3-1\.position/);
    }
  });

  it('allows the undo when the other actor wrote the same value back', () => {
    const s = session(addItem(flat(), { catalog: 'sofa-3', position: [2, 1] }).home);
    s.apply('person', 'move sofa', updateItem(s.home, { id: 'sofa-3-1', position: [2, 2] }));
    s.apply('agent', 'move sofa back', updateItem(s.home, { id: 'sofa-3-1', position: [2, 1] }, { by: 'agent' }));
    expect(s.undo('person').ok).toBe(true);
  });

  it('refuses to undo creating a wall that now has the agent’s door on it', () => {
    const s = session(createHome({ name: 't' }));
    s.apply('person', 'draw wall', addWall(s.home, { start: [0, 0], end: [4, 0] }));
    s.apply('agent', 'add door', addOpening(s.home, { wall: 'wall-1', type: 'door' }, { by: 'agent' }));
    const r = s.undo('person');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflicts).toContainEqual({ id: 'wall-1', reason: 'in_use' });
  });

  it('restores a removed wall and its openings in place', () => {
    const start = addOpening(flat(), { wall: 'wall-2', type: 'door' }).home;
    const s = session(start);
    s.apply('person', 'remove wall', remove(s.home, { ids: ['wall-2'] }));
    expect(s.undo('person').ok).toBe(true);
    expect(s.home.walls.map((w) => w.id)).toEqual(start.walls.map((w) => w.id));
    expect(s.home.openings).toEqual(start.openings);
  });

  it('merges quick nudges into one undo step', () => {
    let t = 0;
    const s = session(addItem(flat(), { catalog: 'plant', position: [1, 1] }).home, () => t);
    for (let i = 1; i <= 5; i++) {
      t += 200;
      s.apply('person', 'nudge', updateItem(s.home, { id: 'plant-1', position: [1 + i * 0.1, 1] }), 'nudge:plant-1');
    }
    expect(s.history.list()).toHaveLength(1);
    expect(s.undo('person').ok).toBe(true);
    expect(s.home.items[0]!.position).toEqual([1, 0, 1]);
  });

  it('starts a new step after a pause', () => {
    let t = 0;
    const s = session(addItem(flat(), { catalog: 'plant', position: [1, 1] }).home, () => t);
    s.apply('person', 'nudge', updateItem(s.home, { id: 'plant-1', position: [1.1, 1] }), 'nudge:plant-1');
    t += 5000;
    s.apply('person', 'nudge', updateItem(s.home, { id: 'plant-1', position: [1.2, 1] }), 'nudge:plant-1');
    expect(s.history.list()).toHaveLength(2);
  });

  it('says plainly when there is nothing to undo', () => {
    const r = session(flat()).undo('person');
    expect(r.ok === false && r.reason).toBe('nothing');
  });

  it('undoes a field reset back to its value', () => {
    const s = session(updateWall(flat(), { id: 'wall-1', height: 2.4 }).home);
    s.apply('person', 'follow level', updateWall(s.home, { id: 'wall-1', height: null }));
    expect(s.home.walls[0]!.height).toBeUndefined();
    expect(s.undo('person').ok).toBe(true);
    expect(s.home.walls[0]!.height).toBe(2.4);
  });
});

describe('inverted patches', () => {
  it('turn a home back when played forwards', () => {
    const start = addRectangularRoom(createHome({ name: 't' }), { name: 'R', x: 0, z: 0, width: 3, depth: 3 }).home;
    const r = paint(start, { target: { room: 'room-1', surface: 'walls' }, color: '#123456' });
    const back = applyPatch(r.home, invertPatch(r.patch), 'redo');
    expect(deepEqual({ ...back, updatedAt: '' }, { ...start, updatedAt: '', nextIds: back.nextIds })).toBe(true);
  });
});
