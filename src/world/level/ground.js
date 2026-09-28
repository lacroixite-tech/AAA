import * as THREE from 'three';
import { box, cyl, mat, jitter, rng } from './geom.js';
import * as P from './props.js';

const FLAT = (w, d) => { const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); return g; };

/** Streets, sidewalks, curbs, markings, tram tracks, puddles, craters. */
export function buildGround(ctx) {
  const B = ctx.batch; const r = rng(77);
  const EXT = 170;
  // base terrain (dirt), large
  B.add(box(900, 1, 900), 'dirt', mat(0, -0.5, 0), { surface: 'dirt', shadow: false });
  // asphalt roads
  B.add(box(12, 0.1, EXT * 2), 'asphalt', mat(0, -0.03, 0), { surface: 'concrete' });
  for (const sx of [-1, 1]) B.add(box(EXT - 6, 0.1, 12), 'asphalt', mat(sx * (EXT + 6) / 2, -0.03, 0), { surface: 'concrete' });
  // asphalt patch repairs (slightly different tone), crack networks, oil
  for (let i = 0; i < 26; i++) {
    const alongZ = r() < 0.6; const a = (r() - 0.5) * 130, b = (r() - 0.5) * 10;
    const w = 1 + r() * 3, d = 1 + r() * 4;
    const [x, z] = alongZ ? [b, a] : [a, b];
    B.add(FLAT(w, d), 'asphalt', mat(x, 0.024, z, 0, r() * 0.3), { collider: false, tint: r() < 0.5 ? 0x8a8a88 : 0xc8c8c4, shadow: false });
  }
  for (let i = 0; i < 40; i++) {
    const alongZ = r() < 0.6; const a = (r() - 0.5) * 140, b = (r() - 0.5) * 11;
    const [x, z] = alongZ ? [b, a] : [a, b]; const s = 1 + r() * 3;
    B.add(FLAT(s, s), r() < 0.3 ? 'decal_oil' : 'decal_stain', mat(x, 0.028, z, 0, r() * 6), { collider: false, uv: 'keep', shadow: false });
  }
  // sidewalks (raised 0.15) with curbs
  const sw = (x0, x1, z0, z1, tint) => {
    B.add(box(x1 - x0, 0.2, z1 - z0), 'concrete', mat((x0 + x1) / 2, 0.05, (z0 + z1) / 2), { surface: 'concrete', tint: tint ?? 0xa8a49c, uvScale: 1 });
  };
  const curb = (x0, x1, z0, z1) => B.add(box(x1 - x0, 0.3, z1 - z0), 'concrete_dark', mat((x0 + x1) / 2, 0.02, (z0 + z1) / 2), { surface: 'concrete', tint: 0xc8c4bc });
  // N-S sidewalks
  for (const [x0, x1, cx] of [[-10, -6.2, -6.1], [6.2, 10, 6.1]]) {
    for (const [z0, z1] of [[-EXT, -10], [10, EXT]]) { sw(x0, x1, z0, z1); curb(cx - 0.1, cx + 0.1, z0 + (z0 < 0 ? 0 : 0.2), z1 - (z0 < 0 ? 0.2 : 0)); }
  }
  // E-W sidewalks
  for (const [z0, z1, cz] of [[-10, -6.2, -6.1], [6.2, 10, 6.1]]) {
    for (const [x0, x1] of [[-EXT, -6.2], [6.2, EXT]]) { sw(x0, x1, z0, z1); curb(x0, x1, cz - 0.1, cz + 0.1); }
  }
  // corner squares
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) sw(sx > 0 ? 6.2 : -10, sx > 0 ? 10 : -6.2, sz > 0 ? 6.2 : -10, sz > 0 ? 10 : -6.2);
  // sidewalk slab joints (dark lines) and dirt at wall bases
  for (let z = -EXT; z < EXT; z += 2.5) for (const x of [-8.1, 8.1]) if (Math.abs(z) > 10) B.add(FLAT(3.8, 0.03), 'decal_oil', mat(x, 0.152, z), { collider: false, uv: 'keep', shadow: false });
  for (let x = -EXT; x < EXT; x += 2.5) for (const z of [-8.1, 8.1]) if (Math.abs(x) > 10) B.add(FLAT(0.03, 3.8), 'decal_oil', mat(x, 0.152, z), { collider: false, uv: 'keep', shadow: false });
  for (let i = 0; i < 60; i++) {
    const side = r.int(0, 3); const t = (r() - 0.5) * 120; const s = 1 + r() * 2.5;
    const pos = [[-9.4, t], [9.4, t], [t, -9.4], [t, 9.4]][side];
    if (Math.abs(pos[0]) < 10 && Math.abs(pos[1]) < 10) continue;
    B.add(FLAT(s, s), r() < 0.5 ? 'decal_dirt' : 'decal_stain', mat(pos[0], 0.153, pos[1], 0, r() * 6), { collider: false, uv: 'keep', shadow: false });
  }
  // road markings: dashed center, edge lines, zebra crossings, stop lines
  const paint = (x, z, w, d, m = 'paint_white', ry = 0) => B.add(FLAT(w, d), m, mat(x, 0.026, z, 0, ry), { collider: false, uvScale: 0.35, shadow: false });
  for (let z = -EXT + 2; z < EXT; z += 6) if (Math.abs(z) > 12) paint(0, z, 0.14, 3);
  for (let x = -EXT + 2; x < EXT; x += 6) if (Math.abs(x) > 12) paint(x, 0, 3, 0.14);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 7; k++) { paint(-5 + k * 1.65, s * 11.5, 0.6, 3.2); paint(s * 11.5, -5 + k * 1.65, 3.2, 0.6); }
    paint(s > 0 ? 3 : -3, s * 13.6, 5.6, 0.35); paint(s * 13.6, s > 0 ? -3 : 3, 0.35, 5.6);
    // lane edge lines
    for (const z0 of [-EXT, 14]) paint(s * 5.5, z0 + (EXT - 14) / 2 * (z0 < 0 ? 1 : 1) , 0.12, EXT - 14);
    for (const x0 of [-EXT, 14]) paint(x0 + (EXT - 14) / 2, s * 5.5, EXT - 14, 0.12);
  }
  // tram tracks along main street (two tracks)
  for (const tc of [-2.4, 2.4]) for (const off of [-0.76, 0.76]) {
    B.add(box(0.07, 0.06, EXT * 2), 'metal_bare', mat(tc + off, 0.03, 0), { collider: false, tint: 0x9a948c });
    B.add(box(0.2, 0.012, EXT * 2), 'concrete_dark', mat(tc + off, 0.022, 0), { collider: false, tint: 0x6a6660 });
  }
  // manholes & drains
  for (const [x, z] of [[-3.5, -24], [3.8, 18], [-2, 38], [22, 2.5], [-30, -3], [1.2, -44], [40, -2]]) P.manhole(ctx, x, z);
  for (let z = -60; z < 64; z += 12) for (const x of [-5.7, 5.7]) if (Math.abs(z) > 12) B.add(box(0.35, 0.02, 0.8), 'metal_rusty', mat(x, 0.028, z), { collider: false });
  // puddles
  const puddles = [[-4.8, 20, 4, 2.5], [4.5, -16, 3.5, 2], [-1, 34, 2.5, 1.6], [16, 4, 3, 2], [-18, -4.5, 3.4, 1.8], [30, 3, 2.2, 1.4], [1.5, -38, 3.5, 2.8], [-5, -46, 2, 1.4], [25, -25, 3, 2], [-30, 34, 4, 3], [34, 30, 3, 2], [-25, -40, 2.5, 4], [5, 48, 2.6, 1.6]];
  for (const [x, z, w, d] of puddles) {
    const y = Math.abs(x) > 10 && Math.abs(z) > 10 && x > 0 && z < 0 ? 0.16 : 0.03;
    B.add(FLAT(w, d), 'puddle', mat(x, y, z, 0, r() * 6), { collider: false, uv: 'keep', shadow: false });
    B.add(FLAT(w * 1.5, d * 1.5), 'decal_stain', mat(x, y - 0.002, z, 0, r() * 6), { collider: false, uv: 'keep', shadow: false });
  }
  // shell craters in the road
  for (const [x, z, s] of [[3.2, 26, 1.6], [-2.5, -30, 1.9], [26, -1.5, 1.4], [-38, 2.5, 1.7]]) crater(ctx, x, z, s, r);
}

