import * as THREE from 'three';
import { box, cyl, mat, jitter, rng, rbox } from './geom.js';
import { Facade, buildBlock } from './building.js';
import * as P from './props.js';

/** Corrugated sheet (w along x, h along y), ribs along y, displacement in +z. */
export function corrugated(w, h, pitch = 0.2, amp = 0.035) {
  const segs = Math.max(2, Math.round(w / pitch) * 4);
  const g = new THREE.PlaneGeometry(w, h, segs, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, Math.sin((x / pitch) * Math.PI * 2) * amp); }
  g.computeVertexNormals();
  return g;
}

/** I-beam along local y of length L. */
function ibeam(B, M, L, s = 0.25, m = 'metal_painted', tint = 0x4a5058) {
  B.add(box(s, L, 0.02), m, M.clone(), { collider: false, tint });
  B.add(box(0.02, L, s), m, M.clone().multiply(mat(s / 2, 0, 0)), { collider: false, tint });
  B.add(box(0.02, L, s), m, M.clone().multiply(mat(-s / 2, 0, 0)), { collider: false, tint });
}

export function warehouse(ctx, [x0, x1, z0, z1], { seed = 12 } = {}) {
  const r = rng(seed); const B = ctx.batch;
  const Hw = 7.2, rh = 2.6, T = 0.25, baseH = 2.4;
  const clad = { tint: 0x7a8a8e }; const cladM = 'metal_painted';
  const doorN = { u0: 0, u1: 0, y0: 0, y1: 5 };
  const sides = [
    { key: 'nz', p0: new THREE.Vector3(x1, 0, z0), n: new THREE.Vector3(0, 0, -1), L: x1 - x0, holes: [{ u0: x1 - (-28), u1: x1 - (-34), y0: -1, y1: 5 }] },
    { key: 'pz', p0: new THREE.Vector3(x0, 0, z1), n: new THREE.Vector3(0, 0, 1), L: x1 - x0, holes: [{ u0: -34 - x0, u1: -28 - x0, y0: -1, y1: 5 }] },
    { key: 'px', p0: new THREE.Vector3(x1, 0, z1), n: new THREE.Vector3(1, 0, 0), L: z1 - z0, holes: [{ u0: z1 - 31.4, u1: z1 - 30.0, y0: -1, y1: 2.2 }] },
    { key: 'nx', p0: new THREE.Vector3(x0, 0, z0), n: new THREE.Vector3(-1, 0, 0), L: z1 - z0, holes: [] },
  ];
  for (const zz of [z0, z1]) { ctx.addSegment([x0, zz], [-34, zz], Hw); ctx.addSegment([-28, zz], [x1, zz], Hw); }
  ctx.addSegment([x1, z0], [x1, 30], Hw); ctx.addSegment([x1, 31.4], [x1, z1], Hw); ctx.addSegment([x0, z0], [x0, z1], Hw);
  for (const S of sides) {
    const F = new Facade(ctx, S.p0, S.n, S.L);
    const isX = S.key === 'px' || S.key === 'nx';
    const lo = isX ? T : 0, hi = isX ? S.L - T : S.L;
    const holes = [...S.holes];
    // clerestory windows on long sides
    if (isX) for (let u = 2.5; u < S.L - 2; u += 3.2) holes.push({ u0: u, u1: u + 2.2, y0: 4.6, y1: 6.2, win: true });
    // inner structural wall (collider)
    F.wall(0, Hw, holes, 'metal_painted', T, { tint: 0x8a9294, surface: 'metal' }, lo, hi, [baseH], { y: baseH, m: 'concrete', out: 0.3, o: { surface: 'concrete', tint: 0xb8b0a4 } });
    // outer corrugated cladding over the rect set above the base
    for (const [u0, u1, a, b] of F.rects(baseH, Hw, holes, lo - (isX ? T : 0) - 0.05, hi + (isX ? T : 0) + 0.05)) {
      const w = u1 - u0, h = b - a; if (w < 0.05 || h < 0.05) continue;
      F.geo(corrugated(w, h, 0.2, 0.03), cladM, (u0 + u1) / 2, (a + b) / 2, 0.36, 0, 0, 0, { collider: false, ...clad });
    }
    // window frames + panes (mostly broken)
    for (const h of holes) if (h.win) {
      F.box(h.u0, h.u1, h.y0 - 0.08, h.y0, -0.1, 0.4, 'metal_painted', { collider: false, tint: 0x3a3a3a });
      for (let k = 0; k <= 4; k++) F.box(h.u0 + k * (h.u1 - h.u0) / 4 - 0.025, h.u0 + k * (h.u1 - h.u0) / 4 + 0.025, h.y0, h.y1, 0.28, 0.33, 'metal_painted', { collider: false, tint: 0x3a3a3a });
      F.box(h.u0, h.u1, (h.y0 + h.y1) / 2 - 0.025, (h.y0 + h.y1) / 2 + 0.025, 0.28, 0.33, 'metal_painted', { collider: false, tint: 0x3a3a3a });
      for (let k = 0; k < 4; k++) if (r() < 0.35) F.plane(h.u0 + k * (h.u1 - h.u0) / 4, h.u0 + (k + 1) * (h.u1 - h.u0) / 4, h.y0, h.y1, 0.3, 'glass', { uv: 'world' });
    }
    // door jambs / header
    for (const h of S.holes) {
      F.box(h.u0 - 0.2, h.u0, 0, h.y1, -T, 0.42, 'metal_painted', { collider: false, tint: 0xa08a30 });
      F.box(h.u1, h.u1 + 0.2, 0, h.y1, -T, 0.42, 'metal_painted', { collider: false, tint: 0xa08a30 });
      F.box(h.u0 - 0.2, h.u1 + 0.2, h.y1, h.y1 + 0.3, -T, 0.42, 'metal_painted', { collider: false, tint: 0x4a4a4a });
      if (h.y1 >= 5) {
        // roll-up door: coil housing + partially lowered slats
        F.geo(cyl(0.35, 0.35, h.u1 - h.u0 + 0.3, 12), 'metal_painted', (h.u0 + h.u1) / 2, h.y1 + 0.45, 0.1, 0, 0, Math.PI / 2, { collider: false, tint: 0x6a7070 });
        const down = S.key === 'pz' ? 2.3 : 3.9;
        for (let y = down; y < h.y1; y += 0.12) F.box(h.u0 + 0.05, h.u1 - 0.05, y, y + 0.11, -0.12, -0.04, 'metal_painted', { collider: true, surface: 'metal', tint: 0x9aa4a0 });
        F.box(h.u0 + 0.05, h.u1 - 0.05, down - 0.08, down, -0.14, -0.02, 'metal_bare', { collider: false });
        // hazard stripes on jambs
        for (let y = 0.1; y < 1.6; y += 0.4) { F.box(h.u0 - 0.21, h.u0 - 0.19, y, y + 0.2, 0.2, 0.42, 'metal_painted', { collider: false, tint: 0x1a1a1a }); F.box(h.u1 + 0.19, h.u1 + 0.21, y, y + 0.2, 0.2, 0.42, 'metal_painted', { collider: false, tint: 0x1a1a1a }); }
      } else {
        F.geo(box(0.9, 2.1, 0.05), 'metal_painted', h.u0 - 0.25, 1.05, 0.5, 0, 1.2, 0, { collider: false, tint: 0x3a4a3a });
      }
    }
    // streaks under windows and base grime
    for (let u = 0; u < S.L - 0.5; u += 3) {
      F.plane(u, u + 3, baseH, baseH + 1.5 + r() * 1.5, 0.42, 'decal_streak_rust');
      F.plane(u, u + 3, 0, 1.2 + r(), 0.31, 'decal_dirt');
    }
    F.box(-0.3, S.L + 0.3, Hw - 0.15, Hw + 0.05, 0, 0.5, 'metal_painted', { collider: false, tint: 0x5a5e60 });
    if (S.key === 'px') {
      // signage on the street-facing wall
      F.box(S.L / 2 - 4.2, S.L / 2 + 4.2, 5.0, 6.4, 0.38, 0.45, 'metal_painted', { collider: false, tint: 0x2a3a4a });
      F.plane(S.L / 2 - 4, S.L / 2 + 4, 5.1, 6.3, 0.46, 'sign11');
    }
  }
  // gable roof along z with missing panels + trusses
  const cx = (x0 + x1) / 2, W = x1 - x0, L = z1 - z0, half = W / 2 + 0.4;
  const slope = Math.atan2(rh, W / 2), len = half / Math.cos(slope);
  const nP = Math.round(L / 2);
  for (const s of [-1, 1]) {
    for (let i = 0; i < nP; i++) {
      const zc = z0 + (i + 0.5) * L / nP;
      const missing = (s < 0 && (i === 3 || i === 4 || i === 9)) || (s > 0 && i === 7);
      if (missing) continue;
      const g = corrugated(len, L / nP + 0.05, 0.25, 0.035);
      const M = mat(cx + s * half / 2, Hw + rh / 2 - 0.4 * Math.tan(slope) / 2, zc, 0, 0, 0).multiply(mat(0, 0, 0, 0, 0, -s * slope)).multiply(mat(0, 0, 0, -Math.PI / 2, 0, 0));
      B.add(g, r() < 0.3 ? 'metal_rusty' : 'metal_painted', M, { surface: 'metal', tint: 0x8a8e88 });
      B.add(g, 'metal_painted', M.clone().multiply(mat(0, 0, -0.04, Math.PI, 0, 0)), { collider: false, tint: 0x6a6e70, shadow: false });
    }
  }
  B.add(box(0.5, 0.12, L + 0.4), 'metal_rusty', mat(cx, Hw + rh + 0.02, (z0 + z1) / 2), { collider: false });
  // gable ends (corrugated triangles approximated with stacked strips)
  for (const zz of [z0, z1]) {
    const sh = new THREE.Shape(); sh.moveTo(-W / 2, 0); sh.lineTo(W / 2, 0); sh.lineTo(0, rh); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.2, bevelEnabled: false });
    B.add(g, cladM, mat(cx, Hw, zz - (zz === z0 ? 0 : 0.2)), { ...clad, surface: 'metal' });
  }
  // trusses & columns
  for (let i = 0; i <= 6; i++) {
    const zc = z0 + 0.4 + i * (L - 0.8) / 6;
    for (const s of [-1, 1]) {
      ibeam(B, mat(cx + s * (W / 2 - 0.45), Hw / 2, zc), Hw);
      B.add(box(len - 0.4, 0.22, 0.14), 'metal_painted', mat(cx + s * half / 2, Hw + rh / 2 - 0.5, zc, 0, 0, -s * slope), { collider: false, tint: 0x4a5058 });
      for (let k = 1; k < 5; k++) { const xx = cx + s * k * W / 10; const yy = Hw - 0.2 + (rh - 0.3) * (1 - k / 5); B.add(box(0.08, yy - Hw + 0.35, 0.08), 'metal_painted', mat(xx, (yy + Hw - 0.35) / 2, zc, 0, 0, s * 0.3 * (k % 2)), { collider: false, tint: 0x4a5058 }); }
    }
    B.add(box(W - 0.8, 0.18, 0.12), 'metal_painted', mat(cx, Hw - 0.3, zc), { collider: false, tint: 0x4a5058 });
    // hanging industrial lamp
    if (i % 2 === 1) {
      B.add(cyl(0.01, 0.01, 1.4, 3), 'metal_bare', mat(cx, Hw - 1.0, zc), { collider: false });
      B.add(cyl(0.08, 0.35, 0.25, 10, true), 'metal_painted', mat(cx, Hw - 1.8, zc), { collider: false, tint: 0x3a4a3a });
    }
  }
  // floor: stained concrete slab
  B.add(box(W - 0.2, 0.06, L - 0.2), 'concrete', mat(cx, 0.03, (z0 + z1) / 2), { surface: 'concrete', tint: 0x9a968e });
  for (let k = 0; k < 10; k++) B.add(new THREE.PlaneGeometry(2 + r() * 3, 2 + r() * 3), r() < 0.5 ? 'decal_oil' : 'decal_stain', mat(x0 + 2 + r() * (W - 4), 0.065, z0 + 2 + r() * (L - 4), -Math.PI / 2, 0, r() * 6), { collider: false, uv: 'keep', shadow: false });
  // mezzanine along west wall + stairs
  const mx0 = x0 + T, mx1 = x0 + 5.5, mz0 = z0 + 4, mz1 = z1 - 4, my = 3.4;
  B.add(box(mx1 - mx0, 0.2, mz1 - mz0), 'metal_bare', mat((mx0 + mx1) / 2, my - 0.1, (mz0 + mz1) / 2), { surface: 'metal', tint: 0x7a7a74 });
  for (let z = mz0 + 0.3; z < mz1; z += 3) ibeam(B, mat(mx1 - 0.2, (my - 0.2) / 2, z), my - 0.2, 0.2);
  for (let z = mz0; z <= mz1 - 0.1; z += 1.2) B.add(box(0.05, 1.05, 0.05), 'metal_painted', mat(mx1 - 0.05, my + 0.52, z), { collider: false, tint: 0xa08a30 });
  const stz0 = mz1 - 7.5; // stairs arrive at stz0+... from south going north? stairs along z at x mx1..mx1+1.2
  B.add(box(0.05, 0.05, mz1 - mz0), 'metal_painted', mat(mx1 - 0.05, my + 1.05, (mz0 + mz1) / 2), { collider: false, tint: 0xa08a30 });
  B.add(box(0.05, 0.05, mz1 - mz0), 'metal_painted', mat(mx1 - 0.05, my + 0.55, (mz0 + mz1) / 2), { collider: false, tint: 0xa08a30 });
  ctx.proxy(0.1, 1.05, mz1 - mz0 - 3.5, mat(mx1 - 0.05, my + 0.52, (mz0 + mz1) / 2 - 1.75), 'metal');
  // stairs: from ground at z = sb (south) up to landing at mz1 - 2 going -z direction onto mezzanine side
  const sx0 = mx1, sx1 = mx1 + 1.3, run = 6.0, n = 18, top = mz1 - 1.0, bottom = top + run;
  for (let i = 0; i < n; i++) {
    const y = (i + 1) * my / n; const z = bottom - (i + 0.5) * run / n;
    B.add(box(sx1 - sx0, 0.05, run / n + 0.02), 'metal_bare', mat((sx0 + sx1) / 2, y - 0.025, z), { collider: false, tint: 0x6a6a64 });
  }
  const sl = Math.atan2(my, run), sLen = Math.hypot(my, run);
  for (const xx of [sx0 + 0.03, sx1 - 0.03]) B.add(box(0.06, 0.25, sLen), 'metal_painted', mat(xx, my / 2, (top + bottom) / 2, sl, 0, 0), { collider: false, tint: 0xa08a30 });
  B.add(box(0.05, 0.05, sLen), 'metal_painted', mat(sx1, my / 2 + 1.0, (top + bottom) / 2, sl, 0, 0), { collider: false, tint: 0xa08a30 });
  // walkable ramp collider under the stairs + landing
  ctx.ramp(sx1 - sx0, sLen, mat((sx0 + sx1) / 2, my / 2 - 0.03, (top + bottom) / 2, sl, 0, 0));
  B.add(box(sx1 - sx0 + 0.1, 0.2, 1.6), 'metal_bare', mat((sx0 + sx1) / 2, my - 0.1, top - 0.8), { surface: 'metal', tint: 0x7a7a74 });
  ctx.addNavElevated([
    [new THREE.Vector3((sx0 + sx1) / 2, 0.05, bottom + 1.0), new THREE.Vector3((sx0 + sx1) / 2, my / 2, (top + bottom) / 2), new THREE.Vector3((sx0 + sx1) / 2, my, top - 0.8), new THREE.Vector3((mx0 + mx1) / 2, my, top - 0.8), new THREE.Vector3((mx0 + mx1) / 2, my, (mz0 + mz1) / 2), new THREE.Vector3((mx0 + mx1) / 2, my, mz0 + 1.5)],
  ]);
  ctx.addCover(new THREE.Vector3(mx1 - 0.6, my, (mz0 + mz1) / 2), new THREE.Vector3(1, 0, 0), 'low');
  // interior clutter: shelving racks, crates, drums, forklift-ish
  for (let k = 0; k < 3; k++) rack(ctx, cx + 3.5, z0 + 5 + k * 6.5, 0, r);
  P.crate(ctx, cx - 3, 0.06, z0 + 8, 0.2, { s: [1.2, 1.0, 1.0], seed: 3 });
  P.crate(ctx, cx - 3, 1.06, z0 + 8, 0.1, { s: [1.0, 0.8, 0.8], seed: 4 });
  P.crate(ctx, cx - 1.6, 0.06, z0 + 8.4, -0.3, { s: [1.0, 0.9, 1.0], seed: 5 });
  P.crate(ctx, cx - 2, 0.06, z1 - 7, 0.5, { s: [1.2, 1.2, 1.2], seed: 6, military: true });
  P.pallet(ctx, cx - 4, 0.06, z1 - 9, 0.3); P.pallet(ctx, cx - 4, 0.21, z1 - 9, 0.35);
  for (let k = 0; k < 5; k++) P.barrel(ctx, x1 - 1.2 - (k % 3) * 0.62, 0.06, z0 + 2 + Math.floor(k / 3) * 0.62, { tint: 0x3a5a3a, rust: k === 2 });
  P.barrel(ctx, x1 - 3, 0, z0 + 4, { tipped: true, yaw: 0.6, rust: true });
  forklift(ctx, cx + 0.5, z1 - 5, 0.9);
  P.sandbags(ctx, cx, z0 + 1.5, 0, 4, 5, { seed: 9 });
  ctx.addCover(new THREE.Vector3(cx, 0, z0 + 2.4), new THREE.Vector3(0, 0, -1), 'low');
}

