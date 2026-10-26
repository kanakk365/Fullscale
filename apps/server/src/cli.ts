// The `fullscale` command.
//
//   fullscale serve [--home <folder>] [--port <n>] [--sample] [--name <text>] [--open]
//       Open a home (creating it if needed) and serve the editor, Blender and agents.
//   fullscale mcp
//       For agent apps that start MCP servers over stdio: connects to the running studio,
//       starting it if needed.
//   fullscale token
//       Print the studio token, for agent apps that connect to http://127.0.0.1:<port>/mcp.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createHome, sampleFlat } from '@fullscale/core';
import { clearRunningServer, readRunningServer, studioToken, writeRunningServer } from './access.ts';
import { bridge, ensureStudio, studioUp } from './bridge.ts';
import { defaultPaths, homeFileOf, readHomeFile, shortPath, writeHomeFile } from './files.ts';
import { startStudioServer, type StudioServer } from './http.ts';
import { Studio } from './studio.ts';
import { Versions } from './versions.ts';
import { VERSION } from './version.ts';

const DEFAULT_PORT = 4747;
const HERE = dirname(fileURLToPath(import.meta.url));
const EDITOR_DIR = resolve(HERE, '../../editor/dist');

async function serve(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      home: { type: 'string' },
      port: { type: 'string' },
      sample: { type: 'boolean' },
      name: { type: 'string' },
      open: { type: 'boolean' },
      'allow-origin': { type: 'string', multiple: true },
      quiet: { type: 'boolean' },
    },
  });
  const paths = defaultPaths();
  const file = homeFileOf(resolve(values.home ?? resolve(paths.data, 'homes', 'my-home')));
  const say = (m: string) => {
    if (!values.quiet) console.log(m);
  };

  const running = readRunningServer(paths.run);
  if (running && (await studioUp(running.url))) {
    console.error(`A studio is already running at ${running.url} (process ${running.pid}) with ${running.home}. Stop it first.`);
    process.exitCode = 1;
    return;
  }

  if (!existsSync(file)) {
    const home = values.sample ? sampleFlat() : createHome({ name: values.name ?? 'My home' });
    writeHomeFile(file, home);
    say(`Created ${shortPath(file)}${values.sample ? ' from the sample flat' : ''}.`);
  }
  const { home, report } = readHomeFile(file);
  for (const step of report.upgraded) say(`Upgraded the file: ${step}.`);
  for (const q of report.quarantined) console.error(`Set aside a damaged ${q.collection.replace(/s$/, '')}${q.id ? ` "${q.id}"` : ''}: ${q.problem}`);

  // The real home and its designs; edits are saved to whichever is open.
  const versions = new Versions(file, join(dirname(file), 'designs'));
  const studio = new Studio({ home, save: (h) => versions.save(h) });
  if (report.upgraded.length) versions.save(home);
  const token = studioToken(paths.run);
  const port = values.port !== undefined ? Number(values.port) : DEFAULT_PORT;
  let server: StudioServer;
  try {
    server = await startStudioServer({
      studio,
      versions,
      token,
      port,
      paths: { ...paths, homeDir: dirname(file) },
      ...(existsSync(EDITOR_DIR) ? { editorDir: EDITOR_DIR } : {}),
      ...(values['allow-origin'] ? { allowOrigins: values['allow-origin'] } : {}),
    });
  } catch (err) {
    const busy = (err as NodeJS.ErrnoException).code === 'EADDRINUSE';
    console.error(busy ? `Port ${port} is in use. Pick another with --port, or --port 0 for any free one.` : (err as Error).message);
    process.exitCode = 1;
    return;
  }
  writeRunningServer(paths.run, { pid: process.pid, port: server.port, url: server.url, version: VERSION, home: file, startedAt: new Date().toISOString() });

  const editorUrl = `${server.url}/#token=${token}`;
  say(`Fullscale ${VERSION}: "${home.name}" from ${shortPath(file)}`);
  say(existsSync(EDITOR_DIR) ? `Editor:  ${editorUrl}` : 'Editor:  not built yet (run "npm run build"), or run "npm run dev" for the development editor.');
  say(`Agents:  run "fullscale mcp" as an MCP server, or connect to ${server.url}/mcp with the token from "fullscale token".`);
  if (values.open && existsSync(EDITOR_DIR)) openBrowser(editorUrl);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    versions.flush();
    clearRunningServer(paths.run);
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}

async function mcp(): Promise<void> {
  const paths = defaultPaths();
  const self = process.argv[1]!;
  const url = await ensureStudio(paths, { command: process.execPath, args: [...process.execArgv, self, 'serve', '--quiet'] });
  await bridge({ url, token: studioToken(paths.run), input: process.stdin, output: process.stdout });
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  spawn(command, [url], { stdio: 'ignore', detached: true }).unref();
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case 'serve':
    await serve(rest);
    break;
  case 'mcp':
    await mcp();
    break;
  case 'token':
    console.log(studioToken(defaultPaths().run));
    break;
  default:
    console.log('Usage: fullscale serve [--home <folder>] [--port <n>] [--sample] [--name <text>] [--open]\n       fullscale mcp\n       fullscale token');
    process.exitCode = command === undefined || command === 'help' || command === '--help' ? 0 : 1;
}
