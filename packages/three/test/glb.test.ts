import { addItem, addRectangularRoom, createHome, sampleFlat } from '@fullscale/core';
import { describe, expect, it } from 'vitest';
import { exportHomeGlb } from '../src/index.ts';

/** The JSON chunk of a GLB. */
function gltfJson(
  glb: Uint8Array,
): Record<string, unknown> & { nodes: Array<{ extras?: { fullscale?: { id: string; kind: string } }; mesh?: number }>; accessors: Array<{ min?: number[]; max?: number[] }> } {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(8, true)).toBe(glb.byteLength);
  const length = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)));
}

describe('GLB export', () => {
  it('writes a valid GLB with every element tagged by its id', () => {
    const home = sampleFlat();
    const json = gltfJson(exportHomeGlb(home));
    const tagged = new Set(json.nodes.map((n) => n.extras?.fullscale?.id).filter(Boolean));
    for (const x of [...home.walls, ...home.rooms, ...home.items, ...home.openings]) expect(tagged.has(x.id), x.id).toBe(true);
  });

  it('keeps true sizes: a 3 × 2 m room’s floor is 3 × 2 m', () => {
    const home = addRectangularRoom(createHome({ name: 't' }), { name: 'R', x: 0, z: 0, width: 3, depth: 2 }).home;
    const json = gltfJson(exportHomeGlb(home));
    const floor = json.nodes.find((n) => n.extras?.fullscale?.kind === 'room')!;
    const mesh = (json.meshes as Array<{ primitives: Array<{ attributes: { POSITION: number } }> }>)[floor.mesh!]!;
    const bounds = json.accessors[mesh.primitives[0]!.attributes.POSITION]!;
    expect(bounds.max![0]! - bounds.min![0]!).toBeCloseTo(3, 6);
    expect(bounds.max![2]! - bounds.min![2]!).toBeCloseTo(2, 6);
  });

  it('never includes the user’s own models', () => {
    const home = addItem(createHome({ name: 't' }), { catalog: 'sofa-3', position: [1, 1], model: { file: 'shop/sofa.glb' } }).home;
    const text = new TextDecoder().decode(exportHomeGlb(home));
    expect(text).not.toContain('shop/sofa.glb');
  });
});

describe('doors in the 3D file', () => {
  it('name their hinge so other programs can swing them', () => {
    const json = gltfJson(exportHomeGlb(sampleFlat())) as unknown as { nodes: Array<{ name?: string; extras?: { fullscale?: { hinge?: { axis: string } } } }> };
    const hinge = json.nodes.find((n) => n.name === 'front-door:hinge');
    expect(hinge?.extras?.fullscale?.hinge?.axis).toBe('y');
  });
});
