// Tools that show: the plan as a picture, 3D views, plan pictures, and pointing things out
// to the person in the editor.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EditError, locate } from '@fullscale/core';
import { ViewSchema } from '@fullscale/protocol';
import { z } from 'zod';
import { insideFolder } from '../files.ts';
import { pictureInfo } from '../images.ts';
import { renderPlanPng, svgToPng } from '../render-plan-png.ts';
import { findBlender, forecast, renderPhotoreal, RENDER_SIZES, type RenderPreset } from '../render.ts';
import { defineTool, Id, type ToolContext, type ToolResult } from './define.ts';

const Width = z.number().int().min(256).max(2048).optional();

function planView(ctx: ToolContext, q: { level?: string; room?: string; highlight?: string[]; width?: number; furniture?: boolean; dimensions?: boolean }): ToolResult {
  const home = ctx.studio.home;
  const plan = renderPlanPng(home, {
    width: q.width ?? 1024,
    ...(q.level ? { level: q.level } : {}),
    ...(q.room ? { room: q.room } : {}),
    ...(q.highlight ? { highlight: q.highlight } : {}),
    ...(q.furniture === false ? { furniture: false } : {}),
    ...(q.dimensions === false ? { dimensions: false } : {}),
  });
  const mpp = plan.metresPerPixel;
  return {
    text: `Plan at revision ${ctx.studio.rev}: ${plan.width} × ${plan.height} px, 1 px = ${(mpp * 100).toFixed(2)} cm. Pixel (0, 0) is plan point [${plan.origin.map((v) => v.toFixed(2)).join(', ')}]; x grows right, z grows down.`,
    data: { rev: ctx.studio.rev, width: plan.width, height: plan.height, metresPerPixel: mpp, origin: plan.origin },
    images: [plan.png],
  };
}

export const viewPlan = defineTool({
  name: 'view_plan',
  title: 'Look at the plan',
  description:
    'A picture of a level’s floor plan with walls, doors, windows, furniture, room names and outside dimensions (± where measured). Look before and after editing. The answer maps pixels to plan metres.',
  input: z.object({
    level: Id.optional(),
    room: Id.optional().describe('zoom to this room'),
    highlight: z.array(Id).max(50).optional().describe('draw these in blue'),
    width: Width.describe('pixels, default 1024'),
    furniture: z.boolean().optional(),
    dimensions: z.boolean().optional(),
  }),
  effect: 'read',
  run: planView,
});

export const view3d = defineTool({
  name: 'view_3d',
  title: 'Look in 3D',
  description:
    'A 3D picture of the home from a named view (top, north, south, east, west, three-quarter) or an eye and target in metres ([x, y, z], y up), optionally framing some elements. Drawn by the open editor; with no editor open, the plan is shown instead and the answer says so.',
  input: z.object({
    view: ViewSchema.optional(),
    width: Width.describe('pixels, default 1024'),
    height: z.number().int().min(256).max(2048).optional().describe('pixels, default 768'),
  }),
  effect: 'read',
  async run(ctx, q) {
    const view = q.view ?? { preset: 'three-quarter' as const };
    if (!ctx.editor?.canRender()) {
      const plan = planView(ctx, { ...(view.level ? { level: view.level } : {}), ...(view.focus ? { highlight: view.focus } : {}) });
      return { ...plan, text: `No editor is open to draw 3D views, so here is the plan instead. Ask the person to open the editor for 3D.\n${plan.text}` };
    }
    const size = { width: q.width ?? 1024, height: q.height ?? 768 };
    const png = await ctx.editor.render(view, size);
    return { text: `3D view at revision ${ctx.studio.rev} (${size.width} × ${size.height}).`, data: { rev: ctx.studio.rev, view, ...size }, images: [png] };
  },
});

export const viewPlanPicture = defineTool({
  name: 'view_plan_picture',
  title: 'Look at a plan picture',
  description: 'Show a floor plan picture with a grid labelled in its own pixels, so you can read off points for scale_plan_picture and for tracing. Says its scale once it has one.',
  input: z.object({ id: Id, width: Width.describe('pixels to show it at, default 1024') }),
  effect: 'read',
  run(ctx, q) {
    const picture = ctx.studio.home.captures.find((c) => c.id === q.id && c.plan);
    if (!picture?.plan) throw new EditError('not_found', `No plan picture with id "${q.id}".`, { id: q.id, kind: 'plan picture' });
    const full = insideFolder(ctx.paths.homeDir, picture.path);
    if (!full) throw new EditError('invalid_input', `The picture's path "${picture.path}" is outside the home's folder.`);
    const data = readFileSync(full);
    const info = pictureInfo(data);
    const width = Math.min(q.width ?? 1024, info.width);
    const shown = width / info.width;
    const height = Math.round(info.height * shown);
    // Grid lines at a round number of picture pixels, about ten across.
    const step = [50, 100, 200, 250, 500, 1000, 2000].find((s) => info.width / s <= 12) ?? 5000;
    const lines: string[] = [];
    for (let x = step; x < info.width; x += step) {
      lines.push(
        `<line x1="${x * shown}" y1="0" x2="${x * shown}" y2="${height}" stroke="#e11d48" stroke-opacity="0.45"/>`,
        `<text x="${x * shown + 2}" y="12" font-size="11" fill="#e11d48">${x}</text>`,
      );
    }
    for (let y = step; y < info.height; y += step) {
      lines.push(
        `<line x1="0" y1="${y * shown}" x2="${width}" y2="${y * shown}" stroke="#e11d48" stroke-opacity="0.45"/>`,
        `<text x="2" y="${y * shown - 2}" font-size="11" fill="#e11d48">${y}</text>`,
      );
    }
    const href = `data:image/${info.type};base64,${data.toString('base64')}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" font-family="Helvetica, Arial, sans-serif"><image x="0" y="0" width="${width}" height="${height}" xlink:href="${href}"/>${lines.join('')}</svg>`;
    const p = picture.plan;
    const scale = p.metresPerPixel ? ` Scale: 1 px = ${(p.metresPerPixel * 100).toFixed(3)} cm (±${((p.scale?.uncertainty ?? 0) * 100).toFixed(2)}%).` : ' Not scaled yet.';
    return {
      text: `Plan picture "${picture.id}": ${info.width} × ${info.height} px, shown at ${width} px wide; grid labels are picture pixels.${scale}`,
      data: { id: picture.id, pixels: [info.width, info.height], shownWidth: width, gridStep: step, plan: p },
      images: [svgToPng(svg, width)],
    };
  },
});

