import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { syntheticRoomPlan } from '@fullscale/capture';
import { sampleFlat } from '@fullscale/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INSTRUCTIONS, mcpHandler } from '../src/mcp.ts';
import { Studio } from '../src/studio.ts';
import { TOOLS } from '../src/tools/index.ts';

type Content = Array<{ type: string; text?: string; data?: string }>;

let dir: string;
let studio: Studio;
let handler: ReturnType<typeof mcpHandler>;
let client: Client;

async function connect(mode?: 'auto'): Promise<Client> {
  const c = new Client({ name: 'test-agent', version: '1.0.0' }, mode ? { versionNegotiation: { mode } } : {});
  await c.connect(new StreamableHTTPClientTransport(new URL('http://studio.test/mcp'), { fetch: (url, init) => handler.fetch(new Request(url, init)) }));
  return c;
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  const content = r.content as Content;
  return { ...r, text: content.find((c) => c.type === 'text')?.text ?? '', images: content.filter((c) => c.type === 'image'), data: r.structuredContent as Record<string, unknown> };
}

/** The JSON a refusal carries. */
const refusal = (r: { text: string }) => JSON.parse(r.text) as { code: string; error: string } & Record<string, unknown>;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fullscale-mcp-'));
  studio = new Studio({ home: sampleFlat() });
  handler = mcpHandler({ studio, actor: 'agent', by: 'agent', paths: { data: dir, models: join(dir, 'models'), run: join(dir, 'run'), homeDir: dir } });
  client = await connect('auto');
});

afterEach(async () => {
  await client.close();
  await handler.close();
});

describe('the tool list', () => {
  it('lists every tool, each with annotations', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    for (const t of tools) expect(t.annotations, t.name).toBeDefined();
  });

  it('uses no tuple syntax anywhere, which some clients reject', async () => {
    const { tools } = await client.listTools();
    const offenders: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) {
        node.forEach((n, i) => {
          walk(n, `${path}[${i}]`);
        });
        return;
      }
      if (typeof node !== 'object' || node === null) return;
      const o = node as Record<string, unknown>;
      if ('prefixItems' in o || Array.isArray(o.items)) offenders.push(path);
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
    };
    for (const t of tools) walk(t.inputSchema, t.name);
    expect(offenders).toEqual([]);
  });

  it('keeps the instructions short', () => {
    expect(INSTRUCTIONS.length).toBeLessThan(2000);
  });

  it('serves clients that only speak the older protocol', async () => {
    const old = await connect();
    expect((await old.listTools()).tools.length).toBe(TOOLS.length);
    await old.close();
  });
});

describe('looking', () => {
  it('gives an overview to start from', async () => {
    const r = await call('get_home');
    expect(r.text).toContain('Living room');
    expect(r.data.rev).toBe(0);
  });

  it('shows the plan as a picture with its scale', async () => {
    const r = await call('view_plan', { width: 512 });
    expect(r.images).toHaveLength(1);
    expect(r.data.metresPerPixel).toBeGreaterThan(0);
  });

  it('falls back to the plan for 3D views when no editor is open, and says so', async () => {
    const r = await call('view_3d');
    expect(r.text).toContain('No editor is open');
    expect(r.images).toHaveLength(1);
  });
});

describe('editing', () => {
  it('draws walls, reports what it achieved, and makes a room of the closed area', async () => {
    const r = await call('draw_walls', {
      points: [
        [10, 0],
        [13, 0],
        [13, 2.5],
        [10, 2.5],
      ],
      close: true,
      thickness: '10 cm',
    });
    expect(r.isError).toBeFalsy();
    expect(r.data.achieved).toMatchObject({ created: { wall: 4, room: 1 } });
    expect(r.data.rev).toBe(1);
    expect(r.text).toMatch(/New room/);
  });

  it('reads lengths with units', async () => {
    await call('add_room', { name: 'Study', rect: { x: 10, z: 0, width: '350 cm', depth: '9\' 10"' } });
    const room = studio.home.rooms.find((x) => x.name === 'Study')!;
    expect(room.polygon[2]).toEqual([13.5, 2.9972]);
  });

  it('shares an existing wall when a room is added next to another', async () => {
    const r = await call('add_room', { name: 'Hall', rect: { x: -1.62, z: 0, width: 1.5, depth: 4 } });
    // The living room's west wall (wall-4) already stands on the hall's east side.
    expect(r.data.achieved).toMatchObject({ created: { wall: 3, room: 1 } });
    expect(r.text).toContain('wall-4');
  });

  it('refuses a bad edit with a code and a fix, and changes nothing', async () => {
    const r = await call('add_opening', { wall: 'wall-1', type: 'window', offset: 1.5, width: 1 });
    expect(r.isError).toBe(true);
    expect(refusal(r)).toMatchObject({ code: 'opening_overlap' });
    expect(studio.rev).toBe(0);
  });

  it('refuses to overwrite changes it has not seen', async () => {
    studio.apply({ op: 'renameHome', name: 'Changed by the person' }, { actor: 'person', by: 'user' });
    const r = await call('paint', { targets: [{ room: 'room-1', surface: 'walls' }], color: '#9caf88', expect_rev: 0 });
    expect(refusal(r)).toMatchObject({ code: 'stale_revision', expected: 0, current: 1 });
  });

  it('leaves out furniture that would block a door, and says where it would fit', async () => {
    // The bedroom door is in the living room's south wall at x 0.3–1.2; it opens into the
    // bedroom, so the living room side keeps a walkway clear in front of it.
    const r = await call('add_items', {
      items: [
        { catalog: 'bookshelf', position: [0.75, 3.75], rotation: 180 },
        { catalog: 'plant', position: [4.0, 1.2] },
      ],
    });
    expect(r.data.achieved).toMatchObject({ created: { item: 1 } });
    expect(r.text).toMatch(/Item 1 \(bookshelf\) left out: .*bedroom-door/);
    expect(r.text).toMatch(/It would fit at/);
  });

  it('checks a fit and says what it did not check', async () => {
    const r = await call('check_fit', { size: [2, 0.9, 0.9], position: [2.5, 2], room: 'room-1' });
    expect(r.data).toMatchObject({ method: 'plan footprint at the given pose' });
    expect(r.text).toContain('Not checked');
  });

  it('dry runs show what would happen without doing it', async () => {
    const r = await call('remove', { ids: ['wall-1'], dry_run: true });
    expect(r.data.removed).toEqual(expect.arrayContaining(['wall-1', 'living-window']));
    expect(studio.home.walls.some((w) => w.id === 'wall-1')).toBe(true);
  });
});

