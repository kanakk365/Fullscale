// `fullscale mcp`: for agent apps that start MCP servers as a local program and talk over
// stdin and stdout. It finds the running studio (starting one if needed), then passes each
// message to the studio's /mcp with the token, so the agent works on the same home as the
// editor. The agent app's configuration never holds the token.
//
// Over HTTP, newer protocol versions want a few headers that repeat what is in the message
// (the version, the method and the tool name). A stdio client sends none, so they are filled
// in here from the message itself.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { readRunningServer } from './access.ts';
import type { Paths } from './files.ts';

const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
/** Which field of a request's params the Mcp-Name header repeats. */
const NAME_FIELD: Readonly<Record<string, string>> = { 'tools/call': 'name', 'prompts/get': 'name', 'resources/read': 'uri' };

interface Message {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown> & { _meta?: Record<string, unknown> };
  result?: { protocolVersion?: unknown };
}

/** Is a studio answering at this address? */
export async function studioUp(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
    return r.ok && ((await r.json()) as { name?: string }).name === 'fullscale';
  } catch {
    return false;
  }
}

/** The running studio's address, starting one in the background if none is running. */
export async function ensureStudio(paths: Paths, startCommand: { command: string; args: string[] }): Promise<string> {
  const running = readRunningServer(paths.run);
  if (running && (await studioUp(running.url))) return running.url;
  const child = spawn(startCommand.command, startCommand.args, { detached: true, stdio: 'ignore', env: process.env });
  child.unref();
  for (let waited = 0; waited < 20_000; waited += 200) {
    await new Promise((r) => setTimeout(r, 200));
    const info = readRunningServer(paths.run);
    if (info && info.pid === child.pid && (await studioUp(info.url))) return info.url;
  }
  throw new Error('The studio did not start. Run "fullscale serve" in a terminal to see why.');
}

/** Pass MCP messages between stdin/stdout and the studio until stdin closes. */
export async function bridge(opts: { url: string; token: string; input: Readable; output: Writable; log?: (m: string) => void }): Promise<void> {
  const log = opts.log ?? ((m: string) => process.stderr.write(`${m}\n`));
  let negotiated: string | undefined;
  const write = (message: unknown): void => {
    opts.output.write(`${JSON.stringify(message)}\n`);
  };
  const pending = new Set<Promise<void>>();

  const forward = async (line: string): Promise<void> => {
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: the line is not JSON.' } });
    }
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${opts.token}`,
    };
    const claimed = message.params?._meta?.[VERSION_KEY];
    if (typeof claimed === 'string') {
      headers['mcp-protocol-version'] = claimed;
      if (message.method && message.id !== undefined) headers['mcp-method'] = message.method;
      const field = message.method ? NAME_FIELD[message.method] : undefined;
      const name = field ? message.params?.[field] : undefined;
      if (typeof name === 'string') headers['mcp-name'] = name;
    } else if (negotiated && message.method !== 'initialize') {
      headers['mcp-protocol-version'] = negotiated;
    }

    let response: Response;
    try {
      response = await fetch(`${opts.url}/mcp`, { method: 'POST', headers, body: line });
    } catch (err) {
      if (message.id !== undefined) write({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: `The studio is not reachable: ${(err as Error).message}` } });
      return;
    }
    const type = response.headers.get('content-type') ?? '';
    if (type.includes('text/event-stream') && response.body) {
      for await (const data of serverSentEvents(response.body)) emit(data);
    } else {
      const text = await response.text();
      if (text.trim()) emit(text);
      else if (!response.ok && message.id !== undefined) write({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: `The studio answered ${response.status}.` } });
    }

    function emit(text: string) {
      let reply: Message | Message[];
      try {
        reply = JSON.parse(text) as Message | Message[];
      } catch {
        log(`The studio sent something that is not JSON: ${text.slice(0, 200)}`);
        return;
      }
      for (const r of Array.isArray(reply) ? reply : [reply]) {
        if (message.method === 'initialize' && typeof r.result?.protocolVersion === 'string') negotiated = r.result.protocolVersion;
        write(r);
      }
    }
  };

  const lines = createInterface({ input: opts.input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const job = forward(line).catch((err: Error) => log(`bridge: ${err.message}`));
    pending.add(job);
    void job.finally(() => pending.delete(job));
  }
  await Promise.all(pending);
}

/** The data of each event in a server-sent event stream. */
async function* serverSentEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
    for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
      const event = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = event
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data) yield data;
    }
  }
}
