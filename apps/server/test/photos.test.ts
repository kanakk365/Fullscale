import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { syntheticRoomPlan } from '@fullscale/capture';
import { captureToHomeMatrix, createHome } from '@fullscale/core';
import jpeg from 'jpeg-js';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mcpHandler } from '../src/mcp.ts';
import { squareToQuad, tileable, toStored, uprightTransform, uprightTurns, type Photo } from '../src/photos.ts';
import { Studio } from '../src/studio.ts';

type Content = Array<{ type: string; text?: string }>;
let dir: string;
let studio: Studio;
let handler: ReturnType<typeof mcpHandler>;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  return { ...r, text: (r.content as Content).find((c) => c.type === 'text')?.text ?? '', data: r.structuredContent as Record<string, unknown> };
}

/** A 4 × 3 m room scanned from a turned, shifted session, with one 64 × 48 photo taken from
 *  the middle of the room, 1.4 m up, looking at the north wall (z = 0) 2 m away. */
async function scannedRoomWithAPhoto() {
  const capture = join(dir, 'captures', 'scan-1');
  mkdirSync(join(capture, 'rooms', 'r1'), { recursive: true });
  mkdirSync(join(capture, 'photos'));
  const layout = syntheticRoomPlan(
    {
      corners: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      height: 2.5,
    },
    { yaw: 12, offset: [1, 0, 1] },
  );
  writeFileSync(join(capture, 'rooms', 'r1', 'roomplan.json'), JSON.stringify(layout));
  writeFileSync(
    join(capture, 'manifest.json'),
    JSON.stringify({ format: 'fullscale-capture/1', revision: 2, id: 'scan-1', status: 'complete', createdAt: '2026-10-26T00:00:00Z', rooms: [{ id: 'r1', name: 'Bedroom', dir: 'rooms/r1' }] }),
  );
  const imported = await call('import_capture', { path: 'captures/scan-1' });
  expect(imported.isError).toBeFalsy();
  const ref = studio.home.captures[0]!;
  const room = studio.home.rooms[0]!;
  const xs = room.polygon.map((p) => p[0]);
  const zs = room.polygon.map((p) => p[1]);
  const middle = [(Math.min(...xs) + Math.max(...xs)) / 2, 1.4, Math.max(...zs) - 1] as const;
  // The camera in the home looks along -z with y up; in the capture, it is wherever the
  // session put it.
  const home = new THREE.Matrix4().makeTranslation(middle[0], middle[1], middle[2]);
  const pose = new THREE.Matrix4().fromArray(captureToHomeMatrix(ref.toHome!, 0)).invert().multiply(home);
  // Left half red, right half blue.
  const width = 64;
  const height = 48;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(x < width / 2 ? [200, 30, 30, 255] : [30, 30, 200, 255], (y * width + x) * 4);
  writeFileSync(join(capture, 'photos', 'p1.jpg'), jpeg.encode({ data: pixels, width, height }, 95).data);
  const record = { id: 'p1', file: 'photos/p1.jpg', room: 'r1', kind: 'detail', t: 1, width, height, pose: pose.toArray(), intrinsics: { fx: 40, fy: 40, cx: 32, cy: 24 }, tracking: 'normal' };
  writeFileSync(join(capture, 'photos', 'index.jsonl'), `${JSON.stringify(record)}\n`);
  return { ref, middle, northWall: Math.min(...zs) };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fullscale-photos-'));
  studio = new Studio({ home: createHome({ name: 't' }) });
  handler = mcpHandler({ studio, actor: 'agent', by: 'agent', paths: { data: dir, models: join(dir, 'models'), run: join(dir, 'run'), homeDir: dir } });
  client = new Client({ name: 'test-agent', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://studio.test/mcp'), { fetch: (url, init) => handler.fetch(new Request(url, init)) }));
});

afterEach(async () => {
  await client.close();
  await handler.close();
});

describe('looking at scan photos', () => {
  it('lists photos with what each shows, and shows one with where it was taken from', async () => {
    const { ref, middle } = await scannedRoomWithAPhoto();
    const list = await call('view_photo');
    expect(list.text).toContain(`${ref.id}/p1 (detail)`);
    const sees = (list.data.photos as Array<{ sees: Array<{ id: string }> }>)[0]!.sees;
    expect(sees[0]!.id).toMatch(/^wall-/);
    const one = await call('view_photo', { photo: 'p1' });
    expect(one.data.eye).toEqual([expect.closeTo(middle[0], 3), expect.closeTo(1.4, 3), expect.closeTo(middle[2], 3)]);
    // 48 px tall at 40 px focal length: 2·atan(24/40).
    expect(one.data.fov).toBeCloseTo(61.9, 1);
    expect((await call('view_photo', { of: sees[0]!.id })).text).toContain('p1');
  });

  it('cuts a rectangle of real size off the surface a point is on, and makes it a material', async () => {
    await scannedRoomWithAPhoto();
    const r = await call('texture_from_photo', { photo: 'p1', at: [32, 24], size: [1, 0.6], material: { name: 'Wall test', kind: 'paint' } });
    expect(r.isError).toBeFalsy();
    expect(r.text).toMatch(/Laid on wall-/);
    const material = studio.home.materials.find((m) => m.id === 'wall-test')!;
    expect(material.image).toEqual({ file: 'textures/wall-test.jpg', width: 1, height: 0.6, fit: 'repeat' });
    expect(existsSync(join(dir, 'textures', 'wall-test.jpg'))).toBe(true);
    // 1 m at 2 m away is 20 px across in the photo, half red and half blue: purple on average.
    expect(material.color).toMatch(/^#[0-9a-f]{6}$/);
    const [red, , blue] = [1, 3, 5].map((i) => Number.parseInt(material.color.slice(i, i + 2), 16));
    expect(Math.abs(red! - blue!)).toBeLessThan(40);
  });

  it('measures a patch given by its corners against the model', async () => {
    await scannedRoomWithAPhoto();
    const r = await call('texture_from_photo', {
      photo: 'p1',
      corners: [
        [22, 14],
        [42, 14],
        [42, 34],
        [22, 34],
      ],
      material: { id: 'poster', name: 'Poster', kind: 'other', fit: 'stretch' },
    });
    expect(r.isError).toBeFalsy();
    // 20 px at 40 px focal length, 2 m away: 1 m each way.
    expect(r.data.size).toEqual([expect.closeTo(1, 2), expect.closeTo(1, 2)]);
  });
});

describe('photo pictures', () => {
  const photo = (pose: number[], width = 4, height = 3) => ({ record: { pose, width, height } }) as unknown as Photo;

  it('stands photos upright and maps upright points back to the stored picture', () => {
    // A phone held upright: the picture's right points down in the world.
    const sideways = photo([0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect(uprightTurns(sideways.record.pose)).toBe(1);
    const p = { ...sideways, turns: 1 as const };
    expect(uprightTransform(p)).toBe('translate(3 0) rotate(90)');
    // The upright picture's top-left corner is the stored picture's bottom-left.
    expect(toStored(p, [0, 0])).toEqual([0, 3]);
    expect(toStored(p, [3, 4])).toEqual([4, 0]);
  });

  it('maps the unit square onto any four corners', () => {
    const map = squareToQuad([
      [10, 10],
      [50, 12],
      [48, 40],
      [8, 38],
    ]);
    expect(map(0, 0)).toEqual([expect.closeTo(10, 9), expect.closeTo(10, 9)]);
    expect(map(1, 1)).toEqual([expect.closeTo(48, 9), expect.closeTo(40, 9)]);
    expect(map(0, 1)).toEqual([expect.closeTo(8, 9), expect.closeTo(38, 9)]);
  });

  it('makes a picture repeat without a seam', () => {
    // A ramp from black to white has a hard seam where it repeats; afterwards it has none.
    const w = 40;
    const h = 20;
    const ramp = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ramp.set([x * 6, x * 6, x * 6, 255], (y * w + x) * 4);
    const out = tileable(ramp, w, h);
    const at = (x: number, y: number) => out[(y * w + x) * 4]!;
    for (let y = 0; y < h; y++) expect(Math.abs(at(0, y) - at(w - 1, y))).toBeLessThan(12);
  });
});