describe('undo', () => {
  it('undoes the agent’s own edits, never the person’s', async () => {
    studio.apply({ op: 'renameHome', name: 'Person’s name' }, { actor: 'person', by: 'user' });
    expect(refusal(await call('undo'))).toMatchObject({ code: 'nothing_to_undo' });
    await call('paint', { targets: [{ room: 'room-3', surface: 'floor' }], color: '#336699' });
    const r = await call('undo');
    expect(r.isError).toBeFalsy();
    expect(studio.home.name).toBe('Person’s name');
  });
});

describe('importing a phone scan', () => {
  it('builds rooms from a capture folder and compares its tape checks', async () => {
    const capture = join(dir, 'captures', 'scan-1');
    mkdirSync(join(capture, 'rooms', 'r1'), { recursive: true });
    mkdirSync(join(capture, 'checks'));
    const layout = syntheticRoomPlan(
      {
        corners: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
        height: 2.5,
        doors: [{ wall: 0, offset: 1, width: 0.8, height: 2 }],
      },
      { yaw: 12, offset: [1, 0, 1] },
    ) as { doors: Array<{ identifier: string }> };
    writeFileSync(join(capture, 'rooms', 'r1', 'roomplan.json'), JSON.stringify(layout));
    writeFileSync(
      join(capture, 'manifest.json'),
      JSON.stringify({ format: 'fullscale-capture/1', id: 'scan-1', status: 'complete', createdAt: '2026-10-24T10:00:00Z', rooms: [{ id: 'r1', name: 'Study', dir: 'rooms/r1' }] }),
    );
    writeFileSync(join(capture, 'checks', 'tape.jsonl'), `${JSON.stringify({ id: 'c1', kind: 'door_width', element: layout.doors[0]!.identifier, tapeM: 0.81, entered: '81 cm' })}\n{"broken`);
    const r = await call('import_capture', { path: 'captures/scan-1' });
    expect(r.isError).toBeFalsy();
    expect(r.data.achieved).toMatchObject({ created: { wall: 4, opening: 1, room: 1, capture: 1 } });
    expect(r.text).toMatch(/Tape check c1 \(door width\): scan 0\.80 m, tape 0\.81 m, -1 cm \(amber\)/);
    expect(r.text).toMatch(/line 2 is not complete JSON/);
    expect(studio.home.rooms.some((x) => x.name === 'Study')).toBe(true);
  });

  it('refuses a path outside the home folder', async () => {
    const r = await call('import_capture', { path: '../elsewhere' });
    expect(refusal(r)).toMatchObject({ code: 'not_found' });
  });
});

describe('photo-real pictures', () => {
  const restore = process.env.BLENDER_BIN;
  afterEach(() => {
    if (restore === undefined) delete process.env.BLENDER_BIN;
    else process.env.BLENDER_BIN = restore;
  });

  it('forecasts a render without running it', async () => {
    const r = await call('render_photoreal', { preset: 'thumb', dry_run: true });
    expect(r.data.size).toEqual({ width: 320, height: 240 });
    expect(r.text).toContain('estimate');
  });

  it('runs Blender with the job and returns its picture', async () => {
    // A stand-in for Blender: writes a picture where asked and prints the result line.
    const fake = join(dir, 'fake-blender.cjs');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    writeFileSync(join(dir, 'pixel.png'), png);
    writeFileSync(
      fake,
      `#!${process.execPath}\nconst a = process.argv; const out = a[a.indexOf('--out') + 1]; const cam = JSON.parse(a[a.indexOf('--camera') + 1]);\nrequire('node:fs').copyFileSync(${JSON.stringify(join(dir, 'pixel.png'))}, out);\nconsole.log('FULLSCALE_PROGRESS {}'); console.log('FULLSCALE_RESULT ' + JSON.stringify({ width: 320, height: 240, seconds: 0.1, device: 'CPU', eyeY: cam.eye[1] }));\n`,
      { mode: 0o755 },
    );
    process.env.BLENDER_BIN = fake;
    const r = await call('render_photoreal', { preset: 'thumb', view: { preset: 'south' } });
    expect(r.isError).toBeFalsy();
    expect(r.text).toMatch(/Rendered revision 0 in 0.1 s on CPU/);
    expect(r.images).toHaveLength(1);
  });

  it('says how to get Blender when it is missing', async () => {
    process.env.BLENDER_BIN = join(dir, 'no-such-blender');
    const r = await call('render_photoreal', { preset: 'thumb' });
    // Only meaningful where Blender isn't installed in the usual places.
    if (r.isError) expect(refusal(r)).toMatchObject({ code: 'blender_unavailable' });
  });
});
