// Checks a home for problems a person or an agent should fix. Never throws. Opening rules
// are shared with the edit commands (rules.ts), so a check never disagrees with an edit.
import { catalogEntry } from './catalog.ts';
import { convexOverlap, isSimplePolygon, itemFootprint, pointInPolygon, shapeMismatch, wallFootprint } from './geometry.ts';
import { allIds, elementsOf, KIND_LIST, referencedIds } from './kinds.ts';
import { openingProblems, wallLengthProblem } from './rules.ts';
import { wallHeight } from './resolve.ts';
import { HomeSchema, type Home, type Vec2 } from './schema.ts';

export interface Issue {
  severity: 'error' | 'warning' | 'info';
  /** stable snake_case code, e.g. "opening_overlap" */
  code: string;
  message: string;
  ids: string[];
}

/** Walls thicker than this get a "is that right?" warning. */
const SUSPICIOUSLY_THICK = 1;
/** Doors narrower than this can't take most furniture. */
const NARROW_DOOR = 0.7;
/** Walls whose ends are this close are drawn on top of each other. */
const SAME_SEGMENT = 0.01;
/** Model proportions this far from the item's size are worth a warning. */
const MODEL_SHAPE_TOLERANCE = 0.03;
/** Overlaps smaller than this are rounding, not a real clash. */
const OVERLAP_SLACK = 0.005;

