// Photo-real pictures, rendered by Blender as a separate program. (Blender and our render
// script are GPL; the studio only starts them and reads what they print.) Each job gets its
// own folder holding the home's 3D file pinned to one revision, the job's settings, and the
// picture. One job runs at a time.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { cameraPose, EditError, pointInPolygon, type CameraRequest, type Home } from '@fullscale/core';
import { exportHomeGlb } from '@fullscale/three';

export type RenderPreset = 'thumb' | 'preview' | 'final';

/** Picture sizes, matching blender/render/render_args.py. */
export const RENDER_SIZES: Readonly<Record<RenderPreset, { width: number; height: number }>> = {
  thumb: { width: 320, height: 240 },
  preview: { width: 1280, height: 720 },
  final: { width: 1920, height: 1080 },
};

/** Rough times on a recent Mac, until measured on this one; shown as estimates. */
const ESTIMATED_SECONDS: Readonly<Record<RenderPreset, string>> = { thumb: '5–15 s', preview: '15–60 s', final: '1–4 min' };
const TIMEOUT_MS: Readonly<Record<RenderPreset, number>> = { thumb: 120_000, preview: 600_000, final: 1_800_000 };

export interface RenderResult {
  file: string;
  width: number;
  height: number;
  seconds: number;
  device: string;
  rev: number;
}

/**
 * Blender's program: BLENDER_BIN when set (and then only that, so a wrong path is reported
 * rather than quietly replaced by another Blender), else the usual Mac place or `blender` on
 * the PATH.
 */
export function findBlender(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.BLENDER_BIN) return existsSync(env.BLENDER_BIN) ? env.BLENDER_BIN : null;
  const candidates = ['/Applications/Blender.app/Contents/MacOS/Blender', ...(env.PATH ?? '').split(delimiter).map((dir) => join(dir, 'blender'))];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** What a render would do, without doing it. */
export function forecast(home: Home, preset: RenderPreset): { size: { width: number; height: number }; estimatedTime: string; warnings: string[] } {
  const warnings: string[] = [];
  const guessed = home.items.filter((i) => ['catalog', 'estimate'].includes((i.sources?.size ?? i.source)?.kind ?? '')).length;
  if (guessed) warnings.push(`${guessed} item(s) have catalogue or guessed sizes.`);
  const ownModels = home.items.filter((i) => i.model?.licence === 'local-only').length;
  if (ownModels) warnings.push(`${ownModels} item(s) use your own models, which stay on this computer; renders show their catalogue shapes.`);
  return { size: RENDER_SIZES[preset], estimatedTime: `${ESTIMATED_SECONDS[preset]} (estimate)`, warnings };
}

let queue: Promise<unknown> = Promise.resolve();

/** Render a view of the home. Jobs wait their turn. */
export function renderPhotoreal(opts: { home: Home; rev: number; view: CameraRequest; preset: RenderPreset; blender: string; script: string; folder: string }): Promise<RenderResult> {
  const job = queue.then(() => run(opts));
  queue = job.catch(() => undefined);
  return job;
}

async function run(opts: { home: Home; rev: number; view: CameraRequest; preset: RenderPreset; blender: string; script: string; folder: string }): Promise<RenderResult> {
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-r${opts.rev}`;
  const dir = join(opts.folder, id);
  mkdirSync(dir, { recursive: true });
  const size = RENDER_SIZES[opts.preset];
  const pose = cameraPose(opts.home, opts.view, size.width / size.height);
  // Ceilings only when the camera stands inside a room; from outside they would hide it.
  const level = opts.view.level ?? opts.home.levels[0]!.id;
  const inside = opts.home.rooms.some((r) => r.level === level && pointInPolygon([pose.eye[0], pose.eye[2]], r.polygon));
  const glb = join(dir, 'home.glb');
  writeFileSync(glb, exportHomeGlb(opts.home, { ceilings: inside, levels: [level] }));
  const camera = { eye: pose.eye, target: pose.target, fov: pose.fov };
  const out = join(dir, 'picture.png');
  writeFileSync(join(dir, 'job.json'), `${JSON.stringify({ rev: opts.rev, preset: opts.preset, camera, view: opts.view }, null, 2)}\n`);

  const log = join(dir, 'blender.log');
  const lines = await runBlender(
    opts.blender,
    ['-b', '--factory-startup', '--python', opts.script, '--', '--glb', glb, '--out', out, '--camera', JSON.stringify(camera), '--preset', opts.preset],
    TIMEOUT_MS[opts.preset],
    log,
  );
  // The script's last word is one marker line; read from the end.
  for (const line of lines.reverse()) {
    if (line.startsWith('FULLSCALE_RESULT ')) {
      const r = JSON.parse(line.slice('FULLSCALE_RESULT '.length)) as { width: number; height: number; seconds: number; device: string };
      return { file: out, width: r.width, height: r.height, seconds: r.seconds, device: r.device, rev: opts.rev };
    }
    if (line.startsWith('FULLSCALE_ERROR ')) {
      throw new EditError('render_failed', `Blender could not render: ${(JSON.parse(line.slice('FULLSCALE_ERROR '.length)) as { error: string }).error} (details in ${log})`, { folder: dir });
    }
  }
  throw new EditError('render_failed', `Blender stopped without a result; what it printed is in ${log}.`, { folder: dir });
}

/** Run Blender; resolves with its output lines, and keeps everything it printed in `log`. */
function runBlender(blender: string, args: string[], timeoutMs: number, log: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(blender, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errors += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new EditError('render_failed', `The render took longer than ${Math.round(timeoutMs / 60_000)} minutes and was stopped.`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new EditError('render_failed', `Could not start Blender: ${err.message}`));
    });
    child.on('close', () => {
      clearTimeout(timer);
      writeFileSync(log, `${output}\n--- errors ---\n${errors}`);
      resolve(output.split('\n'));
    });
  });
}
