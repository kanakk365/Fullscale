// Photo-real pictures, rendered by Blender as a separate program. (Blender and our render
// script are GPL; the studio only starts them and reads what they print.) Each job gets its
// own folder holding the home's 3D file pinned to one revision, the job's settings, and the
// picture. One job runs at a time.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { cameraPose, EditError, faceOffsets, leftOf, pointInPolygon, roomFace, wallDirection, type CameraRequest, type Home, type Vec3 } from '@fullscale/core';
import { exportHomeGlb } from '@fullscale/three';
import { insideFolder } from './files.ts';

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

/** The light outside: daylight, a low evening sun with the lamps on, or night with only the
 *  lamps. The home's own lights shine whenever they are switched on. */
export type TimeOfDay = 'day' | 'evening' | 'night';

/** What the render script needs to light a view: the time of day, which way the sun is
 *  (towards it, level with the floor) and the windows daylight comes in through. */
export interface LightingJob {
  time: TimeOfDay;
  sun?: Vec3;
  windows: Array<{ centre: Vec3; width: number; height: number; inward: Vec3 }>;
}

/** How the render was lit, as the script reports it. */
export interface RenderLighting {
  time: TimeOfDay;
  lamps: number;
  standInLights: number;
  sun: boolean;
  portals: number;
  exposure: number;
  whiteBalance: number;
}

/**
 * The windows of a level and the way to the sun. We don't know the time, date or which way
 * the home faces, so the sun is put where it makes a good picture: shining in through the
 * biggest window of the room the camera is in (or of the level), a little from the side.
 */
export function lightingFor(home: Home, level: string, eye: Vec3, time: TimeOfDay): LightingJob {
  const elevation = home.levels.find((l) => l.id === level)?.elevation ?? 0;
  const walls = new Map(home.walls.filter((w) => w.level === level).map((w) => [w.id, w]));
  const windows: Array<LightingJob['windows'][number] & { area: number; wall: string }> = [];
  for (const o of home.openings) {
    const wall = walls.get(o.wall);
    if (!wall || (o.type !== 'window' && o.type !== 'opening')) continue;
    const d = wallDirection(wall);
    const n = leftOf(d);
    const side = roomFace(home, wall) ?? 'left';
    const offsets = faceOffsets(wall);
    const along = o.offset + o.width / 2;
    const out = side === 'left' ? offsets.left : offsets.right;
    const inward: Vec3 = side === 'left' ? [n[0], 0, n[1]] : [-n[0], 0, -n[1]];
    const x = wall.start[0] + d[0] * along + n[0] * out;
    const z = wall.start[1] + d[1] * along + n[1] * out;
    windows.push({ centre: [x, elevation + o.sill + o.height / 2, z], width: o.width, height: o.height, inward, area: o.width * o.height, wall: wall.id });
  }
  const room = home.rooms.find((r) => r.level === level && pointInPolygon([eye[0], eye[2]], r.polygon));
  const near = room ? windows.filter((w) => pointInPolygon([w.centre[0] + w.inward[0] * 0.1, w.centre[2] + w.inward[2] * 0.1], room.polygon)) : [];
  const biggest = [...(near.length ? near : windows)].sort((a, b) => b.area - a.area)[0];
  let sun: Vec3 | undefined;
  if (biggest && time !== 'night') {
    // From outside the window, turned 25° so the light falls across the room at an angle.
    const turn = (25 * Math.PI) / 180;
    const [ox, , oz] = [-biggest.inward[0], 0, -biggest.inward[2]];
    sun = [ox * Math.cos(turn) - oz * Math.sin(turn), 0, ox * Math.sin(turn) + oz * Math.cos(turn)];
  }
  return { time, ...(sun ? { sun } : {}), windows: windows.map(({ area: _a, wall: _w, ...w }) => w) };
}

export interface RenderResult {
  file: string;
  /** the scene as rendered, saved as a Blender file to open and look around in */
  blend?: string;
  width: number;
  height: number;
  seconds: number;
  device: string;
  rev: number;
  lighting?: RenderLighting;
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
  const ownModels = home.items.filter((i) => i.model).length;
  if (ownModels) warnings.push(`${ownModels} item(s) use your own models: Blender uses them here, on this computer; they never go into the home's 3D file.`);
  return { size: RENDER_SIZES[preset], estimatedTime: `${ESTIMATED_SECONDS[preset]} (estimate)`, warnings };
}

let queue: Promise<unknown> = Promise.resolve();

/** Render a view of the home. Jobs wait their turn. */
export interface RenderOptions {
  home: Home;
  rev: number;
  view: CameraRequest;
  preset: RenderPreset;
  time: TimeOfDay;
  blender: string;
  script: string;
  folder: string;
  /** the home's folder, where pictures on materials are */
  files?: string;
  /** the folder of the person's own 3D models, which Blender reads directly */
  models?: string;
}

export function renderPhotoreal(opts: RenderOptions): Promise<RenderResult> {
  const job = queue.then(() => run(opts));
  queue = job.catch(() => undefined);
  return job;
}

async function run(opts: RenderOptions): Promise<RenderResult> {
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
  const lighting = lightingFor(opts.home, level, pose.eye, opts.time);
  // The person's own models stay out of the 3D file; Blender reads them from their folder.
  const models = opts.models
    ? opts.home.items.flatMap((i) => {
        const file = i.model && i.level === level ? insideFolder(opts.models!, i.model.file) : null;
        return file && existsSync(file) && i.model ? [{ item: i.id, file, fit: i.model.fit, yaw: i.model.yaw, size: i.size }] : [];
      })
    : [];
  const out = join(dir, 'picture.png');
  writeFileSync(join(dir, 'job.json'), `${JSON.stringify({ rev: opts.rev, preset: opts.preset, camera, view: opts.view, lighting }, null, 2)}\n`);

  const log = join(dir, 'blender.log');
  const lines = await runBlender(
    opts.blender,
    [
      '-b',
      '--factory-startup',
      '--python',
      opts.script,
      '--',
      '--glb',
      glb,
      '--out',
      out,
      '--camera',
      JSON.stringify(camera),
      '--preset',
      opts.preset,
      '--blend',
      join(dir, 'scene.blend'),
      '--lighting',
      JSON.stringify(lighting),
      ...(opts.files ? ['--files', opts.files] : []),
      ...(models.length ? ['--models', JSON.stringify(models)] : []),
    ],
    TIMEOUT_MS[opts.preset],
    log,
  );
  // The script's last word is one marker line; read from the end.
  for (const line of lines.reverse()) {
    if (line.startsWith('FULLSCALE_RESULT ')) {
      const r = JSON.parse(line.slice('FULLSCALE_RESULT '.length)) as { width: number; height: number; seconds: number; device: string; blend?: string; lighting?: RenderLighting };
      return {
        file: out,
        ...(r.blend ? { blend: r.blend } : {}),
        width: r.width,
        height: r.height,
        seconds: r.seconds,
        device: r.device,
        rev: opts.rev,
        ...(r.lighting ? { lighting: r.lighting } : {}),
      };
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
