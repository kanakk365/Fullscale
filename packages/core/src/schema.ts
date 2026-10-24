// The home document: the single source of truth for a home.
//
// Conventions
// - Units are metres. 3D axes match Three.js and ARKit: +Y is up.
// - Plan points are [x, z] on the floor of their level. Seen from above, +x is right
//   (east) and +z is down the screen (south).
// - Rotations are degrees about +Y; positive is counter-clockwise seen from above.
// - Every element can carry a `source` saying where its numbers came from and how
//   uncertain they are, and `sources` can say the same for single fields (a scanned wall's
//   position is measured, its thickness guessed). Edits update these automatically, so
//   accuracy information survives editing.
// - A missing optional value means "follow the parent" (a wall without a height is as tall
//   as its level). Read such values through resolve.ts.
import { z } from 'zod';

export const FORMAT = 'fullscale/1' as const;

export const IdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'ids use letters, digits, _ . : -');

const finite = () => z.number().finite();
const positive = () => z.number().finite().positive();

export const Vec2Schema = z.tuple([finite(), finite()]);
export const Vec3Schema = z.tuple([finite(), finite(), finite()]);
export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colour must look like #a1b2c3');

export const SourceSchema = z.object({
  /** user = typed or drawn by a person; scan = phone capture; plan = floor plan import;
   *  catalog = catalogue default; maker = the product's listed size (e.g. a shop page);
   *  estimate = guessed; agent = chosen by an AI agent */
  kind: z.enum(['user', 'scan', 'plan', 'catalog', 'maker', 'estimate', 'agent']),
  /** ± metres for lengths and positions, when known */
  uncertainty: z.number().finite().nonnegative().optional(),
  /** pointer to the evidence, e.g. "roomplan:6F2A…" or "photo:0012" */
  ref: z.string().max(200).optional(),
  note: z.string().max(500).optional(),
});

/** Sources for single fields, keyed by field name, e.g. `{ thickness: { kind: 'estimate' } }`. */
export const FieldSourcesSchema = z.record(z.string(), SourceSchema);

export const MaterialSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(80),
  kind: z.enum(['paint', 'wood', 'tile', 'stone', 'fabric', 'carpet', 'metal', 'glass', 'plastic', 'other']),
  color: HexColorSchema,
  /** id of a texture set in the asset library (optional) */
  texture: z.string().max(80).optional(),
  /** real-world size in metres of one texture tile */
  tileSize: positive().optional(),
  roughness: z.number().min(0).max(1).default(0.85),
  metalness: z.number().min(0).max(1).default(0),
  opacity: z.number().min(0).max(1).default(1),
  source: SourceSchema.optional(),
});

export const LevelSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(80),
  /** height of this level's floor above the ground floor */
  elevation: finite(),
  /** floor-to-ceiling height; walls and rooms without their own height follow it */
  height: positive(),
  source: SourceSchema.optional(),
  sources: FieldSourcesSchema.optional(),
});

export const WallSchema = z.object({
  id: IdSchema,
  level: IdSchema,
  start: Vec2Schema,
  end: Vec2Schema,
  thickness: positive(),
  /** absent: as tall as its level */
  height: positive().optional(),
  /** which line start/end describe. Scans measure the room-side face, so scanned walls
   *  use "left" or "right" and stay exact even if the thickness is a guess. */
  line: z.enum(['center', 'left', 'right']).default('center'),
  /** material ids for each face; left/right are as seen walking from start to end */
  materials: z
    .object({ left: IdSchema.optional(), right: IdSchema.optional() })
    .default({}),
  source: SourceSchema.optional(),
  sources: FieldSourcesSchema.optional(),
});

export const OpeningSchema = z.object({
  id: IdSchema,
  wall: IdSchema,
  type: z.enum(['door', 'window', 'opening']),
  /** distance along the wall from its start point to the opening's near edge */
  offset: finite(),
  /** clear width */
  width: positive(),
  /** clear height */
  height: positive(),
  /** bottom of the opening above the floor (0 for doors) */
  sill: z.number().finite().nonnegative(),
  /** doors: which jamb the hinge is on, and which side of the wall the leaf opens into */
  hinge: z.enum(['start', 'end']).optional(),
  swing: z.enum(['left', 'right']).optional(),
  style: z.string().max(40).optional(),
  source: SourceSchema.optional(),
  sources: FieldSourcesSchema.optional(),
});

export const RoomSchema = z.object({
  id: IdSchema,
  level: IdSchema,
  name: z.string().min(1).max(80),
  /** floor outline at the finished wall faces, in order (either winding) */
  polygon: z.array(Vec2Schema).min(3),
  floorMaterial: IdSchema.optional(),
  ceilingMaterial: IdSchema.optional(),
  /** absent: the level's height */
  ceilingHeight: positive().optional(),
  source: SourceSchema.optional(),
  sources: FieldSourcesSchema.optional(),
});

