// Making edits from the editor. An edit in progress (a drag) is worked out locally with the
// same core rules the studio uses, and shown at once; when it is finished it is sent to the
// studio, which applies it for real and tells every client. A refused edit is shown with
// the studio's reason and the preview is dropped.
import { applyOperation, isEditError, type EditError, type Operation } from '@fullscale/core';
import { studio, type EditOptions } from './connection.ts';
import { getState, say, setState } from './store.ts';

/** Show what an edit would do. Returns the reason it would be refused, if it would be. */
export function preview(operation: Operation): EditError | null {
  const home = getState().home;
  if (!home) return null;
  try {
    setState({ preview: applyOperation(home, operation).home });
    return null;
  } catch (err) {
    if (!isEditError(err)) throw err;
    setState({ preview: null });
    return err;
  }
}

export function cancelPreview(): void {
  if (getState().preview) setState({ preview: null });
}

/** Send an edit to the studio. The preview stays until the studio's change arrives. */
export async function commit(operation: Operation, opts: EditOptions = {}): Promise<boolean> {
  const answer = await studio.edit(operation, opts);
  if (!answer.ok) cancelPreview();
  return answer.ok;
}

export async function undo(): Promise<void> {
  const answer = await studio.undo();
  if (answer.ok) say('info', answer.notes[0] ?? 'Undone');
}

export async function redo(): Promise<void> {
  const answer = await studio.redo();
  if (answer.ok) say('info', answer.notes[0] ?? 'Redone');
}

export function openVersion(id: string): void {
  setState({ selection: [], preview: null });
  studio.openVersion(id);
}

/** Start a design: a copy of what's open, to try changes on without touching the real home. */
export function newDesign(): void {
  const name = window.prompt('Name the new design (a copy of what’s open now):', 'New design');
  if (name?.trim()) {
    setState({ selection: [], preview: null });
    studio.newVersion(name.trim());
  }
}

export function select(ids: string[]): void {
  setState({ selection: ids, highlight: null });
  studio.select(ids);
}

export async function removeSelection(): Promise<void> {
  const ids = getState().selection;
  if (!ids.length) return;
  if (await commit({ op: 'remove', ids }, { label: `Delete ${ids.length === 1 ? ids[0] : `${ids.length} things`}` })) select([]);
}
