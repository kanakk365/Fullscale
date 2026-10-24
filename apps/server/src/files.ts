// Where things live on disk, and reading and writing home files safely.
//
// A home is a folder: `home.json` plus the pictures and captures it refers to by relative
// path. Saves write a temporary file and rename it over the old one, so a crash mid-save
// never leaves half a file. The run folder (~/.fullscale by default) holds the access token
// and the running server's address.
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadHome, type Home, type LoadReport } from '@fullscale/core';

export const HOME_FILE = 'home.json';

export interface Paths {
  /** data folder: homes and local models */
  data: string;
  /** the user's own 3D models (git-ignored) */
  models: string;
  /** token and running-server file */
  run: string;
}

export function defaultPaths(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Paths {
  const data = resolve(cwd, env.FULLSCALE_DATA ?? 'data');
  return {
    data,
    models: resolve(data, env.FULLSCALE_MODELS ?? 'models'),
    run: resolve(env.FULLSCALE_RUN ?? join(homedir(), '.fullscale')),
  };
}

/**
 * Join a relative path onto a folder, or return null if the result would be outside it.
 * Symbolic links are followed for files that exist, so a link can't point out either.
 */
export function insideFolder(root: string, path: string): string | null {
  if (isAbsolute(path) || path.includes('\0')) return null;
  const full = resolve(root, path);
  const within = (p: string, r: string) => p === r || p.startsWith(r.endsWith(sep) ? r : r + sep);
  if (!within(full, resolve(root))) return null;
  if (existsSync(full)) {
    const real = realpathSync(full);
    const realRoot = realpathSync(root);
    if (!within(real, realRoot)) return null;
  }
  return full;
}

/** The home file for a path that names a home folder or a home.json file. */
export function homeFileOf(path: string): string {
  return existsSync(path) && statSync(path).isDirectory() ? join(path, HOME_FILE) : path;
}

export function readHomeFile(file: string): { home: Home; report: LoadReport } {
  const text = readFileSync(file, 'utf8');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${(err as Error).message}`);
  }
  return loadHome(raw);
}

/** Write a home file atomically. */
export function writeHomeFile(file: string, home: Home): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(home, null, 2)}\n`);
  renameSync(tmp, file);
}

/** Saves a home shortly after the last change, so a drag doesn't write a file per frame.
 *  `flush` writes any pending save at once (call it before exiting). */
export class Saver {
  private pending: Home | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly file: string;
  private readonly delayMs: number;
  private readonly onError: (err: Error) => void;

  constructor(file: string, delayMs = 300, onError: (err: Error) => void = (err) => console.error(`Could not save ${file}: ${err.message}`)) {
    this.file = file;
    this.delayMs = delayMs;
    this.onError = onError;
  }

  save(home: Home): void {
    this.pending = home;
    this.timer ??= setTimeout(() => this.flush(), this.delayMs);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const home = this.pending;
    this.pending = null;
    if (!home) return;
    try {
      writeHomeFile(this.file, home);
    } catch (err) {
      this.onError(err as Error);
    }
  }
}

/** A path for display: relative to the current folder when that is shorter. */
export function shortPath(path: string, cwd = process.cwd()): string {
  const rel = relative(cwd, path);
  return rel && !rel.startsWith('..') && rel.length < path.length ? rel : path;
}
