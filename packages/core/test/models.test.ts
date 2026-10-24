import { describe, expect, it } from 'vitest';
import { addItem, applyOperation, createHome, EditError, ModelFileSchema, shapeMismatch, updateItem, validateHome } from '../src/index.ts';

describe('user models', () => {
  it('only accepts .glb/.gltf paths inside the models folder', () => {
    for (const ok of ['sofa.glb', 'ikea/SÖDERHAMN 3-seat (grey).glb', 'a/b/c.gltf', 'chair_v2.GLB']) {
      expect(ModelFileSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ['../sofa.glb', 'ikea/../../etc/x.glb', '/etc/sofa.glb', 'C:\\x\\sofa.glb', '.hidden.glb', 'sofa.obj', 'https://example.com/a.glb', 'a//b.glb', '']) {
      expect(ModelFileSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('adds a model to an item with safe defaults, and removes it with null', () => {
    let h = createHome({ name: 't', id: 't' });
    h = addItem(h, {
      catalog: 'sofa-3',
      position: [2, 2],
      size: [2.18, 0.83, 0.99],
      source: { kind: 'maker', ref: 'product page' },
      model: { file: 'ikea/sofa.glb' },
    }).home;
    const sofa = h.items[0]!;
    expect(sofa.model).toEqual({ file: 'ikea/sofa.glb', licence: 'local-only', fit: 'uniform', yaw: 0 });
    expect(sofa.source?.kind).toBe('maker');

    h = applyOperation(h, { op: 'updateItem', id: sofa.id, model: null }).home;
    expect(h.items[0]!.model).toBeUndefined();
  });

  it('refuses a bad model path with a clear error', () => {
    const h = addItem(createHome({ name: 't', id: 't' }), { catalog: 'chair', position: [1, 1] }).home;
    expect(() => updateItem(h, { id: 'chair-1', model: { file: '../secret.glb' } })).toThrow(EditError);
    expect(() => updateItem(h, { id: 'chair-1', model: { file: '../secret.glb' } })).toThrow(/model.file/);
  });

  it('warns when the model has a different shape from the entered size', () => {
    let h = createHome({ name: 't', id: 't' });
    // A model 2.0 × 0.8 × 1.0 (any units) used for a 2.0 × 0.8 × 1.0 m sofa: same shape.
    h = addItem(h, { catalog: 'sofa-3', position: [2, 2], size: [2, 0.8, 1], model: { file: 's.glb', nativeSize: [200, 80, 100] } }).home;
    expect(validateHome(h).filter((i) => i.code === 'model_shape_mismatch')).toHaveLength(0);
    // Someone typed the depth wrong: 1.3 m instead of 1.0 m.
    h = updateItem(h, { id: 'sofa-3-1', size: [2, 0.8, 1.3] }).home;
    const warn = validateHome(h).filter((i) => i.code === 'model_shape_mismatch');
    expect(warn).toHaveLength(1);
    expect(warn[0]!.message).toMatch(/30% off/);
    // Stretching is a deliberate choice, so no warning.
    h = updateItem(h, { id: 'sofa-3-1', model: { file: 's.glb', nativeSize: [200, 80, 100], fit: 'stretch' } }).home;
    expect(validateHome(h).filter((i) => i.code === 'model_shape_mismatch')).toHaveLength(0);
  });

  it('asks for a credit on CC-BY models', () => {
    let h = addItem(createHome({ name: 't', id: 't' }), { catalog: 'chair', position: [1, 1], model: { file: 'c.glb', licence: 'cc-by' } }).home;
    expect(validateHome(h).some((i) => i.code === 'model_credit_missing')).toBe(true);
    h = updateItem(h, { id: 'chair-1', model: { file: 'c.glb', licence: 'cc-by', credit: 'Chair by Someone (CC-BY 4.0)' } }).home;
    expect(validateHome(h).some((i) => i.code === 'model_credit_missing')).toBe(false);
  });

  it('measures shape mismatch independent of units', () => {
    expect(shapeMismatch([2, 1, 1], [200, 100, 100])).toBeCloseTo(0, 9);
    expect(shapeMismatch([2, 1, 1], [2, 1, 1.1])).toBeCloseTo(0.1, 9);
  });
});
