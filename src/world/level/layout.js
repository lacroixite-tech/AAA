import * as THREE from 'three';
import { box, cyl, mat, rng, jitter, proxyBox } from './geom.js';
import { buildBlock, Facade } from './building.js';
import { buildGround, patch, grass, crater } from './ground.js';
import { buildBackdrop } from './backdrop.js';
import { warehouse, garages, ruinCorner } from './structures.js';
import * as P from './props.js';

const PI = Math.PI, HP = Math.PI / 2;

/**
 * Map layout (north = -Z):
 *   Main street N-S (x∈[-6,6]) + cross street E-W (z∈[-6,6]), 4 m sidewalks.
 *   NW: block A (arch passage to the back alley) | alley x∈[-28,-22] | W1/W2 + garages.
 *   NE: plaza with monument, bounded by blocks C and D.
 *   SW: fenced industrial yard with warehouse (mezzanine) and containers.
 *   SE: block B with collapsed corner (slab ramp to 1st floor), courtyard behind, block E1.
 * Lanes (south→north): west = yard/warehouse → alley, centre = main street, east = courtyard → plaza.
 */
export function buildLayout(ctx) {
  const B = ctx.batch; const r = rng(2024);
  ctx.heightAt = (x, z) => {
    const ax = Math.abs(x), az = Math.abs(z);
    if ((ax > 6.2 && ax < 10) || (az > 6.2 && az < 10)) return 0.15;
    if (x > 10 && x < 46 && z > -46 && z < -10) return 0.15;
    return 0.03;
  };
  buildGround(ctx);

  // ------------------------------------------------------------------ buildings (playable edge)
  const ochre = 0xe0c090, cream = 0xe8dcc4, grey = 0xc0c0bc, pink = 0xd8b0a0, green = 0xb8c4b0;
  // Block A (west of main street), arch passage z∈[-30,-26]
  buildBlock(ctx, {
    rect: [-22, -10, -64, -10], floors: 4, gh: 3.8, fh: 3.1, style: 'old', wall: 'plaster', wallTint: ochre, trimTint: 0xf0e6d4,
    sides: { px: 'front', nx: 'back', pz: 'front' }, roof: 'gable', seed: 11, balconies: true, balcEvery: 4, damage: 0.4,
    shops: { px: [0, 1, 2, 8, 9, 13], pz: [0, 2] }, entrances: { nx: [2, 9, 13], pz: [1] }, openGround: { px: [16, 20], nx: [34, 38] }, noFootprint: true, acRate: 0.15,
  });
  ctx.addFootprint(-22, -10, -64, -30.2, 13); ctx.addFootprint(-22, -10, -25.8, -10, 13);
  // arch tunnel walls + soffit
  for (const z of [-30.2, -25.8]) B.add(box(11.2, 3.6, 0.4), 'plaster', mat(-16, 1.8, z), { tint: 0xb8a888 });
  B.add(box(12, 0.3, 4.8), 'concrete', mat(-16, 3.65, -28), { surface: 'concrete' });
  B.add(box(11.2, 3.2, 0.01), 'decal_streak', mat(-16, 1.8, -29.99), { collider: false, uv: 'keep' });
  B.add(box(11.2, 3.2, 0.01), 'decal_streak', mat(-16, 1.8, -26.01), { collider: false, uv: 'keep' });
  B.add(cyl(0.02, 0.02, 0.6, 4), 'metal_bare', mat(-16, 3.2, -28), { collider: false });
  B.add(box(0.3, 0.12, 0.3), 'lamp_glass', mat(-16, 2.9, -28), { collider: false });
  graffiti(ctx, -16, 1.6, -29.99, 0, 4, 2, 0); graffiti(ctx, -14, 1.5, -26.01, PI, 3, 1.5, 3);

  // W1 + W2 + garages (west of the alley)
  buildBlock(ctx, { rect: [-46, -28, -66, -34], floors: 3, gh: 3.4, fh: 3.0, style: 'soviet', wall: 'brick', trim: 'concrete', trimTint: 0xc8c4bc, sides: { px: 'back' }, roof: 'flat', seed: 12, damage: 0.5, entrances: { px: [2, 6] }, denseBack: true, frame: 'wood', frameTint: 0x8a8070 });
  buildBlock(ctx, { rect: [-64, -40, -34, -10.5], floors: 3, gh: 3.6, fh: 3.0, style: 'soviet', wall: 'plaster', wallTint: grey, sides: { pz: 'front', px: 'blank' }, roof: 'gable', seed: 13, damage: 0.45, balconies: true, shops: { pz: [2, 3] }, entrances: { pz: [5] } });
  garages(ctx, -28.2, -22.6, HP, 7, { seed: 5 });
  P.panelFence(ctx, [-40, -10.6], [-34.2, -10.6], { seed: 6 });
  // alley north wall with gate
  P.panelFence(ctx, [-28, -64], [-22, -64], { seed: 7 });

  // Block B (east of main street) with collapsed NW corner
  buildBlock(ctx, {
    rect: [10, 24, 18, 66], floors: 4, gh: 3.6, fh: 3.0, style: 'old', wall: 'brick', trim: 'plaster', trimTint: 0xd8ccb8,
    sides: { nx: 'front', px: 'back', nz: 'blank' }, roof: 'gable', seed: 21, balconies: true, balcEvery: 3, balcOff: 1, damage: 0.5,
    shops: { nx: [0, 1, 3, 4, 7, 8, 11, 12] }, entrances: { px: [2, 7, 12] }, frame: 'wood', frameTint: 0xd0c8b8,
  });
  ruinCorner(ctx);
  // E1 (tall soviet block) behind the courtyard
  buildBlock(ctx, { rect: [46, 62, 10.5, 66], floors: 5, gh: 3.2, fh: 2.8, style: 'soviet', wall: 'plaster', wallTint: green, trim: 'concrete', sides: { nx: 'back', nz: 'front' }, roof: 'flat', seed: 31, balconies: true, balcEvery: 2, entrances: { nx: [3, 9, 14] }, denseBack: true, damage: 0.35, acRate: 0.2, frame: 'plastic', frameTint: 0xe8e8e0 });
  // C and D around the plaza
  buildBlock(ctx, { rect: [46, 62, -46, -10.5], floors: 4, gh: 3.8, fh: 3.1, style: 'old', wall: 'plaster', wallTint: pink, trimTint: 0xf0e8dc, sides: { nx: 'front', pz: 'front' }, roof: 'gable', seed: 41, balconies: true, balcEvery: 3, shops: { nx: [1, 2, 6, 7], pz: [1] }, damage: 0.45 });
  buildBlock(ctx, { rect: [10, 62, -66, -46], floors: 4, gh: 3.8, fh: 3.1, style: 'old', wall: 'plaster', wallTint: cream, trimTint: 0xf4ece0, sides: { pz: 'front', nx: 'front' }, roof: 'gable', seed: 51, balconies: true, balcEvery: 3, shops: { pz: [1, 2, 4, 5, 9, 10, 13], nx: [1, 3] }, entrances: { pz: [7] }, damage: 0.35 });

  // ------------------------------------------------------------------ out-of-bounds street continuations (lower detail)
  const lod = { lod: true, balconies: true, damage: 0.5, roof: 'flat' };
  buildBlock(ctx, { ...lod, rect: [-26, -10, -120, -68], floors: 5, gh: 3.2, fh: 2.8, style: 'soviet', wallTint: 0xd0ccc4, sides: { px: 'front', pz: 'front' }, seed: 61 });
  buildBlock(ctx, { ...lod, rect: [10, 28, -120, -68], floors: 4, gh: 3.4, fh: 3.0, style: 'old', wallTint: 0xd8c0a0, sides: { nx: 'front', pz: 'front' }, roof: 'gable', seed: 62 });
  buildBlock(ctx, { ...lod, rect: [-26, -10, 70, 122], floors: 4, gh: 3.4, fh: 3.0, style: 'old', wall: 'brick', sides: { px: 'front', nz: 'front' }, roof: 'gable', seed: 63 });
  buildBlock(ctx, { ...lod, rect: [10, 28, 70, 122], floors: 5, gh: 3.2, fh: 2.8, style: 'soviet', wallTint: 0xc8d0c8, sides: { nx: 'front', nz: 'front' }, seed: 64 });
  buildBlock(ctx, { ...lod, rect: [66, 110, -40, -10], floors: 4, gh: 3.4, fh: 3.0, style: 'old', wallTint: 0xe0d0b0, sides: { pz: 'front', nx: 'front' }, roof: 'gable', seed: 65 });
  buildBlock(ctx, { ...lod, rect: [66, 110, 10, 40], floors: 5, gh: 3.2, fh: 2.8, style: 'soviet', wallTint: 0xc0c4c8, sides: { nz: 'front', nx: 'front' }, seed: 66 });
  buildBlock(ctx, { ...lod, rect: [-110, -68, -40, -10], floors: 3, gh: 3.4, fh: 3.0, style: 'soviet', wall: 'brick', sides: { pz: 'front', px: 'front' }, seed: 67 });
  buildBlock(ctx, { ...lod, rect: [-110, -68, 10, 40], floors: 4, gh: 3.4, fh: 3.0, style: 'old', wallTint: 0xd8c8b0, sides: { nz: 'front', px: 'front' }, roof: 'gable', seed: 68 });
  // deeper street vistas so the view down each street terminates in city, not void
  const far = { ...lod, damage: 0.3, balconies: false };
  let sd = 90;
  for (const [z0, z1, sx] of [[-175, -124, -1], [-175, -124, 1], [124, 175, -1], [124, 175, 1]]) buildBlock(ctx, { ...far, rect: sx < 0 ? [-26, -10, z0, z1] : [10, 26, z0, z1], floors: 4 + (sd % 3), gh: 3.3, fh: 2.9, style: sd % 2 ? 'old' : 'soviet', wallTint: [0xd8ccb8, 0xc8c4bc, 0xe0c8a8][sd % 3], sides: sx < 0 ? { px: 'front' } : { nx: 'front' }, seed: sd++ });
  for (const [x0, x1, zs] of [[-175, -114, -1], [-175, -114, 1], [114, 175, -1], [114, 175, 1]]) buildBlock(ctx, { ...far, rect: zs < 0 ? [x0, x1, -26, -10] : [x0, x1, 10, 26], floors: 4 + (sd % 2), gh: 3.3, fh: 2.9, style: 'soviet', wallTint: [0xd0ccc4, 0xd8c8b0][sd % 2], sides: zs < 0 ? { pz: 'front' } : { nz: 'front' }, seed: sd++ });
  // street-terminating blocks
  buildBlock(ctx, { ...far, rect: [-30, 30, -205, -185], floors: 6, gh: 3.4, fh: 2.9, style: 'soviet', wallTint: 0xc8c0b4, sides: { pz: 'front' }, seed: sd++ });
  buildBlock(ctx, { ...far, rect: [-30, 30, 185, 205], floors: 5, gh: 3.4, fh: 2.9, style: 'old', wallTint: 0xd8c4a4, sides: { nz: 'front' }, roof: 'gable', seed: sd++ });
  buildBackdrop(ctx);

  // ------------------------------------------------------------------ SW industrial yard
  patch(ctx, -60, -10.3, 10.3, 64, 'gravel', 0.02);
  patch(ctx, -58, -44, 12, 30, 'dirt', 0.03);
  warehouse(ctx, [-42, -20, 20, 46]);
  buildBlock(ctx, { rect: [-18, -12, 50, 58], floors: 1, gh: 3.2, style: 'soviet', wall: 'brick', trim: 'concrete', sides: { nx: 'back', nz: 'front', px: 'blank' }, roof: 'flat', seed: 71, damage: 0.6, entrances: { nz: [0] }, edge: 0.8 });
  P.panelFence(ctx, [-10.3, 10.3], [-10.3, 34.3], { skip: [3], seed: 8, lean: [1] });
  P.chainFence(ctx, [-10.3, 38.5], [-10.3, 64], { sag: 0.12 });
  P.panelFence(ctx, [-60, 10.3], [-10.3, 10.3], { skip: [2, 7, 10], seed: 9, lean: [5] });
  P.panelFence(ctx, [-60, 10.3], [-60, 64], { seed: 10 });
  P.panelFence(ctx, [-60, 64], [-10.3, 64], { seed: 11 });
  // gate posts + fallen gate leaf
  B.add(box(2.6, 0.08, 2.0), 'metal_rusty', mat(-12.2, 0.12, 36.5, 0, 0.3, 0.05), { collider: false });
  P.container(ctx, -52, 0, 27, HP, { tint: 0x8a3a2a });
  P.container(ctx, -52, 2.62, 27.4, HP + 0.03, { tint: 0x2a4a6a });
  P.container(ctx, -52, 0, 36, HP, { tint: 0x3a5a3a });
  P.container(ctx, -47, 0, 56, 0.1, { tint: 0x9a7a3a, len: 12.1 });
  P.container(ctx, -15.5, 0, 16, 0.3, { tint: 0x5a5a5a });
  P.wreckedTruck(ctx, -32, 54, 0.15);
  P.crate(ctx, -25, 0, 14, 0.2, { s: [1.2, 1.1, 1.1], seed: 1 }); P.crate(ctx, -24, 0, 15.3, -0.1, { s: [1, 0.8, 0.9], seed: 2 });
  P.crate(ctx, -44, 0, 48, 0.4, { s: [1.2, 1.1, 1.0], seed: 3 }); P.crate(ctx, -44.3, 1.1, 48.1, 0.3, { s: [0.9, 0.7, 0.8], seed: 4 });
  P.crate(ctx, -18, 0, 44, 0.1, { military: true, s: [1.2, 0.5, 0.6] }); P.crate(ctx, -18, 0.5, 44, 0.12, { military: true, s: [1.2, 0.5, 0.6] });
  for (let i = 0; i < 4; i++) P.pallet(ctx, -56, i * 0.15, 45, 0.1 * i);
  P.pallet(ctx, -27, 0, 12.5, 0.8); P.pallet(ctx, -46, 0, 18, 0.3);
  for (let i = 0; i < 6; i++) P.barrel(ctx, -56.5 + (i % 3) * 0.62, 0, 50 + Math.floor(i / 3) * 0.62, { tint: 0x7a2a1a, rust: i === 4 });
  P.barrel(ctx, -20, 0, 12, { rust: true }); P.barrel(ctx, -19, 0, 12.6, { tipped: true, yaw: 1.2, tint: 0x2a4a6a });
  for (let i = 0; i < 5; i++) P.tire(ctx, -57, i * 0.22, 40, true, i);
  P.tire(ctx, -55.5, 0, 41.2, false, 0.5); P.tire(ctx, -44, 0, 14, false, 1.2);
  P.sandbags(ctx, -30, 14.5, 0, 4.5, 5, { seed: 13, curve: -0.6 });
  P.sandbags(ctx, -46, 44, HP, 3.5, 5, { seed: 14 });
  P.hesco(ctx, -26, 50, 0.1, 3);
  P.car(ctx, -52, 16, 0.4, { kind: 'hatch', burnt: true, seed: 5 });
  grass(ctx, -59.5, -58, 11, 63, 90, 1, 0.02, 0.7); grass(ctx, -59, -12, 62.5, 63.7, 90, 2, 0.02, 0.7); grass(ctx, -12, -10.6, 11, 63, 60, 3, 0.02, 0.6);
  grass(ctx, -58, -44, 12, 30, 80, 4, 0.03, 0.6);
  P.tree(ctx, -57, 58, { seed: 3, h: 9, leaves: 0.25 }); P.tree(ctx, -56, 21, { seed: 4, h: 8 });
  P.trashBags(ctx, -21, 47.8, 6, 3);

  // ------------------------------------------------------------------ alley behind block A
  patch(ctx, -28, -22, -64, -10.3, 'asphalt', 0.015, 0x9a9690);
  P.dumpster(ctx, -26.6, -44, HP, { tint: 0x3a5a4a }); P.dumpster(ctx, -26.7, -41.5, HP + 0.1, { tint: 0x6a4a2a });
  P.trashBags(ctx, -24, -46.5, 9, 5); P.trashBags(ctx, -27, -20, 5, 6);
  P.car(ctx, -24.8, -30.5, HP + 0.15, { kind: 'sedan', burnt: true, seed: 8, doorOpen: true });
  P.sandbags(ctx, -25, -52, 0, 4.2, 5, { seed: 15 });
  P.crate(ctx, -23, 0, -36, 0.3, { s: [1.1, 0.9, 1], seed: 7 }); P.pallet(ctx, -27.2, 0, -36, 0.2); P.pallet(ctx, -27.1, 0.15, -36, 0.25);
  P.barrel(ctx, -22.7, 0, -15, { rust: true }); P.barrel(ctx, -23.4, 0, -14.6, { tint: 0x2a4a2a });
  P.tire(ctx, -27.4, 0, -25, true, 0); P.tire(ctx, -27.4, 0.22, -25.1, true, 1);
  grass(ctx, -28, -27.3, -63, -12, 60, 5, 0.02, 0.6); grass(ctx, -22.7, -22, -63, -12, 40, 6, 0.02, 0.6);
  // cables strung across the alley
  for (const z of [-58, -47, -36, -18]) P.cable(ctx, new THREE.Vector3(-28, 7.5 + r(), z), new THREE.Vector3(-22, 8.5 + r(), z + (r() - 0.5) * 3), 0.6);
  for (const z of [-54, -40, -24]) { P.cable(ctx, new THREE.Vector3(-28, 3 + r(), z), new THREE.Vector3(-22, 3.4, z + 1), 0.45, 0.006); }

  // ------------------------------------------------------------------ main street furniture, cover & wrecks
  // tram/power poles with span wires + contact wires
  const poleZ = [-54, -30, -12, 14, 34, 54];
  const polePts = { w: [], e: [] };
  for (const z of poleZ) {
    polePts.w.push(P.powerPole(ctx, -7.0, z, 0, { lean: z === 34 ? 0.05 : 0 }));
    polePts.e.push(P.powerPole(ctx, 7.0, z, 0, { lean: z === -30 ? -0.04 : 0 }));
  }
  for (let i = 0; i < poleZ.length; i++) {
    const a = polePts.w[i][3], b = polePts.e[i][3];
    P.cable(ctx, a, b, 0.5, 0.01);
    if (i < poleZ.length - 1) {
      for (const k of [0, 1, 2]) { P.cable(ctx, polePts.w[i][k], polePts.w[i + 1][k], 0.9 + k * 0.15, 0.012); P.cable(ctx, polePts.e[i][k], polePts.e[i + 1][k], 0.9 + k * 0.1, 0.012); }
      if (i !== 2) for (const tx of [-2.4, 2.4]) P.cable(ctx, new THREE.Vector3(tx, 6.1, poleZ[i]), new THREE.Vector3(tx, 6.1, poleZ[i + 1]), 0.25, 0.008);
    }
  }
  // broken contact wire dangling to the street near the intersection
  P.cable(ctx, new THREE.Vector3(-7, 8.8, -12), new THREE.Vector3(-8.6, 0.2, -9.6), 0.6, 0.01);
  P.cable(ctx, new THREE.Vector3(7, 8.8, 34), new THREE.Vector3(8.8, 0.2, 31.5), 0.5, 0.01);
  // wires from poles to buildings
  for (const [z, s] of [[-54, -1], [-30, -1], [34, 1], [54, 1]]) P.cable(ctx, new THREE.Vector3(s * 7, 8.2, z), new THREE.Vector3(s * 10, 7.6, z + 4), 0.4, 0.008);
  for (const [x, z, yaw] of [[-8.8, -42, HP], [8.8, -18, -HP], [-8.8, 26, HP], [8.8, 44, -HP], [-8.8, 6.9 + 40, HP], [-24, 8.8, 0], [30, -8.8, PI], [-44, -8.8, PI], [44, 8.8, 0]]) P.streetLamp(ctx, x, z, yaw, { broken: r() < 0.3 });
  // wrecks
  P.car(ctx, 4.2, 38, HP + 0.12, { kind: 'sedan', burnt: true, seed: 1, hoodOpen: true });
  P.car(ctx, -4.3, 23, HP - 0.06, { kind: 'hatch', paint: 0x7a8a6a, seed: 2 });
  P.car(ctx, -2.6, -19, HP + 0.65, { kind: 'sedan', burnt: true, seed: 3 });
  P.car(ctx, 3.6, -36, HP - 0.18, { kind: 'van', burnt: true, seed: 4 });
  P.car(ctx, 8.2, 47, HP, { kind: 'sedan', paint: 0x8a2a22, seed: 6, tilt: 0.02 });
  P.car(ctx, -31, 3.2, 0.12, { kind: 'hatch', burnt: true, seed: 7 });
  P.car(ctx, 31, -3.5, 0.05, { kind: 'sedan', paint: 0x2a4a6a, seed: 9 });
  P.car(ctx, 3.2, 5.6, 2.6, { kind: 'sedan', burnt: true, seed: 10 });
  // cover
  P.jersey(ctx, -2, 45, 0.1, { paint: true }); P.jersey(ctx, 2.8, 42.6, -0.25);
  P.jersey(ctx, -1.2, -43, 0.12); P.jersey(ctx, 3.8, -46.5, 0.18, { paint: true });
  P.jersey(ctx, -8, 16, HP); P.jersey(ctx, 8, -26.5, HP + 0.1);
  P.sandbags(ctx, 3.5, 15, 0, 3.6, 5, { seed: 21, curve: 0.3 });
  P.sandbags(ctx, -3.8, -12.5, PI, 3.6, 5, { seed: 22, curve: 0.3 });
  P.hesco(ctx, -2.8, -2.5, 0, 3); P.hesco(ctx, 1.9, 2.8, 0.05, 2);
  P.hedgehog(ctx, 0.2, 26.5, 0.4); P.hedgehog(ctx, 5, -8, 1.1); P.hedgehog(ctx, -40, -2, 0.2);
  P.crate(ctx, 7.8, 0.15, 25, 0.3, { military: true, s: [1.2, 0.5, 0.6] }); P.crate(ctx, 7.9, 0.65, 25, 0.35, { military: true, s: [1.2, 0.5, 0.6] });
  P.trashBags(ctx, -8.8, 40, 7, 9); P.trashBags(ctx, 9, -40, 5, 10); P.trashBags(ctx, 8.8, 30.5, 4, 11);
  // facade spill: rubble heaps under shell-damaged walls, and debris strewn onto the road
  for (const [x, z, rx, rz, h, sd] of [[-9, -37, 1.6, 2.6, 0.8, 61], [9.1, 29, 1.4, 2.4, 0.7, 62], [-8.9, 11.5, 1.2, 1.8, 0.6, 63], [9, -20.5, 1.3, 2.2, 0.7, 64], [-9.2, 51, 1.5, 2.5, 0.9, 65], [-3.5, -26, 1.3, 1.2, 0.35, 66], [2.5, 21, 1.0, 1.4, 0.3, 67]]) P.rubble(ctx, x, z, { rx, rz, h, seed: sd, chunks: 22, block: h > 0.5 });
  P.car(ctx, -4.6, -48, HP + 0.25, { kind: 'hatch', burnt: true, seed: 17 });
  P.wreckedTruck(ctx, -3.5, 31.5, HP + 0.45, { seed: 9 });
  // sidewalk trees in pits
  for (const [x, z, s] of [[-8.3, -34, 1], [-8.3, 34, 2], [8.3, 26, 3], [8.3, -48, 4], [-8.3, -50, 5]]) {
    P.tree(ctx, x, z, { seed: 10 + s, h: 7 + s % 3, leaves: 0.4 });
    B.add(box(1.4, 0.05, 1.4), 'dirt', mat(x, 0.14, z), { collider: false });
    grass(ctx, x - 0.6, x + 0.6, z - 0.6, z + 0.6, 6, 20 + s, 0.16, 0.8);
  }
  // bus stop shelter (east sidewalk, near plaza)
  busStop(ctx, 8.8, -34, -HP, r);
  // barricades at the map edges
  P.bus(ctx, 0, -58, 0.04);
  P.hesco(ctx, -8, -58, 0, 4); P.hesco(ctx, 8.1, -58, 0, 4);
  P.jersey(ctx, -3, -55, 0.05); P.jersey(ctx, 2.5, -55.3, -0.08);
  P.sandbags(ctx, 6, -55, 0.1, 3, 5, { seed: 23 });
  wall(ctx, [-10.5, -59.8], [10.5, -59.8], 5);
  // south: collapsed building spill + tank traps
  P.rubble(ctx, -2, 68, { rx: 11, rz: 5, h: 4.2, seed: 51, chunks: 120, brick: true });
  P.rubble(ctx, 7, 64.5, { rx: 4, rz: 2.5, h: 2, seed: 52, chunks: 40 });
  P.rubble(ctx, -8, 63.5, { rx: 3, rz: 2.4, h: 1.6, seed: 53, chunks: 40 });
  for (const x of [-5, -1.5, 2, 5.5]) P.hedgehog(ctx, x, 59.5 + (x % 2), x);
  wall(ctx, [-10.5, 62.5], [10.5, 62.5], 5);
  // collapsed facade remnant standing in the rubble
  const Fr = new Facade(ctx, new THREE.Vector3(-9, 0, 71), new THREE.Vector3(0, 0, -1), 14);
  Fr.wall(0, 9, [{ u0: 2, u1: 3.5, y0: 4, y1: 5.6 }, { u0: 6, u1: 7.5, y0: 4, y1: 5.6 }, { u0: 2, u1: 3.5, y0: 7, y1: 8.6 }, { u0: 9.5, u1: 14, y0: 5, y1: 9.1 }, { u0: 11.5, u1: 14, y0: 2.5, y1: 9.1 }], 'brick', 0.4, { collider: false });
  // cross street ends
  P.container(ctx, 57, 0, -3.1, HP, { tint: 0x2a5a8a }); P.container(ctx, 57.2, 0, 3.1, HP - 0.04, { tint: 0x7a2a22 });
  P.container(ctx, 57.1, 2.6, 0, HP + 0.05, { tint: 0x5a5a4a });
  P.hesco(ctx, 57, -8.1, HP, 3); P.hesco(ctx, 57, 8.1, HP, 3);
  P.wreckedTruck(ctx, 49, -2.8, 0.25);
  wall(ctx, [59, -10.5], [59, 10.5], 6);
  P.container(ctx, -57, 0, 3.2, HP, { tint: 0x3a4a3a }); P.hesco(ctx, -57, -3.5, HP, 5, { h: 1.9 });
  P.hesco(ctx, -57, 8.2, HP, 3); P.hesco(ctx, -57, -8.2, HP, 3);
  P.sandbags(ctx, -53, -2, HP, 3, 5, { seed: 24 });
  wall(ctx, [-59, -10.5], [-59, 10.5], 6);
  // intersection craters
  P.rubble(ctx, -9.2, -9.4, { rx: 2, rz: 1.8, h: 0.9, seed: 54, chunks: 30 });

  // ------------------------------------------------------------------ NE plaza
  patch(ctx, 10, 46, -46, -10.2, 'concrete', 0.15, 0xb4b0a8);
  B.add(new THREE.PlaneGeometry(36, 35.8).rotateX(-HP), 'pavers', mat(28, 0.152, -28.1), { collider: false, uvScale: 0.5 });
  // granite border band + bollards around the square
  for (const [x0, x1, z0, z1] of [[10, 46, -10.8, -10.2], [10.2, 10.8, -46, -10.2]]) B.add(box(x1 - x0, 0.04, z1 - z0), 'concrete_dark', mat((x0 + x1) / 2, 0.16, (z0 + z1) / 2), { collider: false, tint: 0x8a8680 });
  for (let t = 12; t < 45; t += 3.2) { if (Math.abs(t - 28) < 3) continue; B.add(cyl(0.11, 0.13, 0.8, 8), 'concrete', mat(t, 0.55, -10.9), { collider: false, tint: 0xa8a49c }); B.add(cyl(0.11, 0.13, 0.8, 8), 'concrete', mat(10.9, 0.55, -t), { collider: false, tint: 0xa8a49c }); }
  for (const [x, z] of [[20, -20], [36, -36], [36, -20], [20, -36]]) P.streetLamp(ctx, x, z, Math.atan2(28 - x, 28 - z) + PI, { h: 5.5, broken: x === 36 && z === -36 });
  for (let i = 0; i < 18; i++) B.add(new THREE.PlaneGeometry(2 + r() * 3, 2 + r() * 3).rotateX(-HP), r() < 0.5 ? 'decal_dirt' : 'decal_stain', mat(12 + r() * 32, 0.155, -44 + r() * 32, 0, r() * 6), { collider: false, uv: 'keep', shadow: false });
  monument(ctx, 28, -28, r);
  for (const [x, z] of [[16, -16], [40, -16], [16, -40], [40, -40], [28, -14.5], [28, -42], [14, -28], [43, -28]]) {
    P.tree(ctx, x, z, { seed: Math.round(x * 3 + z), h: 8 + (x % 3), leaves: 0.5 });
    B.add(box(2.4, 0.3, 2.4), 'concrete', mat(x, 0.3, z), { collider: false, tint: 0xb0aca4 });
    B.add(box(2.1, 0.05, 2.1), 'dirt', mat(x, 0.42, z), { collider: false });
    grass(ctx, x - 1, x + 1, z - 1, z + 1, 8, x * 7 + z, 0.44, 0.7);
  }
  P.bench(ctx, 22, -22, PI / 4); P.bench(ctx, 34, -34, PI + PI / 4, true); P.bench(ctx, 34, -22, -PI / 4); P.bench(ctx, 22, -34, PI - PI / 4);
  P.kiosk(ctx, 40, -13.2, PI, { tint: 0x2a5a7a, sign: 4 });
  P.sandbags(ctx, 18, -37, 0.3, 4.5, 6, { seed: 31, curve: -1.0 });
  P.sandbags(ctx, 15.5, -35, HP + 0.3, 2.6, 6, { seed: 32 });
  tarpRoof(ctx, 17.5, -38.5, 0.3, r);
  P.hesco(ctx, 24, -17.5, 0, 3); P.hesco(ctx, 38, -26, HP, 2);
  P.car(ctx, 36, -40, 0.9, { kind: 'hatch', burnt: true, seed: 12 });
  P.crate(ctx, 42, 0.15, -36, 0.2, { military: true, s: [1.2, 0.5, 0.6] }); P.crate(ctx, 42.1, 0.65, -36, 0.25, { military: true, s: [1.2, 0.5, 0.6], seed: 3 });
  P.jersey(ctx, 13, -24, HP + 0.2);
  P.trashBags(ctx, 44, -44, 6, 12);
  crater(ctx, 32, -20, 1.4, r);

  // ------------------------------------------------------------------ SE courtyard
  patch(ctx, 24, 46, 10.3, 66, 'dirt', 0.02);
  patch(ctx, 27, 36, 30, 46, 'grass', 0.035);
  grass(ctx, 24.5, 45.5, 11, 58, 300, 7, 0.03, 0.5);
  garages(ctx, 35, 63.5, PI, 6, { seed: 8 });
  playground(ctx, 31, 38, r);
  for (const [x, z, s] of [[28, 22, 1], [42, 28, 2], [27, 52, 3], [41, 50, 4]]) P.tree(ctx, x, z, { seed: 30 + s, h: 9 + s % 2, leaves: 0.3 });
  P.dumpster(ctx, 26, 14, 0, { tint: 0x3a5a4a }); P.dumpster(ctx, 28.3, 14.1, 0.05, { tint: 0x5a5a5a });
  P.trashBags(ctx, 30.5, 13.6, 6, 13);
  P.car(ctx, 38, 18, 0.1, { kind: 'sedan', paint: 0xb8b0a0, seed: 14 });
  P.car(ctx, 42.5, 42, HP + 0.2, { kind: 'hatch', burnt: true, seed: 15 });
  P.sandbags(ctx, 34, 26, 0, 4, 5, { seed: 33 });
  P.crate(ctx, 26, 0, 30, 0.4, { s: [1.1, 1, 1], seed: 8 }); P.pallet(ctx, 25.4, 0, 32, 0.1);
  for (const x of [26, 44]) { B.add(cyl(0.05, 0.05, 2.4, 6), 'metal_painted', mat(x, 1.2, 45), { collider: false, tint: 0x5a6a5a }); }
  P.cable(ctx, new THREE.Vector3(26, 2.3, 45), new THREE.Vector3(44, 2.3, 45), 0.35, 0.006);
  P.chainFence(ctx, [24.2, 10.4], [30, 10.4], { h: 1.6 });
  P.chainFence(ctx, [40, 10.4], [45.8, 10.4], { h: 1.6, sag: 0.2 });
  // cables from courtyard to buildings
  P.cable(ctx, new THREE.Vector3(24, 10, 30), new THREE.Vector3(46, 12, 34), 1.2, 0.01);
  P.cable(ctx, new THREE.Vector3(24, 9, 48), new THREE.Vector3(46, 11, 50), 1.0, 0.01);

  // ------------------------------------------------------------------ scattered micro detail
  const scatter = (kind, n, x0, x1, z0, z1, y = 0.03, sc = [0.7, 1.4]) => {
    for (let i = 0; i < n; i++) { const s = sc[0] + r() * (sc[1] - sc[0]); ctx.inst(kind, mat(x0 + r() * (x1 - x0), y, z0 + r() * (z1 - z0), (r() - 0.5) * 0.4, r() * 6, (r() - 0.5) * 0.4, s, s, s)); }
  };
  scatter('debris', 260, -6, 6, -56, 56, 0.04); scatter('debris', 140, -60, 60, -6, 6, 0.04);
  scatter('brick', 90, 6.5, 13, 6, 20, 0.05); scatter('brick', 40, -10, -6.5, -40, 40, 0.18);
  scatter('paper', 120, -10, 10, -56, 58, 0.03); scatter('paper', 60, 10, 46, -46, -10, 0.16); scatter('paper', 40, -28, -22, -62, -12, 0.02);
  scatter('casing', 80, 12, 20, -40, -33, 0.17, [1, 1]); scatter('casing', 60, 14, 18, 11, 16, 3.32, [1, 1]); scatter('casing', 40, 1, 6, 13.8, 16, 0.04, [1, 1]);
  // grass in cracks along curbs and wall bases
  grass(ctx, -9.9, -9.4, -60, 60, 110, 31, 0.16, 0.7); grass(ctx, 9.4, 9.9, -44, 60, 90, 32, 0.16, 0.7);
  grass(ctx, -60, 60, 9.4, 9.9, 60, 33, 0.16, 0.7); grass(ctx, -60, -12, -9.9, -9.4, 50, 34, 0.16, 0.7);
  // posters on walls
  poster(ctx, -9.99, 2.0, -21.5, HP, 1, 1.3, 0); poster(ctx, -9.99, 2.1, -22.8, HP, 1, 1.3, 5); poster(ctx, 9.99, 2.0, 36, -HP, 1, 1.3, 2);
  poster(ctx, 9.99, 2.2, 26.6, -HP, 1.1, 1.4, 3); poster(ctx, -10.1, 1.5, 28, -HP, 1, 1.3, 7); poster(ctx, 45.99, 2.2, -24, -HP, 1, 1.3, 1);
  graffiti(ctx, -10.09, 1.4, 20, -HP, 3, 1.5, 1); graffiti(ctx, 9.99, 1.3, 54, -HP, 3, 1.5, 2); graffiti(ctx, -22.01, 1.8, -48, -HP, 3.4, 1.7, 4); graffiti(ctx, 45.99, 1.6, 30, -HP, 3, 1.5, 5);

  // ------------------------------------------------------------------ spawns
  const playerSpawn = { position: new THREE.Vector3(0.5, 0.03, 53), yaw: 0 };
  const enemySpawns = [
    [-2, -51], [4.5, -50.5], [-25, -57], [-24.5, -40], [20, -42], [36, -36], [42, -20], [-8.4, -38], [30, -48 + 4], [-17, -27.9],
  ].map(([x, z]) => new THREE.Vector3(x, ctx.heightAt(x, z), z));
  // high cover at building corners along lanes
  for (const [x, z, fx, fz] of [[-10.4, -10.4, 0, -1], [10.4, -10.4, 0, -1], [-10.4, 10.4, 0, -1], [10.4, 18.5, 0, -1], [-22.4, -10.6, 0, -1], [45.6, -10.6, 0, -1], [-20.2, 46.4, 0, -1], [-41.8, 19.6, 0, -1]]) ctx.addCover(new THREE.Vector3(x, 0, z), new THREE.Vector3(fx, 0, fz), 'high');
  return { playerSpawn, enemySpawns };
}

