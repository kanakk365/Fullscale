// Tools that look but never change anything.
import {
  CATALOG,
  checkFit,
  clearance,
  EditError,
  fitsThrough,
  formatLength,
  itemFootprint,
  locate,
  measureBetween,
  openWallEnds,
  pointInPolygon,
  roomInfo,
  sourceOf,
  validateHome,
  wallInfo,
  wallLength,
  wallLengthUncertainty,
  type Home,
  type Source,
  type Vec2,
} from '@fullscale/core';
import { z } from 'zod';
import { defineTool, Distance, Id, m, Point, Size } from './define.ts';

const levelOf = (home: Home, level: string | undefined) => {
  const found = home.levels.find((l) => l.id === (level ?? home.levels[0]!.id));
  if (!found) throw new EditError('not_found', `No level "${level}". Levels: ${home.levels.map((l) => l.id).join(', ')}.`, { id: level, kind: 'level' });
  return found;
};

const sourceText = (s: Source | undefined) => (s ? `${s.kind}${s.uncertainty !== undefined ? ` ±${formatLength(s.uncertainty, { unit: 'cm' }).replace(' ', '')}` : ''}` : 'unknown');

export const getHome = defineTool({
  name: 'get_home',
  title: 'Home overview',
  description: 'Overview of the home: levels, rooms with their areas, counts, the current revision and how many problems are open. Start here, then use get_level for one level in detail.',
  input: z.object({}),
  effect: 'read',
  run(ctx) {
    const h = ctx.studio.home;
    const issues = validateHome(h);
    const count = (s: string) => issues.filter((i) => i.severity === s).length;
    const levels = h.levels.map((l) => ({
      id: l.id,
      name: l.name,
      elevation: l.elevation,
      height: l.height,
      rooms: h.rooms.filter((r) => r.level === l.id).map((r) => ({ id: r.id, name: r.name, area: roomInfo(h, r.id).area })),
      walls: h.walls.filter((w) => w.level === l.id).length,
      items: h.items.filter((i) => i.level === l.id).length,
    }));
    const lines = [`# ${h.name} (revision ${ctx.studio.rev})`];
    for (const l of levels) {
      lines.push(`${l.name} (${l.id}): floor at ${m(l.elevation)}, ${m(l.height)} high; ${l.walls} walls, ${l.items} items.`);
      for (const r of l.rooms) lines.push(`  - ${r.name} (${r.id}): ${r.area.toFixed(1)} m²`);
    }
    lines.push(`Problems: ${count('error')} errors, ${count('warning')} warnings (validate_home lists them).`);
    return {
      text: lines.join('\n'),
      data: { id: h.id, name: h.name, rev: ctx.studio.rev, north: h.north, levels, issues: { errors: count('error'), warnings: count('warning'), info: count('info') } },
    };
  },
});

