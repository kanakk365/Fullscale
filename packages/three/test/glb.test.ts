import { addItem, addRectangularRoom, createHome, paint, sampleFlat, upsertMaterial } from '@fullscale/core';
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

  it('says what each material is made of, so Blender can give it a real surface', () => {
    let home = addRectangularRoom(createHome({ name: 't' }), { name: 'R', x: 0, z: 0, width: 3, depth: 2 }).home;
    home = upsertMaterial(home, { material: { id: 'tiles', name: 'Tiles', kind: 'tile', color: '#e8e5dc', tileSize: 0.6, roughness: 0.2, metalness: 0, opacity: 1 } }).home;
    home = paint(home, { target: { room: home.rooms[0]!.id, surface: 'floor' }, material: 'tiles' }).home;
    home = addItem(home, { catalog: 'bed-double', position: [1.5, 1] }).home;
    const json = gltfJson(exportHomeGlb(home));
    const materials = json.materials as Array<{ name?: string; extras?: { fullscale?: { kind: string; tileSize?: number } } }>;
    expect(materials.find((m) => m.name === 'tiles')?.extras?.fullscale).toEqual({ kind: 'tile', tileSize: 0.6 });
    const kinds = new Set(materials.map((m) => m.extras?.fullscale?.kind));
    // The bed's frame keeps its catalogue colour and is wood; its bedding is fabric.
    expect(kinds.has('wood')).toBe(true);
    expect(kinds.has('fabric')).toBe(true);
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

  it('carries each lamp’s light and its glowing material', () => {
    let home = addRectangularRoom(createHome({ name: 't' }), { name: 'R', x: 0, z: 0, width: 3, depth: 2 }).home;
    home = addItem(home, { catalog: 'ceiling-light', position: [1.5, 2.55, 1], light: { kelvin: 3000, lumens: 1200 } }).home;
    const json = gltfJson(exportHomeGlb(home, { ceilings: true }));
    const nodes = json.nodes as Array<{ extras?: { fullscale?: { light?: Record<string, unknown> } } }>;
    const light = nodes.map((n) => n.extras?.fullscale?.light).find(Boolean);
    expect(light).toMatchObject({ shape: 'disc', facing: [0, -1, 0], on: true, kelvin: 3000, lumens: 1200 });
    const materials = json.materials as Array<{ emissiveFactor?: number[]; extras?: { fullscale?: { glow?: number } } }>;
    const glow = materials.find((m) => m.extras?.fullscale?.glow);
    expect(glow?.extras?.fullscale?.glow).toBe(3000);
    expect(glow?.emissiveFactor?.every((v) => v > 0)).toBe(true);
  });

  it('carries a material’s picture, and texture coordinates the way glTF counts them', () => {
    let home = addRectangularRoom(createHome({ name: 't' }), { name: 'R', x: 0, z: 0, width: 3, depth: 2 }).home;
    const image = { file: 'textures/photo.jpg', width: 0.2, height: 0.25, fit: 'stretch' as const };
    home = upsertMaterial(home, { material: { id: 'photo', name: 'Photo', kind: 'other', color: '#886655', image, roughness: 0.7, metalness: 0, opacity: 1 } }).home;
    home = addItem(home, { catalog: 'picture-frame', position: [1, 1, 0.1], materials: { picture: 'photo' } }).home;
    const json = gltfJson(exportHomeGlb(home));
    const materials = json.materials as Array<{ name?: string; extras?: { fullscale?: { image?: unknown } } }>;
    expect(materials.find((m) => m.name === 'photo')?.extras?.fullscale?.image).toEqual(image);
    // three.js counts v up from the bottom; glTF from the top. A box's first corner is at the
    // top of its face, v = 1 in three.js, so v = 0 in the file.
    const glb = exportHomeGlb(home);
    const photoIndex = materials.findIndex((m) => m.name === 'photo');
    const meshes = json.meshes as Array<{ primitives: Array<{ material: number; attributes: { TEXCOORD_0?: number } }> }>;
    const primitive = meshes.flatMap((m) => m.primitives).find((p) => p.material === photoIndex)!;
    const accessor = (json.accessors as Array<{ bufferView: number }>)[primitive.attributes.TEXCOORD_0!]!;
    const view = (json.bufferViews as Array<{ byteOffset: number }>)[accessor.bufferView]!;
    const jsonLength = new DataView(glb.buffer, glb.byteOffset).getUint32(12, true);
    const bin = 20 + jsonLength + 8;
    const first = new Float32Array(glb.buffer.slice(glb.byteOffset + bin + view.byteOffset, glb.byteOffset + bin + view.byteOffset + 8));
    expect([...first]).toEqual([0, 0]);
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
