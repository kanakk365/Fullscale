// Looking at the photos of the home's phone scans, and cutting real pictures out of them
// (a bedsheet's print, a photo in a frame, what is on a screen) to put on the model.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EditError, MaterialKindSchema, type BaseOperation, type Home } from '@fullscale/core';
import { z } from 'zod';
import { capturePhotos, cutPatch, findPhoto, ModelRays, photoCamera, toStored, uprightSize, uprightTransform, type Photo } from '../photos.ts';
import { svgToPng } from '../render-plan-png.ts';
import { defineTool, Id, receiptResult, write, WriteOptions } from './define.ts';
import { PaintTarget } from './furnish.ts';

const SHEET = { columns: 5, rows: 4, cell: 260 };

const UprightPoint = z.array(z.number().finite()).length(2).describe('[x, y] in upright pixels of the photo, from its top-left corner');

export const viewPhoto = defineTool({
  name: 'view_photo',
  title: 'Look at a scan’s photos',
  description:
    'The photos taken while scanning, upright. Without a photo: a page of small pictures with their ids and what each shows (the elements its view meets), optionally only those showing one element (of). With a photo: the photo with a pixel grid, where it was taken from (eye, target and fov to give render_photoreal for the same view), and what it shows; region zooms into part of it. Points on photos are upright pixels from the top-left, as texture_from_photo takes them.',
  input: z.object({
    capture: Id.optional().describe('a phone capture’s id (get_home lists them); default all'),
    photo: z.string().max(64).optional().describe('a photo’s id, e.g. "p1998"'),
    of: Id.optional().describe('only photos showing this element, the most of it first'),
    region: z.array(z.number().finite()).length(4).optional().describe('[left, top, right, bottom] in upright pixels: zoom into this part of the photo'),
    page: z.number().int().min(1).optional(),
  }),
  effect: 'read',
  run(ctx, q) {
    const home = ctx.studio.home;
    if (q.photo) return showPhoto(home, findPhoto(home, ctx.paths.homeDir, q.capture, q.photo), q.region as [number, number, number, number] | undefined);
    const { photos, problems } = capturePhotos(home, ctx.paths.homeDir, q.capture);
    if (!photos.length) throw new EditError('not_found', `No scan photos${q.capture ? ` in ${q.capture}` : ''}. ${problems.join(' ')}`.trim());
    const rays = new ModelRays(home);
    try {
      let listed = photos.map((p) => {
        const camera = photoCamera(home, p);
        return { photo: p, sees: camera ? rays.sees(p, camera) : [] };
      });
      if (q.of) {
        listed = listed.filter((l) => l.sees.some((s) => s.id === q.of)).sort((a, b) => b.sees.find((s) => s.id === q.of)!.share - a.sees.find((s) => s.id === q.of)!.share);
        if (!listed.length) throw new EditError('not_found', `No photo shows "${q.of}" (as the model is placed). Look through the pages without "of".`, { id: q.of });
      }
      const perPage = SHEET.columns * SHEET.rows;
      const pages = Math.ceil(listed.length / perPage);
      const page = Math.min(q.page ?? 1, pages);
      const shown = listed.slice((page - 1) * perPage, page * perPage);
      const lines = shown.map(
        (l) =>
          `${l.photo.capture.id}/${l.photo.record.id} (${l.photo.record.kind}): ${
            l.sees.length
              ? l.sees
                  .slice(0, 4)
                  .map((s) => `${s.id} ${Math.round(s.share * 100)}%`)
                  .join(', ')
              : 'capture not placed in the home'
          }`,
      );
      const text = [`Page ${page} of ${pages} (${listed.length} photos${q.of ? ` showing ${q.of}` : ''}). What each shows, by share of its view:`, ...lines, ...problems].join('\n');
      return {
        text,
        data: { page, pages, photos: shown.map((l) => ({ capture: l.photo.capture.id, id: l.photo.record.id, kind: l.photo.record.kind, sees: l.sees })) },
        images: [contactSheet(shown.map((l) => l.photo))],
      };
    } finally {
      rays.dispose();
    }
  },
});