export const getLevel = defineTool({
  name: 'get_level',
  title: 'One level in detail',
  description:
    'Everything on one level: walls (ends, length with ±, thickness, height, doors and windows), rooms (area, size, ceiling), items (position, turn, size), loose wall ends and plan pictures. Lengths say where they came from (scan, user, estimate…).',
  input: z.object({ level: Id.optional().describe('level id; default the first level') }),
  effect: 'read',
  run(ctx, { level }) {
    const h = ctx.studio.home;
    const l = levelOf(h, level);
    const walls = h.walls
      .filter((w) => w.level === l.id)
      .map((w) => {
        const info = wallInfo(h, w.id);
        const u = wallLengthUncertainty(w);
        return {
          id: w.id,
          start: w.start,
          end: w.end,
          length: info.length,
          lengthText: formatLength(wallLength(w), u === undefined ? {} : { uncertainty: u }),
          thickness: info.thickness,
          height: info.height,
          heightFollowsLevel: info.heightFollowsLevel,
          line: w.line,
          openings: info.openings,
          source: sourceText(sourceOf(w, 'start')),
        };
      });
    const rooms = h.rooms
      .filter((r) => r.level === l.id)
      .map((r) => {
        const info = roomInfo(h, r.id);
        return { id: r.id, name: r.name, area: info.area, width: info.width, depth: info.depth, ceilingHeight: info.ceilingHeight, perimeter: info.perimeter, polygon: r.polygon };
      });
    const items = h.items
      .filter((i) => i.level === l.id)
      .map((i) => ({
        id: i.id,
        name: i.name,
        catalog: i.catalog,
        position: i.position,
        rotation: i.rotation,
        size: i.size,
        sizeSource: sourceText(sourceOf(i, 'size')),
        locked: i.locked,
        model: i.model?.file,
      }));
    const openEnds = openWallEnds(h, l.id);
    const pictures = h.captures.filter((c) => c.plan?.level === l.id).map((c) => ({ id: c.id, path: c.path, scaled: c.plan?.metresPerPixel !== undefined }));
    const text = [
      `${l.name} (${l.id}), revision ${ctx.studio.rev}: ${walls.length} walls, ${rooms.length} rooms, ${items.length} items.`,
      ...walls.map((w) => `wall ${w.id}: ${w.lengthText}, ${m(w.thickness)} thick${w.openings.length ? `, ${w.openings.map((o) => `${o.type} ${o.id}`).join(', ')}` : ''} [${w.source}]`),
      ...rooms.map((r) => `room ${r.name} (${r.id}): ${r.area.toFixed(2)} m², ${m(r.width)} × ${m(r.depth)}`),
      ...items.map((i) => `item ${i.name} (${i.id}): at [${i.position[0]}, ${i.position[2]}], turned ${i.rotation}°, ${i.size.map((v) => v.toFixed(2)).join(' × ')} m [size: ${i.sizeSource}]`),
      ...openEnds.map((o) => `loose end: ${o.wall}.${o.end}${o.candidate ? ` (${m(o.candidate.gap)} from ${o.candidate.wall}; join_wall_end closes it)` : ''}`),
    ].join('\n');
    return { text, data: { level: l, walls, rooms, items, openEnds, pictures, rev: ctx.studio.rev } };
  },
});

export const getElements = defineTool({
  name: 'get_elements',
  title: 'Element details',
  description:
    'Stored fields of up to 20 elements by id, with derived values (wall length and faces, room area and walls, an item’s footprint and nearest neighbours) and where each dimension came from.',
  input: z.object({ ids: z.array(Id).min(1).max(20) }),
  effect: 'read',
  run(ctx, { ids }) {
    const h = ctx.studio.home;
    const found: Array<Record<string, unknown>> = [];
    const missing: string[] = [];
    for (const id of ids) {
      const at = locate(h, id);
      if (!at) {
        missing.push(id);
        continue;
      }
      const kind = at.info.kind;
      const derived =
        kind === 'wall' ? wallInfo(h, id) : kind === 'room' ? roomInfo(h, id) : kind === 'item' ? { footprint: itemFootprint(h.items.find((i) => i.id === id)!), ...clearance(h, id) } : undefined;
      found.push({ kind, element: at.element, ...(derived ? { derived } : {}) });
    }
    const text = `${found.length} found${missing.length ? `; not found: ${missing.join(', ')}` : ''}.\n${JSON.stringify(found, null, 1)}`;
    return { text, data: { elements: found, missing } };
  },
});

