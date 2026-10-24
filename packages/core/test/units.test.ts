import { describe, expect, it } from 'vitest';
import { formatLength, lengthField, parseLength } from '../src/index.ts';

describe('reading lengths', () => {
  it.each([
    [3.5, 3.5],
    ['3.5', 3.5],
    ['3.5 m', 3.5],
    ['350cm', 3.5],
    ['3500 mm', 3.5],
    ['1m80', 1.8],
    ['6 ft', 1.8288],
    ['2 ft 3 in', 0.6858],
    ['12\' 6"', 3.81],
    ['12\'-6 1/2"', 3.8227],
    ['84"', 2.1336],
    ['84 inches', 2.1336],
    ['-0.25', -0.25],
  ] as const)('%s → %s m', (input, metres) => {
    expect(parseLength(input)).toBeCloseTo(metres, 9);
  });

  it('reads bare numbers in the field’s unit', () => {
    expect(parseLength(250, 'cm')).toBe(2.5);
    expect(parseLength('250', 'mm')).toBe(0.25);
  });

  it.each(['1,234', '6²', '', 'three metres', '5 furlongs', '1/0"'])('refuses %j', (input) => {
    expect(() => parseLength(input)).toThrow(/Can't read/);
  });

  it('cleans up floating-point noise', () => {
    expect(parseLength('180cm')).toBe(1.8);
  });
});

describe('length fields', () => {
  it('takes text or numbers and checks bounds', () => {
    const field = lengthField({ positive: true, max: 50 });
    expect(field.parse('2.5 m')).toBe(2.5);
    expect(field.safeParse(0).success).toBe(false);
    expect(field.safeParse('60 m').error?.issues[0]?.message).toMatch(/maximum of 50 m/);
  });
});

describe('writing lengths', () => {
  it('shows metres with the uncertainty', () => {
    expect(formatLength(3.4167, { uncertainty: 0.012 })).toBe('3.42 m ±1 cm');
    expect(formatLength(0.9, { unit: 'mm', uncertainty: 0.002 })).toBe('900 mm ±2 mm');
  });

  it('shows feet and inches to the nearest eighth', () => {
    expect(formatLength(3.8227, { unit: 'ft-in' })).toBe(`12' 6 1/2"`);
  });
});