function showPhoto(home: Home, p: Photo, region?: [number, number, number, number]): { text: string; data: Record<string, unknown>; images: Buffer[] } {
  const [w, h] = uprightSize(p);
  const [x0, y0, x1, y1] = region ? [Math.max(0, region[0]), Math.max(0, region[1]), Math.min(w, region[2]), Math.min(h, region[3])] : [0, 0, w, h];
  if (x1 - x0 < 8 || y1 - y0 < 8) throw new EditError('invalid_input', `The region must lie on the photo, which is ${w} × ${h} upright.`);
  const shownWidth = Math.min(1400, Math.max(600, Math.round(x1 - x0)));
  const step = niceStep((x1 - x0) / 8);
  const lines: string[] = [];
  // Lines and labels keep the same size on screen however far the photo is zoomed.
  const stroke = Math.max(1, (x1 - x0) / shownWidth);
  for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
    lines.push(`<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" stroke="#ffd400" stroke-opacity="0.6" stroke-width="${stroke}"/>`);
    lines.push(label(x + 3 * stroke, y0 + 16 * stroke, String(x), stroke));
  }
  for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
    lines.push(`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="#ffd400" stroke-opacity="0.6" stroke-width="${stroke}"/>`);
    lines.push(label(x0 + 3 * stroke, y - 4 * stroke, String(y), stroke));
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" width="${shownWidth}" height="${Math.round((shownWidth * (y1 - y0)) / (x1 - x0))}"><image transform="${uprightTransform(p)}" width="${p.record.width}" height="${p.record.height}" xlink:href="data:image/jpeg;base64,${readFileSync(p.file).toString('base64')}"/>${lines.join('')}</svg>`;
  const camera = photoCamera(home, p);
  const rays = camera ? new ModelRays(home) : null;
  const sees = camera && rays ? rays.sees(p, camera) : [];
  rays?.dispose();
  const where = camera
    ? `Taken from eye [${camera.eye.join(', ')}] looking at target [${camera.target.join(', ')}], vertical fov ${camera.fov}° (give these to render_photoreal to see the model from the same spot). It shows: ${sees
        .slice(0, 6)
        .map((s) => `${s.id} (${Math.round(s.share * 100)}%, ${s.distance} m away)`)
        .join(', ')}.`
    : 'Its capture isn’t placed in the home, so where it was taken from is unknown.';
  const text = `${p.capture.id}/${p.record.id} (${p.record.kind}), ${w} × ${h} px upright${region ? `; showing [${x0}, ${y0}] to [${x1}, ${y1}]` : ''}; grid lines every ${step} px. ${where}`;
  return {
    text,
    data: { capture: p.capture.id, id: p.record.id, size: [w, h], grid: step, ...(camera ? { eye: camera.eye, target: camera.target, fov: camera.fov } : {}), sees },
    images: [svgToPng(svg, shownWidth)],
  };
}

function label(x: number, y: number, text: string, scale: number): string {
  return `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${14 * scale}" fill="#ffd400" stroke="#000" stroke-width="${3 * scale}" paint-order="stroke">${text}</text>`;
}

function niceStep(raw: number): number {
  for (const s of [10, 20, 25, 50, 100, 200, 250, 500, 1000]) if (s >= raw) return s;
  return 1000;
}