export const findElements = defineTool({
  name: 'find_elements',
  title: 'Find elements',
  description: 'Find elements by kind, level, room, name, where their numbers came from, or how unsure they are (e.g. every wall less sure than ±2 cm).',
  input: z.object({
    kind: z.enum(['wall', 'opening', 'room', 'item', 'material', 'level']).optional(),
    level: Id.optional(),
    room: Id.optional().describe('only things inside this room'),
    name: z.string().max(80).optional().describe('part of the name, any case'),
    source: z.enum(['user', 'scan', 'plan', 'catalog', 'maker', 'estimate', 'agent']).optional(),
    uncertainty_above: Distance('only things less sure than this').optional(),
    limit: z.number().int().min(1).max(200).optional().describe('default 50'),
  }),
  effect: 'read',
  run(ctx, q) {
    const h = ctx.studio.home;
    const room = q.room ? h.rooms.find((r) => r.id === q.room) : undefined;
    if (q.room && !room) throw new EditError('not_found', `No room "${q.room}".`, { id: q.room, kind: 'room' });
    const rows: Array<{ id: string; kind: string; name?: string; level?: string; source?: string }> = [];
    const consider = (kind: string, el: { id: string; name?: string; level?: string; source?: Source; sources?: Record<string, Source> }, at?: Vec2) => {
      if (q.kind && q.kind !== kind) return;
      if (q.level && el.level !== undefined && el.level !== q.level) return;
      if (room && (!at || !pointInPolygon(at, room.polygon))) return;
      if (q.name && !(el.name ?? '').toLowerCase().includes(q.name.toLowerCase())) return;
      const s = el.source;
      if (q.source && s?.kind !== q.source) return;
      if (q.uncertainty_above !== undefined && !((s?.uncertainty ?? Infinity) > q.uncertainty_above)) return;
      rows.push({ id: el.id, kind, ...(el.name ? { name: el.name } : {}), ...(el.level ? { level: el.level } : {}), source: sourceText(s) });
    };
    for (const l of h.levels) consider('level', l);
    for (const w of h.walls) consider('wall', w, [(w.start[0] + w.end[0]) / 2, (w.start[1] + w.end[1]) / 2]);
    for (const o of h.openings) {
      const w = h.walls.find((x) => x.id === o.wall);
      consider('opening', { ...o, level: w?.level }, w ? [(w.start[0] + w.end[0]) / 2, (w.start[1] + w.end[1]) / 2] : undefined);
    }
    for (const r of h.rooms) consider('room', r, r.polygon[0]);
    for (const i of h.items) consider('item', i, [i.position[0], i.position[2]]);
    for (const mat of h.materials) consider('material', mat);
    const limit = q.limit ?? 50;
    const shown = rows.slice(0, limit);
    const more = rows.length > limit ? ` Showing ${limit} of ${rows.length}; narrow the search.` : '';
    return { text: `${rows.length} found.${more}\n${shown.map((r) => `${r.kind} ${r.id}${r.name ? ` "${r.name}"` : ''} [${r.source}]`).join('\n')}`, data: { total: rows.length, shown } };
  },
});

export const measure = defineTool({
  name: 'measure',
  title: 'Measure',
  description:
    'Distance between two elements or points on the plan, with ± from where their positions came from. mode "gap" (default) is the shortest gap between outlines; "centres" is centre to centre.',
  input: z.object({
    a: z.union([Id, Point]).describe('an element id or [x, z]'),
    b: z.union([Id, Point]).describe('an element id or [x, z]'),
    mode: z.enum(['gap', 'centres']).optional(),
  }),
  effect: 'read',
  run(ctx, { a, b, mode }) {
    const r = measureBetween(ctx.studio.home, a as string | Vec2, b as string | Vec2, mode ?? 'gap');
    const text = `${formatLength(r.distance, r.uncertainty === undefined ? {} : { uncertainty: r.uncertainty })} (${r.method}; from ${r.sources.join(', ') || 'given points'}).`;
    return { text, data: { ...r, rev: ctx.studio.rev } };
  },
});

