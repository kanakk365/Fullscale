// Where to put a label inside a shape: the point furthest from its edges, so the label of
// an L-shaped room sits in the room and not in the corner it wraps around. Found by
// splitting the outline's box into cells and only looking further into cells that could
// still hold a better point.
import { bounds, pointInPolygon, pointSegmentDistance, polygonCentroid } from './geometry.ts';
import type { Vec2 } from './schema.ts';

/** Distance from a point to an outline: positive inside, negative outside. */
export function signedDistanceToOutline(p: Vec2, poly: Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, pointSegmentDistance(p, poly[i]!, poly[(i + 1) % poly.length]!));
  return pointInPolygon(p, poly) ? d : -d;
}

interface Cell {
  centre: Vec2;
  half: number;
  /** distance from the centre to the outline */
  d: number;
  /** the best distance any point in this cell could have */
  max: number;
}

function cell(centre: Vec2, half: number, poly: Vec2[]): Cell {
  const d = signedDistanceToOutline(centre, poly);
  return { centre, half, d, max: d + half * Math.SQRT2 };
}

/** The point inside `poly` furthest from its edges, to within `precision` metres. */
export function labelPoint(poly: Vec2[], precision = 0.01): Vec2 {
  const box = bounds(poly);
  const size = Math.min(box.size[0], box.size[1]);
  if (size <= 0) return poly[0] ?? [0, 0];

  let best = cell(polygonCentroid(poly), 0, poly);
  const boxCentre = cell([box.min[0] + box.size[0] / 2, box.min[1] + box.size[1] / 2], 0, poly);
  if (boxCentre.d > best.d) best = boxCentre;

  const queue = new MaxQueue();
  const half = size / 2;
  for (let x = box.min[0]; x < box.max[0]; x += size) {
    for (let z = box.min[1]; z < box.max[1]; z += size) queue.push(cell([x + half, z + half], half, poly));
  }
  for (let c = queue.pop(); c; c = queue.pop()) {
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    const h = c.half / 2;
    for (const [dx, dz] of [
      [-h, -h],
      [h, -h],
      [-h, h],
      [h, h],
    ] as const) {
      queue.push(cell([c.centre[0] + dx, c.centre[1] + dz], h, poly));
    }
  }
  return best.centre;
}

/** A binary heap ordered by `max`, largest first. */
class MaxQueue {
  private items: Cell[] = [];

  push(c: Cell): void {
    const a = this.items;
    a.push(c);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent]!.max >= a[i]!.max) break;
      [a[parent], a[i]] = [a[i]!, a[parent]!];
      i = parent;
    }
  }

  pop(): Cell | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.max > a[m]!.max) m = l;
        if (r < a.length && a[r]!.max > a[m]!.max) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}
