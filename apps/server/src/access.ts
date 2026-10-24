// Who may talk to the studio. The server listens on this computer only, and every request
// that reads or changes the home carries the studio token: in an Authorization header, or
// in the first WebSocket message (browsers can't set WebSocket headers). Host and Origin
// are checked too, so a web page can't reach the studio by pointing a domain at
// 127.0.0.1 (DNS rebinding) or by posting to it from another site.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';

const TOKEN_FILE = 'token';
const SERVER_FILE = 'server.json';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** The studio token, created once with owner-only permissions and kept for later runs. */
export function studioToken(runDir: string): string {
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const file = join(runDir, TOKEN_FILE);
  if (existsSync(file)) {
    // A token anyone on the computer can read is no secret: tighten it.
    if ((statSync(file).mode & 0o077) !== 0) chmodSync(file, 0o600);
    const token = readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(token)) return token;
  }
  const token = randomBytes(32).toString('hex');
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

/** Compare tokens in constant time. */
export function sameToken(given: string | undefined, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
}

/** The Host header must name this computer, on our port. */
export function hostAllowed(req: IncomingMessage, port: number): boolean {
  const host = req.headers.host;
  if (!host) return false;
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(host);
  return !!match && LOCAL_HOSTS.has(match[1]!.toLowerCase()) && Number(match[2] ?? 80) === port;
}

/** Requests from web pages must come from the studio's own pages (or an allowed origin,
 *  like the editor's development server). Requests without an Origin are not from pages. */
export function originAllowed(req: IncomingMessage, port: number, extra: readonly string[] = []): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (extra.includes(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname === '::1' ? '[::1]' : url.hostname) && Number(url.port || 80) === port;
  } catch {
    return false;
  }
}

export interface RunningServer {
  pid: number;
  port: number;
  url: string;
  version: string;
  home: string;
  startedAt: string;
}

/** Record the running server so `fullscale mcp` and others can find it. */
export function writeRunningServer(runDir: string, info: RunningServer): void {
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(runDir, SERVER_FILE), `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
}

export function readRunningServer(runDir: string): RunningServer | null {
  try {
    return JSON.parse(readFileSync(join(runDir, SERVER_FILE), 'utf8')) as RunningServer;
  } catch {
    return null;
  }
}

/** Remove the record, if it is still ours. */
export function clearRunningServer(runDir: string, pid = process.pid): void {
  const info = readRunningServer(runDir);
  if (info?.pid === pid) rmSync(join(runDir, SERVER_FILE), { force: true });
}
