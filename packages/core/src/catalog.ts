// Built-in furniture catalogue. Sizes are common real-world sizes in metres
// [width, height, depth]. Every item can be resized to the exact product size.
// `shape` tells renderers which procedural model to draw until a CC0 model is attached.

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
  | 'box';

export interface CatalogEntry {
  id: string;
  name: string;
  category: 'living' | 'bedroom' | 'dining' | 'office' | 'kitchen' | 'bathroom' | 'storage' | 'decor';
  shape: Shape;
  size: [number, number, number];
  /** named parts that can take their own material */
  parts: string[];
  /** default colours per part */
  colors: Record<string, string>;
  /** sits on the floor against a wall by default */
  againstWall?: boolean;
}

const e = (entry: CatalogEntry): CatalogEntry => entry;

export const CATALOG: CatalogEntry[] = [
  e({ id: 'sofa-3', name: 'Sofa, 3 seats', category: 'living', shape: 'sofa', size: [2.1, 0.85, 0.92], parts: ['body', 'legs'], colors: { body: '#8a9a8b', legs: '#5b4636' }, againstWall: true }),
  e({ id: 'sofa-2', name: 'Sofa, 2 seats', category: 'living', shape: 'sofa', size: [1.6, 0.85, 0.9], parts: ['body', 'legs'], colors: { body: '#8a9a8b', legs: '#5b4636' }, againstWall: true }),
  e({ id: 'armchair', name: 'Armchair', category: 'living', shape: 'armchair', size: [0.85, 0.85, 0.85], parts: ['body', 'legs'], colors: { body: '#c9a66b', legs: '#5b4636' } }),
  e({ id: 'coffee-table', name: 'Coffee table', category: 'living', shape: 'table', size: [1.1, 0.42, 0.6], parts: ['top', 'legs'], colors: { top: '#a47c55', legs: '#a47c55' } }),
  e({ id: 'tv-unit', name: 'TV unit', category: 'living', shape: 'cabinet', size: [1.6, 0.5, 0.42], parts: ['body'], colors: { body: '#e8e2d6' }, againstWall: true }),
  e({ id: 'bookshelf', name: 'Bookshelf', category: 'storage', shape: 'shelf', size: [0.8, 2.0, 0.3], parts: ['body'], colors: { body: '#efe9df' }, againstWall: true }),
  e({ id: 'bed-double', name: 'Double bed', category: 'bedroom', shape: 'bed', size: [1.6, 0.95, 2.1], parts: ['frame', 'mattress', 'bedding'], colors: { frame: '#a47c55', mattress: '#f4f1ea', bedding: '#b9c6d3' }, againstWall: true }),
  e({ id: 'bed-single', name: 'Single bed', category: 'bedroom', shape: 'bed', size: [0.95, 0.95, 2.05], parts: ['frame', 'mattress', 'bedding'], colors: { frame: '#a47c55', mattress: '#f4f1ea', bedding: '#d8c4b6' }, againstWall: true }),
  e({ id: 'nightstand', name: 'Bedside table', category: 'bedroom', shape: 'cabinet', size: [0.45, 0.55, 0.4], parts: ['body'], colors: { body: '#a47c55' }, againstWall: true }),
  e({ id: 'wardrobe', name: 'Wardrobe', category: 'storage', shape: 'cabinet', size: [1.0, 2.0, 0.6], parts: ['body'], colors: { body: '#efe9df' }, againstWall: true }),
  e({ id: 'dining-table-4', name: 'Dining table, 4 seats', category: 'dining', shape: 'table', size: [1.2, 0.75, 0.8], parts: ['top', 'legs'], colors: { top: '#a47c55', legs: '#a47c55' } }),
  e({ id: 'dining-table-6', name: 'Dining table, 6 seats', category: 'dining', shape: 'table', size: [1.8, 0.75, 0.9], parts: ['top', 'legs'], colors: { top: '#a47c55', legs: '#a47c55' } }),
  e({ id: 'chair', name: 'Chair', category: 'dining', shape: 'chair', size: [0.45, 0.85, 0.5], parts: ['body'], colors: { body: '#3f3f3f' } }),
  e({ id: 'desk', name: 'Desk', category: 'office', shape: 'desk', size: [1.4, 0.75, 0.7], parts: ['top', 'legs'], colors: { top: '#efe9df', legs: '#3f3f3f' }, againstWall: true }),
  e({ id: 'office-chair', name: 'Office chair', category: 'office', shape: 'chair', size: [0.65, 1.1, 0.65], parts: ['body'], colors: { body: '#2e2e2e' } }),
  e({ id: 'kitchen-base', name: 'Kitchen base unit', category: 'kitchen', shape: 'counter', size: [0.6, 0.9, 0.6], parts: ['body', 'top'], colors: { body: '#f2f0eb', top: '#b8b3a8' }, againstWall: true }),
  e({ id: 'kitchen-wall', name: 'Kitchen wall unit', category: 'kitchen', shape: 'cabinet', size: [0.6, 0.72, 0.35], parts: ['body'], colors: { body: '#f2f0eb' }, againstWall: true }),
  e({ id: 'fridge', name: 'Fridge', category: 'kitchen', shape: 'appliance', size: [0.6, 1.85, 0.65], parts: ['body'], colors: { body: '#d9dcdf' }, againstWall: true }),
  e({ id: 'cooker', name: 'Cooker', category: 'kitchen', shape: 'appliance', size: [0.6, 0.9, 0.6], parts: ['body'], colors: { body: '#2b2b2b' }, againstWall: true }),
  e({ id: 'toilet', name: 'Toilet', category: 'bathroom', shape: 'toilet', size: [0.38, 0.8, 0.68], parts: ['body'], colors: { body: '#f7f7f5' }, againstWall: true }),
  e({ id: 'basin', name: 'Wash basin', category: 'bathroom', shape: 'basin', size: [0.6, 0.85, 0.45], parts: ['body'], colors: { body: '#f7f7f5' }, againstWall: true }),
  e({ id: 'bathtub', name: 'Bathtub', category: 'bathroom', shape: 'bathtub', size: [1.7, 0.55, 0.75], parts: ['body'], colors: { body: '#f7f7f5' }, againstWall: true }),
  e({ id: 'shower', name: 'Shower tray', category: 'bathroom', shape: 'shower', size: [0.9, 2.0, 0.9], parts: ['body'], colors: { body: '#f7f7f5' }, againstWall: true }),
  e({ id: 'rug', name: 'Rug', category: 'decor', shape: 'rug', size: [2.0, 0.01, 1.4], parts: ['body'], colors: { body: '#c8b8a2' } }),
  e({ id: 'plant', name: 'Plant', category: 'decor', shape: 'plant', size: [0.45, 1.2, 0.45], parts: ['pot', 'leaves'], colors: { pot: '#c9b8a4', leaves: '#4f7a4a' } }),
  e({ id: 'floor-lamp', name: 'Floor lamp', category: 'decor', shape: 'lamp', size: [0.35, 1.6, 0.35], parts: ['body', 'shade'], colors: { body: '#2b2b2b', shade: '#f4ead8' } }),
  e({ id: 'box', name: 'Generic object', category: 'storage', shape: 'box', size: [0.5, 0.5, 0.5], parts: ['body'], colors: { body: '#bdbdbd' } }),
];

export const CATALOG_BY_ID: ReadonlyMap<string, CatalogEntry> = new Map(CATALOG.map((c) => [c.id, c]));

export function catalogEntry(id: string): CatalogEntry {
  return CATALOG_BY_ID.get(id) ?? CATALOG_BY_ID.get('box')!;
}