export const checkFitTool = defineTool({
  name: 'check_fit',
  title: 'Will it fit here?',
  description:
    'Check whether something of a given size fits at a spot on the plan: against walls, furniture, door swings and the room outline. Answers say what was and was not checked, and suggest the nearest spot that works. Give `item` to check an existing item where it is or at a new pose.',
  input: z.object({
    size: Size.optional().describe('[width, height, depth]; needed unless `item` is given'),
    item: Id.optional().describe('an existing item to check'),
    position: Point.optional().describe('[x, z] of the footprint centre; default: where the item is'),
    elevation: Distance('height of its bottom above the floor').optional(),
    rotation: z.number().finite().optional().describe('degrees, counter-clockwise seen from above'),
    level: Id.optional(),
    room: Id.optional().describe('the room it should stand in; found from the position by default'),
    clearance: Distance('space to keep around it').optional(),
  }),
  effect: 'read',
  run(ctx, q) {
    const h = ctx.studio.home;
    const item = q.item ? h.items.find((i) => i.id === q.item) : undefined;
    if (q.item && !item) throw new EditError('not_found', `No item "${q.item}".`, { id: q.item, kind: 'item' });
    const size = q.size ?? item?.size;
    const flat = q.position ?? (item ? ([item.position[0], item.position[2]] as Vec2) : undefined);
    if (!size || !flat) throw new EditError('invalid_input', 'Give a size and a position, or an existing item.');
    const answer = checkFit(h, {
      size,
      position: [flat[0], q.elevation ?? item?.position[1] ?? 0, flat[1]],
      rotation: q.rotation ?? item?.rotation ?? 0,
      level: q.level ?? item?.level,
      ...(q.room ? { room: q.room } : {}),
      ...(q.clearance !== undefined ? { clearance: q.clearance } : {}),
      ...(item ? { ignore: [item.id], sizeSource: sourceOf(item, 'size') } : {}),
    });
    const verdict = answer.fits ? 'The footprint fits at this pose.' : `It does not fit: ${answer.problems.map((p) => p.message).join(' ')}`;
    const suggestion = answer.suggestion ? ` Nearest pose that works: [${answer.suggestion.position[0]}, ${answer.suggestion.position[2]}], turned ${answer.suggestion.rotation}°.` : '';
    const text = `${verdict}${suggestion}\nChecked: ${answer.checked.join('; ')}.\nNot checked: ${answer.notChecked.join('; ')}.${answer.caveats.length ? `\nCaveats: ${answer.caveats.join(' ')}` : ''} Status: ${answer.status}.`;
    return { text, data: { ...answer, rev: ctx.studio.rev } };
  },
});

export const fitsThroughTool = defineTool({
  name: 'fits_through',
  title: 'Will it go through this door?',
  description: 'Whether an object can be carried through a door or opening, turned on its side if needed (not tilted diagonally).',
  input: z.object({
    opening: Id,
    size: Size,
    margin: Distance('space to leave for hands and wrapping, default 2 cm').optional(),
  }),
  effect: 'read',
  run(ctx, { opening, size, margin }) {
    const h = ctx.studio.home;
    const r = fitsThrough(h, opening, size, margin);
    const o = h.openings.find((x) => x.id === opening)!;
    const s = sourceOf(o, 'width');
    const unsure = !s || s.kind === 'estimate' || s.kind === 'catalog';
    const text = `${r.explanation}${unsure ? ` The opening's size is ${s ? `a ${s.kind} value` : 'of unknown origin'}; measure it before relying on this.` : ''}`;
    return { text, data: { ...r, openingSource: s ?? null, rev: ctx.studio.rev } };
  },
});

