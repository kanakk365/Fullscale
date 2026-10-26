// Designs: copies of the real home to try a redesign on, so the real home stays as it was
// scanned. Agents start one, work in it like in the home, switch between them, and render
// them side by side from the same spot.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EditError, type Home } from '@fullscale/core';
import { ViewSchema } from '@fullscale/protocol';
import { z } from 'zod';
import { findBlender, renderPhotoreal, RENDER_SIZES, type RenderPreset, type TimeOfDay } from '../render.ts';
import { svgToPng } from '../render-plan-png.ts';
import { REAL, type Versions } from '../versions.ts';
import { defineTool, Id, type ToolContext } from './define.ts';
import { RENDER_SCRIPT } from './views.ts';

function versionsOf(ctx: ToolContext): Versions {
  if (!ctx.versions) throw new EditError('invalid_input', 'Designs aren’t available in this studio.');
  return ctx.versions;
}

/** What a design changes from another version: elements added, removed and changed. */
export function differences(from: Home, to: Home): { added: string[]; removed: string[]; changed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const collection of ['walls', 'openings', 'rooms', 'items', 'materials'] as const) {
    const before = new Map<string, unknown>(from[collection].map((e) => [e.id, e]));
    const after = new Map<string, unknown>(to[collection].map((e) => [e.id, e]));
    for (const [id, e] of after) {
      const name = (e as { name?: string }).name;
      const label = name && name !== id ? `${name} (${id})` : id;
      if (!before.has(id)) added.push(label);
      else if (JSON.stringify(before.get(id)) !== JSON.stringify(e)) changed.push(label);
    }
    for (const [id, e] of before) {
      if (!after.has(id)) {
        const name = (e as { name?: string }).name;
        removed.push(name && name !== id ? `${name} (${id})` : id);
      }
    }
  }
  return { added, removed, changed };
}

const summary = (d: ReturnType<typeof differences>) =>
  d.added.length + d.removed.length + d.changed.length === 0 ? 'no changes yet' : `${d.added.length} added, ${d.removed.length} removed, ${d.changed.length} changed`;

export const listDesigns = defineTool({
  name: 'list_designs',
  title: 'The real home and its designs',
  description:
    'The real home (as scanned and built) and its designs: copies to try a redesign on. Says which is open (the one the editor shows and edits go to) and what each design changes from the real home.',
  input: z.object({}),
  effect: 'read',
  run(ctx) {
    const versions = versionsOf(ctx);
    const real = versions.read(REAL, ctx.studio);
    const list = versions.list().map((v) => ({ ...v, open: v.id === versions.open, ...(v.id === REAL ? {} : { changes: differences(real, versions.read(v.id, ctx.studio)) }) }));
    const text = list.map((v) => `${v.open ? '▶ ' : '  '}${v.id === REAL ? `Real home: ${v.name}` : `${v.id}: ${v.name} (${summary(v.changes!)})${v.note ? `. ${v.note}` : ''}`}`).join('\n');
    return { text: `${text}\n(▶ is open.)`, data: { open: versions.open, versions: list } };
  },
});

export const newDesign = defineTool({
  name: 'new_design',
  title: 'Start a design',
  description:
    'Copy the real home (or a design) into a new design and open it, so redesign edits go there and the real home stays as it is. The person sees it open in the editor. Undo starts again in the opened design.',
  input: z.object({
    name: z.string().min(1).max(80).describe('what the idea is, e.g. "Calm and tidy" or "Bed by the window"'),
    from: z.string().max(64).optional().describe('the version to copy: "real" or a design id; default what’s open'),
    note: z.string().max(500).optional().describe('the idea in a sentence, for the person'),
    open: z.boolean().optional().describe('open it (default true)'),
  }),
  effect: 'write',
  run(ctx, q) {
    const versions = versionsOf(ctx);
    const made = versions.create(ctx.studio, q.name, { ...(q.from ? { from: q.from } : {}), ...(q.note ? { note: q.note } : {}) });
    if (q.open !== false) versions.openVersion(made.id, ctx.studio);
    return {
      text: `Made the design "${made.name}" (${made.id}) from ${made.from === REAL ? 'the real home' : made.from}${q.open !== false ? '; it is open now, so edits go to it' : ''}.`,
      data: { design: made, open: versions.open, rev: ctx.studio.rev },
    };
  },
});

