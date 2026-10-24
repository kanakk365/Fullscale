// Opening home files written by older versions, or with damaged parts.
//
// Each format version has one step that upgrades the raw JSON to the next version, so old
// files always open and the current schema carries no leftover fields. An element that
// still fails to load is quarantined: kept exactly as it was, reported, and saved back
// unchanged, so a bad file never silently loses data.
import type { z } from 'zod';
import { EditError } from './errors.ts';
import { counterFloor } from './ids.ts';
import { CaptureRefSchema, FORMAT, HomeSchema, ItemSchema, LevelSchema, MaterialSchema, OpeningSchema, RoomSchema, WallSchema, type Home } from './schema.ts';

type Raw = Record<string, unknown>;

interface MigrationStep {
  from: string;
  to: string;
  up(raw: Raw): Raw;
}

const asList = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);

const STEPS: readonly MigrationStep[] = [
  {
    // Version 0 filled heights in from defaults and copied each level's height into its
    // walls. Version 1 stores only values that were set, so walls follow their level.
    from: 'fullscale/0',
    to: 'fullscale/1',
    up(raw) {
      const levels: Raw[] = asList(raw.levels).map((l) => ({ elevation: 0, height: 2.7, ...l }));
      const levelHeight = new Map(levels.map((l) => [l.id, l.height]));
      const walls = asList(raw.walls).map((w) => {
        const wall: Raw = { thickness: 0.12, ...w };
        const source = wall.source as { kind?: string } | undefined;
        if (wall.height === levelHeight.get(wall.level) && source?.kind !== 'scan') delete wall.height;
        return wall;
      });
      const openings = asList(raw.openings).map((o) => ({ sill: 0, ...o }));
      return { ...raw, format: 'fullscale/1', levels, walls, openings };
    },
  },
];

const ELEMENT_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  levels: LevelSchema,
  walls: WallSchema,
  openings: OpeningSchema,
  rooms: RoomSchema,
  items: ItemSchema,
  materials: MaterialSchema,
  captures: CaptureRefSchema,
};

export interface LoadReport {
  /** the format the file was written in */
  from: string;
  /** upgrade steps that ran, e.g. ["fullscale/0 → fullscale/1"] */
  upgraded: string[];
  /** elements that failed to load and were set aside */
  quarantined: Array<{ collection: string; id?: string; problem: string }>;
}

/** Upgrade raw JSON to the current format. */
export function migrateRaw(input: unknown): { raw: Raw; from: string; upgraded: string[] } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new EditError('invalid_input', 'This is not a home file: expected a JSON object.');
  }
  let raw = input as Raw;
  const from = String(raw.format);
  const upgraded: string[] = [];
  while (raw.format !== FORMAT) {
    const step = STEPS.find((s) => s.from === raw.format);
    if (!step) {
      const known = [...STEPS.map((s) => s.from), FORMAT].join(', ');
      throw new EditError('invalid_input', `Unknown home format "${String(raw.format)}". This version reads: ${known}.`, { format: raw.format });
    }
    raw = step.up(raw);
    upgraded.push(`${step.from} → ${step.to}`);
  }
  return { raw, from, upgraded };
}

/** Open a home file of any known version. Bad elements are quarantined, not dropped. */
export function loadHome(input: unknown): { home: Home; report: LoadReport } {
  const { raw, from, upgraded } = migrateRaw(input);
  const quarantined: LoadReport['quarantined'] = [];
  const kept: Raw = { ...raw, quarantine: [...asList(raw.quarantine)] };

  for (const [collection, schema] of Object.entries(ELEMENT_SCHEMAS)) {
    if (!Array.isArray(raw[collection])) continue;
    const good: unknown[] = [];
    for (const element of raw[collection] as unknown[]) {
      const result = schema.safeParse(element);
      if (result.success) {
        good.push(element);
        continue;
      }
      const issue = result.error.issues[0];
      const problem = `${issue?.path.join('.') || '(element)'}: ${issue?.message}`;
      const id = typeof (element as Raw)?.id === 'string' ? ((element as Raw).id as string) : undefined;
      quarantined.push({ collection, ...(id ? { id } : {}), problem });
      (kept.quarantine as unknown[]).push({ collection, element, problem });
    }
    kept[collection] = good;
  }

  const result = HomeSchema.safeParse(kept);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new EditError('invalid_input', `This home file can't be opened: ${issue?.path.join('.') || '(root)'}: ${issue?.message}`);
  }
  const home = result.data;
  home.nextIds = counterFloor(home);
  return { home, report: { from, upgraded, quarantined } };
}
