// The shared cases in fixtures/tape-checks.json, which the phone apps test against too.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLength, type LengthUnit } from '@fullscale/core';
import { describe, expect, it } from 'vitest';
import { tapeBand } from '../src/index.ts';

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, '../../../fixtures/tape-checks.json'), 'utf8')) as {
  lengths: Array<{ input: string; unit: LengthUnit; metres?: number; refused?: boolean }>;
  bands: { cases: Array<{ scanM: number; tapeM: number; band: string }> };
};

describe('shared tape-check cases', () => {
  it.each(fixture.lengths)('reads "$input" ($unit)', ({ input, unit, metres, refused }) => {
    if (refused) expect(() => parseLength(input, unit)).toThrow();
    else expect(parseLength(input, unit)).toBe(metres);
  });

  it.each(fixture.bands.cases)('grades scan $scanM m against tape $tapeM m as $band', ({ scanM, tapeM, band }) => {
    expect(tapeBand(scanM, tapeM)).toBe(band);
  });
});
