// The editor, driven in a real browser against a real studio: draw, drag, type, undo, and
// see an agent's edits arrive. Needs a Chromium: run "npx playwright-core install
// chromium-headless-shell" once, or point FULLSCALE_BROWSER at one. Without it, these
// tests are skipped.
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sampleFlat, wallLength, type Vec2 } from '@fullscale/core';
import { chromium, type Browser, type Page } from 'playwright-core';
import { build } from 'vite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Studio, startStudioServer, type StudioServer } from '@fullscale/server';

const TOKEN = 'b'.repeat(64);
const browserPath = process.env.FULLSCALE_BROWSER ?? (existsSync(chromium.executablePath()) ? chromium.executablePath() : undefined);

let browser: Browser;
let editorDir: string;
let studio: Studio;
let server: StudioServer;
let page: Page;

describe.skipIf(!browserPath)('the editor in a browser', () => {
  beforeAll(async () => {
    editorDir = mkdtempSync(join(tmpdir(), 'fullscale-editor-'));
    await build({ root: join(import.meta.dirname, '..'), logLevel: 'silent', build: { outDir: editorDir, emptyOutDir: true } });
    browser = await chromium.launch({ executablePath: browserPath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  beforeEach(async () => {
    await server?.close();
    const dir = mkdtempSync(join(tmpdir(), 'fullscale-e2e-'));
    studio = new Studio({ home: sampleFlat() });
    server = await startStudioServer({ studio, token: TOKEN, port: 0, editorDir, paths: { data: dir, models: join(dir, 'models'), run: join(dir, 'run'), homeDir: dir }, log: () => undefined });
    page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
    await page.goto(`${server.url}/#token=${TOKEN}`);
    await page.waitForSelector('.plan svg [data-id="wall-1"]');
  });

  /** Where a plan point is on the screen. */
  async function screenOf(p: Vec2): Promise<{ x: number; y: number }> {
    return page.evaluate(([x, z]) => {
      const svg = document.querySelector('.plan svg') as SVGSVGElement;
      const at = new DOMPoint(x, z).matrixTransform(svg.getScreenCTM()!);
      return { x: at.x, y: at.y };
    }, p);
  }

  async function until(check: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 100; i++) {
      if (check()) return;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  it('shows the home', async () => {
    expect(await page.locator('.side').textContent()).toContain('Living room');
    expect(await page.locator('.statusbar').textContent()).toContain('live · revision 0');
  });

  it('draws a wall of a typed length', async () => {
    await page.getByRole('button', { name: 'Snap: walls' }).click(); // → grid
    await page.keyboard.press('w');
    const start = await screenOf([10, 1]);
    const toward = await screenOf([12, 1]);
    await page.mouse.click(start.x, start.y);
    await page.mouse.move(toward.x, toward.y);
    await page.keyboard.type('3.5');
    await page.keyboard.press('Enter');
    await until(() => studio.home.walls.length === 13, 'the new wall');
    const wall = studio.home.walls.at(-1)!;
    expect(wall.start).toEqual([10, 1]);
    expect(wall.end).toEqual([13.5, 1]);
  });

  it('drags furniture and undoes the move', async () => {
    const sofa = studio.home.items.find((i) => i.catalog === 'sofa-3')!;
    const from = await screenOf([sofa.position[0], sofa.position[2]]);
    const to = await screenOf([sofa.position[0] - 0.5, sofa.position[2] + 1.5]);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await until(() => studio.rev === 1, 'the move');
    const moved = studio.home.items.find((i) => i.id === sofa.id)!;
    expect(moved.position[0]).toBeCloseTo(sofa.position[0] - 0.5, 1);
    await page.keyboard.press('Meta+z');
    await until(() => studio.rev === 2, 'the undo');
    expect(studio.home.items.find((i) => i.id === sofa.id)!.position).toEqual(sofa.position);
  });

  it('sets a wall’s length by typing over its dimension, and the room follows', async () => {
    const living = studio.home.rooms.find((r) => r.name === 'Living room')!;
    await page.locator('[data-dimension="wall-4"]').click();
    await page.locator('.dimension-input').fill('4.5');
    await page.keyboard.press('Enter');
    await until(() => studio.rev === 1, 'the new length');
    expect(wallLength(studio.home.walls.find((w) => w.id === 'wall-4')!)).toBeCloseTo(4.5, 9);
    expect(studio.home.rooms.find((r) => r.id === living.id)!.polygon).not.toEqual(living.polygon);
  });

  it('draws a room by dragging, with walls that share a neighbour’s wall', async () => {
    await page.getByRole('button', { name: 'Snap: walls' }).click(); // → grid
    await page.keyboard.press('b');
    // A 2 × 4 m room against the kitchen's east side (the kitchen's inside ends at x 8.12).
    const a = await screenOf([8.24, 0]);
    const b = await screenOf([10.24, 4]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 });
    await page.mouse.up();
    await until(() => studio.home.rooms.length === 5, 'the new room');
    // Three new walls: the kitchen's east wall already stands on the room's west side.
    expect(studio.home.walls).toHaveLength(15);
  });

  it('places a door on a wall where the pointer is', async () => {
    await page.keyboard.press('d');
    // The bedroom's south wall (wall-9) runs from x 5 to 0 along z 7.32; its window is at
    // x 2.8–4.2, so the door goes further west.
    const at = await screenOf([1, 7.38]);
    await page.mouse.move(at.x, at.y);
    await page.mouse.click(at.x, at.y);
    await until(() => studio.home.openings.length === 9, 'the door');
    const door = studio.home.openings.at(-1)!;
    expect(door).toMatchObject({ wall: 'wall-9', type: 'door' });
  });

  it('deletes the selection with the Delete key', async () => {
    const plant = studio.home.items.find((i) => i.catalog === 'plant')!;
    const at = await screenOf([plant.position[0], plant.position[2]]);
    await page.mouse.click(at.x, at.y);
    await page.keyboard.press('Delete');
    await until(() => !studio.home.items.some((i) => i.id === plant.id), 'the delete');
  });

  it('shows an agent’s edit as it happens', async () => {
    studio.apply({ op: 'addItem', id: 'agent-box', catalog: 'box', position: [2.5, 2.5] }, { actor: 'agent', by: 'agent' });
    await page.waitForSelector('[data-id="agent-box"]');
    expect(await page.locator('.toast').textContent()).toContain('agent');
  });

  it('draws 3D pictures for agents', async () => {
    const png = await server.live.render({ preset: 'three-quarter' }, { width: 320, height: 240 });
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });
});
