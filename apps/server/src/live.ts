// Live clients: the editor in a browser and the Blender add-on, over one WebSocket each.
// A client says hello with the studio token, gets the whole home, then sends edits and
// receives every change by anyone as a numbered patch. Clients that can draw 3D pictures
// do so for agents on request.
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { isEditError } from '@fullscale/core';
import { parseClientMessage, PROTOCOL_VERSION, type ClientMessage, type Hello, type ServerMessage, type View } from '@fullscale/protocol';
import { WebSocketServer, type WebSocket } from 'ws';
import { sameToken } from './access.ts';
import type { Studio, StudioEvent } from './studio.ts';
import type { Versions } from './versions.ts';
import { NAME, VERSION } from './version.ts';

/** A client must say hello this soon after connecting. */
const HELLO_TIMEOUT_MS = 5000;
/** How long an agent waits for a 3D picture. */
const RENDER_TIMEOUT_MS = 20_000;
/** Big enough for a 3D picture coming back as PNG. */
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

interface Client {
  socket: WebSocket;
  hello: Hello;
  actor: string;
}

export interface LiveOptions {
  studio: Studio;
  /** the real home and its designs, for editors to switch between */
  versions?: Versions;
  token: string;
  /** called for messages a client got wrong, for the server log */
  log?: (message: string) => void;
}

