import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { sampleFlat } from '@fullscale/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readHomeFile, Saver, writeHomeFile } from '../src/files.ts';
import { mcpHandler } from '../src/mcp.ts';
import { Studio } from '../src/studio.ts';
import { Versions } from '../src/versions.ts';

type Content = Array<{ type: string; text?: string }>;
let dir: string;
let studio: Studio;
let versions: Versions;
let handler: ReturnType<typeof mcpHandler>;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  return { ...r, text: (r.content as Content).find((c) => c.type === 'text')?.text ?? '', data: r.structuredContent as Record<string, unknown> };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fullscale-designs-'));
  const file = join(dir, 'home.json');
  writeHomeFile(file, sampleFlat());
  // Saved at once, so the files can be checked straight after each edit.
  versions = new Versions(file, join(dir, 'designs'), (f) => new Saver(f, 0));
  studio = new Studio({ home: readHomeFile(file).home, save: (h) => versions.save(h) });
  handler = mcpHandler({ studio, versions, actor: 'agent', by: 'agent', paths: { data: dir, models: join(dir, 'models'), run: join(dir, 'run'), homeDir: dir } });
  client = new Client({ name: 'test-agent', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://studio.test/mcp'), { fetch: (url, init) => handler.fetch(new Request(url, init)) }));
});

afterEach(async () => {
  versions.flush();
  await client.close();
  await handler.close();
});

describe('designs', () => {
  it('keeps the real home as it is while a design is changed', async () => {
    const made = await call('new_design', { name: 'Calm and tidy', note: 'Fewer things, softer colours' });
    expect(made.isError).toBeFalsy();
    expect(versions.open).toBe('calm-and-tidy');
    expect(studio.home.design).toEqual({ from: 'real', note: 'Fewer things, softer colours' });
    const sofa = studio.home.items.find((i) => i.catalog.startsWith('sofa'))!;
    expect((await call('remove', { ids: [sofa.id] })).isError).toBeFalsy();
    versions.flush();
    // The design lost its sofa; the real home's file still has it.
    expect(readHomeFile(join(dir, 'designs', 'calm-and-tidy.json')).home.items.some((i) => i.id === sofa.id)).toBe(false);
    expect(readHomeFile(join(dir, 'home.json')).home.items.some((i) => i.id === sofa.id)).toBe(true);

    const list = await call('list_designs');
    expect(list.text).toContain('▶ calm-and-tidy: Calm and tidy (0 added, 1 removed, 0 changed). Fewer things, softer colours');

    await call('open_design', { design: 'real' });
    expect(studio.home.items.some((i) => i.id === sofa.id)).toBe(true);
    expect(studio.home.design).toBeUndefined();
  });

  it('copies from any version, never deletes the real home, and closes a deleted design', async () => {
    await call('new_design', { name: 'Idea', open: false });
    expect(versions.open).toBe('real');
    await call('new_design', { name: 'Idea', from: 'idea' });
    expect(versions.open).toBe('idea-2');
    expect(studio.home.design?.from).toBe('idea');
    const refused = await call('delete_design', { design: 'real' });
    expect(refused.isError).toBe(true);
    await call('delete_design', { design: 'idea-2' });
    expect(versions.open).toBe('real');
    expect(existsSync(join(dir, 'designs', 'idea-2.json'))).toBe(false);
    expect(versions.list().map((v) => v.id)).toEqual(['real', 'idea']);
  });

  it('tells the editor when the open home changes', async () => {
    const events: string[] = [];
    studio.on((e) => {
      if (e.type === 'replaced') events.push(e.reason);
    });
    await call('new_design', { name: 'Bed by the window' });
    expect(events).toEqual(['opened the design "Bed by the window"']);
  });
});
