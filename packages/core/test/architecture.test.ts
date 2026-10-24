import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The core must run anywhere: in the server, the browser, tests and agents. So it may only
// import zod and its own files.
const SRC = join(import.meta.dirname, '../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
}

describe('core boundaries', () => {
  const files = sourceFiles(SRC);

  it('scans the whole package', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('imports nothing but zod and its own files', () => {
    const outside: string[] = [];
    for (const file of files) {
      for (const [, spec] of readFileSync(file, 'utf8').matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
        if (!spec!.startsWith('.') && spec !== 'zod') outside.push(`${file.slice(SRC.length + 1)} → ${spec}`);
      }
    }
    expect(outside).toEqual([]);
  });
});
