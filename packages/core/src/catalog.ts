// Built-in furniture catalogue. Sizes are common real-world sizes in metres
// [width, height, depth]. Every item can be resized to the exact product size.
// `shape` tells renderers which procedural model to draw until a CC0 model is attached.
import type { Item, MaterialKind } from './schema.ts';

export type Shape =
  | 'sofa'
  | 'armchair'
  | 'bed'
  | 'table'
  | 'chair'
  | 'desk'
  | 'cabinet'
  | 'shelf'
  | 'counter'
  | 'appliance'
  | 'toilet'
  | 'bathtub'
  | 'shower'
  | 'basin'
  | 'rug'
  | 'plant'
  | 'lamp'
  | 'office-chair'
  | 'desk-drawers'
  | 'monitor'
  | 'laptop'
  | 'wall-unit'
  | 'rail'
  | 'frame'
  | 'bulb'
  | 'tube-light'
  | 'ceiling-light'
  | 'pendant'
  | 'ceiling-fan'
  | 'box';

export interface CatalogEntry {
  id: string;
  name: string;
  category: Category;
  shape: Shape;
  size: [number, number, number];
  /** named parts that can take their own material */
  parts: string[];
  /** default colours per part */
  colors: Record<string, string>;
  /** sits on the floor against a wall by default */
  againstWall?: boolean;
  /** hangs from the ceiling: placed with its top at the ceiling unless told otherwise */
  ceiling?: boolean;
  /** a light: its usual colour temperature (kelvin) and brightness (lumens), the part that
   *  glows, and whether it starts switched off (screens) */
  light?: { kelvin: number; lumens: number; part: string; off?: boolean };
}

export const CATEGORIES = ['living', 'bedroom', 'dining', 'office', 'kitchen', 'bathroom', 'storage', 'decor', 'lighting'] as const;
export type Category = (typeof CATEGORIES)[number];

const e = (entry: CatalogEntry): CatalogEntry => entry;

/** What each part of a shape is usually made of, for parts left in their catalogue colour:
 *  renderers give fabric a soft weave, wood a grain, metal a shine. */
const SHAPE_PART_KINDS: Readonly<Record<Shape, Readonly<Record<string, MaterialKind>>>> = {
  sofa: { body: 'fabric', legs: 'wood' },
  armchair: { body: 'fabric', legs: 'wood' },
  bed: { frame: 'wood', mattress: 'fabric', bedding: 'fabric', pillows: 'fabric' },
  table: { top: 'wood', legs: 'wood' },
  chair: { body: 'wood' },
  desk: { top: 'wood', legs: 'metal' },
  cabinet: { body: 'wood' },
  shelf: { body: 'wood' },
  counter: { body: 'wood', top: 'stone' },
  appliance: { body: 'plastic' },
  toilet: { body: 'plastic' },
  bathtub: { body: 'plastic' },
  shower: { body: 'plastic' },
  basin: { body: 'plastic' },
  rug: { body: 'carpet' },
  plant: { pot: 'stone', leaves: 'other' },
  lamp: { body: 'metal', shade: 'fabric' },
  bulb: { holder: 'plastic', bulb: 'plastic' },
  'tube-light': { body: 'plastic', tube: 'plastic' },
  'ceiling-light': { body: 'plastic', diffuser: 'plastic' },
  pendant: { shade: 'metal', cord: 'plastic', bulb: 'plastic' },
  'ceiling-fan': { body: 'plastic', blades: 'plastic' },
  'office-chair': { body: 'fabric', frame: 'metal' },
  'desk-drawers': { top: 'wood', body: 'wood', fronts: 'wood' },
  monitor: { frame: 'plastic', screen: 'plastic' },
  laptop: { body: 'metal', screen: 'plastic', keys: 'other' },
  'wall-unit': { body: 'plastic', vent: 'plastic' },
  rail: { body: 'metal' },
  frame: { frame: 'wood', picture: 'paint' },
  box: { body: 'other' },
};

/** What a catalogue item's part is made of when it keeps its catalogue colour. */
export function partKind(entry: Pick<CatalogEntry, 'shape'>, part: string): MaterialKind {
  return SHAPE_PART_KINDS[entry.shape][part] ?? 'other';
}

