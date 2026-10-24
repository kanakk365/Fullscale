// Floor plan pictures laid under a level (add one, scale it from known lengths, move or turn
// it into place), and phone captures a home was made from. Walls traced over a scaled
// picture can say how sure they are; a capture records how its world lines up with the plan.
import { z } from 'zod';
import { calibrateScale } from '../calibration.ts';
import { EditError } from '../errors.ts';
import { takeId } from '../ids.ts';
import { CapturePathSchema, CaptureRefSchema, IdSchema, KnownLengthSchema, Vec2Schema, type CaptureRef } from '../schema.ts';
import { formatUncertainty } from '../units.ts';
import { defineCommand, levelFor } from './edit.ts';

const Pixels = z.number().finite().positive();

export const addPlanPicture = defineCommand(
  z.strictObject({
    id: IdSchema.optional(),
    /** the picture file, relative to the home file */
    path: CapturePathSchema,
    level: IdSchema.optional(),
    /** the picture's size in pixels */
    pixels: z.tuple([Pixels, Pixels]),
    page: z.number().int().positive().optional(),
    note: z.string().max(500).optional(),
  }),
  (d, input) => {
    const picture: CaptureRef = {
      id: takeId(d.home, input.id, 'plan-picture'),
      kind: 'floor-plan-image',
      path: input.path,
      importedAt: new Date().toISOString(),
      plan: { level: levelFor(d.home, input.level), pixels: input.pixels, origin: [0, 0], rotation: 0, opacity: 0.5, locked: false },
    };
    if (input.page !== undefined) picture.plan!.page = input.page;
    if (input.note) picture.note = input.note;
    d.home.captures.push(picture);
    d.notes.push(`Added plan picture "${picture.id}". Scale it from one or more lengths you know before tracing over it.`);
  },
);

function findPicture(d: { home: { captures: CaptureRef[] } }, id: string): CaptureRef & { plan: NonNullable<CaptureRef['plan']> } {
  const picture = d.home.captures.find((c) => c.id === id);
  if (!picture?.plan) throw new EditError('not_found', `No plan picture with id "${id}".`, { id, kind: 'plan picture' });
  return picture as CaptureRef & { plan: NonNullable<CaptureRef['plan']> };
}

export const scalePlanPicture = defineCommand(
  z.strictObject({
    id: IdSchema,
    /** lengths you know on the picture: two pixel points and the real distance between them */
    known: z.array(KnownLengthSchema).min(1).max(20),
  }),
  (d, input) => {
    const picture = findPicture(d, input.id);
    const scale = calibrateScale(input.known);
    picture.plan.metresPerPixel = scale.metresPerPixel;
    picture.plan.scale = { known: input.known, uncertainty: scale.uncertainty, residual: scale.residual };
    const percent = (scale.uncertainty * 100).toFixed(2);
    const tenMetres = formatUncertainty(10 * scale.uncertainty);
    d.notes.push(`Scale: 1 px = ${(scale.metresPerPixel * 100).toFixed(3)} cm, good to ±${percent}% (${tenMetres} over 10 m).`);
  },
);

export const placePlanPicture = defineCommand(
  z.strictObject({
    id: IdSchema,
    /** where the picture's top-left corner lies on the plan */
    origin: Vec2Schema.optional(),
    /** degrees counter-clockwise seen from above */
    rotation: z.number().finite().optional(),
    opacity: z.number().min(0).max(1).optional(),
    locked: z.boolean().optional(),
  }),
  (d, { id, ...patch }) => {
    const picture = findPicture(d, id);
    if (picture.plan.locked && patch.locked !== false && (patch.origin || patch.rotation !== undefined)) {
      throw new EditError('locked_element', `Plan picture "${id}" is locked. Unlock it to move it.`, { id });
    }
    Object.assign(picture.plan, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
  },
);

export const addCapture = defineCommand(CaptureRefSchema.omit({ id: true, plan: true, importedAt: true }).extend({ id: IdSchema.optional() }).strict(), (d, input) => {
  const capture: CaptureRef = { ...input, id: takeId(d.home, input.id, 'capture'), importedAt: new Date().toISOString() };
  if (capture.toHome) levelFor(d.home, capture.toHome.level);
  d.home.captures.push(capture);
});