export const openDesign = defineTool({
  name: 'open_design',
  title: 'Open a design or the real home',
  description: 'Switch the studio (and the person’s editor) to a design, or back to the real home with "real". Edits go to what’s open. Undo starts again.',
  input: z.object({ design: z.string().min(1).max(64).describe('a design id, or "real"') }),
  effect: 'write',
  run(ctx, q) {
    const opened = versionsOf(ctx).openVersion(q.design, ctx.studio);
    return { text: `Opened ${opened.id === REAL ? 'the real home' : `the design "${opened.name}"`}.`, data: { open: opened.id, rev: ctx.studio.rev } };
  },
});

export const deleteDesign = defineTool({
  name: 'delete_design',
  title: 'Delete a design',
  description: 'Delete a design for good (never the real home). If it’s open, the real home opens. Ask the person first.',
  input: z.object({ design: Id }),
  effect: 'write',
  run(ctx, q) {
    versionsOf(ctx).remove(q.design, ctx.studio);
    return { text: `Deleted the design "${q.design}".`, data: { deleted: q.design } };
  },
});

export const compareDesigns = defineTool({
  name: 'compare_designs',
  title: 'Compare designs side by side',
  description:
    'Render the real home and designs from the same spot with Blender and put the pictures side by side, labelled, to compare ideas. Each takes as long as a render_photoreal of the same preset.',
  input: z.object({
    designs: z.array(z.string().min(1).max(64)).min(1).max(4).optional().describe('ids to compare, "real" for the real home; default the real home and every design (up to 4)'),
    view: ViewSchema.optional(),
    preset: z.enum(['thumb', 'preview', 'final']).optional().describe('default preview'),
    time: z.enum(['day', 'evening', 'night']).optional().describe('default day'),
  }),
  effect: 'read',
  async run(ctx, q) {
    const versions = versionsOf(ctx);
    const blender = findBlender();
    if (!blender) throw new EditError('blender_unavailable', 'Blender is not installed on this computer, so designs can’t be rendered. view_3d shows the open one meanwhile.');
    const all = versions.list();
    const ids = q.designs ?? all.slice(0, 4).map((v) => v.id);
    const preset: RenderPreset = q.preset ?? 'preview';
    const time: TimeOfDay = q.time ?? 'day';
    const view = q.view ?? { preset: 'three-quarter' as const };
    const pictures: Array<{ id: string; name: string; file: string; png: Buffer }> = [];
    for (const id of ids) {
      const home = versions.read(id, ctx.studio);
      const result = await renderPhotoreal({
        home,
        rev: id === versions.open ? ctx.studio.rev : 0,
        view,
        preset,
        time,
        blender,
        script: RENDER_SCRIPT,
        folder: join(ctx.paths.data, 'renders'),
        files: ctx.paths.homeDir,
        models: ctx.paths.models,
      });
      pictures.push({ id, name: id === REAL ? `${home.name} (real)` : home.name, file: result.file, png: readFileSync(result.file) });
    }
    const size = RENDER_SIZES[preset];
    const w = 640;
    const h = Math.round((w * size.height) / size.width);
    const columns = Math.min(2, pictures.length);
    const rows = Math.ceil(pictures.length / columns);
    const cells = pictures.map((p, i) => {
      const x = (i % columns) * (w + 10);
      const y = Math.floor(i / columns) * (h + 34);
      return `<text x="${x + 4}" y="${y + 22}" font-family="Helvetica, Arial, sans-serif" font-size="18" fill="#111">${escapeXml(p.name)}</text><image x="${x}" y="${y + 30}" width="${w}" height="${h}" xlink:href="data:image/png;base64,${p.png.toString('base64')}"/>`;
    });
    const width = columns * w + (columns - 1) * 10;
    const height = rows * (h + 34);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/>${cells.join('')}</svg>`;
    return {
      text: `Rendered ${pictures.map((p) => p.name).join(', ')} from the same spot (${time}). Pictures: ${pictures.map((p) => p.file).join(', ')}.`,
      data: { pictures: pictures.map(({ id, name, file }) => ({ id, name, file })) },
      images: [svgToPng(svg, width)],
    };
  },
});

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
