// Reading a capture folder from disk: the manifest, each room's scanner layout and the tape
// checks. Paths come from the manifest, so each is checked to stay inside the capture.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ManifestSchema, readJsonLines, TapeCheckSchema, type ScanInput } from '@fullscale/capture';
import { EditError } from '@fullscale/core';
import { insideFolder } from './files.ts';

/** Read a capture for import. `path` is relative to the home's folder. */
export function readCapture(homeDir: string, path: string): { input: ScanInput; problems: string[] } {
  const dir = insideFolder(homeDir, path);
  if (!dir || !existsSync(join(dir, 'manifest.json'))) {
    throw new EditError('not_found', `No capture at "${path}": put the capture's folder (unzipped) inside the home's folder and give its path from there.`, { path });
  }
  const manifest = ManifestSchema.safeParse(readJson(join(dir, 'manifest.json')));
  if (!manifest.success) {
    const issue = manifest.error.issues[0];
    throw new EditError('invalid_input', `"${path}/manifest.json" is not a fullscale-capture/1 manifest: ${issue?.path.join('.')} ${issue?.message}`, { path });
  }
  const problems: string[] = [];
  if (manifest.data.status !== 'complete') problems.push(`The capture is marked "${manifest.data.status}": it may be missing its last room.`);
  const rooms: ScanInput['rooms'] = [];
  for (const room of manifest.data.rooms) {
    const file = insideFolder(dir, `${room.dir}/roomplan.json`);
    if (!file || !existsSync(file)) {
      problems.push(`Room "${room.name}" has no scanner layout (${room.dir}/roomplan.json).`);
      continue;
    }
    rooms.push({ id: room.id, name: room.name, layout: readJson(file) });
  }
  const tapeFile = join(dir, 'checks', 'tape.jsonl');
  const tape = existsSync(tapeFile) ? readJsonLines(readFileSync(tapeFile, 'utf8'), TapeCheckSchema) : { records: [], problems: [] };
  problems.push(...tape.problems.map((p) => `Tape checks, ${p}.`));
  return { input: { path, manifest: manifest.data, rooms, checks: tape.records }, problems };
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new EditError('invalid_input', `${file} is not valid JSON: ${(err as Error).message}`);
  }
}
