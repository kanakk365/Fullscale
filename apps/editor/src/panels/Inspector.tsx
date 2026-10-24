// The selected element's details, editable. Every size shows where it came from (scan,
// you, an estimate…). Edits go to the studio like any other, so the same rules apply.
import {
  catalogEntry,
  checkItemFit,
  locate,
  polygonArea,
  roomInfo,
  sourceOf,
  wallHeight,
  wallInfo,
  wallLength,
  type BaseOperation,
  type Home,
  type Item,
  type Opening,
  type Room,
  type Wall,
} from '@fullscale/core';
import { useState, type ReactNode } from 'react';
import { commit, removeSelection, select } from '../app/actions.ts';
import { shownHome, useEditor } from '../app/store.ts';
import { ColorInput } from '../ui/ColorInput.tsx';
import { LengthInput } from '../ui/LengthInput.tsx';
import { NumberInput } from '../ui/NumberInput.tsx';
import { SourceBadge } from '../ui/SourceBadge.tsx';

const edit = (op: BaseOperation, label?: string) => void commit(op, label ? { label } : {});
const m2 = (v: number) => `${v.toFixed(2)} m²`;

function Row({ label, children, source }: { label: string; children: ReactNode; source?: ReactNode }) {
  return (
    <div className="row">
      <div className="label">
        {label}
        {source}
      </div>
      <div className="value">{children}</div>
    </div>
  );
}

const colourOf = (home: Home, material: string | undefined, fallback: string) => home.materials.find((m) => m.id === material)?.color ?? fallback;

export function Inspector() {
  const home = useEditor(shownHome);
  const selection = useEditor((s) => s.selection);
  if (!home) return null;
  if (selection.length > 1) {
    return (
      <section className="panel">
        <h2>{selection.length} selected</h2>
        <button type="button" className="danger" onClick={() => void removeSelection()}>
          Delete them
        </button>
      </section>
    );
  }
  const found = selection[0] ? locate(home, selection[0]) : undefined;
  if (!found) return <HomePanel home={home} />;
  switch (found.info.kind) {
    case 'wall':
      return <WallPanel home={home} wall={found.element as unknown as Wall} />;
    case 'opening':
      return <OpeningPanel home={home} opening={found.element as unknown as Opening} />;
    case 'room':
      return <RoomPanel home={home} room={found.element as unknown as Room} />;
    case 'item':
      return <ItemPanel home={home} item={found.element as unknown as Item} />;
    default:
      return <HomePanel home={home} />;
  }
}

function HomePanel({ home }: { home: Home }) {
  const level = useEditor((s) => s.level);
  const rooms = home.rooms.filter((r) => r.level === level);
  const current = home.levels.find((l) => l.id === level);
  return (
    <section className="panel">
      <h2>
        <input
          className="title-input"
          defaultValue={home.name}
          key={home.name}
          onBlur={(e) => e.target.value.trim() && e.target.value !== home.name && edit({ op: 'renameHome', name: e.target.value.trim() })}
        />
      </h2>
      {current && (
        <Row label="Storey height" source={<SourceBadge source={sourceOf(current, 'height')} />}>
          <LengthInput value={current.height} onCommit={(v) => v && edit({ op: 'updateLevel', id: current.id, height: v })} />
        </Row>
      )}
      <h3>Rooms on this level</h3>
      {rooms.length ? (
        <ul className="list">
          {rooms.map((r) => (
            <li key={r.id}>
              <button type="button" className="link" onClick={() => select([r.id])}>
                {r.name}
              </button>
              <span>{m2(polygonArea(r.polygon))}</span>
            </li>
          ))}
          <li className="total">
            <span>Total</span>
            <span>{m2(rooms.reduce((s, r) => s + polygonArea(r.polygon), 0))}</span>
          </li>
        </ul>
      ) : (
        <p className="hint">No rooms yet. Draw walls (W) or a room (B); closed areas become rooms.</p>
      )}
      <p className="hint">Select something to change it. Agents can work on this home too: run "fullscale mcp" as an MCP server.</p>
    </section>
  );
}