function contactSheet(photos: Photo[]): Buffer {
  const { columns, cell } = SHEET;
  const rows = Math.max(1, Math.ceil(photos.length / columns));
  const cells = photos.map((p, i) => {
    const [w, h] = uprightSize(p);
    const s = Math.min((cell - 8) / w, (cell - 28) / h);
    const x = (i % columns) * cell + (cell - w * s) / 2;
    const y = Math.floor(i / columns) * cell + 22;
    return `<g transform="translate(${x} ${y}) scale(${s})"><image transform="${uprightTransform(p)}" width="${p.record.width}" height="${p.record.height}" xlink:href="data:image/jpeg;base64,${readFileSync(p.file).toString('base64')}"/></g><text x="${(i % columns) * cell + 6}" y="${Math.floor(i / columns) * cell + 16}" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#111">${p.capture.id}/${p.record.id}</text>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${columns * cell}" height="${rows * cell}"><rect width="100%" height="100%" fill="#fff"/>${cells.join('')}</svg>`;
  return svgToPng(svg, columns * cell);
}

const ROUGHNESS: Record<string, number> = { fabric: 0.92, carpet: 0.95, paint: 0.9, plaster: 0.9, wood: 0.6, stone: 0.5, tile: 0.25, metal: 0.35, plastic: 0.45, glass: 0.05, other: 0.7 };

export const textureFromPhoto = defineTool({
  name: 'texture_from_photo',
  title: 'Cut a picture from a photo',
  description:
    'Cut a flat surface out of a scan photo — a bedsheet’s print, a photo in a frame, a poster, what a screen shows, a door’s wood — straighten it and make it a material with that picture, at its real size. Easiest: give `at`, a point on the surface in upright pixels (view_photo), and `size` in metres; the rectangle is laid on that surface in the model and found on the photo (the model must be where the scan was). Or give the patch’s four corners, top-left, top-right, bottom-right, bottom-left as it should look; its size is then measured against the model, or give size. Pick a clear area: things lying on it are cut too, and you’re told when a corner is hidden. fit: repeat (default) tiles the patch, blended at its edges so the seams don’t show (fabrics, floors, wood); mirror tiles it mirrored; stretch shows it once on each face (a framed photo, a poster, a screen). paint puts the new material on surfaces at once. The picture is saved in the home’s folder and stays on this computer.',
  input: z.object({
    capture: Id.optional().describe('the photo’s capture, when photo ids repeat across captures'),
    photo: z.string().max(64),
    at: UprightPoint.optional().describe('a point on a flat surface in the photo: cut a rectangle of `size` there, squared to the surface (easiest)'),
    corners: z.array(UprightPoint).length(4).optional().describe('or the patch’s own corners: top-left, top-right, bottom-right, bottom-left, in upright pixels'),
    material: z.object({
      id: Id.optional().describe('a new or existing material id; default made from the name'),
      name: z.string().min(1).max(80),
      kind: MaterialKindSchema,
      fit: z.enum(['repeat', 'mirror', 'stretch']).optional(),
    }),
    size: z.array(z.number().positive().max(20)).length(2).optional().describe('the patch’s real [width, height] in metres: needed with at; with corners, default measured'),
    paint: z.array(PaintTarget).max(50).optional().describe('surfaces to put the new material on'),
    ...WriteOptions,
  }),
  effect: 'write',
  run(ctx, q) {
    const home = ctx.studio.home;
    const p = findPhoto(home, ctx.paths.homeDir, q.capture, q.photo);
    const [w, h] = uprightSize(p);
    if (!q.at === !q.corners) throw new EditError('invalid_input', 'Give at (with size) or corners, not both.');
    const onPhoto = ([x, y]: number[]) => x! >= 0 && y! >= 0 && x! <= w && y! <= h;
    const camera = photoCamera(home, p);
    let size = q.size as [number, number] | undefined;
    let measured = '';
    let stored: Array<[number, number]>;
    if (q.at) {
      if (!size) throw new EditError('invalid_input', 'With at, give size: the rectangle’s real [width, height] in metres.');
      if (!onPhoto(q.at)) throw new EditError('invalid_input', `at must lie on the photo, which is ${w} × ${h} upright.`);
      if (!camera) throw new EditError('invalid_input', 'This photo’s capture isn’t placed in the home, so at can’t be used; give corners and size.');
      const rays = new ModelRays(home);
      const rect = rays.rectangleAt(camera, toStored(p, q.at as [number, number]), size[0], size[1]);
      rays.dispose();
      if (!rect) throw new EditError('invalid_input', 'Nothing in the model is at that point of the photo. Give corners and size instead.');
      const sw = p.record.width;
      const sh = p.record.height;
      if (rect.corners.some((c) => !c || c[0] < 0 || c[1] < 0 || c[0] > sw || c[1] > sh)) {
        throw new EditError('invalid_input', `A ${size[0]} × ${size[1]} m rectangle there runs off the photo; make it smaller or move it.`);
      }
      stored = rect.corners as Array<[number, number]>;
      const hidden = rect.blocked.map((b, i) => (b ? `${['top-left', 'top-right', 'bottom-right', 'bottom-left'][i]} (${b})` : null)).filter(Boolean);
      measured = ` Laid on ${rect.on}.${hidden.length ? ` Corners not on ${rect.on} in the model: ${hidden.join(', ')}; check the picture.` : ''}`;
    } else {
      const corners = q.corners as Array<[number, number]>;
      if (!corners.every(onPhoto)) throw new EditError('invalid_input', `Corners must lie on the photo, which is ${w} × ${h} upright.`);
      stored = corners.map((c) => toStored(p, c));
      // Its real size: from the photo's camera through each corner to the model.
      if (!size && camera) {
        const rays = new ModelRays(home);
        const hits = stored.map((c) => rays.hit(camera.ray(c)));
        rays.dispose();
        if (hits.every(Boolean)) {
          const [a, b, c, d] = hits.map((x) => x!.point);
          size = [(a!.distanceTo(b!) + d!.distanceTo(c!)) / 2, (a!.distanceTo(d!) + b!.distanceTo(c!)) / 2];
          const on = [...new Set(hits.map((x) => x!.id))];
          measured = ` Measured from the photo against the model, on ${on.join(' and ')}${on.length > 1 ? ' (the corners met different things: check the size)' : ''}.`;
        }
      }
    }
    if (!size) throw new EditError('invalid_input', 'The patch’s size couldn’t be measured (its corners don’t all meet the model). Give size: its real [width, height] in metres.');
    const [sw, sh] = size.map((v) => Math.round(v * 1000) / 1000) as [number, number];

    // As many pixels as the photo really has there, up to 2048 on the long side.
    const len = (i: number, j: number) => Math.hypot(stored[i]![0] - stored[j]![0], stored[i]![1] - stored[j]![1]);
    const across = Math.max(len(0, 1), len(3, 2));
    const scale = Math.min(1, 2048 / Math.max(across, (across * sh) / sw));
    const pw = Math.max(16, Math.round(across * scale));
    const ph = Math.max(16, Math.round((pw * sh) / sw));
    const fit = q.material.fit ?? 'repeat';
    // A patch that repeats is blended at its edges so the repeats don't show seams.
    const cut = cutPatch(p.file, stored, pw, ph, fit === 'repeat');

    const id =
      q.material.id ??
      `${
        q.material.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40) || 'picture'
      }`;
    const file = `textures/${id}.jpg`;
    const material = {
      id,
      name: q.material.name,
      kind: q.material.kind,
      color: cut.colour,
      image: { file, width: sw, height: sh, fit },
      roughness: ROUGHNESS[q.material.kind] ?? 0.8,
      metalness: q.material.kind === 'metal' ? 1 : 0,
      opacity: 1,
      source: { kind: 'scan' as const, ref: `photo:${p.capture.id}/${p.record.id}` },
    };
    const ops: BaseOperation[] = [{ op: 'upsertMaterial', material } as BaseOperation, ...(q.paint ?? []).map((target) => ({ op: 'paint', target, material: id }) as BaseOperation)];
    const receipt = write(ctx, { op: 'batch', label: `Picture “${q.material.name}” from ${p.record.id}`, ops }, q);
    if (!receipt.dry_run) {
      mkdirSync(join(ctx.paths.homeDir, 'textures'), { recursive: true });
      writeFileSync(join(ctx.paths.homeDir, file), cut.jpeg);
    }
    receipt.notes.unshift(`Cut ${pw} × ${ph} px from ${p.capture.id}/${p.record.id}: ${sw} × ${sh} m.${measured} Saved as ${file}; material "${id}" (${fit}).`);
    const preview = svgToPng(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${pw}" height="${ph}"><image width="${pw}" height="${ph}" xlink:href="data:image/jpeg;base64,${cut.jpeg.toString('base64')}"/></svg>`,
      Math.min(800, pw),
    );
    return { ...receiptResult(receipt, { material: id, file, size: [sw, sh], colour: cut.colour }), images: [preview] };
  },
});