export const CATALOG: CatalogEntry[] = [
  e({ id: 'sofa-3', name: 'Sofa, 3 seats', category: 'living', shape: 'sofa', size: [2.1, 0.85, 0.92], parts: ['body', 'legs'], colors: { body: '#8a9a8b', legs: '#5b4636' }, againstWall: true }),
  e({ id: 'sofa-2', name: 'Sofa, 2 seats', category: 'living', shape: 'sofa', size: [1.6, 0.85, 0.9], parts: ['body', 'legs'], colors: { body: '#8a9a8b', legs: '#5b4636' }, againstWall: true }),
  e({ id: 'armchair', name: 'Armchair', category: 'living', shape: 'armchair', size: [0.85, 0.85, 0.85], parts: ['body', 'legs'], colors: { body: '#c9a66b', legs: '#5b4636' } }),
  e({ id: 'coffee-table', name: 'Coffee table', category: 'living', shape: 'table', size: [1.1, 0.42, 0.6], parts: ['top', 'legs'], colors: { top: '#a47c55', legs: '#a47c55' } }),
  e({ id: 'tv-unit', name: 'TV unit', category: 'living', shape: 'cabinet', size: [1.6, 0.5, 0.42], parts: ['body'], colors: { body: '#e8e2d6' }, againstWall: true }),
  e({ id: 'bookshelf', name: 'Bookshelf', category: 'storage', shape: 'shelf', size: [0.8, 2.0, 0.3], parts: ['body'], colors: { body: '#efe9df' }, againstWall: true }),
  e({
    id: 'bed-double',
    name: 'Double bed',
    category: 'bedroom',
    shape: 'bed',
    size: [1.6, 0.95, 2.1],
    parts: ['frame', 'mattress', 'bedding', 'pillows'],
    colors: { frame: '#a47c55', mattress: '#f4f1ea', bedding: '#b9c6d3', pillows: '#f4f1ea' },
    againstWall: true,
  }),
  e({
    id: 'bed-single',
    name: 'Single bed',
    category: 'bedroom',
    shape: 'bed',
    size: [0.95, 0.95, 2.05],
    parts: ['frame', 'mattress', 'bedding', 'pillows'],
    colors: { frame: '#a47c55', mattress: '#f4f1ea', bedding: '#d8c4b6', pillows: '#f4f1ea' },
    againstWall: true,
  }),
  e({ id: 'nightstand', name: 'Bedside table', category: 'bedroom', shape: 'cabinet', size: [0.45, 0.55, 0.4], parts: ['body'], colors: { body: '#a47c55' }, againstWall: true }),
  e({ id: 'wardrobe', name: 'Wardrobe', category: 'storage', shape: 'cabinet', size: [1.0, 2.0, 0.6], parts: ['body'], colors: { body: '#efe9df' }, againstWall: true }),
  e({ id: 'dining-table-4', name: 'Dining table, 4 seats', category: 'dining', shape: 'table', size: [1.2, 0.75, 0.8], parts: ['top', 'legs'], colors: { top: '#a47c55', legs: '#a47c55' } }),
  e({ id: 'dining-table-6', name: 'Dining table, 6 seats', category: 'dining', shape: 'table', size: [1.8, 0.75, 0.9], parts: ['top', 'legs'], colors: { top: '#a47c55', legs: '#a47c55' } }),
  e({ id: 'chair', name: 'Chair', category: 'dining', shape: 'chair', size: [0.45, 0.85, 0.5], parts: ['body'], colors: { body: '#3f3f3f' } }),
  e({ id: 'desk', name: 'Desk', category: 'office', shape: 'desk', size: [1.4, 0.75, 0.7], parts: ['top', 'legs'], colors: { top: '#efe9df', legs: '#3f3f3f' }, againstWall: true }),
  e({ id: 'office-chair', name: 'Office chair', category: 'office', shape: 'office-chair', size: [0.65, 1.2, 0.65], parts: ['body', 'frame'], colors: { body: '#232326', frame: '#cfd0d3' } }),
  e({
    id: 'desk-drawers',
    name: 'Desk with drawers',
    category: 'office',
    shape: 'desk-drawers',
    size: [1.2, 0.75, 0.6],
    parts: ['top', 'body', 'fronts'],
    colors: { top: '#dcd9d2', body: '#3a3a3d', fronts: '#4a4a4e' },
    againstWall: true,
  }),
  e({
    id: 'monitor',
    name: 'Computer monitor',
    category: 'office',
    shape: 'monitor',
    size: [0.62, 0.46, 0.2],
    parts: ['frame', 'screen'],
    colors: { frame: '#1c1c1e', screen: '#1f2836' },
    light: { kelvin: 6500, lumens: 120, part: 'screen', off: true },
  }),
  e({
    id: 'laptop',
    name: 'Laptop, open',
    category: 'office',
    shape: 'laptop',
    size: [0.34, 0.23, 0.24],
    parts: ['body', 'screen', 'keys'],
    colors: { body: '#bfc1c6', screen: '#1f2633', keys: '#1d1d20' },
    light: { kelvin: 6500, lumens: 50, part: 'screen', off: true },
  }),
  e({
    id: 'kitchen-base',
    name: 'Kitchen base unit',
    category: 'kitchen',
    shape: 'counter',
    size: [0.6, 0.9, 0.6],
    parts: ['body', 'top'],
    colors: { body: '#f2f0eb', top: '#b8b3a8' },
    againstWall: true,
  }),
  e({ id: 'kitchen-wall', name: 'Kitchen wall unit', category: 'kitchen', shape: 'cabinet', size: [0.6, 0.72, 0.35], parts: ['body'], colors: { body: '#f2f0eb' }, againstWall: true }),
  e({ id: 'fridge', name: 'Fridge', category: 'kitchen', shape: 'appliance', size: [0.6, 1.85, 0.65], parts: ['body'], colors: { body: '#d9dcdf' }, againstWall: true }),
  e({ id: 'cooker', name: 'Cooker', category: 'kitchen', shape: 'appliance', size: [0.6, 0.9, 0.6], parts: ['body'], colors: { body: '#2b2b2b' }, againstWall: true }),
  e({ id: 'toilet', name: 'Toilet', category: 'bathroom', shape: 'toilet', size: [0.38, 0.8, 0.68], parts: ['body'], colors: { body: '#f7f7f5' }, againstWall: true }),
  e({ id: 'basin', name: 'Wash basin', category: 'bathroom', shape: 'basin', size: [0.6, 0.85, 0.45], parts: ['body'], colors: { body: '#f7f7f5' }, againstWall: true }),
  e({ id: 'bathtub', name: 'Bathtub', category: 'bathroom', shape: 'bathtub', size: [1.7, 0.55, 0.75], parts: ['body'], colors: { body: '#f7f7f5' }, againstWall: true }),
  e({ id: 'shower', name: 'Shower tray', category: 'bathroom', shape: 'shower', size: [0.9, 2.0, 0.9], parts: ['body'], colors: { body: '#f7f7f5' }, againstWall: true }),
  e({ id: 'rug', name: 'Rug', category: 'decor', shape: 'rug', size: [2.0, 0.01, 1.4], parts: ['body'], colors: { body: '#c8b8a2' } }),
  e({ id: 'plant', name: 'Plant', category: 'decor', shape: 'plant', size: [0.45, 1.2, 0.45], parts: ['pot', 'leaves'], colors: { pot: '#c9b8a4', leaves: '#4f7a4a' } }),
  e({
    id: 'floor-lamp',
    name: 'Floor lamp',
    category: 'lighting',
    shape: 'lamp',
    size: [0.35, 1.6, 0.35],
    parts: ['body', 'shade'],
    colors: { body: '#2b2b2b', shade: '#f4ead8' },
    light: { kelvin: 2700, lumens: 800, part: 'shade' },
  }),
  e({
    id: 'desk-lamp',
    name: 'Desk lamp',
    category: 'lighting',
    shape: 'lamp',
    size: [0.2, 0.45, 0.2],
    parts: ['body', 'shade'],
    colors: { body: '#2b2b2b', shade: '#f4ead8' },
    light: { kelvin: 3000, lumens: 450, part: 'shade' },
  }),
  e({
    id: 'wall-bulb',
    name: 'Bulb in a wall holder',
    category: 'lighting',
    shape: 'bulb',
    size: [0.11, 0.11, 0.17],
    parts: ['holder', 'bulb'],
    colors: { holder: '#f2f1ec', bulb: '#fbfbf8' },
    againstWall: true,
    light: { kelvin: 6500, lumens: 900, part: 'bulb' },
  }),
  e({
    id: 'tube-light',
    name: 'Tube light (LED batten)',
    category: 'lighting',
    shape: 'tube-light',
    size: [1.22, 0.04, 0.045],
    parts: ['body', 'tube'],
    colors: { body: '#f2f1ec', tube: '#fbfbf8' },
    againstWall: true,
    light: { kelvin: 6500, lumens: 2000, part: 'tube' },
  }),
  e({
    id: 'ceiling-light',
    name: 'Ceiling light, round',
    category: 'lighting',
    shape: 'ceiling-light',
    size: [0.3, 0.05, 0.3],
    parts: ['body', 'diffuser'],
    colors: { body: '#f2f1ec', diffuser: '#fbfbf8' },
    ceiling: true,
    light: { kelvin: 4000, lumens: 1600, part: 'diffuser' },
  }),
  e({
    id: 'pendant-light',
    name: 'Hanging light with a shade',
    category: 'lighting',
    shape: 'pendant',
    size: [0.3, 0.6, 0.3],
    parts: ['shade', 'cord', 'bulb'],
    colors: { shade: '#2b2b2b', cord: '#1c1c1c', bulb: '#fbfbf8' },
    ceiling: true,
    light: { kelvin: 2700, lumens: 800, part: 'bulb' },
  }),
  e({
    id: 'ceiling-fan',
    name: 'Ceiling fan',
    category: 'living',
    shape: 'ceiling-fan',
    size: [1.2, 0.35, 1.2],
    parts: ['body', 'blades'],
    colors: { body: '#f1f0ec', blades: '#f1f0ec' },
    ceiling: true,
  }),
  e({
    id: 'air-conditioner',
    name: 'Air conditioner, wall unit',
    category: 'living',
    shape: 'wall-unit',
    size: [0.95, 0.3, 0.24],
    parts: ['body', 'vent'],
    colors: { body: '#f2f2f0', vent: '#9c9c9a' },
    againstWall: true,
  }),
  e({ id: 'clothes-rail', name: 'Clothes rail with hooks, wall', category: 'bedroom', shape: 'rail', size: [1.2, 0.08, 0.08], parts: ['body'], colors: { body: '#c8cacd' }, againstWall: true }),
  e({ id: 'picture-frame', name: 'Picture frame', category: 'decor', shape: 'frame', size: [0.2, 0.25, 0.02], parts: ['frame', 'picture'], colors: { frame: '#2b2623', picture: '#c8a585' } }),
  e({ id: 'box', name: 'Generic object', category: 'storage', shape: 'box', size: [0.5, 0.5, 0.5], parts: ['body'], colors: { body: '#bdbdbd' } }),
];

export const CATALOG_BY_ID: ReadonlyMap<string, CatalogEntry> = new Map(CATALOG.map((c) => [c.id, c]));

export function catalogEntry(id: string): CatalogEntry {
  return CATALOG_BY_ID.get(id) ?? CATALOG_BY_ID.get('box')!;
}

/** An item's light as it shines: the catalogue's colour and brightness unless the item has
 *  its own, and on unless switched off (screens start off). Null for items that aren't
 *  lights. */
export interface ItemLight {
  on: boolean;
  kelvin: number;
  lumens: number;
  /** the part that glows */
  part: string;
}

export function itemLight(item: Pick<Item, 'catalog' | 'light'>): ItemLight | null {
  const light = CATALOG_BY_ID.get(item.catalog)?.light;
  if (!light) return null;
  return { on: item.light?.on ?? !light.off, kelvin: item.light?.kelvin ?? light.kelvin, lumens: item.light?.lumens ?? light.lumens, part: light.part };
}
