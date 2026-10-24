// The floor plan as an SVG string: for agents (rasterised to PNG on the server), export and
// printing. It draws the shapes from plan-geometry.ts and adds a scale bar and a title.
import { bounds } from './geometry.ts';
import type { Home, Vec2 } from './schema.ts';
import { PLAN_TEXT, planGeometry, type PlanPrimitive } from './plan-geometry.ts';

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

const INK = '#2f2f2f';
const BLUE = '#2563eb';
const DIMENSION = '#b45309';
const GUESS = '#9a6a2f';
const PAPER = '#fbfaf7';
/** Text never gets smaller than this, however far out the plan is drawn. */
const MIN_TEXT_PX = 10;
/** Space around the plan, in metres. */
const MARGIN = 0.9;

export interface PlanSvg {
  svg: string;
  width: number;
  height: number;
  metresPerPixel: number;
  /** the plan point [x, z] at the picture's top-left corner */
  origin: Vec2;
}

export function renderPlanSvg(home: Home, opts: PlanSvgOptions = {}): PlanSvg {
  const plan = planGeometry(home, opts);
  const highlight = new Set(opts.highlight ?? []);
  const focus = opts.room ? home.rooms.find((r) => r.id === opts.room)?.polygon : undefined;
  const area = focus ? bounds(focus) : plan.bounds;

  const minX = area.min[0] - MARGIN;
  const minZ = area.min[1] - MARGIN;
  const width = opts.width ?? 1024;
  const s = width / (area.size[0] + 2 * MARGIN);
  const height = Math.round((area.size[1] + 2 * MARGIN) * s);
  const X = (x: number) => ((x - minX) * s).toFixed(1);
  const Z = (z: number) => ((z - minZ) * s).toFixed(1);
  const pts = (p: Vec2[]) => p.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ');
  const px = (metres: number) => Math.max(MIN_TEXT_PX, Math.round(metres * s));
  const font = px(PLAN_TEXT);
  const lit = (id?: string) => id !== undefined && highlight.has(id);

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Helvetica, Arial, sans-serif">`);
  out.push(`<rect width="100%" height="100%" fill="${PAPER}"/>`);

  // Room floors first, labels last, so text is never hidden by walls or furniture.
  const order = (p: PlanPrimitive) => (p.kind === 'polygon' && p.role === 'room' ? 0 : p.kind === 'text' && p.role !== 'item-name' ? 3 : p.kind === 'dimension' ? 2 : 1);
  for (const p of [...plan.primitives].sort((a, b) => order(a) - order(b))) {
    switch (p.kind) {
      case 'polygon': {
        const fill = { room: lit(p.id) ? '#dbeafe' : '#f1ece3', wall: lit(p.id) ? BLUE : INK, hub: INK, item: '#ffffff', rug: 'none', window: '#e6f2f7', opening: 'none' }[p.role];
        if (p.role === 'item' || p.role === 'rug') {
          const dash = p.role === 'rug' ? ' stroke-dasharray="4 3"' : '';
          out.push(`<polygon points="${pts(p.points)}" fill="${fill}" fill-opacity="0.85" stroke="${lit(p.id) ? BLUE : '#8b8b8b'}" stroke-width="${lit(p.id) ? 2.5 : 1.2}"${dash}/>`);
        } else if (p.role === 'opening') {
          // Dashed, like the head of an archway seen from above.
          out.push(`<polygon points="${pts(p.points)}" fill="none" stroke="${lit(p.id) ? BLUE : '#9a9a9a'}" stroke-width="1" stroke-dasharray="4 3"/>`);
        } else if (p.role === 'window') {
          out.push(`<polygon points="${pts(p.points)}" fill="${fill}" stroke="${lit(p.id) ? BLUE : INK}" stroke-width="1"/>`);
        } else {
          out.push(`<polygon points="${pts(p.points)}" fill="${fill}"/>`);
        }
        break;
      }
      case 'line': {
        const stroke = p.role === 'item-front' ? (lit(p.id) ? BLUE : '#8b8b8b') : lit(p.id) ? BLUE : INK;
        const w = p.role === 'item-front' ? 2.5 : p.role === 'door-leaf' ? 1.5 : 1;
        out.push(`<line x1="${X(p.a[0])}" y1="${Z(p.a[1])}" x2="${X(p.b[0])}" y2="${Z(p.b[1])}" stroke="${stroke}" stroke-width="${w}"/>`);
        break;
      }
      case 'arc': {
        const r = (p.radius * s).toFixed(1);
        const turn = (p.from[0] - p.centre[0]) * (p.to[1] - p.centre[1]) - (p.from[1] - p.centre[1]) * (p.to[0] - p.centre[0]);
        out.push(`<path d="M ${X(p.from[0])} ${Z(p.from[1])} A ${r} ${r} 0 0 ${turn > 0 ? 1 : 0} ${X(p.to[0])} ${Z(p.to[1])}" fill="none" stroke="#9a9a9a" stroke-width="1" stroke-dasharray="3 3"/>`);
        break;
      }
      case 'text': {
        if (p.role === 'item-name') {
          out.push(`<text x="${X(p.at[0])}" y="${Z(p.at[1])}" font-size="${px(p.size)}" fill="#555" text-anchor="middle" dominant-baseline="middle">${esc(p.text)}</text>`);
          break;
        }
        const halo = `stroke="${PAPER}" stroke-width="4" paint-order="stroke"`;
        const style = p.role === 'room-name' ? 'font-weight="600" fill="#3b3b3b"' : 'fill="#6b6b6b"';
        out.push(`<text x="${X(p.at[0])}" y="${Z(p.at[1])}" font-size="${px(p.size)}" ${style} text-anchor="middle" ${halo}>${esc(p.text)}</text>`);
        break;
      }
      case 'dimension': {
        const colour = p.estimated ? GUESS : DIMENSION;
        const dash = p.estimated ? ' stroke-dasharray="5 3"' : '';
        out.push(`<line x1="${X(p.a[0])}" y1="${Z(p.a[1])}" x2="${X(p.b[0])}" y2="${Z(p.b[1])}" stroke="${colour}" stroke-width="1"${dash}/>`);
        for (const end of [p.a, p.b]) {
          const t1: Vec2 = [end[0] - p.out[0] * 0.08, end[1] - p.out[1] * 0.08];
          const t2: Vec2 = [end[0] + p.out[0] * 0.08, end[1] + p.out[1] * 0.08];
          out.push(`<line x1="${X(t1[0])}" y1="${Z(t1[1])}" x2="${X(t2[0])}" y2="${Z(t2[1])}" stroke="${colour}" stroke-width="1"/>`);
        }
        const mid: Vec2 = [(p.a[0] + p.b[0]) / 2 + p.out[0] * 0.14, (p.a[1] + p.b[1]) / 2 + p.out[1] * 0.14];
        let angle = (Math.atan2(p.b[1] - p.a[1], p.b[0] - p.a[0]) * 180) / Math.PI;
        if (angle > 90) angle -= 180;
        if (angle < -90) angle += 180;
        const label = p.estimated ? `${p.label} (est.)` : p.label;
        out.push(
          `<text x="${X(mid[0])}" y="${Z(mid[1])}" font-size="${Math.round(font * 0.9)}" fill="${colour}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${angle.toFixed(1)} ${X(mid[0])} ${Z(mid[1])})">${esc(label)}</text>`,
        );
        break;
      }
    }
  }

  // Scale bar (1 m) and title.
  const sb = 20;
  out.push(`<line x1="${sb}" y1="${height - sb}" x2="${(sb + s).toFixed(1)}" y2="${height - sb}" stroke="#333" stroke-width="3"/>`);
  out.push(`<text x="${sb}" y="${height - sb - 8}" font-size="${Math.round(font * 0.9)}" fill="#333">1 m</text>`);
  const levelName = home.levels.find((l) => l.id === plan.level)?.name ?? plan.level;
  out.push(`<text x="${width - sb}" y="${height - sb}" font-size="${Math.round(font * 0.9)}" fill="#888" text-anchor="end">${esc(home.name)} · ${esc(levelName)}</text>`);
  out.push('</svg>');
  return { svg: out.join('\n'), width, height, metresPerPixel: 1 / s, origin: [minX, minZ] };
}
