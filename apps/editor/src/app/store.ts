// The editor's state, in one small store that React reads through useSyncExternalStore.
// The home itself is never edited here: edits go to the studio, and the home changes when
// the studio says it has. While a drag is in progress, `preview` shows the result of the
// edit worked out locally with the same core rules, so the screen follows the pointer.
import { useSyncExternalStore } from 'react';
import type { Home, SnapMode } from '@fullscale/core';
import type { UndoState } from '@fullscale/protocol';

export type ToolKind = 'select' | 'wall' | 'room' | 'door' | 'window' | 'opening' | 'item' | 'measure';

export interface EditorState {
  connection: 'no-token' | 'connecting' | 'open' | 'closed' | 'unauthorized';
  home: Home | null;
  rev: number;
  actor: string;
  undo: UndoState;
  level: string | null;
  tool: ToolKind;
  /** the catalogue entry the furniture tool places */
  catalog: string;
  selection: string[];
  hover: string | null;
  /** the home as an edit in progress would leave it */
  preview: Home | null;
  snap: SnapMode;
  /** grid step in metres */
  grid: number;
  view: 'plan' | '3d' | 'split';
  /** elements an agent pointed out */
  highlight: { actor: string; ids: string[]; note?: string } | null;
  /** what another actor (usually an agent) has selected */
  othersSelection: Array<{ actor: string; ids: string[] }>;
  message: { kind: 'error' | 'info'; text: string; at: number } | null;
  /** edits sent and not yet answered */
  pending: number;
  /** the pointer on the plan, in metres */
  cursor: [number, number] | null;
}

const initial: EditorState = {
  connection: 'connecting',
  home: null,
  rev: -1,
  actor: 'person',
  undo: { canUndo: false, canRedo: false },
  level: null,
  tool: 'select',
  catalog: 'sofa-3',
  selection: [],
  hover: null,
  preview: null,
  snap: 'lines',
  grid: 0.1,
  view: 'plan',
  highlight: null,
  othersSelection: [],
  message: null,
  pending: 0,
  cursor: null,
};

type Listener = () => void;

let state = initial;
const listeners = new Set<Listener>();

export function getState(): EditorState {
  return state;
}

export function setState(patch: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)): void {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Read part of the state; the component re-renders when that part changes. */
export function useEditor<T>(select: (s: EditorState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

/** The home as it should be drawn: the edit in progress, or the studio's home. */
export function shownHome(s: EditorState): Home | null {
  return s.preview ?? s.home;
}

export function say(kind: 'error' | 'info', text: string): void {
  setState({ message: { kind, text, at: Date.now() } });
}