function rack(ctx, x, z, yaw, r) {
  const B = ctx.batch; const L = 5, D = 1.1, H = 3.6;
  for (const lx of [-L / 2, 0, L / 2]) for (const lz of [-D / 2, D / 2]) B.add(box(0.08, H, 0.08), 'metal_painted', mat(x + lz, H / 2, z + lx), { collider: false, tint: 0x2a4a8a });
  for (const y of [0.15, 1.3, 2.45, 3.5]) {
    for (const lz of [-D / 2, D / 2]) B.add(box(0.1, 0.12, L), 'metal_painted', mat(x + lz, y, z), { collider: false, tint: 0xc07020 });
    B.add(box(D, 0.03, L), 'wood', mat(x, y + 0.07, z), { collider: false, tint: 0x9a8a6a });
    for (let k = 0; k < 4; k++) if (r() < 0.7) {
      const h = 0.4 + r() * 0.6; const w = 0.6 + r() * 0.5;
      B.add(box(D * 0.8, h, w), r() < 0.7 ? 'wood_planks' : 'tarp', mat(x, y + 0.09 + h / 2, z - L / 2 + 0.6 + k * 1.2 + (r() - 0.5) * 0.2), { collider: false, tint: r.pick([0xb09a78, 0xc8b898, 0x8a8a70]) });
    }
  }
  ctx.proxy(D, H, L, mat(x, H / 2, z), 'metal');
  ctx.addObb(x, z, D / 2, L / 2, 0, H, false);
}