/** Invisible boundary wall (placed only behind visible blockers). */
function wall(ctx, a, b, h) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  ctx.proxy(L, h, 0.3, mat((a[0] + b[0]) / 2, h / 2, (a[1] + b[1]) / 2, 0, Math.atan2(-dz, dx), 0), 'concrete');
  ctx.addSegment(a, b, h);
}

function atlasPlane(w, h, cell, cols, rows) {
  const g = new THREE.PlaneGeometry(w, h); const uv = g.attributes.uv;
  const cx = cell % cols, cy = Math.floor(cell / cols);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (cx + uv.getX(i)) / cols, 1 - (cy + 1 - uv.getY(i)) / rows);
  return g;
}
function poster(ctx, x, y, z, ry, w, h, cell) {
  ctx.batch.add(atlasPlane(w, h, cell, 4, 2), 'poster', mat(x, y, z, 0, ry, (Math.sin(cell * 7) * 0.05)), { collider: false, uv: 'keep', shadow: false });
}
function graffiti(ctx, x, y, z, ry, w, h, cell) {
  ctx.batch.add(atlasPlane(w, h, cell, 3, 2), 'graffiti', mat(x, y, z, 0, ry, 0), { collider: false, uv: 'keep', shadow: false });
}

function monument(ctx, x, z, r) {
  const B = ctx.batch;
  B.add(box(8, 0.4, 8), 'concrete', mat(x, 0.35, z), { surface: 'concrete', tint: 0xb8b4ac });
  B.add(box(6, 0.4, 6), 'concrete', mat(x, 0.75, z), { surface: 'concrete', tint: 0xb8b4ac });
  B.add(box(2.4, 3.2, 2.4), 'concrete', mat(x, 2.55, z), { surface: 'concrete', tint: 0x9a968e });
  B.add(box(2.7, 0.3, 2.7), 'concrete', mat(x, 4.2, z), { collider: false, tint: 0xa8a49c });
  B.add(box(2.7, 0.3, 2.7), 'concrete', mat(x, 1.05, z), { collider: false, tint: 0xa8a49c });
  // plaque
  B.add(box(1.4, 0.8, 0.05), 'metal_painted', mat(x, 2.6, z + 1.22), { collider: false, tint: 0x6a5a3a });
  // statue remnant: legs + torso stump (bronze), toppled torso on the ground
  const bronze = { collider: false, tint: 0x4a5a48 };
  B.add(cyl(0.18, 0.22, 1.3, 8), 'metal_painted', mat(x - 0.25, 5.0, z), bronze);
  B.add(cyl(0.18, 0.22, 1.3, 8), 'metal_painted', mat(x + 0.25, 5.0, z + 0.15, 0.1), bronze);
  const stump = box(0.9, 0.7, 0.5); jitter(stump, 0.12, r);
  B.add(stump, 'metal_painted', mat(x, 5.9, z), bronze);
  const torso = box(1.0, 1.6, 0.55); jitter(torso, 0.1, r);
  B.add(torso, 'metal_painted', mat(x + 3.4, 0.55, z + 1.2, HP, 0.6, 0.2), { ...bronze, collider: true, surface: 'metal' });
  B.add(new THREE.SphereGeometry(0.32, 10, 8), 'metal_painted', mat(x + 4.5, 0.45, z + 2.1), bronze);
  B.add(cyl(0.1, 0.12, 1.4, 6), 'metal_painted', mat(x + 2.6, 0.35, z + 2.2, 0, 0.3, HP), bronze);
  // flowers / wreath remains, candles
  B.add(new THREE.TorusGeometry(0.35, 0.08, 6, 12), 'grass', mat(x - 0.6, 1.0, z + 1.5, HP), { collider: false, tint: 0x5a6a3a });
  P.rubble(ctx, x - 2.6, z - 2.4, { rx: 1.4, rz: 1.2, h: 0.6, seed: 91, chunks: 18, block: false });
  ctx.addObb(x, z, 3, 3, 0, 1.0, true);
  ctx.addObb(x, z, 1.3, 1.3, 0, 4.0, false);
}

