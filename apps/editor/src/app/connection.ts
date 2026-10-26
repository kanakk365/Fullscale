// The live connection to the studio. Edits are sent as operations and answered by number;
// every change by anyone arrives as a numbered patch and is applied to the editor's copy of
// the home. If a patch is missed, the editor asks for the whole home again.
import type { Operation } from '@fullscale/core';
import { HomeMirror, PROTOCOL_VERSION, SOCKET_PATH, type ServerMessage, type View } from '@fullscale/protocol';
import { getState, say, setState } from './store.ts';

type Answer = Extract<ServerMessage, { type: 'result' }>;

export interface EditOptions {
  label?: string;
  /** quick edits with the same key (arrow-key nudges) become one undo step */
  groupKey?: string;
}

/** Draws a 3D picture for an agent; set by the 3D module. */
let renderer: ((view: View, size: { width: number; height: number }) => Promise<string>) | null = null;

export function setRenderer(r: typeof renderer): void {
  renderer = r;
}

class Connection {
  private socket: WebSocket | null = null;
  private readonly mirror = new HomeMirror();
  private readonly waiting = new Map<string, (answer: Answer) => void>();
  private counter = 0;
  private retry = 0;
  private stopped = false;
  private token = '';

  start(token: string): void {
    this.token = token;
    this.stopped = false;
    this.open();
  }

  /** Send an edit. Resolves with the studio's answer; refusals resolve too, with ok false. */
  edit(operation: Operation, opts: EditOptions = {}): Promise<Answer> {
    return this.request({ type: 'ops', operation, ...(opts.label ? { label: opts.label } : {}), ...(opts.groupKey ? { groupKey: opts.groupKey } : {}) });
  }

  undo(): Promise<Answer> {
    return this.request({ type: 'undo' });
  }

  redo(): Promise<Answer> {
    return this.request({ type: 'redo' });
  }

  select(ids: string[]): void {
    this.send({ type: 'select', ids });
  }

  /** Open the real home ("real") or a design; the studio sends the home that's now open. */
  openVersion(id: string): void {
    this.send({ type: 'open_version', req: `v${++this.counter}`, id });
  }

  /** Copy what's open into a new design, and open it. */
  newVersion(name: string): void {
    this.send({ type: 'new_version', req: `v${++this.counter}`, name });
  }

  private request(message: Record<string, unknown>): Promise<Answer> {
    const req = `r${++this.counter}`;
    setState((s) => ({ pending: s.pending + 1 }));
    return new Promise((resolve) => {
      this.waiting.set(req, (answer) => {
        setState((s) => ({ pending: s.pending - 1 }));
        if (!answer.ok) say('error', answer.error.message);
        resolve(answer);
      });
      if (!this.send({ ...message, req })) {
        this.waiting.delete(req);
        setState((s) => ({ pending: s.pending - 1 }));
        const answer: Answer = { type: 'result', req, ok: false, error: { code: 'offline', message: 'Not connected to the studio.' } };
        say('error', answer.error.message);
        resolve(answer);
      }
    });
  }

  private send(message: Record<string, unknown>): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  private open(): void {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${SOCKET_PATH}`;
    const socket = new WebSocket(url);
    this.socket = socket;
    setState({ connection: 'connecting' });
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, client: 'editor', token: this.token, version: '0.1.0', capabilities: ['render'] }));
    };
    socket.onmessage = (event) => this.receive(JSON.parse(String(event.data)) as ServerMessage);
    socket.onclose = (event) => {
      for (const [req, resolve] of this.waiting) resolve({ type: 'result', req, ok: false, error: { code: 'offline', message: 'The connection to the studio closed.' } });
      this.waiting.clear();
      if (event.code === 4401) {
        setState({ connection: 'unauthorized' });
        return;
      }
      setState({ connection: 'closed' });
      if (this.stopped) return;
      // Back off, so a stopped studio isn't hammered: 0.5, 1, 2, 5, then every 10 s.
      const delay = [500, 1000, 2000, 5000][this.retry] ?? 10_000;
      this.retry++;
      setTimeout(() => this.open(), delay);
    };
  }

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case 'welcome':
      case 'snapshot': {
        this.retry = 0;
        this.mirror.receive(message);
        const home = this.mirror.home!;
        const level = getState().level;
        setState({
          connection: 'open',
          home,
          rev: message.rev,
          undo: message.undo,
          preview: null,
          level: level && home.levels.some((l) => l.id === level) ? level : home.levels[0]!.id,
          ...(message.type === 'welcome' ? { actor: message.actor } : {}),
        });
        if (message.type === 'welcome') this.send({ type: 'versions', req: `v${++this.counter}` });
        return;
      }
      case 'versions':
        setState({ versions: { open: message.open, list: message.versions } });
        if (message.error) say('error', message.error);
        return;
      case 'changed': {
        const outcome = this.mirror.receive(message);
        if (outcome === 'resync') {
          this.send({ type: 'sync', req: `sync${++this.counter}` });
          return;
        }
        if (outcome !== 'updated') return;
        const home = this.mirror.home!;
        const gone = new Set(message.removed);
        setState((s) => ({
          home,
          rev: message.rev,
          undo: message.undo,
          // A change from someone else ends any preview based on the old home.
          preview: null,
          selection: s.selection.filter((id) => !gone.has(id)),
        }));
        if (message.actor !== getState().actor) say('info', `${message.actor}: ${message.label}`);
        return;
      }
      case 'result': {
        const resolve = this.waiting.get(message.req);
        this.waiting.delete(message.req);
        resolve?.(message);
        return;
      }
      case 'highlight':
        setState({ highlight: message.ids.length ? { actor: message.actor, ids: message.ids, ...(message.note ? { note: message.note } : {}) } : null, selection: message.ids });
        return;
      case 'selection':
        setState((s) => ({ othersSelection: [...s.othersSelection.filter((o) => o.actor !== message.actor), { actor: message.actor, ids: message.ids }] }));
        return;
      case 'render':
        void this.render(message);
        return;
      case 'error':
        if (message.code === 'unauthorized') setState({ connection: 'unauthorized' });
        say('error', message.message);
        return;
    }
  }

  private async render(message: Extract<ServerMessage, { type: 'render' }>): Promise<void> {
    try {
      if (!renderer) throw new Error('The 3D view is not ready.');
      const png = await renderer(message.view, { width: message.width, height: message.height });
      this.send({ type: 'render_reply', req: message.req, ok: true, png });
    } catch (err) {
      this.send({ type: 'render_reply', req: message.req, ok: false, error: (err as Error).message });
    }
  }
}

export const studio = new Connection();
