// Reading and writing lengths the way people type them: "3.5", "350 cm", "1m80",
// "12' 6 1/2\"", "6 ft 3 in". Everything is stored in metres. Input that could be read two
// ways (like "1,234") is refused rather than guessed.
import { z } from 'zod';
import { EditError } from './errors.ts';

export type LengthUnit = 'm' | 'cm' | 'mm' | 'ft' | 'in';

const TO_METRES: Readonly<Record<LengthUnit, number>> = { m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 };

const METRIC_UNITS: Readonly<Record<string, LengthUnit>> = {
  m: 'm',
  metre: 'm',
  metres: 'm',
  meter: 'm',
  meters: 'm',
  cm: 'cm',
  mm: 'mm',
};

const NUMBER = String.raw`\d+(?:\.\d+)?|\.\d+`;
const METRIC = new RegExp(`^(${NUMBER})\\s*([a-z]+)?$`);
const METRES_AND_CM = /^(\d+)\s*m\s*(\d{2})$/;
const FEET = String.raw`(?:(${NUMBER})\s*(?:'|ft|feet|foot))`;
const INCHES = String.raw`(?:(${NUMBER})?\s*(?:(\d+)\/(\d+))?\s*(?:"|in|inch|inches))`;
const IMPERIAL = new RegExp(`^${FEET}?\\s*-?\\s*${INCHES}?$`);

function bad(text: string, why: string): EditError {
  return new EditError('bad_length', `Can't read "${text}" as a length: ${why}. Try "3.5 m", "350 cm" or "11' 6\\"".`, { input: text });
}

/** Clean up float noise such as 1.8000000000000003. */
const tidy = (v: number) => Number(v.toPrecision(12));

/** Parse a length into metres. A bare number is read in `unit` (metres by default). */
export function parseLength(input: number | string, unit: LengthUnit = 'm'): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw bad(String(input), 'it is not a finite number');
    return tidy(input * TO_METRES[unit]);
  }
  const text = input.trim().toLowerCase().replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  if (text === '') throw bad(input, 'it is empty');
  if (text.includes(',')) throw bad(input, 'commas are ambiguous; use a dot for decimals and no thousands separators');
  if (/[^\x20-\x7e]/.test(text)) throw bad(input, 'it contains characters that are not part of a length');

  const negative = text.startsWith('-');
  const body = negative ? text.slice(1).trim() : text;
  const sign = negative ? -1 : 1;

  const metric = METRIC.exec(body);
  if (metric && (metric[2] === undefined || metric[2] in METRIC_UNITS)) {
    const [, value, word] = metric;
    const u = word === undefined ? unit : METRIC_UNITS[word]!;
    return tidy(sign * Number(value) * TO_METRES[u]);
  }

  const mcm = METRES_AND_CM.exec(body);
  if (mcm) return tidy(sign * (Number(mcm[1]) + Number(mcm[2]) / 100));

  const imperial = IMPERIAL.exec(body);
  if (imperial && body !== '' && /['"]|ft|feet|foot|in/.test(body)) {
    const [, feet, inches, num, den] = imperial;
    if (den !== undefined && Number(den) === 0) throw bad(input, 'a fraction cannot divide by zero');
    const totalInches = Number(feet ?? 0) * 12 + Number(inches ?? 0) + (num !== undefined ? Number(num) / Number(den) : 0);
    return tidy(sign * totalInches * TO_METRES.in);
  }
  throw bad(input, 'the format is not one I recognise');
}

export interface LengthFieldOptions {
  /** unit for bare numbers */
  unit?: LengthUnit;
  min?: number;
  max?: number;
  positive?: boolean;
}

/** A schema field that takes a number or a length text and gives metres. */
export function lengthField(opts: LengthFieldOptions = {}) {
  return z.union([z.number(), z.string()]).transform((value, ctx) => {
    let metres: number;
    try {
      metres = parseLength(value, opts.unit);
    } catch (err) {
      ctx.addIssue({ code: 'custom', message: (err as Error).message });
      return z.NEVER;
    }
    const shown = typeof value === 'string' ? `"${value}"` : `${value}`;
    if (opts.positive && metres <= 0) ctx.addIssue({ code: 'custom', message: `${shown} must be more than zero` });
    if (opts.min !== undefined && metres < opts.min) ctx.addIssue({ code: 'custom', message: `${shown} is below the minimum of ${opts.min} m` });
    if (opts.max !== undefined && metres > opts.max) ctx.addIssue({ code: 'custom', message: `${shown} is above the maximum of ${opts.max} m` });
    return metres;
  });
}

/** Write a length for people: "3.42 m", or "3.42 m ±1 cm" when its uncertainty is known. */
export function formatLength(metres: number, opts: { unit?: 'm' | 'cm' | 'mm' | 'ft-in'; uncertainty?: number } = {}): string {
  const unit = opts.unit ?? 'm';
  let text: string;
  if (unit === 'ft-in') {
    const eighths = Math.round(Math.abs(metres) / TO_METRES.in * 8);
    const feet = Math.floor(eighths / 96);
    const rest = eighths - feet * 96;
    const inches = Math.floor(rest / 8);
    let frac = rest % 8;
    let den = 8;
    while (frac > 0 && frac % 2 === 0) {
      frac /= 2;
      den /= 2;
    }
    const fraction = frac ? ` ${frac}/${den}` : '';
    text = `${metres < 0 ? '-' : ''}${feet}' ${inches}${fraction}"`;
  } else if (unit === 'm') {
    text = `${(Math.round(metres * 100) / 100).toFixed(2)} m`;
  } else if (unit === 'cm') {
    text = `${Math.round(metres * 1000) / 10} cm`;
  } else {
    text = `${Math.round(metres * 1000)} mm`;
  }
  if (opts.uncertainty === undefined) return text;
  const u = opts.uncertainty;
  const plusMinus = u >= 0.01 ? `±${Math.round(u * 100)} cm` : `±${Math.max(1, Math.round(u * 1000))} mm`;
  return `${text} ${plusMinus}`;
}
