// A synthetic sample flat built only with edit commands, so it doubles as a test that the
// commands are enough to design a real home. All sizes are inside dimensions.
import { addItem, addOpening, addRectangularRoom, createHome, paint, upsertMaterial, type EditResult } from './commands/index.ts';
import type { Home } from './schema.ts';

export function sampleFlat(): Home {
  let h = createHome({ name: 'Sample flat (2 rooms + kitchen + bath)', id: 'sample-flat' });
  const run = (f: (home: Home) => EditResult) => {
    h = f(h).home;
  };

  // Rooms: walls are 0.12 m thick; neighbours skip the wall they share.
  run((x) => addRectangularRoom(x, { name: 'Living room', x: 0, z: 0, width: 5, depth: 4 }));
  run((x) => addRectangularRoom(x, { name: 'Kitchen', x: 5.12, z: 0, width: 3, depth: 4, skipWalls: ['west'] }));
  run((x) => addRectangularRoom(x, { name: 'Bedroom', x: 0, z: 4.12, width: 5, depth: 3.2, skipWalls: ['north'] }));
  run((x) => addRectangularRoom(x, { name: 'Bathroom', x: 5.12, z: 4.12, width: 3, depth: 3.2, skipWalls: ['north', 'west'] }));
  // wall-1..4 living (N,E,S,W), wall-5..7 kitchen (N,E,S), wall-8..10 bedroom (E,S,W), wall-11..12 bathroom (E,S)

  // Doors and windows
  run((x) => addOpening(x, { id: 'front-door', wall: 'wall-4', type: 'door', offset: 2.6, width: 0.9 }));
  run((x) => addOpening(x, { id: 'kitchen-arch', wall: 'wall-2', type: 'opening', offset: 1.2, width: 1.2, height: 2.1 }));
  run((x) => addOpening(x, { id: 'bedroom-door', wall: 'wall-3', type: 'door', offset: 3.8, width: 0.9 }));
  run((x) => addOpening(x, { id: 'bathroom-door', wall: 'wall-8', type: 'door', offset: 2.2, width: 0.8 }));
  run((x) => addOpening(x, { id: 'living-window', wall: 'wall-1', type: 'window', offset: 1.6, width: 1.8, height: 1.3, sill: 0.9 }));
  run((x) => addOpening(x, { id: 'kitchen-window', wall: 'wall-5', type: 'window', offset: 0.9, width: 1.2, height: 1.2, sill: 1.0 }));
  run((x) => addOpening(x, { id: 'bedroom-window', wall: 'wall-9', type: 'window', offset: 0.8, width: 1.4, height: 1.3, sill: 0.9 }));
  run((x) => addOpening(x, { id: 'bathroom-window', wall: 'wall-12', type: 'window', offset: 1.2, width: 0.6, height: 0.6, sill: 1.4 }));

  // Surfaces
  run((x) => upsertMaterial(x, { material: { id: 'tile-light', name: 'Light grey tile', kind: 'tile', color: '#dfe3e4', texture: 'tile', tileSize: 0.6, roughness: 0.35 } }));
  run((x) => paint(x, { target: { room: 'room-2', surface: 'floor' }, material: 'tile-light' }));
  run((x) => paint(x, { target: { room: 'room-4', surface: 'floor' }, material: 'tile-light' }));
  run((x) => paint(x, { target: { room: 'room-4', surface: 'walls' }, material: 'tile-light' }));
  run((x) => paint(x, { target: { room: 'room-3', surface: 'walls' }, color: '#a9b8a0', name: 'Sage green' }));

  // Living room
  run((x) => addItem(x, { catalog: 'sofa-3', position: [2.5, 0.48] }));
  run((x) => addItem(x, { catalog: 'rug', position: [2.5, 1.5] }));
  run((x) => addItem(x, { catalog: 'coffee-table', position: [2.5, 1.6] }));
  run((x) => addItem(x, { catalog: 'tv-unit', position: [2.5, 3.77], rotation: 180 }));
  run((x) => addItem(x, { catalog: 'armchair', position: [0.9, 2.0], rotation: 90 }));
  run((x) => addItem(x, { catalog: 'floor-lamp', position: [4.6, 0.4] }));
  run((x) => addItem(x, { catalog: 'plant', position: [0.4, 3.6] }));

  // Kitchen: units along the east wall, facing west
  for (const [catalog, z] of [
    ['kitchen-base', 0.32],
    ['kitchen-base', 0.92],
    ['cooker', 1.52],
    ['kitchen-base', 2.12],
    ['fridge', 2.74],
  ] as const) {
    run((x) => addItem(x, { catalog, position: [7.8, z], rotation: 270 }));
  }
  run((x) => addItem(x, { catalog: 'dining-table-4', position: [6.2, 2.4], rotation: 90 }));
  for (const [cx, cz, rot] of [
    [5.5, 2.1, 90],
    [5.5, 2.7, 90],
    [6.9, 2.1, 270],
    [6.9, 2.7, 270],
  ] as const) {
    run((x) => addItem(x, { catalog: 'chair', position: [cx, cz], rotation: rot }));
  }

  // Bedroom
  run((x) => addItem(x, { catalog: 'bed-double', position: [1.07, 5.72], rotation: 90 }));
  run((x) => addItem(x, { catalog: 'nightstand', position: [0.22, 4.67], rotation: 90 }));
  run((x) => addItem(x, { catalog: 'nightstand', position: [0.22, 6.77], rotation: 90 }));
  run((x) => addItem(x, { catalog: 'wardrobe', position: [3.5, 4.44] }));
  run((x) => addItem(x, { catalog: 'desk', position: [3.6, 6.95], rotation: 180 }));
  run((x) => addItem(x, { catalog: 'office-chair', position: [3.6, 6.2] }));

  // Bathroom
  run((x) => addItem(x, { catalog: 'bathtub', position: [7.22, 6.92], rotation: 180 }));
  run((x) => addItem(x, { catalog: 'toilet', position: [7.76, 5.0], rotation: 270 }));
  run((x) => addItem(x, { catalog: 'basin', position: [6.2, 4.365] }));

  return h;
}