function forklift(ctx, x, z, yaw) {
  const B = ctx.batch; const F = (lx, ly, lz, rx = 0, ry = 0, rz = 0) => mat(x, 0, z, 0, yaw, 0).multiply(mat(lx, ly, lz, rx, ry, rz));
  const t = 0xc89a20;
  B.add(rbox(2.0, 0.9, 1.1, 0.08), 'metal_painted', F(0, 0.75, 0), { collider: false, tint: t });
  B.add(rbox(0.6, 0.7, 1.05, 0.1), 'metal_painted', F(0.85, 0.75, 0), { collider: false, tint: 0x2a2a2a });
  for (const s of [-1, 1]) {
    B.add(box(0.06, 1.3, 0.06), 'metal_painted', F(-0.35, 1.85, s * 0.5), { collider: false, tint: 0x2a2a2a });
    B.add(box(0.06, 1.3, 0.06), 'metal_painted', F(0.55, 1.85, s * 0.5, 0, 0, 0.1), { collider: false, tint: 0x2a2a2a });
    B.add(box(0.08, 2.4, 0.1), 'metal_bare', F(-1.1, 1.3, s * 0.35), { collider: false, tint: 0x3a3a3a });
    B.add(box(1.1, 0.05, 0.12), 'metal_bare', F(-1.6, 0.1, s * 0.3), { collider: false, tint: 0x3a3a3a });
    for (const wx of [-0.6, 0.6]) B.add(cyl(0.3, 0.3, 0.25, 12), 'rubber', F(wx, 0.3, s * 0.55, Math.PI / 2), { collider: false });
  }
  B.add(box(1.0, 0.05, 1.1), 'metal_painted', F(0.1, 2.5, 0), { collider: false, tint: 0x2a2a2a });
  B.add(box(0.3, 0.1, 0.4), 'cloth_camo', F(0.2, 1.25, 0), { collider: false, tint: 0x2a2a2a });
  ctx.proxy(2.2, 1.3, 1.2, F(0, 0.65, 0), 'metal');
  ctx.addObb(x, z, 1.2, 0.7, yaw, 1.3);
}