function WallPanel({ home, wall }: { home: Home; wall: Wall }) {
  const info = wallInfo(home, wall.id);
  const [keep, setKeep] = useState<'start' | 'end'>('start');
  return (
    <section className="panel">
      <h2>Wall {wall.id}</h2>
      <Row label="Length" source={<SourceBadge source={sourceOf(wall, 'end')} />}>
        <LengthInput value={wallLength(wall)} onCommit={(v) => v && edit({ op: 'setWallLength', id: wall.id, length: v, keep })} />
        <select value={keep} onChange={(e) => setKeep(e.target.value as 'start' | 'end')} title="Which end stays put">
          <option value="start">keep start</option>
          <option value="end">keep end</option>
        </select>
      </Row>
      <Row label="Thickness" source={<SourceBadge source={sourceOf(wall, 'thickness')} />}>
        <LengthInput value={wall.thickness} onCommit={(v) => v && edit({ op: 'updateWall', id: wall.id, thickness: v })} />
      </Row>
      <Row label="Height" source={<SourceBadge source={sourceOf(wall, 'height')} follows={wall.height === undefined} />}>
        <LengthInput value={wall.height} emptyMeans={`${wallHeight(home, wall).toFixed(2)} (level)`} onCommit={(v) => edit({ op: 'updateWall', id: wall.id, height: v })} />
      </Row>
      <Row label="Drawn along">
        <select value={wall.line} onChange={(e) => edit({ op: 'updateWall', id: wall.id, line: e.target.value as Wall['line'] })}>
          <option value="center">its centre</option>
          <option value="left">its left face</option>
          <option value="right">its right face</option>
        </select>
      </Row>
      <Row label="Faces">
        <ColorInput title="Left face" value={colourOf(home, wall.materials.left, '#f1ede4')} onCommit={(color) => edit({ op: 'paint', target: { wall: wall.id, face: 'left' }, color })} />
        <ColorInput title="Right face" value={colourOf(home, wall.materials.right, '#f1ede4')} onCommit={(color) => edit({ op: 'paint', target: { wall: wall.id, face: 'right' }, color })} />
      </Row>
      <p className="hint">Paint area of one face {info.faceArea.toFixed(2)} m². Drag the wall to move it, or its round ends to reshape; rooms follow their walls.</p>
      <button type="button" className="danger" onClick={() => void removeSelection()}>
        Delete wall
      </button>
    </section>
  );
}

function OpeningPanel({ home, opening }: { home: Home; opening: Opening }) {
  const wall = home.walls.find((w) => w.id === opening.wall)!;
  const update = (patch: Omit<Extract<BaseOperation, { op: 'updateOpening' }>, 'op' | 'id'>) => edit({ op: 'updateOpening', id: opening.id, ...patch });
  return (
    <section className="panel">
      <h2>
        {opening.type === 'door' ? 'Door' : opening.type === 'window' ? 'Window' : 'Opening'} {opening.id}
      </h2>
      <Row label="Width" source={<SourceBadge source={sourceOf(opening, 'width')} />}>
        <LengthInput value={opening.width} onCommit={(v) => v && update({ width: v })} />
      </Row>
      <Row label="Height" source={<SourceBadge source={sourceOf(opening, 'height')} />}>
        <LengthInput value={opening.height} onCommit={(v) => v && update({ height: v })} />
      </Row>
      {opening.type !== 'door' && (
        <Row label="Sill" source={<SourceBadge source={sourceOf(opening, 'sill')} />}>
          <LengthInput value={opening.sill} onCommit={(v) => v !== null && update({ sill: v })} />
        </Row>
      )}
      <Row label="From wall start" source={<SourceBadge source={sourceOf(opening, 'offset')} />}>
        <LengthInput value={opening.offset} onCommit={(v) => v !== null && update({ offset: v })} />
      </Row>
      {opening.type === 'door' && (
        <Row label="Opens">
          <button type="button" onClick={() => update({ hinge: opening.hinge === 'end' ? 'start' : 'end' })}>
            Swap hinge side
          </button>
          <button type="button" onClick={() => update({ swing: opening.swing === 'right' ? 'left' : 'right' })}>
            Swing the other way
          </button>
        </Row>
      )}
      <p className="hint">
        In wall {wall.id}, {wallLength(wall).toFixed(2)} m long. Drag it along the wall, or onto another wall.
      </p>
      <button type="button" className="danger" onClick={() => void removeSelection()}>
        Delete
      </button>
    </section>
  );
}

