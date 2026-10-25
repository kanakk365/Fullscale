import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '../src/index.ts';

describe('the capture manifest', () => {
  it('reads revision 2: the space, the library room, and the scan a room adds to', () => {
    const manifest = ManifestSchema.parse({
      format: 'fullscale-capture/1',
      revision: 2,
      id: '20261026T090000Z-ABCD',
      status: 'complete',
      createdAt: '2026-10-26T09:00:00Z',
      space: { id: 'S1', name: 'Home' },
      rooms: [{ id: 'r1', name: 'Bedroom', dir: 'rooms/r1', spaceRoom: { id: 'R1', name: 'Bedroom' }, addsTo: { capture: '20261025T180343Z-JAPJ', room: 'r1' } }],
      alignment: { method: 'relocalized' },
      somethingNewer: true,
    });
    expect(manifest.space?.name).toBe('Home');
    expect(manifest.rooms[0]?.addsTo).toEqual({ capture: '20261025T180343Z-JAPJ', room: 'r1' });
    expect(manifest.alignment?.method).toBe('relocalized');
  });

  it('still reads revision 1, which has none of them', () => {
    const manifest = ManifestSchema.parse({ format: 'fullscale-capture/1', id: 'x', status: 'complete', createdAt: '2026-10-24T10:12:00Z', rooms: [{ id: 'r1', dir: 'rooms/r1' }] });
    expect(manifest.revision).toBe(1);
    expect(manifest.space).toBeUndefined();
  });
});