function busStop(ctx, x, z, yaw, r) {
  const B = ctx.batch; const F = (lx, ly, lz, rx = 0, ry = 0, rz = 0) => mat(x, 0.15, z, 0, yaw, 0).multiply(mat(lx, ly, lz, rx, ry, rz));
  for (const lx of [-1.8, 1.8]) for (const lz of [-0.6, 0.6]) B.add(box(0.08, 2.5, 0.08), 'metal_painted', F(lx, 1.25, lz), { collider: false, tint: 0x3a5a6a });
  B.add(box(3.9, 0.1, 1.6), 'metal_painted', F(0, 2.52, 0, 0.06), { collider: false, tint: 0x3a5a6a });
  B.add(new THREE.PlaneGeometry(3.6, 1.8), 'glass', F(0, 1.3, -0.62), { collider: false });
  B.add(box(3.6, 0.05, 0.4), 'wood', F(0, 0.5, -0.35), { collider: false, tint: 0x6a4a2a });
  B.add(new THREE.PlaneGeometry(1.1, 1.4), 'poster', F(1.2, 1.3, -0.6), { collider: false, uv: 'keep' });
  for (let i = 0; i < 20; i++) ctx.inst('debris', F(-2 + r() * 4, 0.02, -1 + r() * 2, 0, r() * 6, 0).multiply(mat(0, 0, 0, 0, 0, 0, 0.4, 0.2, 0.4)));
  ctx.addObb(x, z, 0.3, 1.9, 0, 2.5, false);
}