export class LiveHub {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  private readonly clients = new Set<Client>();
  private readonly renders = new Map<string, { resolve: (png: Buffer) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly studio: Studio;
  private readonly versions: Versions | undefined;
  private readonly token: string;
  private readonly log: (message: string) => void;
  private readonly unsubscribe: () => void;

  constructor(opts: LiveOptions) {
    this.studio = opts.studio;
    this.versions = opts.versions;
    this.token = opts.token;
    this.log = opts.log ?? (() => undefined);
    const offStudio = this.studio.on((event) => this.broadcast(event));
    const offVersions = this.versions?.on(() => {
      for (const c of this.clients) if (c.hello.client === 'editor') this.sendVersions(c);
    });
    this.unsubscribe = () => {
      offStudio();
      offVersions?.();
    };
  }

  /** Take over an HTTP upgrade request (the caller has already checked Host and Origin). */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws));
  }

  /** How many clients of each kind are connected. */
  counts(): Record<Hello['client'], number> {
    const counts = { editor: 0, blender: 0, other: 0 };
    for (const c of this.clients) counts[c.hello.client]++;
    return counts;
  }

  /** Can any connected client draw 3D pictures? */
  canRender(): boolean {
    return [...this.clients].some((c) => c.hello.capabilities?.includes('render'));
  }

  /** Ask a connected editor to draw the home from a view. */
  render(view: View, size: { width: number; height: number }): Promise<Buffer> {
    const client = [...this.clients].find((c) => c.hello.capabilities?.includes('render'));
    if (!client) return Promise.reject(new Error('No editor is open to draw 3D views.'));
    const req = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.renders.delete(req);
        reject(new Error('The editor did not send the 3D view in time.'));
      }, RENDER_TIMEOUT_MS);
      this.renders.set(req, { resolve, reject, timer });
      send(client.socket, { type: 'render', req, view, ...size });
    });
  }

  close(): void {
    this.unsubscribe();
    for (const c of this.clients) c.socket.close(1001, 'The studio is shutting down');
    for (const [, r] of this.renders) {
      clearTimeout(r.timer);
      r.reject(new Error('The studio is shutting down.'));
    }
    this.wss.close();
  }

  private accept(socket: WebSocket): void {
    let client: Client | null = null;
    const timer = setTimeout(() => socket.close(4401, 'Say hello first'), HELLO_TIMEOUT_MS);
    socket.on('message', (data, isBinary) => {
      if (isBinary) return refuse(socket, 'bad_message', 'Messages are JSON text.');
      const parsed = parseClientMessage(data.toString());
      if (!parsed.ok) return refuse(socket, 'bad_message', parsed.error);
      const message = parsed.message;
      if (!client) {
        if (message.type !== 'hello') return refuse(socket, 'not_ready', 'Say hello first.');
        clearTimeout(timer);
        client = this.welcome(socket, message);
        return;
      }
      this.handle(client, message);
    });
    socket.on('close', () => {
      clearTimeout(timer);
      if (client) this.clients.delete(client);
    });
    socket.on('error', (err) => this.log(`live client error: ${err.message}`));
  }

  private welcome(socket: WebSocket, hello: Hello): Client | null {
    if (!sameToken(hello.token, this.token)) {
      refuse(socket, 'unauthorized', 'Wrong studio token.');
      socket.close(4401, 'Unauthorized');
      return null;
    }
    if (hello.protocol !== PROTOCOL_VERSION) {
      const update = hello.protocol < PROTOCOL_VERSION ? 'this client is too old; update it' : 'the studio is older than this client; update the studio';
      refuse(socket, 'too_old', `The studio speaks protocol ${PROTOCOL_VERSION} and this client ${hello.protocol}: ${update}.`);
      socket.close(4426, 'Protocol mismatch');
      return null;
    }
    const actor = hello.actor ?? (hello.client === 'blender' ? 'blender' : 'person');
    const client: Client = { socket, hello, actor };
    this.clients.add(client);
    send(socket, { type: 'welcome', protocol: PROTOCOL_VERSION, server: { name: NAME, version: VERSION }, actor, rev: this.studio.rev, home: this.studio.home, undo: this.undoState(actor) });
    return client;
  }

  private handle(client: Client, message: ClientMessage): void {
    switch (message.type) {
      case 'hello':
        refuse(client.socket, 'bad_message', 'Already said hello.');
        return;
      case 'ops': {
        try {
          const r = this.studio.apply(message.operation, {
            actor: client.actor,
            // People edit through the editor and Blender, so their numbers are theirs.
            by: 'user',
            ...(message.label ? { label: message.label } : {}),
            ...(message.groupKey ? { groupKey: message.groupKey } : {}),
            ...(message.baseRev !== undefined ? { expectRev: message.baseRev } : {}),
            ...(message.dryRun ? { dryRun: true } : {}),
          });
          send(client.socket, { type: 'result', req: message.req, ok: true, rev: r.rev, achieved: r.achieved, changed: r.changed, removed: r.removed, notes: r.notes, dryRun: r.dryRun });
        } catch (err) {
          send(client.socket, { type: 'result', req: message.req, ok: false, error: errorOf(err, this.log) });
        }
        return;
      }
      case 'undo':
      case 'redo': {
        const r = message.type === 'undo' ? this.studio.undo(client.actor) : this.studio.redo(client.actor);
        if (r.ok) send(client.socket, { type: 'result', req: message.req, ok: true, rev: r.rev, achieved: r.achieved, changed: r.changed, removed: r.removed, notes: [r.label], dryRun: false });
        else send(client.socket, { type: 'result', req: message.req, ok: false, error: { code: r.reason === 'nothing' ? 'nothing_to_undo' : 'undo_conflict', message: r.message } });
        return;
      }
      case 'select':
        this.studio.select(client.actor, message.ids);
        return;
      case 'sync':
        send(client.socket, { type: 'snapshot', rev: this.studio.rev, home: this.studio.home, undo: this.undoState(client.actor) });
        return;
      case 'versions':
        this.sendVersions(client, message.req);
        return;
      case 'open_version':
      case 'new_version': {
        if (!this.versions) {
          this.sendVersions(client, message.req, 'Designs are not available in this studio.');
          return;
        }
        try {
          if (message.type === 'open_version') this.versions.openVersion(message.id, this.studio);
          else this.versions.openVersion(this.versions.create(this.studio, message.name).id, this.studio);
        } catch (err) {
          this.sendVersions(client, message.req, errorOf(err, this.log).message);
        }
        return;
      }
      case 'render_reply': {
        const pending = this.renders.get(message.req);
        if (!pending) return;
        this.renders.delete(message.req);
        clearTimeout(pending.timer);
        if (message.ok && message.png) pending.resolve(Buffer.from(message.png, 'base64'));
        else pending.reject(new Error(message.error ?? 'The editor could not draw the view.'));
        return;
      }
    }
  }

  private broadcast(event: StudioEvent): void {
    for (const c of this.clients) {
      switch (event.type) {
        case 'changed': {
          const { change } = event;
          send(c.socket, { type: 'changed', ...change, undo: this.undoState(c.actor) });
          break;
        }
        case 'replaced':
          send(c.socket, { type: 'snapshot', rev: event.rev, home: event.home, undo: this.undoState(c.actor) });
          break;
        case 'selection':
          if (event.actor !== c.actor) send(c.socket, { type: 'selection', actor: event.actor, ids: event.ids });
          break;
        case 'highlight':
          send(c.socket, { type: 'highlight', actor: event.actor, ids: event.ids, ...(event.note ? { note: event.note } : {}) });
          break;
      }
    }
  }

  private sendVersions(client: Client, req?: string, error?: string): void {
    const list = this.versions?.list() ?? [];
    send(client.socket, { type: 'versions', ...(req ? { req } : {}), open: this.versions?.open ?? 'real', versions: list, ...(error ? { error } : {}) });
  }

  private undoState(actor: string) {
    return { canUndo: this.studio.canUndo(actor), canRedo: this.studio.canRedo(actor) };
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function refuse(socket: WebSocket, code: Extract<ServerMessage, { type: 'error' }>['code'], message: string): void {
  send(socket, { type: 'error', code, message });
}

function errorOf(err: unknown, log: (message: string) => void): { code: string; message: string; details?: Record<string, unknown> } {
  if (isEditError(err)) return { code: err.code, message: err.message, details: { ...err.details } };
  log(`edit failed: ${(err as Error).stack ?? String(err)}`);
  return { code: 'internal_error', message: 'Something went wrong inside the studio; the home was not changed.' };
}