export function crater(ctx, x, z, s, r) {
  const B = ctx.batch;
  B.add(FLAT(s * 4.5, s * 4.5), 'decal_soot', mat(x, 0.03, z, 0, r() * 6), { collider: false, uv: 'keep', shadow: false });
  B.add(FLAT(s * 1.6, s * 1.4), 'puddle', mat(x, 0.035, z, 0, r() * 6), { collider: false, uv: 'keep', shadow: false });
  const ring = new THREE.TorusGeometry(s * 0.95, s * 0.28, 5, 14); ring.rotateX(-Math.PI / 2); ring.scale(1, 0.45, 1); jitter(ring, s * 0.12, r);
  B.add(ring, 'asphalt', mat(x, 0.0, z), { surface: 'dirt' });
  for (let i = 0; i < 18; i++) {
    const a = r() * 6.28, d = s * (1 + r() * 1.2); const c = box(0.15 + r() * 0.4, 0.06 + r() * 0.06, 0.15 + r() * 0.35); jitter(c, 0.05, r);
    B.add(c, 'asphalt', mat(x + Math.cos(a) * d, 0.05, z + Math.sin(a) * d, (r() - 0.5) * 0.5, r() * 6, (r() - 0.5) * 0.5), { collider: false });
  }
}

/** Ground cover for yards/courtyards/plaza. */
export function patch(ctx, x0, x1, z0, z1, m, y = 0.01, tint) {
  ctx.batch.add(box(x1 - x0, 0.1, z1 - z0), m, mat((x0 + x1) / 2, y - 0.05, (z0 + z1) / 2), { surface: m === 'tiles' ? 'concrete' : 'dirt', tint, shadow: false });
}

/** Scatter grass tufts in a rect. */
export function grass(ctx, x0, x1, z0, z1, n, seed = 1, y = 0.02, dry = 0.4) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const s = 0.4 + r() * 0.7;
    ctx.inst(r() < dry ? 'grassDry' : 'grass', mat(x0 + r() * (x1 - x0), y, z0 + r() * (z1 - z0), 0, r() * 6, 0, s, s * (0.7 + r() * 0.6), s));
  }
}
