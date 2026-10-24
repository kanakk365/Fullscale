// Building blocks for command inputs. Lengths and coordinates are metres.
import { z } from 'zod';
import { SourceSchema } from '../schema.ts';

export const Length = z.number().finite().positive();
export const Coordinate = z.number().finite();
export const NonNegative = z.number().finite().nonnegative();

/** Per-field sources to merge in; null removes a field's source. */
export const SourcesInput = z.record(z.string(), SourceSchema.nullable());