export const validate = defineTool({
  name: 'validate_home',
  title: 'Problems',
  description: 'Everything wrong or worth a look: overlapping doors, furniture in walls, missing references, loose wall ends and more. Each problem has a stable code and the ids involved.',
  input: z.object({
    severity: z.enum(['error', 'warning', 'info']).optional().describe('only this severity'),
    ids: z.array(Id).max(50).optional().describe('only problems involving these elements'),
  }),
  effect: 'read',
  run(ctx, { severity, ids }) {
    const h = ctx.studio.home;
    let issues = validateHome(h);
    for (const level of h.levels) {
      for (const end of openWallEnds(h, level.id)) {
        issues.push({
          severity: 'info',
          code: 'wall_end_loose',
          message: `The ${end.end} of wall "${end.wall}" meets nothing${end.candidate ? ` (${m(end.candidate.gap)} from ${end.candidate.wall})` : ''}.`,
          ids: [end.wall],
        });
      }
    }
    if (severity) issues = issues.filter((i) => i.severity === severity);
    if (ids) issues = issues.filter((i) => i.ids.some((x) => ids.includes(x)));
    const text = issues.length ? issues.map((i) => `${i.severity} ${i.code}: ${i.message}`).join('\n') : 'No problems found.';
    return { text, data: { issues, rev: ctx.studio.rev } };
  },
});

export const searchCatalog = defineTool({
  name: 'search_catalog',
  title: 'Furniture catalogue',
  description: 'Built-in furniture with typical sizes. Use an entry’s id with add_items, and give the real product size when known.',
  input: z.object({
    query: z.string().max(80).optional().describe('words in the name or id'),
    category: z.enum(['living', 'bedroom', 'dining', 'office', 'kitchen', 'bathroom', 'storage', 'decor']).optional(),
  }),
  effect: 'read',
  run(_ctx, { query, category }) {
    const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const found = CATALOG.filter((c) => (!category || c.category === category) && words.every((w) => `${c.id} ${c.name}`.toLowerCase().includes(w)));
    const text = found.length
      ? found.map((c) => `${c.id}: ${c.name}, ${c.size.map((v) => v.toFixed(2)).join(' × ')} m (w × h × d)${c.againstWall ? ', usually against a wall' : ''}`).join('\n')
      : 'Nothing matched. "box" is a plain box at any size.';
    return { text, data: { entries: found.map((c) => ({ id: c.id, name: c.name, category: c.category, size: c.size, parts: c.parts, againstWall: !!c.againstWall })) } };
  },
});

export const getSelection = defineTool({
  name: 'get_selection',
  title: 'What the person selected',
  description: 'What the person has selected in the editor, so "this sofa" or "that wall" can be resolved.',
  input: z.object({}),
  effect: 'read',
  run(ctx) {
    const h = ctx.studio.home;
    const selected = ctx.studio
      .selection()
      .filter((s) => s.actor !== ctx.actor)
      .map((s) => ({ actor: s.actor, elements: s.ids.map((id) => ({ id, kind: locate(h, id)?.info.kind ?? 'gone', name: (locate(h, id)?.element as { name?: string } | undefined)?.name })) }));
    const all = selected.flatMap((s) => s.elements);
    const text = all.length ? `Selected: ${all.map((e) => `${e.kind} ${e.id}${e.name ? ` "${e.name}"` : ''}`).join(', ')}.` : 'Nothing is selected in the editor.';
    return { text, data: { selected } };
  },
});

export const recentChanges = defineTool({
  name: 'recent_changes',
  title: 'What changed',
  description: 'Changes since a revision, by anyone: the person in the editor, Blender or agents. Use it to see what the person did since you last looked.',
  input: z.object({
    since: z.number().int().nonnegative().describe('revision to start after'),
    actor: z.string().max(40).optional().describe('only changes by this actor, e.g. "person"'),
  }),
  effect: 'read',
  run(ctx, { since, actor }) {
    const changes = ctx.studio.changesSince(since, actor).map((c) => ({ rev: c.rev, actor: c.actor, label: c.label, changed: c.changed, removed: c.removed }));
    const text = changes.length
      ? changes.map((c) => `r${c.rev} ${c.actor}: ${c.label}${c.changed.length ? ` (changed ${c.changed.join(', ')})` : ''}${c.removed.length ? ` (removed ${c.removed.join(', ')})` : ''}`).join('\n')
      : `No changes since revision ${since}.`;
    return { text, data: { rev: ctx.studio.rev, changes } };
  },
});
