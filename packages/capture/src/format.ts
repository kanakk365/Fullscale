// The `fullscale-capture/1` format (docs/capture-format.md): the manifest and the records a
// capture app writes. Readers ignore fields they don't know, so later revisions of the
// format still open.
import { z } from 'zod';

export const CAPTURE_FORMAT = 'fullscale-capture/1' as const;

const finite = () => z.number().finite();
const Matrix = z.array(finite()).length(16);
const Intrinsics = z.object({ fx: finite(), fy: finite(), cx: finite(), cy: finite() });
const RelativePath = z
  .string()
  .max(300)
  .refine((p) => !p.startsWith('/') && !p.split('/').some((part) => part === '..' || part === ''), 'paths are relative and never contain ".."');

export const CaptureRoomSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(80).default('Room'),
  /** the room's folder, relative to the capture */
  dir: RelativePath,
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
});

export const ManifestSchema = z.object({
  format: z.literal(CAPTURE_FORMAT),
  revision: z.number().int().nonnegative().default(1),
  id: z.string().min(1).max(64),
  status: z.enum(['recording', 'complete', 'interrupted']),
  createdAt: z.string(),
  endedAt: z.string().optional(),
  clock: z.object({ uptimeAtStart: finite(), utcAtStart: z.string(), uptimeAtEnd: finite().optional(), utcAtEnd: z.string().optional() }).optional(),
  app: z.object({ name: z.string(), version: z.string(), build: z.string().optional() }).optional(),
  device: z.object({ model: z.string(), os: z.string(), osVersion: z.string(), lidar: z.boolean() }).optional(),
  /** 1 LiDAR + scanner, 2 camera only, 3 Android ARCore, 4 photos only */
  tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  rooms: z.array(CaptureRoomSchema).default([]),
  alignment: z.object({ method: z.enum(['first', 'relocalized', 'unaligned']), residualM: finite().optional() }).optional(),
});

export const TapeCheckSchema = z.object({
  id: z.string().min(1).max(64),
  room: z.string().optional(),
  kind: z.enum(['wall_length', 'door_width', 'door_height', 'window_width', 'ceiling_height', 'diagonal', 'other']),
  /** the scanner identifier of the element measured */
  element: z.string().optional(),
  a: z.array(finite()).length(3).optional(),
  b: z.array(finite()).length(3).optional(),
  /** what the scan said, in metres */
  appM: finite().optional(),
  /** what the tape said, in metres */
  tapeM: finite().positive(),
  /** the text the person typed */
  entered: z.string().max(40).optional(),
  heldOut: z.boolean().default(false),
  obstructed: z.boolean().default(false),
  note: z.string().max(300).optional(),
});

export const PhotoRecordSchema = z.object({
  id: z.string(),
  file: RelativePath,
  room: z.string().optional(),
  kind: z.enum(['auto', 'manual', 'still', 'card', 'tape']),
  t: finite(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  pose: Matrix,
  intrinsics: Intrinsics,
  tracking: z.string().optional(),
  blurPx: finite().optional(),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type TapeCheck = z.infer<typeof TapeCheckSchema>;
export type PhotoRecord = z.infer<typeof PhotoRecordSchema>;

/** Read JSON Lines, keeping the good lines and reporting the rest (a capture cut short by a
 *  crash can end with half a line). */
export function readJsonLines<S extends z.ZodType>(text: string, schema: S): { records: Array<z.output<S>>; problems: string[] } {
  const records: Array<z.output<S>> = [];
  const problems: string[] = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      problems.push(`line ${i + 1} is not complete JSON`);
      return;
    }
    const r = schema.safeParse(raw);
    if (r.success) records.push(r.data);
    else problems.push(`line ${i + 1}: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`);
  });
  return { records, problems };
}