/** Garage row (single storey lock-up garages) along local x, doors facing +z. */
export function garages(ctx, x, z, yaw, n = 6, { seed = 4 } = {}) {
  const r = rng(seed); const B = ctx.batch; const W = 3.2, D = 6, H = 2.7;
  const F = (lx, ly, lz, rx = 0, ry = 0, rz = 0) => mat(x, 0, z, 0, yaw, 0).multiply(mat(lx, ly, lz, rx, ry, rz));
  const L = n * W;
  B.add(box(L, H, 0.3), 'brick', F(0, H / 2, -D + 0.15), { surface: 'concrete' });
  for (let i = 0; i <= n; i++) B.add(box(0.3, H, D), 'brick', F(-L / 2 + i * W, H / 2, -D / 2), { surface: 'concrete' });
  B.add(box(L + 0.4, 0.25, D + 0.4), 'concrete', F(0, H + 0.12, -D / 2 + 0.1), { surface: 'concrete' });
  B.add(box(L + 0.3, 0.06, D + 0.3), 'tarp', F(0, H + 0.27, -D / 2 + 0.1), { collider: false, tint: 0x2a2826 });
  for (let i = 0; i < n; i++) {
    const cx = -L / 2 + (i + 0.5) * W; const tint = r.pick([0x4a6a5a, 0x7a4a3a, 0x5a6a8a, 0x8a8a6a, 0x6a5a4a]);
    const open = r() < 0.25;
    for (const s of [-1, 1]) {
      const g = box(1.3, 2.2, 0.05);
      if (open && s > 0) B.add(g, 'metal_painted', F(cx + 1.45, 1.2, 0.65, 0, -1.3, 0), { collider: false, tint });
      else B.add(g, 'metal_painted', F(cx + s * 0.67, 1.2, -0.1), { collider: !open, surface: 'metal', tint });
      for (let k = 0; k < 3; k++) if (!(open && s > 0)) B.add(box(1.25, 0.06, 0.04), 'metal_painted', F(cx + s * 0.67, 0.4 + k * 0.7, -0.06), { collider: false, tint });
    }
    if (open) {
      for (const [part, pw, ph, M] of [['back', W - 0.3, H, F(cx, H / 2, -D + 0.31)]]) B.add(new THREE.PlaneGeometry(pw, ph), 'void', M, { collider: false, uv: 'keep' });
      B.add(new THREE.PlaneGeometry(W - 0.3, D - 0.4), 'void', F(cx, H - 0.01, -D / 2, Math.PI / 2), { collider: false });
    }
    B.add(box(2.8, 0.25, 0.12), 'concrete', F(cx, 2.4, 0.02), { collider: false });
    B.add(new THREE.PlaneGeometry(0.3, 0.2), 'paint_white', F(cx, 2.4, 0.09), { collider: false, uv: 'keep' });
    B.add(new THREE.PlaneGeometry(W, 1.2 + r()), 'decal_streak_rust', F(cx, 1.6, 0.0), { collider: false, uv: 'keep' });
  }
  const c = Math.cos(yaw), s = Math.sin(yaw);
  ctx.addObb(x + (-D / 2) * s, z + (-D / 2) * c, L / 2, D / 2, yaw, H);
}

