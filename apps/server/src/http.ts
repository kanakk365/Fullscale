// The studio's HTTP server, on this computer only. It serves:
//   /health                 whether the studio is up (no token needed)
//   /mcp                    the agent tools (MCP)
//   /live                   the WebSocket for the editor and Blender
//   /api/home, /api/home.glb, /api/plan.png
//                           the home as JSON, as a 3D file (GLB), and its plan as a picture
//   /files/models/…         the user's own 3D models, to this computer's editor only
//   /files/home/…           pictures and captures in the home's folder
//   /                       the editor, when it has been built
// Everything except /health and the editor's files needs the studio token.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { SOCKET_PATH } from '@fullscale/protocol';
import { exportHomeGlb } from '@fullscale/three';
import { bearerToken, hostAllowed, originAllowed, sameToken } from './access.ts';
import { insideFolder } from './files.ts';
import { LiveHub } from './live.ts';
import { mcpHandler } from './mcp.ts';
import { renderPlanPng } from './render-plan-png.ts';
import type { Studio } from './studio.ts';
import type { Versions } from './versions.ts';
import type { ToolContext } from './tools/index.ts';
import { NAME, VERSION } from './version.ts';

export interface StudioServerOptions {
  studio: Studio;
  /** the real home and its designs */
  versions?: Versions;
  token: string;
  paths: ToolContext['paths'];
  /** 0 picks a free port */
  port: number;
  /** the built editor, served at / */
  editorDir?: string;
  /** web origins allowed besides the studio's own, e.g. the editor's development server */
  allowOrigins?: string[];
  log?: (message: string) => void;
}

export interface StudioServer {
  url: string;
  port: number;
  live: LiveHub;
  close(): Promise<void>;
}

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.woff2': 'font/woff2',
};

export function startStudioServer(opts: StudioServerOptions): Promise<StudioServer> {
  const log = opts.log ?? ((m: string) => console.error(m));
  const live = new LiveHub({ studio: opts.studio, token: opts.token, log, ...(opts.versions ? { versions: opts.versions } : {}) });
  let port = opts.port;
  const tools = mcpHandler({ studio: opts.studio, actor: 'agent', by: 'agent', paths: opts.paths, editor: live, ...(opts.versions ? { versions: opts.versions } : {}) });
  const mcp = toNodeHandler(tools);

  const server: Server = createServer((req, res) => {
    void route(req, res).catch((err: Error) => {
      log(`request failed: ${err.stack ?? err.message}`);
      if (!res.headersSent) reply(res, 500, { error: 'Something went wrong inside the studio.' });
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!hostAllowed(req, port) || !originAllowed(req, port, opts.allowOrigins)) return reply(res, 403, { error: 'This studio only answers this computer.' });
    const url = new URL(req.url ?? '/', 'http://studio.local');
    const path = decodeURIComponent(url.pathname);

    if (path === '/health') return reply(res, 200, { ok: true, name: NAME, version: VERSION });

    const authorised = sameToken(bearerToken(req), opts.token);
    if (path === '/mcp') {
      if (!authorised) return reply(res, 401, { error: 'Missing or wrong studio token. Use "fullscale mcp", which reads it for you.' }, { 'www-authenticate': 'Bearer' });
      return mcp(req, res);
    }
    if (path.startsWith('/api/') || path.startsWith('/files/')) {
      if (!authorised) return reply(res, 401, { error: 'Missing or wrong studio token.' }, { 'www-authenticate': 'Bearer' });
      if (req.method !== 'GET') return reply(res, 405, { error: 'Only GET here; edits go through /live or /mcp.' });
      if (path === '/api/home') return reply(res, 200, { rev: opts.studio.rev, home: opts.studio.home });
      if (path === '/api/plan.png') {
        const level = url.searchParams.get('level') ?? undefined;
        const width = Math.min(2048, Math.max(256, Number(url.searchParams.get('width') ?? 1024) || 1024));
        const { png } = renderPlanPng(opts.studio.home, { width, ...(level ? { level } : {}) });
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        return void res.end(png);
      }
      if (path === '/api/home.glb') {
        // Pinned to the revision it was built from, so a client can tell if it is stale.
        const glb = exportHomeGlb(opts.studio.home, { ceilings: url.searchParams.get('ceilings') === '1' });
        res.writeHead(200, { 'content-type': 'model/gltf-binary', 'content-length': glb.byteLength, 'x-fullscale-rev': String(opts.studio.rev), 'cache-control': 'no-store' });
        return void res.end(glb);
      }
      if (path.startsWith('/files/models/')) return sendFile(res, insideFolder(opts.paths.models, path.slice('/files/models/'.length)));
      if (path.startsWith('/files/home/')) return sendFile(res, insideFolder(opts.paths.homeDir, path.slice('/files/home/'.length)));
      return reply(res, 404, { error: 'Not found.' });
    }
    if (opts.editorDir && req.method === 'GET') {
      const file = path === '/' ? 'index.html' : path.slice(1);
      const full = insideFolder(opts.editorDir, file);
      if (full && existsSync(full) && statSync(full).isFile()) return sendFile(res, full);
      // The editor is a single page: unknown paths get the page.
      return sendFile(res, join(opts.editorDir, 'index.html'));
    }
    return reply(res, 404, { error: 'Not found. The editor has not been built; run "npm run build" in the project folder, or use "npm run dev".' });
  }

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://studio.local');
    if (url.pathname !== SOCKET_PATH || !hostAllowed(req, port) || !originAllowed(req, port, opts.allowOrigins)) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    live.upgrade(req, socket, head);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => {
      const address = server.address();
      port = typeof address === 'object' && address ? address.port : opts.port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        live,
        close: async () => {
          live.close();
          await tools.close();
          await new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
  });
}

function reply(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function sendFile(res: ServerResponse, full: string | null): void {
  if (!full || !existsSync(full) || !statSync(full).isFile()) {
    reply(res, 404, { error: 'No such file.' });
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(full).toLowerCase()] ?? 'application/octet-stream', 'content-length': statSync(full).size, 'cache-control': 'no-store' });
  createReadStream(full).pipe(res);
}
