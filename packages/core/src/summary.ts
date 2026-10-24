// A short, readable description of a home for people and agents.
import { roomInfo, wallOpenings } from './measure.ts';
import type { Home } from './schema.ts';
import { wallLength } from './geometry.ts';

const m = (v: number) => `${(Math.round(v * 100) / 100).toFixed(2)} m`;
const m2 = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1)} m²`;

export function summarizeHome(home: Home): string {
  const lines: string[] = [];
  lines.push(`# ${home.name}`);
  lines.push(`${home.levels.length} level(s), ${home.rooms.length} room(s), ${home.walls.length} wall(s), ${home.openings.length} door/window opening(s), ${home.items.length} item(s).`);
  for (const level of home.levels) {
    lines.push('');
    lines.push(`## ${level.name} (${level.id}), floor at ${m(level.elevation)}, height ${m(level.height)}`);
    const rooms = home.rooms.filter((r) => r.level === level.id);
    let total = 0;
    for (const r of rooms) {
      const info = roomInfo(home, r.id);
      total += info.area;
      lines.push(`- Room ${r.name} (${r.id}): ${m2(info.area)}, about ${m(info.width)} × ${m(info.depth)}, ceiling ${m(info.ceilingHeight)}; ${info.items.length} item(s)`);
    }
    if (rooms.length) lines.push(`- Total room area: ${m2(total)}`);
    for (const w of home.walls.filter((x) => x.level === level.id)) {
      const ops = wallOpenings(home, w.id).map((o) => `${o.type} ${o.id} ${m(o.width)} wide at ${m(o.offset)}`);
      const height = w.height === undefined ? '' : `, ${m(w.height)} high`;
      lines.push(`- Wall ${w.id}: ${m(wallLength(w))} long, ${m(w.thickness)} thick${height}${ops.length ? `; ${ops.join(', ')}` : ''}`);
    }
    for (const it of home.items.filter((x) => x.level === level.id)) {
      const [w, h, d] = it.size;
      lines.push(`- Item ${it.name} (${it.id}): ${m(w)} × ${m(d)}, ${m(h)} high, at x ${m(it.position[0])}, z ${m(it.position[2])}, turned ${Math.round(it.rotation)}°`);
    }
  }
  return lines.join('\n');
}