/** Collapsed corner of block B: exposed floor slab, sloping slab ramp, rubble. */
export function ruinCorner(ctx, { seed = 21 } = {}) {
  const r = rng(seed); const B = ctx.batch;
  const x0 = 10, x1 = 24, z0 = 10, z1 = 18, sy = 3.3, st = 0.25;
  const wallT = 0.42; const wo = { tint: 0xc8b8a0, surface: 'concrete' };
  // intact first-floor slab (jagged street edge) at x from 14.6..24
  B.add(box(x1 - 14.6 - wallT, st, z1 - z0 - 0.4), 'concrete', mat((14.6 + x1 - wallT) / 2, sy - st / 2, (z0 + z1) / 2 + 0.2), { surface: 'concrete' });
  B.add(box(x1 - 14.6 - wallT, 0.03, z1 - z0 - 0.4), 'tiles', mat((14.6 + x1 - wallT) / 2, sy + 0.005, (z0 + z1) / 2 + 0.2), { collider: false, tint: 0x8a7a6a });
  for (let z = z0 + 0.4; z < z1; z += 0.6) { const g = box(0.4 + r() * 0.5, st, 0.6); jitter(g, 0.08, r); B.add(g, 'concrete', mat(14.5 + r() * 0.3, sy - st / 2 - r() * 0.1, z, 0, 0, (r() - 0.5) * 0.4), { collider: false }); }
  for (let z = z0 + 0.5; z < z1 - 0.3; z += 0.25) B.add(cyl(0.008, 0.008, 0.5 + r() * 0.9, 3), 'metal_rusty', mat(14.3, sy - 0.15, z, 0, 0, Math.PI / 2 + (r() - 0.5) * 0.6), { collider: false });
  // columns + beam under slab
  for (const cz of [z0 + 1.5, z1 - 1.8]) for (const cx of [17.5, 21]) B.add(box(0.4, sy - st, 0.4), 'concrete', mat(cx, (sy - st) / 2, cz), { surface: 'concrete' });
  B.add(box(x1 - 16, 0.45, 0.35), 'concrete', mat((16 + x1) / 2, sy - st - 0.22, z0 + 1.5), { collider: false });
  // ceiling underside plaster
  B.add(box(x1 - 14.8 - wallT, 0.02, z1 - z0 - 0.5), 'plaster', mat((14.8 + x1 - wallT) / 2, sy - st - 0.01, (z0 + z1) / 2 + 0.2), { collider: false, tint: 0x8a8278 });
  // collapsed slab ramp from street (x=7.6,y=0.1) up to slab edge (x=14.8, y=sy)
  const rx0 = 7.4, rx1 = 14.9, rw = 5.0, rz = 13.6;
  const dx = rx1 - rx0, dy = sy - 0.1, len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
  const rampG = box(len, 0.28, rw, 6, 1, 3); jitter(rampG, 0.06, r);
  B.add(rampG, 'concrete', mat((rx0 + rx1) / 2, (0.1 + sy) / 2 - 0.12, rz, 0, 0, ang).multiply(mat(0, 0, 0, 0.04, 0, 0)), { surface: 'concrete' });
  B.add(box(len, 0.03, rw - 0.3), 'tiles', mat((rx0 + rx1) / 2, (0.1 + sy) / 2 + 0.03, rz, 0, 0, ang), { collider: false, tint: 0x7a6a5a });
  for (let i = 0; i < 26; i++) {
    const t = r(), zz = rz + (r() - 0.5) * (rw - 0.4), s0 = 0.12 + r() * 0.35;
    const c = box(s0 * (1 + r()), s0 * 0.6, s0 * (1 + r())); jitter(c, s0 * 0.3, r);
    B.add(c, r.pick(['concrete', 'brick', 'plaster', 'concrete_dark']), mat(rx0 + t * dx, 0.1 + t * dy + 0.14 + s0 * 0.2, zz, r(), r() * 6, r()), { collider: false, tint: 0xd8ccb8 });
  }
  ctx.ramp(len, rw - 0.6, mat((rx0 + rx1) / 2, (0.1 + sy) / 2 - 0.02, rz, 0, 0, ang), true);
  for (let i = 0; i < 12; i++) B.add(cyl(0.008, 0.008, 0.6 + r() * 0.8, 3), 'metal_rusty', mat(rx1 - 0.2, sy - 0.1, rz - rw / 2 + 0.3 + i * 0.38, (r() - 0.5) * 0.8, 0, Math.PI / 2 - 0.3 + (r() - 0.5) * 0.5), { collider: false });
  // remaining ground-floor walls: courtyard side x=24 with doorway, cross-street side z=10 partial
  const Fe = new Facade(ctx, new THREE.Vector3(x1, 0, z1), new THREE.Vector3(1, 0, 0), z1 - z0);
  Fe.wall(0, sy, [{ u0: 3, u1: 4.6, y0: -1, y1: 2.3 }], 'plaster', wallT, wo, 0, z1 - z0);
  // jagged parapet remnant above slab on courtyard side
  for (let u = 0; u < z1 - z0; u += 0.5) { const h = 0.6 + r() * 0.9 * (1 - u / (z1 - z0)) + 0.4; Fe.box(u, u + 0.52, sy, sy + h, -wallT, 0, 'plaster', wo); }
  const Fs = new Facade(ctx, new THREE.Vector3(x1, 0, z0), new THREE.Vector3(0, 0, -1), x1 - x0);
  Fs.wall(0, sy, [{ u0: 2.2, u1: 4.2, y0: 0.9, y1: 2.5 }, { u0: 7, u1: 20, y0: -1, y1: 10 }], 'plaster', wallT, wo, 0, x1 - x0, [0.7], { y: 0.7, m: 'concrete_dark', out: 0.06, o: {} });
  for (let u = 0; u < 6.5; u += 0.45) { const h = 0.9 + r() * 0.6 - u * 0.06; Fs.box(u, u + 0.47, sy, sy + Math.max(0.3, h), -wallT, 0, 'plaster', wo); }
  for (let u = 0; u < 7; u += 0.55) { const g = box(0.5, 0.3 + r() * 0.5, 0.4); jitter(g, 0.1, r); Fs.geo(g, r() < 0.5 ? 'brick' : 'plaster', u + 0.25, sy + 0.9 + r() * 0.4, -0.2, r(), r(), r(), { collider: false, tint: 0xc8b8a0 }); }
  // blown window fill & soot on remaining ground wall
  Fs.plane(1.2, 5.2, 0.5, 3.2, 0.01, 'decal_soot');
  ctx.addCover(new THREE.Vector3(22, sy, z0 + 0.9), new THREE.Vector3(0, 0, -1), 'low');
  ctx.addCover(new THREE.Vector3(x1 - 0.9, sy, 12.5), new THREE.Vector3(1, 0, 0), 'low');
  // sandbag nest on the slab overlooking the intersection
  P.sandbags(ctx, 16.2, 13.5, Math.PI / 2, 3.2, 4, { seed: 31, y0: sy });
  // exposed interior wall of the intact block at z=18: wallpaper bands, slab stubs, jagged upper floors
  const papers = [0x8a6a5a, 0x6a7a6a, 0x9a8a6a, 0x7a6a7a];
  for (let f = 0; f < 4; f++) for (let k = 0; k < 3; k++) {
    const xa = x0 + 0.4 + k * 4.5, ya = f === 0 ? 0.1 : sy + (f - 1) * 3 + 0.05;
    B.add(new THREE.PlaneGeometry(4.2, 2.7), 'plaster', mat(xa + 2.1, ya + 1.35, z1 - 0.005, 0, Math.PI, 0), { collider: false, tint: papers[(f + k) % 4], uv: 'world' });
    B.add(new THREE.PlaneGeometry(4.3, 2.7), 'decal_streak', mat(xa + 2.1, ya + 1.35, z1 - 0.01, 0, Math.PI, 0), { collider: false, uv: 'keep' });
    B.add(box(0.15, 2.7, 0.35), 'plaster', mat(xa + 4.35, ya + 1.35, z1 - 0.17), { collider: false, tint: 0xa09888 });
  }
  for (const y of [sy + 3, sy + 6]) {
    for (let x = x0; x < x1; x += 0.7) { const d = 0.3 + r() * 1.4 * (x > 18 ? 1 : 0.3); const g = box(0.72, 0.24, d); jitter(g, 0.04, r); B.add(g, 'concrete', mat(x + 0.35, y - 0.12, z1 - d / 2, (r() - 0.5) * 0.1), { collider: false }); }
  }
  // hanging 2nd-floor slab piece (bent down)
  B.add(box(4, 0.24, 3.2), 'concrete', mat(22, sy + 2.3, z1 - 1.9, -0.45, 0, 0.1), { surface: 'concrete' });
  // rubble mounds on sidewalk / road & inside
  P.rubble(ctx, 9.5, 9.2, { rx: 3.2, rz: 2.4, h: 1.2, seed: 41, chunks: 50 });
  P.rubble(ctx, 12.5, 17.0, { rx: 2.8, rz: 1.5, h: 1.3, seed: 42, chunks: 30 });
  P.rubble(ctx, 19, 15.5, { rx: 2.0, rz: 1.8, h: 0.7, seed: 43, chunks: 25, block: false });
  ctx.addNavElevated([[new THREE.Vector3(6.5, 0.1, rz), new THREE.Vector3((rx0 + rx1) / 2, (sy + 0.1) / 2, rz), new THREE.Vector3(15.8, sy, rz), new THREE.Vector3(19, sy, 12), new THREE.Vector3(21.5, sy, 16)]]);
  ctx.addSegment([24, 10], [24, 13.4], 3); ctx.addSegment([24, 15], [24, 18], 3); ctx.addSegment([17, 10], [24, 10], 3);
  for (const cz of [z0 + 1.5, z1 - 1.8]) for (const cx of [17.5, 21]) ctx.addObb(cx, cz, 0.2, 0.2, 0, 3, false);
}