export const highlight = defineTool({
  name: 'highlight',
  title: 'Point things out',
  description: 'Highlight elements in the person’s editor, with a short note, e.g. to ask "is this the wall you mean?".',
  input: z.object({ ids: z.array(Id).max(100), note: z.string().max(200).optional() }),
  effect: 'read',
  run(ctx, q) {
    const missing = q.ids.filter((id) => !locate(ctx.studio.home, id));
    if (missing.length) throw new EditError('not_found', `Not found: ${missing.join(', ')}.`, { ids: missing });
    ctx.studio.highlight(ctx.actor, q.ids, q.note);
    return { text: q.ids.length ? `Highlighted ${q.ids.join(', ')} in the editor.` : 'Cleared the highlight.', data: { ids: q.ids } };
  },
});

const RENDER_SCRIPT = fileURLToPath(new URL('../../../../blender/render/render.py', import.meta.url));
/** Pictures for the agent are shown at most this wide; the full picture stays on disk. */
const SHOWN_WIDTH = 1024;

export const renderPhoto = defineTool({
  name: 'render_photoreal',
  title: 'Photo-real picture',
  description:
    'A photo-real picture rendered by Blender (installed on this computer) from a named view or an eye and target. Presets: thumb (320 px, seconds), preview (1280 × 720), final (1920 × 1080, minutes). Use dry_run first to see the size, an estimated time and warnings. The picture is pinned to the revision it was rendered from.',
  input: z.object({
    view: ViewSchema.optional(),
    preset: z.enum(['thumb', 'preview', 'final']).optional().describe('default preview'),
    dry_run: z.boolean().optional(),
  }),
  effect: 'read',
  async run(ctx, q) {
    const preset: RenderPreset = q.preset ?? 'preview';
    const home = ctx.studio.home;
    const blender = findBlender();
    if (q.dry_run) {
      const f = forecast(home, preset);
      const text = [`Would render ${f.size.width} × ${f.size.height} in about ${f.estimatedTime}${blender ? '' : ', but Blender is not installed'}.`, ...f.warnings].join('\n');
      return { text, data: { ...f, blender: blender ?? null, rev: ctx.studio.rev } };
    }
    if (!blender) {
      const set = process.env.BLENDER_BIN;
      throw new EditError(
        'blender_unavailable',
        set
          ? `BLENDER_BIN is set to "${set}", but there is no program there. Fix the path, or unset it to use the Blender installed in the usual place. view_3d gives a quick 3D picture meanwhile.`
          : 'Blender is not installed on this computer. Install it (free) from blender.org, or set BLENDER_BIN to its program, then try again. view_3d gives a quick 3D picture meanwhile.',
      );
    }
    const rev = ctx.studio.rev;
    const result = await renderPhotoreal({ home, rev, view: q.view ?? { preset: 'three-quarter' }, preset, blender, script: RENDER_SCRIPT, folder: join(ctx.paths.data, 'renders') });
    const png = readFileSync(result.file);
    const shown = result.width > SHOWN_WIDTH ? shrink(png, result.width, result.height) : png;
    const stale = ctx.studio.rev !== result.rev ? ` The home has changed since (now revision ${ctx.studio.rev}).` : '';
    return {
      text: `Rendered revision ${result.rev} in ${result.seconds} s on ${result.device}; saved at ${result.file}.${stale}`,
      data: { ...result, size: RENDER_SIZES[preset] },
      images: [shown],
    };
  },
});

function shrink(png: Buffer, width: number, height: number): Buffer {
  const h = Math.round((height * SHOWN_WIDTH) / width);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${SHOWN_WIDTH}" height="${h}"><image width="${SHOWN_WIDTH}" height="${h}" xlink:href="data:image/png;base64,${png.toString('base64')}"/></svg>`;
  return svgToPng(svg, SHOWN_WIDTH);
}
