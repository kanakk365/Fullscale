// Scaling a floor plan picture from lengths a person knows ("this wall is 4.20 m").
//
// One known length gives the scale, with an uncertainty from how precisely the two points
// were clicked. Two or more give a best-fit scale and show whether they agree: if one
// disagrees by more than 2% (or 5 cm), the plan is probably not to scale, or the photo of it
// is skewed, and the scale is refused rather than averaged into something wrong.
import { EditError } from './errors.ts';
import type { KnownLength, Vec2 } from './schema.ts';

/** How precisely a person clicks a point on a plan picture, in pixels. */
export const CLICK_PRECISION_PX = 2;
/** Known lengths must agree with the best-fit scale this closely (relative)… */
export const SCALE_AGREEMENT = 0.02;
/** …or this closely in metres, whichever is looser. */
export const SCALE_AGREEMENT_M = 0.05;

export interface Scale {
  metresPerPixel: number;
  /** relative uncertainty of the scale, e.g. 0.004 = 0.4% */
  uncertainty: number;
  /** root-mean-square disagreement of the known lengths with the scale, in metres */
  residual: number;
}

const pixels = (k: KnownLength) => Math.hypot(k.b[0] - k.a[0], k.b[1] - k.a[1]);

/** The scale of a plan picture from one or more known lengths. */
export function calibrateScale(known: readonly KnownLength[]): Scale {
  if (known.length === 0) throw new EditError('scale_unknown', 'Give at least one known length to scale the plan.');
  for (const [i, k] of known.entries()) {
    if (pixels(k) < 10) throw new EditError('invalid_input', `Known length ${i + 1}: its two points are only ${pixels(k).toFixed(1)} px apart; pick points further apart.`, { index: i });
  }

  // Least squares: the scale s that minimises Σ (s·pixels − metres)².
  const metresPerPixel = known.reduce((sum, k) => sum + pixels(k) * k.metres, 0) / known.reduce((sum, k) => sum + pixels(k) ** 2, 0);
  const errors = known.map((k) => metresPerPixel * pixels(k) - k.metres);
  for (const [i, k] of known.entries()) {
    const off = Math.abs(errors[i]!);
    if (off > Math.max(SCALE_AGREEMENT * k.metres, SCALE_AGREEMENT_M)) {
      throw new EditError(
        'scale_inconsistent',
        `Known length ${i + 1} (${k.metres} m) measures ${(k.metres + errors[i]!).toFixed(3)} m at the scale the others give, ${((off / k.metres) * 100).toFixed(1)}% off. The plan may not be to scale, or the picture is skewed; check that length or photograph the plan straight on.`,
        { index: i, metres: k.metres, measured: k.metres + errors[i]! },
      );
    }
  }
  const residual = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / known.length);

  // Each known length is good to the clicks at both ends and its own ±; together they
  // average down, but never below how much they actually disagree.
  const relative = known.map((k) => Math.hypot((Math.SQRT2 * CLICK_PRECISION_PX) / pixels(k), (k.uncertainty ?? 0) / k.metres));
  const combined = 1 / Math.sqrt(relative.reduce((s, r) => s + 1 / r ** 2, 0));
  const meanLength = known.reduce((s, k) => s + k.metres, 0) / known.length;
  return { metresPerPixel, uncertainty: Math.max(combined, residual / meanLength), residual };
}

/** Where a picture pixel lies on the plan, given where the picture's top-left corner is,
 *  how it is turned (degrees counter-clockwise seen from above) and its scale. Picture
 *  rows go down the screen, which is +z on the plan. */
export function pictureToPlan(px: Vec2, place: { origin: Vec2; rotation: number; metresPerPixel: number }): Vec2 {
  const u = px[0] * place.metresPerPixel;
  const v = px[1] * place.metresPerPixel;
  const a = (place.rotation * Math.PI) / 180;
  // The same turn as items use: local x → (cos a, −sin a), local z → (sin a, cos a).
  return [place.origin[0] + u * Math.cos(a) + v * Math.sin(a), place.origin[1] - u * Math.sin(a) + v * Math.cos(a)];
}