// A path inside the local models folder: "/"-separated parts that never start with "."
// (so no "..", no hidden files, no absolute paths), ending in .glb or .gltf.
const modelPart = String.raw`[\p{L}\p{N}_ ()+,-][\p{L}\p{N}_ ()+,.-]*`;
export const ModelFileSchema = z
  .string()
  .max(200)
  .regex(new RegExp(`^${modelPart}(?:/${modelPart})*\\.(?:glb|gltf)$`, 'iu'), 'model files are .glb or .gltf paths inside the models folder');

/** A 3D model file the user supplied. The files live in the local models folder
 *  (data/models/ by default), which git ignores; the home only stores the path. */
export const ModelRefSchema = z.object({
  /** path inside the models folder, e.g. "ikea/sofa.glb" */
  file: ModelFileSchema,
  /** local-only: the user's own download (e.g. from a shop's website); it is never
   *  committed, bundled or exported. cc0 / cc-by: free to share (cc-by needs `credit`). */
  licence: z.enum(['local-only', 'cc0', 'cc-by']).default('local-only'),
  credit: z.string().max(200).optional(),
  /** the model's own bounding box [w, h, d] in its file units after `yaw`, recorded on import */
  nativeSize: z.tuple([positive(), positive(), positive()]).optional(),
  /** uniform: keep the model's proportions and fit inside the item's size; stretch: match each axis */
  fit: z.enum(['uniform', 'stretch']).default('uniform'),
  /** degrees about +Y that turn the model so its front faces local +z */
  yaw: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
});

export const ItemSchema = z.object({
  id: IdSchema,
  level: IdSchema,
  /** catalogue entry id, e.g. "sofa-3"; also the stand-in shape when no model is loaded */
  catalog: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  /** [x, y, z]: centre of the footprint; y is the bottom of the item above the floor */
  position: Vec3Schema,
  /** degrees about +Y, counter-clockwise seen from above */
  rotation: finite().default(0),
  /** true outer size [width (x), height (y), depth (z)] before rotation */
  size: z.tuple([positive(), positive(), positive()]),
  /** material per named part, e.g. { body: "fabric-sage", legs: "oak" } */
  materials: z.record(z.string(), IdSchema).default({}),
  /** the user's own 3D model, drawn at `size` instead of the catalogue shape */
  model: ModelRefSchema.optional(),
  locked: z.boolean().default(false),
  source: SourceSchema.optional(),
  sources: FieldSourcesSchema.optional(),
});

export const CaptureRefSchema = z.object({
  id: IdSchema,
  kind: z.enum(['phone-capture', 'floor-plan-image', 'other']),
  /** path relative to the home file, never committed for real homes */
  path: z.string().max(300),
  importedAt: z.string(),
  note: z.string().max(500).optional(),
});

/** An element that failed to load. It is kept as it was, reported, and saved back
 *  unchanged, so a bad file never silently loses data. */
export const QuarantinedSchema = z.object({
  collection: z.string(),
  element: z.unknown(),
  problem: z.string(),
});

export const HomeSchema = z.object({
  format: z.literal(FORMAT),
  id: IdSchema,
  name: z.string().min(1).max(120),
  units: z.literal('m').default('m'),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** degrees from +z (plan "down") to true north, if known */
  north: finite().optional(),
  levels: z.array(LevelSchema).min(1),
  walls: z.array(WallSchema).default([]),
  openings: z.array(OpeningSchema).default([]),
  rooms: z.array(RoomSchema).default([]),
  items: z.array(ItemSchema).default([]),
  materials: z.array(MaterialSchema).default([]),
  captures: z.array(CaptureRefSchema).default([]),
  /** the next number for each id prefix; only ever goes up (see ids.ts) */
  nextIds: z.record(z.string(), z.number().int().positive()).default({}),
  quarantine: z.array(QuarantinedSchema).default([]),
});

export type Vec2 = z.infer<typeof Vec2Schema>;
export type Vec3 = z.infer<typeof Vec3Schema>;
export type Source = z.infer<typeof SourceSchema>;
export type SourceKind = Source['kind'];
export type Material = z.infer<typeof MaterialSchema>;
export type Level = z.infer<typeof LevelSchema>;
export type Wall = z.infer<typeof WallSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type ModelRef = z.infer<typeof ModelRefSchema>;
export type ModelRefInput = z.input<typeof ModelRefSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type CaptureRef = z.infer<typeof CaptureRefSchema>;
export type Home = z.infer<typeof HomeSchema>;

/** Parse a current-format home and fill defaults. Throws a readable error if it is
 *  invalid. To open a file that may be older or damaged, use `loadHome` (migrate.ts). */
export function parseHome(input: unknown): Home {
  const result = HomeSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues
      .slice(0, 20)
      .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Not a valid home document:\n${lines.join('\n')}`);
  }
  return result.data;
}
