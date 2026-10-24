// A clean 2D floor plan as an SVG string, with dimensions. Used for agent snapshots
// (rasterised to PNG on the server) and for printing.
import { catalogEntry } from './catalog.ts';
import { add, bounds, faceOffsets, itemFootprint, leftOf, pointInPolygon, polygonCentroid, scale, wallDirection, wallFootprint, wallLength } from './geometry.ts';
import { faceStops, levelJoins } from './joins.ts';
import { roomInfo, wallOpenings } from './measure.ts';
import type { Home, Vec2 } from './schema.ts';

export interface PlanSvgOptions {
  level?: string;
  /** only draw around this room (with a margin) */
  room?: string;
  /** output width in pixels */
  width?: number;
  furniture?: boolean;
  dimensions?: boolean;
  /** element ids to highlight */
  highlight?: string[];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmtM = (v: number) => `${(Math.round(v * 100) / 100).toFixed(2)} m`;

export function renderPlanSvg(home: Home, opts: PlanSvgOptions = {}): { svg: string; width: number; height: number; metresPerPixel: number } {
  const level = opts.level ?? home.levels[0]!.id;
  const walls = home.walls.filter((w) => w.level === level);
  const rooms = home.rooms.filter((r) => r.level === level);
  const items = home.items.filter((i) => i.level === level);
  const highlight = new Set(opts.highlight ?? []);

  let pts: Vec2[] = [...walls.flatMap((w) => wallFootprint(w)), ...rooms.flatMap((r) => r.polygon)];
  if (opts.room) pts = home.rooms.find((r) => r.id === opts.room)?.polygon ?? pts;
  if (pts.length === 0) pts = [[0, 0], [5, 5]];
  const b = bounds(pts);
  const margin = 0.9;
  const minX = b.min[0] - margin;
  const minZ = b.min[1] - margin;
  const wM = b.size[0] + 2 * margin;
  const hM = b.size[1] + 2 * margin;
  const width = opts.width ?? 1024;
  const s = width / wM;
  const height = Math.round(hM * s);
  const X = (x: number) => ((x - minX) * s).toFixed(1);
  const Z = (z: number) => ((z - minZ) * s).toFixed(1);
  const poly = (p: Vec2[]) => p.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ');
  const font = Math.max(10, Math.round(s * 0.16));

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Helvetica, Arial, sans-serif">`);
  out.push(`<rect width="100%" height="100%" fill="#fbfaf7"/>`);

  // Rooms: floor fill now, name and area on top at the end.
  const labels: string[] = [];
  for (const r of rooms) {
    const info = roomInfo(home, r.id);
    const fill = highlight.has(r.id) ? '#dbeafe' : '#f1ece3';
    out.push(`<polygon points="${poly(r.polygon)}" fill="${fill}" stroke="none"/>`);
    const c = polygonCentroid(r.polygon);
    const halo = 'stroke="#fbfaf7" stroke-width="4" paint-order="stroke"';
    labels.push(`<text x="${X(c[0])}" y="${Z(c[1])}" font-size="${font * 1.1}" font-weight="600" fill="#3b3b3b" text-anchor="middle" ${halo}>${esc(r.name)}</text>`);
    labels.push(`<text x="${X(c[0])}" y="${(Number(Z(c[1])) + font * 1.3).toFixed(1)}" font-size="${font}" fill="#6b6b6b" text-anchor="middle" ${halo}>${info.area.toFixed(1)} m² · ${fmtM(info.width)} × ${fmtM(info.depth)}</text>`);
  }

  // Furniture outlines with a front marker.
  if (opts.furniture !== false) {
    for (const it of items) {
      const fp = itemFootprint(it);
      const isRug = catalogEntry(it.catalog).shape === 'rug';
      const stroke = highlight.has(it.id) ? '#2563eb' : '#8b8b8b';
      out.push(`<polygon points="${poly(fp)}" fill="${isRug ? 'none' : '#ffffff'}" fill-opacity="0.85" stroke="${stroke}" stroke-width="${highlight.has(it.id) ? 2.5 : 1.2}" ${isRug ? 'stroke-dasharray="4 3"' : ''}/>`);
      // front edge is fp[2]→fp[3] (local +z side)
      out.push(`<line x1="${X(fp[2]![0])}" y1="${Z(fp[2]![1])}" x2="${X(fp[3]![0])}" y2="${Z(fp[3]![1])}" stroke="${stroke}" stroke-width="2.5"/>`);
      const c = [it.position[0], it.position[2]] as Vec2;
      const fitsText = it.name.length * font * 0.8 * 0.55 < Math.max(it.size[0], it.size[2]) * s * 0.9;
      if (!isRug && fitsText && Math.min(it.size[0], it.size[2]) * s > font * 1.6) {
        out.push(`<text x="${X(c[0])}" y="${Z(c[1])}" font-size="${font * 0.8}" fill="#555" text-anchor="middle" dominant-baseline="middle">${esc(it.name)}</text>`);
      }
    }
  }

  // Walls: solid footprint with joined corners and gaps cut for openings.
  const joins = levelJoins(home, level);
  for (const hub of joins.hubs) out.push(`<polygon points="${poly(hub)}" fill="#2f2f2f"/>`);
  for (const w of walls) {
    const fill = highlight.has(w.id) ? '#2563eb' : '#2f2f2f';
    const len = wallLength(w);
    const ops = wallOpenings(home, w.id);
    const join = joins.walls.get(w.id);
    let u = 0;
    const segments: Array<[number, number]> = [];
    for (const o of ops) {
      if (o.offset > u) segments.push([u, o.offset]);
      u = Math.max(u, o.offset + o.width);
    }
    if (u < len) segments.push([u, len]);
    const d = wallDirection(w);
    const n = leftOf(d);
    const off = faceOffsets(w);
    const stops = join ? faceStops(w, join) : { start: { left: 0, right: 0 }, end: { left: len, right: len } };
    for (const [a, c] of segments) {
      // The first and last pieces take the wall's joined corners; pieces between openings are plain.
      const startLeft = a === 0 ? stops.start.left : a;
      const startRight = a === 0 ? stops.start.right : a;
      const endLeft = c === len ? stops.end.left : c;
      const endRight = c === len ? stops.end.right : c;
      const at = (along: number, face: number) => add(add(w.start, scale(d, along)), scale(n, face));
      const quad: Vec2[] = [at(startLeft, off.left), at(endLeft, off.left), at(endRight, off.right), at(startRight, off.right)];
      out.push(`<polygon points="${poly(quad)}" fill="${fill}"/>`);
    }
    for (const o of ops) {
      const p0 = add(w.start, scale(d, o.offset));
      const p1 = add(w.start, scale(d, o.offset + o.width));
      const highlightO = highlight.has(o.id);
      if (o.type === 'window') {
        const quad: Vec2[] = [add(p0, scale(n, off.left)), add(p1, scale(n, off.left)), add(p1, scale(n, off.right)), add(p0, scale(n, off.right))];
        out.push(`<polygon points="${poly(quad)}" fill="#e6f2f7" stroke="${highlightO ? '#2563eb' : '#2f2f2f'}" stroke-width="1"/>`);
        const m0 = add(p0, scale(n, (off.left + off.right) / 2));
        const m1 = add(p1, scale(n, (off.left + off.right) / 2));
        out.push(`<line x1="${X(m0[0])}" y1="${Z(m0[1])}" x2="${X(m1[0])}" y2="${Z(m1[1])}" stroke="#2f2f2f" stroke-width="1"/>`);
      } else if (o.type === 'door') {
        // Leaf and swing arc on the side the door opens to.
        const hinge = o.hinge === 'end' ? p1 : p0;
        const other = o.hinge === 'end' ? p0 : p1;
        const side = o.swing === 'right' ? -1 : 1;
        const faceOff = side > 0 ? off.left : off.right;
        const h = add(hinge, scale(n, faceOff));
        const tip = add(h, scale(n, side * o.width));
        const end = add(other, scale(n, faceOff));
        out.push(`<line x1="${X(h[0])}" y1="${Z(h[1])}" x2="${X(tip[0])}" y2="${Z(tip[1])}" stroke="${highlightO ? '#2563eb' : '#2f2f2f'}" stroke-width="1.5"/>`);
        const r = (o.width * s).toFixed(1);
        const cross = (tip[0] - h[0]) * (end[1] - h[1]) - (tip[1] - h[1]) * (end[0] - h[0]);
        out.push(`<path d="M ${X(tip[0])} ${Z(tip[1])} A ${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${X(end[0])} ${Z(end[1])}" fill="none" stroke="#9a9a9a" stroke-width="1" stroke-dasharray="3 3"/>`);
      }
    }
  }

  // Dimension lines along each wall, on the outside of its room-side face.
  if (opts.dimensions !== false) {
    for (const w of walls) {
      const len = wallLength(w);
      if (len < 0.3) continue;
      const d = wallDirection(w);
      const n = leftOf(d);
      const off = faceOffsets(w);
      // Inside walls (rooms on both sides) get no dimension line; room labels give their sizes.
      const midW = add(w.start, scale(d, len / 2));
      const roomOn = (face: 'left' | 'right') =>
        rooms.some((r) => pointInPolygon(add(midW, scale(n, off[face] + (face === 'left' ? 0.08 : -0.08))), r.polygon));
      if (roomOn('left') && roomOn('right')) continue;
      // Put the dimension on the outside: away from the room centre.
      const centre = rooms.length ? polygonCentroid(rooms.flatMap((r) => r.polygon)) : ([0, 0] as Vec2);
      const mid = add(w.start, scale(d, len / 2));
      const towardsCentre = (centre[0] - mid[0]) * n[0] + (centre[1] - mid[1]) * n[1];
      const side = towardsCentre > 0 ? -1 : 1;
      const base = side > 0 ? off.left : off.right;
      const gap = 0.35;
      const a = add(w.start, scale(n, base + side * gap));
      const c = add(w.end, scale(n, base + side * gap));
      out.push(`<line x1="${X(a[0])}" y1="${Z(a[1])}" x2="${X(c[0])}" y2="${Z(c[1])}" stroke="#b45309" stroke-width="1"/>`);
      for (const p of [a, c]) {
        const t1 = add(p, scale(n, -side * 0.08));
        const t2 = add(p, scale(n, side * 0.08));
        out.push(`<line x1="${X(t1[0])}" y1="${Z(t1[1])}" x2="${X(t2[0])}" y2="${Z(t2[1])}" stroke="#b45309" stroke-width="1"/>`);
      }
      const label = add(mid, scale(n, base + side * (gap + 0.14)));
      let angle = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      out.push(`<text x="${X(label[0])}" y="${Z(label[1])}" font-size="${font * 0.9}" fill="#b45309" text-anchor="middle" dominant-baseline="middle" transform="rotate(${angle.toFixed(1)} ${X(label[0])} ${Z(label[1])})">${fmtM(len)}</text>`);
    }
  }

  out.push(...labels);

  // Scale bar (1 m) and title.
  const sb = 20;
  out.push(`<line x1="${sb}" y1="${height - sb}" x2="${(sb + s).toFixed(1)}" y2="${height - sb}" stroke="#333" stroke-width="3"/>`);
  out.push(`<text x="${sb}" y="${height - sb - 8}" font-size="${font * 0.9}" fill="#333">1 m</text>`);
  out.push(`<text x="${width - sb}" y="${sb + font}" font-size="${font * 0.9}" fill="#888" text-anchor="end">${esc(home.name)} · ${esc(home.levels.find((l) => l.id === level)?.name ?? level)}</text>`);
  out.push('</svg>');
  return { svg: out.join('\n'), width, height, metresPerPixel: 1 / s };
}
