// Messages between the studio server and its live clients: the editor in a browser and the
// Blender add-on. The server owns the home. Clients send operations; every change, from
// anyone, comes back to every client as a numbered patch, so all of them (and the agents)
// always see the same home. Messages are JSON text frames over one WebSocket.
import { applyPatch, type Achieved, type Home, type Patch } from '@fullscale/core';
import { z } from 'zod';

/** Bumped when a change would break existing clients. */
export const PROTOCOL_VERSION = 1;

/** Path of the WebSocket on the studio server. */
export const SOCKET_PATH = '/live';

const ReqId = z.string().min(1).max(64);
const Ids = z.array(z.string().min(1).max(64)).max(500);
const Point3 = z.array(z.number().finite()).length(3);

/** Things a client can do for others. `render`: draw a 3D picture of the home on request. */
export const CapabilitySchema = z.enum(['render']);

/** A camera for a 3D picture. Either a named view or an eye and a target, in metres. */
export const ViewSchema = z.strictObject({
  preset: z.enum(['top', 'north', 'south', 'east', 'west', 'three-quarter']).optional(),
  eye: Point3.optional(),
  target: Point3.optional(),
  /** frame these elements */
  focus: Ids.optional(),
  /** vertical field of view in degrees */
  fov: z.number().min(10).max(120).optional(),
  ceilings: z.boolean().optional(),
  level: z.string().optional(),
});

// ---------- client → server ----------

export const HelloSchema = z.strictObject({
  type: z.literal('hello'),
  protocol: z.number().int(),
  client: z.enum(['editor', 'blender', 'other']),
  /** the studio's access token */
  token: z.string().min(1).max(200),
  /** who edits through this client, for history and undo: "person", "blender", … */
  actor: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,30}$/)
    .optional(),
  version: z.string().max(40).optional(),
  capabilities: z.array(CapabilitySchema).max(8).optional(),
});

export const OpsSchema = z.strictObject({
  type: z.literal('ops'),
  req: ReqId,
  /** a core operation or batch; the server checks it */
  operation: z.unknown(),
  /** refuse if the home has changed since this revision */
  baseRev: z.number().int().nonnegative().optional(),
  /** shown in the history */
  label: z.string().max(120).optional(),
  /** quick edits with the same key (a drag, arrow-key nudges) become one undo step */
  groupKey: z.string().max(64).optional(),
  /** check the edit and report what it would do, without applying it */
  dryRun: z.boolean().optional(),
});

export const UndoSchema = z.strictObject({ type: z.enum(['undo', 'redo']), req: ReqId });

export const SelectSchema = z.strictObject({ type: z.literal('select'), ids: Ids });

export const SyncSchema = z.strictObject({ type: z.literal('sync'), req: ReqId });

export const RenderReplySchema = z.strictObject({
  type: z.literal('render_reply'),
  req: ReqId,
  ok: z.boolean(),
  /** PNG, base64 */
  png: z
    .string()
    .max(12 * 1024 * 1024)
    .optional(),
  error: z.string().max(500).optional(),
});

/** The real home and its designs: ask for the list, open one, or copy the open one into a new design. */
export const VersionsSchema = z.strictObject({ type: z.literal('versions'), req: ReqId });
export const OpenVersionSchema = z.strictObject({ type: z.literal('open_version'), req: ReqId, id: z.string().min(1).max(64) });
export const NewVersionSchema = z.strictObject({ type: z.literal('new_version'), req: ReqId, name: z.string().min(1).max(80) });

export const ClientMessageSchema = z.discriminatedUnion('type', [HelloSchema, OpsSchema, UndoSchema, SelectSchema, SyncSchema, RenderReplySchema, VersionsSchema, OpenVersionSchema, NewVersionSchema]);

export type Hello = z.infer<typeof HelloSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type View = z.infer<typeof ViewSchema>;

/** Read a client frame. Never throws. */
export function parseClientMessage(text: string): { ok: true; message: ClientMessage } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The message is not JSON.' };
  }
  const result = ClientMessageSchema.safeParse(raw);
  if (result.success) return { ok: true, message: result.data };
  const issue = result.error.issues[0];
  return { ok: false, error: `Bad message at ${issue?.path.join('.') || '(root)'}: ${issue?.message}` };
}

// ---------- server → client ----------

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
}

export interface Welcome {
  type: 'welcome';
  protocol: number;
  server: { name: string; version: string };
  /** the actor this client edits as */
  actor: string;
  rev: number;
  home: Home;
  undo: UndoState;
}

/** A change to the home, by anyone. Revisions go up by one per change. */
export interface Changed {
  type: 'changed';
  rev: number;
  actor: string;
  label: string;
  patch: Patch;
  changed: string[];
  removed: string[];
  notes: string[];
  /** this client's own undo and redo, after the change */
  undo: UndoState;
}

export type Result =
  | { type: 'result'; req: string; ok: true; rev: number; achieved: Achieved; changed: string[]; removed: string[]; notes: string[]; dryRun: boolean }
  | { type: 'result'; req: string; ok: false; error: { code: string; message: string; details?: Record<string, unknown> } };

/** The whole home, after a reload or when a client asks to catch up. */
export interface Snapshot {
  type: 'snapshot';
  rev: number;
  home: Home;
  undo: UndoState;
}

/** Elements another actor (usually an agent) wants the person to look at. */
export interface Highlight {
  type: 'highlight';
  actor: string;
  ids: string[];
  note?: string;
}

/** What a person has selected, so an agent can resolve "this sofa". */
export interface Selection {
  type: 'selection';
  actor: string;
  ids: string[];
}

/** Please draw a 3D picture (sent to clients with the `render` capability). */
export interface RenderRequest {
  type: 'render';
  req: string;
  view: View;
  width: number;
  height: number;
}

/** The real home ("real") and its designs, and which is open; sent to editors when asked and
 *  whenever it changes. `error` says why a request to open or make one was refused. */
export interface VersionList {
  type: 'versions';
  req?: string;
  open: string;
  versions: Array<{ id: string; name: string; from?: string; note?: string; createdAt: string }>;
  error?: string;
}

export interface ProtocolError {
  type: 'error';
  code: 'unauthorized' | 'too_old' | 'bad_message' | 'not_ready';
  message: string;
}

export type ServerMessage = Welcome | Changed | Result | Snapshot | Highlight | Selection | RenderRequest | VersionList | ProtocolError;

// ---------- keeping a copy of the home ----------

/**
 * A client's copy of the home, kept in step with the server. Patches are applied in
 * revision order; a missing revision means the copy is out of date and must be reloaded.
 */
export class HomeMirror {
  home: Home | null = null;
  rev = -1;

  /** Feed a server message. Returns "resync" when the client should ask for a snapshot. */
  receive(message: ServerMessage): 'updated' | 'resync' | 'ignored' {
    switch (message.type) {
      case 'welcome':
      case 'snapshot':
        this.home = message.home;
        this.rev = message.rev;
        return 'updated';
      case 'changed':
        if (!this.home || message.rev <= this.rev) return 'ignored';
        if (message.rev !== this.rev + 1) return 'resync';
        this.home = applyPatch(this.home, message.patch, 'redo');
        this.rev = message.rev;
        return 'updated';
      default:
        return 'ignored';
    }
  }
}
