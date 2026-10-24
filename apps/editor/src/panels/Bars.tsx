// The bars around the views: the top bar (home, level, view, undo), the tool bar on the
// left, the status bar at the bottom, and passing messages.
import { CATALOG, type SnapMode } from '@fullscale/core';
import { useEffect } from 'react';
import { redo, undo } from '../app/actions.ts';
import { setState, useEditor, type EditorState, type ToolKind } from '../app/store.ts';

export function TopBar() {
  const home = useEditor((s) => s.home);
  const level = useEditor((s) => s.level);
  const view = useEditor((s) => s.view);
  const undoState = useEditor((s) => s.undo);
  if (!home) return <header className="topbar" />;
  return (
    <header className="topbar">
      <span className="brand">Fullscale</span>
      <span className="home-name">{home.name}</span>
      {home.levels.length > 1 && (
        <select value={level ?? ''} onChange={(e) => setState({ level: e.target.value, selection: [] })}>
          {home.levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      )}
      <span className="spacer" />
      <div className="segmented">
        {(['plan', 'split', '3d'] as const).map((v) => (
          <button type="button" key={v} className={view === v ? 'on' : ''} onClick={() => setState({ view: v })}>
            {v === 'plan' ? 'Plan' : v === '3d' ? '3D' : 'Both'}
          </button>
        ))}
      </div>
      <button type="button" title="Undo (⌘Z)" disabled={!undoState.canUndo} onClick={() => void undo()}>
        ↶ Undo
      </button>
      <button type="button" title="Redo (⇧⌘Z)" disabled={!undoState.canRedo} onClick={() => void redo()}>
        ↷ Redo
      </button>
    </header>
  );
}

const TOOLS: Array<{ kind: ToolKind; label: string; key: string; icon: string }> = [
  { kind: 'select', label: 'Select and move', key: 'V', icon: '↖' },
  { kind: 'wall', label: 'Draw walls', key: 'W', icon: '▭' },
  { kind: 'room', label: 'Draw a room', key: 'B', icon: '▣' },
  { kind: 'door', label: 'Add a door', key: 'D', icon: '◜' },
  { kind: 'window', label: 'Add a window', key: 'N', icon: '▤' },
  { kind: 'opening', label: 'Add an opening', key: 'O', icon: '⊓' },
  { kind: 'item', label: 'Add furniture', key: 'F', icon: '⌂' },
  { kind: 'measure', label: 'Measure', key: 'M', icon: '↔' },
];

export function ToolBar() {
  const tool = useEditor((s) => s.tool);
  return (
    <nav className="toolbar">
      {TOOLS.map((t) => (
        <button type="button" key={t.kind} className={tool === t.kind ? 'on' : ''} title={`${t.label} (${t.key})`} onClick={() => setState({ tool: t.kind, preview: null })}>
          <span className="icon">{t.icon}</span>
        </button>
      ))}
    </nav>
  );
}

export function Catalog() {
  const tool = useEditor((s) => s.tool);
  const catalog = useEditor((s) => s.catalog);
  if (tool !== 'item') return null;
  const groups = [...new Set(CATALOG.map((c) => c.category))];
  return (
    <section className="panel catalog">
      <h2>Furniture</h2>
      <p className="hint">Typical sizes. Click on the plan to place; set the real size after.</p>
      {groups.map((g) => (
        <div key={g}>
          <h3>{g}</h3>
          <div className="catalog-grid">
            {CATALOG.filter((c) => c.category === g).map((c) => (
              <button type="button" key={c.id} className={catalog === c.id ? 'on' : ''} onClick={() => setState({ catalog: c.id })}>
                {c.name}
                <small>{c.size.map((v) => Math.round(v * 100)).join('×')} cm</small>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

const SNAP_LABELS: Readonly<Record<SnapMode, string>> = { lines: 'Snap: walls', grid: 'Snap: grid', angles: 'Snap: angles', off: 'Snap: off' };
const NEXT_SNAP: Readonly<Record<SnapMode, SnapMode>> = { lines: 'grid', grid: 'angles', angles: 'off', off: 'lines' };
const GRIDS = [0.05, 0.1, 0.25, 0.5, 1];

const CONNECTION: Readonly<Record<EditorState['connection'], string>> = {
  'no-token': 'not connected',
  connecting: 'connecting…',
  open: 'live',
  closed: 'reconnecting…',
  unauthorized: 'wrong token',
};

export function StatusBar() {
  const connection = useEditor((s) => s.connection);
  const rev = useEditor((s) => s.rev);
  const pending = useEditor((s) => s.pending);
  const cursor = useEditor((s) => s.cursor);
  const snap = useEditor((s) => s.snap);
  const grid = useEditor((s) => s.grid);
  return (
    <footer className="statusbar">
      <span className={`dot ${connection}`} />
      <span>
        {CONNECTION[connection]}
        {connection === 'open' && ` · revision ${rev}`}
        {pending > 0 && ' · saving…'}
      </span>
      <span className="spacer" />
      {cursor && (
        <span className="coords">
          x {cursor[0].toFixed(2)} · z {cursor[1].toFixed(2)} m
        </span>
      )}
      <button type="button" className="chip" title="How drawing snaps (click to change; hold Alt to place freely)" onClick={() => setState({ snap: NEXT_SNAP[snap] })}>
        {SNAP_LABELS[snap]}
      </button>
      <select value={grid} title="Grid step" onChange={(e) => setState({ grid: Number(e.target.value) })}>
        {GRIDS.map((g) => (
          <option key={g} value={g}>
            grid {g < 1 ? `${Math.round(g * 100)} cm` : `${g} m`}
          </option>
        ))}
      </select>
    </footer>
  );
}

export function Toast() {
  const message = useEditor((s) => s.message);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setState((s) => (s.message === message ? { message: null } : {})), message.kind === 'error' ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [message]);
  if (!message) return null;
  return <div className={`toast ${message.kind}`}>{message.text}</div>;
}