function RoomPanel({ home, room }: { home: Home; room: Room }) {
  const info = roomInfo(home, room.id);
  return (
    <section className="panel">
      <h2>
        <input
          className="title-input"
          defaultValue={room.name}
          key={room.name}
          onBlur={(e) => e.target.value.trim() && e.target.value !== room.name && edit({ op: 'updateRoom', id: room.id, name: e.target.value.trim() })}
        />
      </h2>
      <Row label="Area" source={<SourceBadge source={sourceOf(room, 'polygon')} />}>
        {m2(info.area)} · {info.width.toFixed(2)} × {info.depth.toFixed(2)} m
      </Row>
      <Row label="Ceiling" source={<SourceBadge source={sourceOf(room, 'ceilingHeight')} follows={room.ceilingHeight === undefined} />}>
        <LengthInput value={room.ceilingHeight} emptyMeans={`${info.ceilingHeight.toFixed(2)} (level)`} onCommit={(v) => edit({ op: 'updateRoom', id: room.id, ceilingHeight: v })} />
      </Row>
      <Row label="Floor">
        <ColorInput value={colourOf(home, room.floorMaterial, '#b08a5e')} onCommit={(color) => edit({ op: 'paint', target: { room: room.id, surface: 'floor' }, color })} />
      </Row>
      <Row label="Walls">
        <ColorInput
          value={colourOf(home, home.walls.find((w) => info.walls.some((f) => f.wall === w.id))?.materials.left, '#f1ede4')}
          onCommit={(color) => edit({ op: 'paint', target: { room: room.id, surface: 'walls' }, color }, `Paint ${room.name}`)}
        />
        <span className="hint">{info.paintableWallArea.toFixed(1)} m² to paint</span>
      </Row>
      <button type="button" className="danger" onClick={() => void removeSelection()}>
        Delete room (keeps walls)
      </button>
    </section>
  );
}

function ItemPanel({ home, item }: { home: Home; item: Item }) {
  const entry = catalogEntry(item.catalog);
  const [fit, setFit] = useState<string | null>(null);
  const update = (patch: Omit<Extract<BaseOperation, { op: 'updateItem' }>, 'op' | 'id'>) => edit({ op: 'updateItem', id: item.id, ...patch });
  const setSize = (i: 0 | 1 | 2, v: number) => {
    const size: [number, number, number] = [...item.size];
    size[i] = v;
    update({ size });
  };
  const part = entry.parts[0]!;
  return (
    <section className="panel">
      <h2>
        <input className="title-input" defaultValue={item.name} key={item.name} onBlur={(e) => e.target.value.trim() && e.target.value !== item.name && update({ name: e.target.value.trim() })} />
      </h2>
      <Row label="Size" source={<SourceBadge source={sourceOf(item, 'size')} />}>
        <span className="size-inputs">
          <LengthInput title="Width" value={item.size[0]} onCommit={(v) => v && setSize(0, v)} />
          <LengthInput title="Height" value={item.size[1]} onCommit={(v) => v && setSize(1, v)} />
          <LengthInput title="Depth" value={item.size[2]} onCommit={(v) => v && setSize(2, v)} />
        </span>
      </Row>
      <Row label="Position" source={<SourceBadge source={sourceOf(item, 'position')} />}>
        <span className="size-inputs">
          <LengthInput allowNegative title="x" value={item.position[0]} onCommit={(v) => v !== null && update({ position: [v, item.position[1], item.position[2]] })} />
          <LengthInput allowNegative title="z" value={item.position[2]} onCommit={(v) => v !== null && update({ position: [item.position[0], item.position[1], v] })} />
        </span>
      </Row>
      <Row label="Above floor">
        <LengthInput allowNegative value={item.position[1]} onCommit={(v) => v !== null && update({ position: [item.position[0], v, item.position[2]] })} />
      </Row>
      <Row label="Turned">
        <NumberInput value={item.rotation} step={15} suffix="°" onCommit={(v) => update({ rotation: ((v % 360) + 360) % 360 })} />
      </Row>
      <Row label="Colour">
        <ColorInput value={colourOf(home, item.materials[part], entry.colors[part] ?? '#bdbdbd')} onCommit={(color) => edit({ op: 'paint', target: { item: item.id, part }, color })} />
      </Row>
      <Row label="Locked">
        <input type="checkbox" checked={item.locked} onChange={(e) => update({ locked: e.target.checked })} />
      </Row>
      {item.model && <p className="hint">Your model: {item.model.file} (stays on this computer)</p>}
      <div className="buttons">
        <button
          type="button"
          onClick={() => {
            const r = checkItemFit(home, item.id);
            setFit(r.fits ? `Fits where it stands (${r.status}). Not checked: ${r.notChecked.join('; ')}.` : r.problems.map((p) => p.message).join(' '));
          }}
        >
          Check fit
        </button>
        <button type="button" className="danger" onClick={() => void removeSelection()}>
          Delete
        </button>
      </div>
      {fit && <p className="hint">{fit}</p>}
    </section>
  );
}
