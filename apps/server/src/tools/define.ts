// How agent tools are defined. A tool is a name, a description, an input schema and a run
// function; it knows nothing about MCP, so the same tools can be served over MCP, called by
// tests, or used by other front ends. Every change goes through the studio, and every
// write answers with what really changed (`achieved`), counted from the home itself.
import { lengthField, type Achieved, type SourceKind, type Vec2 } from '@fullscale/core';
import type { View } from '@fullscale/protocol';
import { z } from 'zod';
import type { Paths } from '../files.ts';
import type { Studio } from '../studio.ts';

export interface ToolContext {
  studio: Studio;
  /** the undo actor for this caller, e.g. "agent" */
  actor: string;
  /** where numbers this caller sets come from */
  by: SourceKind;
  paths: Paths & {
    /** the open home's folder; pictures and captures are relative to it */
    homeDir: string;
  };
  /** the person's editor, when the studio has live clients */
  editor?: {
    /** is an editor open that can draw 3D pictures? */
    canRender(): boolean;
    render(view: View, size: { width: number; height: number }): Promise<Buffer>;
  };
}

export interface ToolResult {
  /** what the agent reads first: short, with the key numbers */
  text: string;
  /** the same answer as data */
  data: Record<string, unknown>;
  images?: Buffer[];
}

export interface Tool<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: S;
  /** read: changes nothing; write: changes the home; destructive: can remove things */
  effect: 'read' | 'write' | 'destructive';
  run(ctx: ToolContext, input: z.output<S>): ToolResult | Promise<ToolResult>;
}

export function defineTool<S extends z.ZodObject>(tool: Tool<S>): Tool<S> {
  return tool;
}

// ---------- inputs ----------

/** A point on the floor plan. A plain list rather than a tuple: some clients drop tools
 *  whose schemas use tuple syntax. */
export const Point = z
  .array(z.number().finite())
  .length(2)
  .describe('[x, z] in metres on the floor plan: x to the right, z down the plan')
  .transform((p) => p as unknown as Vec2);

const UNIT_HINT = 'metres, or text with a unit like "350 cm" or "11\' 6\\""';

/** A length in metres; text with a unit is converted. */
export const Length = (what: string, opts: { min?: number; max?: number } = {}) => lengthField({ positive: true, ...opts }).describe(`${what} (${UNIT_HINT})`);

/** A distance that may be zero (offsets, gaps, heights above the floor). */
export const Distance = (what: string) => lengthField({ min: 0 }).describe(`${what} (${UNIT_HINT})`);

/** A size [width, height, depth]. */
export const Size = z
  .array(lengthField({ positive: true }))
  .length(3)
  .describe(`[width, height, depth], each in ${UNIT_HINT}`)
  .transform((s) => s as unknown as [number, number, number]);

export const Id = z.string().min(1).max(64);

export const WriteOptions = {
  expect_rev: z.number().int().nonnegative().optional().describe('refuse with stale_revision if the home has changed since this revision'),
  dry_run: z.boolean().optional().describe('check and report what would happen, without changing anything'),
};

// ---------- writes ----------

export interface Receipt {
  rev: number;
  achieved: Achieved;
  changed: string[];
  removed: string[];
  notes: string[];
  dry_run: boolean;
}

/** Apply a core operation for the caller and return the receipt. */
export function write(ctx: ToolContext, operation: unknown, opts: { label?: string; expect_rev?: number; dry_run?: boolean } = {}): Receipt {
  const applied = ctx.studio.apply(operation, {
    actor: ctx.actor,
    by: ctx.by,
    ...(opts.label ? { label: opts.label } : {}),
    ...(opts.expect_rev !== undefined ? { expectRev: opts.expect_rev } : {}),
    ...(opts.dry_run ? { dryRun: true } : {}),
  });
  return { rev: applied.rev, achieved: applied.achieved, changed: applied.changed, removed: applied.removed, notes: applied.notes, dry_run: applied.dryRun };
}

/** One line saying what an edit did, e.g. "Created 2 walls, 1 room; updated 1 wall." */
export function describeReceipt(r: Receipt): string {
  const part = (verb: string, counts: Record<string, number | undefined>) => {
    const items = Object.entries(counts)
      .filter(([, n]) => n)
      .map(([kind, n]) => `${n} ${kind}${n === 1 ? '' : 's'}`);
    return items.length ? `${verb} ${items.join(', ')}` : '';
  };
  const parts = [part('created', r.achieved.created), part('updated', r.achieved.updated), part('removed', r.achieved.deleted)].filter(Boolean);
  const what = r.achieved.unchanged ? 'Nothing changed' : `${r.dry_run ? 'Would have ' : ''}${parts.join('; ')}`;
  const head = `${what.charAt(0).toUpperCase()}${what.slice(1)}.${r.dry_run ? ' (dry run: nothing was changed)' : ''} Revision ${r.rev}.`;
  return [head, ...r.notes].join('\n');
}

/** A tool answer for a write. */
export function receiptResult(r: Receipt, extra: Record<string, unknown> = {}): ToolResult {
  return { text: describeReceipt(r), data: { ...r, ...extra } };
}

export const m = (v: number) => `${(Math.round(v * 100) / 100).toFixed(2)} m`;