function tarpRoof(ctx, x, z, yaw, r) {
  const B = ctx.batch;
  for (const [dx, dz] of [[-1.8, -1.2], [1.8, -1.2], [-1.8, 1.2], [1.8, 1.2]]) B.add(cyl(0.05, 0.05, 1.9, 6), 'wood', mat(x + dx, 0.95 + 0.15, z + dz), { collider: false, tint: 0x6a5a4a });
  const g = new THREE.PlaneGeometry(4.4, 3.2, 8, 6); g.rotateX(-HP); jitter(g, 0.12, r);
  B.add(g, 'cloth_camo', mat(x, 2.0, z, 0.05, yaw, 0), { collider: false });
  const n = new THREE.PlaneGeometry(4.6, 3.4, 6, 4); n.rotateX(-HP); jitter(n, 0.1, r);
  B.add(n, 'wiregrid', mat(x, 2.08, z, 0.05, yaw, 0), { collider: false, uvScale: 6 });
}

function playground(ctx, x, z, r) {
  const B = ctx.batch; const t = 0x8a3a2a;
  // swing frame
  for (const s of [-1, 1]) for (const k of [-1, 1]) B.add(cyl(0.04, 0.04, 2.6, 6), 'metal_painted', mat(x + s * 1.5, 1.2, z + k * 0.5, k * 0.3, 0, 0), { collider: false, tint: t });
  B.add(cyl(0.04, 0.04, 3.1, 6), 'metal_painted', mat(x, 2.4, z, 0, 0, HP), { collider: false, tint: t });
  B.add(cyl(0.01, 0.01, 1.8, 3), 'metal_bare', mat(x - 0.3, 1.5, z), { collider: false });
  B.add(cyl(0.01, 0.01, 1.2, 3), 'metal_bare', mat(x + 0.3, 1.8, z, 0.3), { collider: false });
  B.add(box(0.5, 0.04, 0.25), 'wood', mat(x - 0.3, 0.6, z, 0, 0, 0.2), { collider: false, tint: 0x8a6a3a });
  // slide
  B.add(box(0.6, 0.05, 3), 'metal_bare', mat(x + 5, 0.9, z + 1, 0.55), { collider: false });
  for (const s of [-1, 1]) B.add(cyl(0.04, 0.04, 2, 6), 'metal_painted', mat(x + 5 + s * 0.3, 1, z - 0.5), { collider: false, tint: 0x3a6a8a });
  // sandbox
  for (const [dx, dz, w, d] of [[0, -1.5, 3, 0.15], [0, 1.5, 3, 0.15], [-1.5, 0, 0.15, 3], [1.5, 0, 0.15, 3]]) B.add(box(w, 0.3, d), 'wood', mat(x - 5 + dx, 0.15, z + dz), { collider: false, tint: 0x7a6a4a });
  B.add(box(2.9, 0.1, 2.9), 'gravel', mat(x - 5, 0.08, z), { collider: false, tint: 0xd8c8a0 });
}
