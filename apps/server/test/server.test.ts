import { request } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { sampleFlat } from '@fullscale/core';
import { HomeMirror, PROTOCOL_VERSION, SOCKET_PATH, type ServerMessage } from '@fullscale/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { writeRunningServer } from '../src/access.ts';
import { startStudioServer, type StudioServer } from '../src/http.ts';
import { Studio } from '../src/studio.ts';

const TOKEN = 'a'.repeat(64);
const CLI = join(import.meta.dirname, '../src/cli.ts');

let dir: string;
let studio: Studio;
let server: StudioServer;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fullscale-server-'));
  mkdirSync(join(dir, 'run'));
  studio = new Studio({ home: sampleFlat() });
  server = await startStudioServer({ studio, token: TOKEN, port: 0, paths: { data: dir, models: join(dir, 'models'), run: join(dir, 'run'), homeDir: dir }, log: () => undefined });
});

afterEach(async () => {
  await server.close();
});

/** A raw request, so Host and Origin can be set to anything. */
function raw(path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.port, path, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

/** A live client that records what the server sends. */
async function liveClient(hello: Record<string, unknown> = {}) {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}${SOCKET_PATH}`);
  const inbox: ServerMessage[] = [];
  const waiters: Array<{ type: ServerMessage['type']; resolve: (m: ServerMessage) => void }> = [];
  socket.on('message', (data) => {
    const m = JSON.parse(data.toString()) as ServerMessage;
    const waiter = waiters.find((w) => w.type === m.type);
    if (waiter) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(m);
    } else {
      inbox.push(m);
    }
  });
  await new Promise((r) => socket.once('open', r));
  const next = <T extends ServerMessage['type']>(type: T) =>
    new Promise<Extract<ServerMessage, { type: T }>>((resolve) => {
      const seen = inbox.find((m) => m.type === type);
      if (seen) {
        inbox.splice(inbox.indexOf(seen), 1);
        return resolve(seen as Extract<ServerMessage, { type: T }>);
      }
      waiters.push({ type, resolve: resolve as (m: ServerMessage) => void });
    });
  socket.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, client: 'editor', token: TOKEN, ...hello }));
  return { socket, next, send: (m: unknown) => socket.send(JSON.stringify(m)), close: () => socket.close() };
}

describe('who may connect', () => {
  it('answers health checks without a token', async () => {
    const r = await fetch(`${server.url}/health`);
    expect(await r.json()).toMatchObject({ ok: true, name: 'fullscale' });
  });

  it('needs the token for the home', async () => {
    expect((await fetch(`${server.url}/api/home`)).status).toBe(401);
    const r = await fetch(`${server.url}/api/home`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(((await r.json()) as { rev: number }).rev).toBe(0);
  });

  it('refuses requests for another host name, which DNS rebinding would send', async () => {
    expect(await raw('/health', { host: `evil.example:${server.port}` })).toBe(403);
  });

  it('refuses requests from other web pages', async () => {
    expect(await raw('/health', { host: `127.0.0.1:${server.port}`, origin: 'https://evil.example' })).toBe(403);
    expect(await raw('/health', { host: `127.0.0.1:${server.port}`, origin: `http://localhost:${server.port}` })).toBe(200);
  });

  it('closes a live connection that gives the wrong token', async () => {
    const c = await liveClient({ token: 'b'.repeat(64) });
    expect(await c.next('error')).toMatchObject({ code: 'unauthorized' });
  });

  it('tells an old client to update', async () => {
    const c = await liveClient({ protocol: 0 });
    expect(await c.next('error')).toMatchObject({ code: 'too_old' });
  });
});

