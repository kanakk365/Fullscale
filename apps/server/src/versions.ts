// The real home and its designs. A design is a copy of the home (or of another design) to try
// a redesign on: its own file in the home's `designs/` folder, sharing the home's captures,
// pictures and renders, so the real home stays as it was scanned. One of them is open in the
// studio at a time; every edit, from the editor, an agent or Blender, goes to the open one.
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { EditError, type Home } from '@fullscale/core';
import { readHomeFile, Saver } from './files.ts';
import type { Studio } from './studio.ts';

export const REAL = 'real';

export interface Version {
  /** "real" for the real home, else the design's id */
  id: string;
  name: string;
  /** what a design was copied from */
  from?: string;
  note?: string;
  createdAt: string;
}

export class Versions {
  private active = REAL;
  private saver: Saver;
  private readonly listeners = new Set<() => void>();
  private readonly realFile: string;
  private readonly designsDir: string;
  private readonly makeSaver: (file: string) => Saver;

  constructor(realFile: string, designsDir: string, makeSaver: (file: string) => Saver = (file) => new Saver(file)) {
    this.realFile = realFile;
    this.designsDir = designsDir;
    this.makeSaver = makeSaver;
    this.saver = makeSaver(realFile);
  }

  /** The version open in the studio. */
  get open(): string {
    return this.active;
  }

  /** Save the open version (the studio's save hook). */
  save(home: Home): void {
    this.saver.save(home);
  }

  flush(): void {
    this.saver.flush();
  }

  list(): Version[] {
    const versions: Version[] = [];
    if (existsSync(this.realFile)) versions.push(describe(REAL, readHomeFile(this.realFile).home));
    if (existsSync(this.designsDir)) {
      for (const file of readdirSync(this.designsDir)
        .filter((f) => f.endsWith('.json'))
        .sort()) {
        versions.push(describe(file.slice(0, -'.json'.length), readHomeFile(join(this.designsDir, file)).home));
      }
    }
    return versions.sort((a, b) => (a.id === REAL ? -1 : b.id === REAL ? 1 : a.createdAt.localeCompare(b.createdAt)));
  }

  /** A version's home as saved (the open one: as it is now, in the studio). */
  read(id: string, studio: Studio): Home {
    if (id === this.active) return studio.home;
    return readHomeFile(this.fileOf(id)).home;
  }

  /** Copy a version into a new design; returns it. Doesn't open it. */
  create(studio: Studio, name: string, opts: { from?: string; note?: string } = {}): Version {
    const from = opts.from ?? this.active;
    const source = this.read(from, studio);
    const id = this.freeId(name);
    const now = new Date().toISOString();
    const home: Home = {
      ...structuredClone(source),
      id: `${source.id.split('.')[0]}.${id}`.slice(0, 64),
      name,
      createdAt: now,
      updatedAt: now,
      design: { from, ...(opts.note ? { note: opts.note } : {}) },
    };
    mkdirSync(this.designsDir, { recursive: true });
    const saver = this.makeSaver(this.fileOf(id));
    saver.save(home);
    saver.flush();
    this.changed();
    return describe(id, home);
  }

  /** Open a version in the studio, saving the one that was open first. Undo starts again. */
  openVersion(id: string, studio: Studio): Version {
    const file = this.fileOf(id);
    if (!existsSync(file)) throw new EditError('not_found', `No design "${id}". list_designs shows them.`, { id, kind: 'design' });
    this.saver.flush();
    const { home } = readHomeFile(file);
    this.active = id;
    this.saver = this.makeSaver(file);
    studio.replace(home, id === REAL ? 'opened the real home' : `opened the design "${home.name}"`);
    this.changed();
    return describe(id, home);
  }

  /** Delete a design (never the real home). The open one is closed first. */
  remove(id: string, studio: Studio): void {
    if (id === REAL) throw new EditError('invalid_input', 'The real home can’t be deleted, only designs.');
    const file = this.fileOf(id);
    if (!existsSync(file)) throw new EditError('not_found', `No design "${id}".`, { id, kind: 'design' });
    if (this.active === id) this.openVersion(REAL, studio);
    rmSync(file);
    this.changed();
  }

  on(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  private fileOf(id: string): string {
    if (id === REAL) return this.realFile;
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) throw new EditError('not_found', `No design "${id}".`, { id, kind: 'design' });
    return join(this.designsDir, `${id}.json`);
  }

  private freeId(name: string): string {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32) || 'design';
    let id = base;
    for (let n = 2; id === REAL || existsSync(join(this.designsDir, `${id}.json`)); n++) id = `${base}-${n}`;
    return id;
  }
}

function describe(id: string, home: Home): Version {
  return { id, name: home.name, ...(home.design ? { from: home.design.from } : {}), ...(home.design?.note ? { note: home.design.note } : {}), createdAt: home.createdAt };
}