export function validateHome(input: unknown): Issue[] {
  const parsed = HomeSchema.safeParse(input);
  if (!parsed.success) {
    return parsed.error.issues.slice(0, 50).map((i) => ({
      severity: 'error' as const,
      code: 'schema',
      message: `${i.path.join('.') || '(root)'}: ${i.message}`,
      ids: [],
    }));
  }
  const home = parsed.data;
  const issues: Issue[] = [];
  const push = (severity: Issue['severity'], code: string, message: string, ids: string[]) => issues.push({ severity, code, message, ids });
  const fromError = (severity: Issue['severity'], err: { code: string; message: string }, ids: string[]) => push(severity, err.code, err.message, ids);

  checkIdsAndReferences(home, push);

  for (const q of home.quarantine) {
    push('warning', 'quarantined', `A ${q.collection.replace(/s$/, '')} could not be loaded and was set aside: ${q.problem}`, []);
  }

  // Walls
  for (const w of home.walls) {
    const tooShort = wallLengthProblem(w);
    if (tooShort) fromError('error', tooShort, [w.id]);
    if (w.thickness > SUSPICIOUSLY_THICK) push('warning', 'wall_thick', `Wall "${w.id}" is ${w.thickness} m thick; is that right?`, [w.id]);
  }
  for (let i = 0; i < home.walls.length; i++) {
    for (let j = i + 1; j < home.walls.length; j++) {
      const a = home.walls[i]!;
      const b = home.walls[j]!;
      if (a.level === b.level && sameSegment(a.start, a.end, b.start, b.end)) {
        push('warning', 'wall_duplicate', `Walls "${a.id}" and "${b.id}" lie on top of each other`, [a.id, b.id]);
      }
    }
  }

  // Openings: report each overlapping pair once.
  const walls = new Map(home.walls.map((w) => [w.id, w]));
  const reportedPairs = new Set<string>();
  for (const o of home.openings) {
    const w = walls.get(o.wall);
    if (!w) continue;
    for (const p of openingProblems(home, w, o)) {
      if (p.code === 'opening_overlap') {
        const other = String(p.details.other);
        const key = [o.id, other].sort().join('|');
        if (reportedPairs.has(key)) continue;
        reportedPairs.add(key);
        fromError('error', p, [o.id, other]);
      } else {
        fromError('error', p, [o.id, w.id]);
      }
    }
    if (o.type === 'door' && o.width < NARROW_DOOR) {
      push('info', 'door_narrow', `Door "${o.id}" is ${fmt(o.width)} m wide; most furniture needs 0.75 m or more`, [o.id]);
    }
  }

  // Rooms
  for (const r of home.rooms) {
    if (!isSimplePolygon(r.polygon)) push('error', 'room_self_intersects', `Room "${r.id}" outline crosses itself`, [r.id]);
  }

  // Items
  for (const it of home.items) {
    if (it.model?.licence === 'cc-by' && !it.model.credit) {
      push('warning', 'model_credit_missing', `"${it.name}" (${it.id}) uses a CC-BY model but gives no credit`, [it.id]);
    }
    if (it.model?.nativeSize && it.model.fit === 'uniform') {
      const off = shapeMismatch(it.model.nativeSize, it.size);
      if (off > MODEL_SHAPE_TOLERANCE) {
        push(
          'warning',
          'model_shape_mismatch',
          `"${it.name}" (${it.id}): the model's proportions are ${Math.round(off * 100)}% off its size, so it is drawn smaller on some sides. Check the dimensions, or set the model's fit to "stretch"`,
          [it.id],
        );
      }
    }
    if (catalogEntry(it.catalog).shape === 'rug') continue;
    const fp = itemFootprint(it);
    for (const w of home.walls) {
      if (w.level !== it.level || it.position[1] >= wallHeight(home, w)) continue;
      if (convexOverlap(fp, wallFootprint(w), OVERLAP_SLACK)) {
        push('warning', 'item_in_wall', `"${it.name}" (${it.id}) goes into wall "${w.id}"`, [it.id, w.id]);
      }
    }
    const inAnyRoom = home.rooms.some((r) => r.level === it.level && pointInPolygon([it.position[0], it.position[2]], r.polygon));
    if (home.rooms.length > 0 && !inAnyRoom) push('info', 'item_outside_rooms', `"${it.name}" (${it.id}) is not inside any room`, [it.id]);
  }
  for (let i = 0; i < home.items.length; i++) {
    for (let j = i + 1; j < home.items.length; j++) {
      const a = home.items[i]!;
      const b = home.items[j]!;
      if (a.level !== b.level) continue;
      if (catalogEntry(a.catalog).shape === 'rug' || catalogEntry(b.catalog).shape === 'rug') continue;
      const verticalOverlap = a.position[1] < b.position[1] + b.size[1] && b.position[1] < a.position[1] + a.size[1];
      if (verticalOverlap && convexOverlap(itemFootprint(a), itemFootprint(b), OVERLAP_SLACK)) {
        push('warning', 'items_overlap', `"${a.name}" (${a.id}) and "${b.name}" (${b.id}) overlap`, [a.id, b.id]);
      }
    }
  }
  return issues;
}

function checkIdsAndReferences(home: Home, push: (s: Issue['severity'], code: string, message: string, ids: string[]) => void): void {
  const count = new Map<string, number>();
  for (const info of KIND_LIST) for (const x of elementsOf(home, info.collection)) count.set(x.id, (count.get(x.id) ?? 0) + 1);
  for (const [id, n] of count) if (n > 1) push('error', 'duplicate_id', `Id "${id}" is used ${n} times`, [id]);

  const ids = allIds(home);
  for (const info of KIND_LIST) {
    for (const el of elementsOf(home, info.collection)) {
      for (const ref of info.refs) {
        for (const target of referencedIds(el, ref)) {
          if (!ids.has(target)) {
            push('error', 'missing_reference', `${info.kind} "${el.id}" points to ${ref.target} "${target}" (${ref.path}), which does not exist`, [el.id]);
          }
        }
      }
    }
  }
}

const fmt = (v: number) => (Math.round(v * 1000) / 1000).toString();

function sameSegment(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const close = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1]) < SAME_SEGMENT;
  return (close(a1, b1) && close(a2, b2)) || (close(a1, b2) && close(a2, b1));
}

export function isValid(home: Home): boolean {
  return validateHome(home).every((i) => i.severity !== 'error');
}