describe('live editing', () => {
  it('sends every change to every client, so their copies stay the same as the studio’s', async () => {
    const a = await liveClient();
    const b = await liveClient({ client: 'blender' });
    const mirror = new HomeMirror();
    mirror.receive(await b.next('welcome'));
    expect((await a.next('welcome')).actor).toBe('person');

    a.send({ type: 'ops', req: 'r1', operation: { op: 'paint', target: { room: 'room-1', surface: 'floor' }, color: '#aa5500' } });
    expect(await a.next('result')).toMatchObject({ req: 'r1', ok: true, rev: 1 });
    const changed = await b.next('changed');
    expect(changed).toMatchObject({ rev: 1, actor: 'person' });
    expect(mirror.receive(changed)).toBe('updated');
    // Only the studio hands out ids, so clients don't keep the id counters.
    const comparable = (h: typeof studio.home) => ({ ...h, nextIds: {}, updatedAt: '' });
    expect(comparable(mirror.home!)).toEqual(comparable(studio.home));
    a.close();
    b.close();
  });

  it('reports a refused edit with its code and changes nothing', async () => {
    const a = await liveClient();
    await a.next('welcome');
    a.send({ type: 'ops', req: 'bad', operation: { op: 'addOpening', wall: 'wall-1', type: 'door', offset: 9 } });
    expect(await a.next('result')).toMatchObject({ ok: false, error: { code: 'opening_outside_wall' } });
    expect(studio.rev).toBe(0);
    a.close();
  });

  it('undoes only the client’s own edits', async () => {
    const a = await liveClient();
    await a.next('welcome');
    studio.apply({ op: 'renameHome', name: 'By the agent' }, { actor: 'agent', by: 'agent' });
    await a.next('changed');
    a.send({ type: 'undo', req: 'u1' });
    expect(await a.next('result')).toMatchObject({ ok: false, error: { code: 'nothing_to_undo' } });
    a.close();
  });

  it('lets an agent see what the person selected', async () => {
    const a = await liveClient();
    await a.next('welcome');
    a.send({ type: 'select', ids: ['sofa-3-1'] });
    await new Promise((r) => setTimeout(r, 50));
    expect(studio.selection()).toEqual([{ actor: 'person', ids: ['sofa-3-1'] }]);
    a.close();
  });
});

describe('agents', () => {
  async function agent() {
    const c = new Client({ name: 'test', version: '1' }, { versionNegotiation: { mode: 'auto' } });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }));
    return c;
  }

  it('reach the tools over HTTP with the token', async () => {
    const c = await agent();
    const r = await c.callTool({ name: 'get_home', arguments: {} });
    expect((r.content as Array<{ text: string }>)[0]!.text).toContain('Sample flat');
    await c.close();
  });

  it('get 3D views drawn by an open editor', async () => {
    const editor = await liveClient({ capabilities: ['render'] });
    await editor.next('welcome');
    const c = await agent();
    const answer = c.callTool({ name: 'view_3d', arguments: { view: { preset: 'top' } } });
    const request = await editor.next('render');
    expect(request.view).toEqual({ preset: 'top' });
    editor.send({ type: 'render_reply', req: request.req, ok: true, png: Buffer.from('a picture').toString('base64') });
    const r = await answer;
    expect((r.content as Array<{ type: string; data?: string }>).find((x) => x.type === 'image')?.data).toBe(Buffer.from('a picture').toString('base64'));
    await c.close();
    editor.close();
  });

  it.each([
    ['the older protocol', undefined],
    ['the newer protocol', 'auto' as const],
  ])(
    'connect through "fullscale mcp" over stdio, speaking %s',
    async (_name, mode) => {
      writeRunningServer(join(dir, 'run'), { pid: process.pid, port: server.port, url: server.url, version: 'test', home: 'test', startedAt: new Date().toISOString() });
      writeFileSync(join(dir, 'run', 'token'), `${TOKEN}\n`, { mode: 0o600 });
      const c = new Client({ name: 'stdio-agent', version: '1' }, mode ? { versionNegotiation: { mode } } : {});
      await c.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: ['--import', 'tsx', CLI, 'mcp'],
          env: { ...(process.env as Record<string, string>), FULLSCALE_RUN: join(dir, 'run'), FULLSCALE_DATA: dir },
        }),
      );
      const r = await c.callTool({ name: 'paint', arguments: { targets: [{ room: 'room-2', surface: 'floor' }], color: '#123456' } });
      expect(r.isError).toBeFalsy();
      expect(studio.rev).toBe(1);
      await c.close();
    },
    30_000,
  );
});

describe('the home as a 3D file', () => {
  it('serves a GLB pinned to the revision', async () => {
    const r = await fetch(`${server.url}/api/home.glb`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(r.headers.get('content-type')).toBe('model/gltf-binary');
    expect(r.headers.get('x-fullscale-rev')).toBe('0');
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect(new DataView(bytes.buffer).getUint32(0, true)).toBe(0x46546c67);
  });
});
