import * as THREE from 'three';
import { box, rbox, cyl, mat, jitter, rng } from './geom.js';

const M = (x, y, z, ry = 0, rx = 0, rz = 0) => mat(x, y, z, rx, ry, rz);
/** local→world helper for a prop at (x,z,yaw,y0) */
function frame(x, z, yaw, y0 = 0) {
  const base = mat(x, y0, z, 0, yaw, 0);
  return (lx, ly, lz, rx = 0, ry = 0, rz = 0) => base.clone().multiply(mat(lx, ly, lz, rx, ry, rz));
}

// ---------------------------------------------------------------- vehicles
function profileShape(pts, wheels, wr) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  // bottom edge from rear to front with wheel arches
  const yb = pts[pts.length - 1][1];
  const ws = [...wheels].sort((a, b) => b - a);
  for (const wx of ws) { s.lineTo(wx + wr, yb); s.absarc(wx, yb, wr, 0, Math.PI, false); }
  s.lineTo(pts[0][0], yb);
  s.closePath();
  return s;
}

/**
 * Detailed car. kind: 'sedan'|'hatch'|'van'. burnt: rusted shell, no glass, sitting on rims.
 */
export function car(ctx, x, z, yaw, { kind = 'sedan', burnt = false, paint = 0x6a7a6a, seed = 1, hoodOpen = false, doorOpen = false, tilt = 0 } = {}) {
  const r = rng(seed); const B = ctx.batch;
  const L = kind === 'van' ? 4.6 : kind === 'hatch' ? 3.8 : 4.3, W = kind === 'van' ? 1.85 : 1.66;
  const sink = burnt ? -0.14 : 0;
  const F = frame(x, z, yaw, sink); const tiltM = mat(0, 0, 0, 0, 0, tilt);
  const P = (lx, ly, lz, rx, ry, rz) => F(0, 0, 0).multiply(tiltM).multiply(mat(lx, ly, lz, rx, ry, rz));
  const body = burnt ? 'metal_rusty' : 'car_paint';
  const bo = { collider: false, tint: burnt ? undefined : paint };
  const wr = 0.34, wb = kind === 'hatch' ? 1.2 : 1.3;
  const hL = L / 2;
  let lower, cabin;
  if (kind === 'van') {
    lower = [[-hL, 0.3], [-hL - 0.02, 0.7], [-hL + 0.25, 0.95], [-hL + 0.7, 1.15], [hL, 1.15], [hL, 0.3]];
    cabin = [[-hL + 0.7, 1.15], [-hL + 1.35, 1.95], [hL - 0.05, 1.98], [hL, 1.15]];
  } else if (kind === 'hatch') {
    lower = [[-hL, 0.3], [-hL - 0.03, 0.62], [-hL + 0.1, 0.78], [-hL + 1.0, 0.9], [hL - 0.15, 0.95], [hL, 0.9], [hL, 0.3]];
    cabin = [[-hL + 1.0, 0.9], [-hL + 1.75, 1.38], [hL - 0.5, 1.4], [hL - 0.12, 0.95]];
  } else {
    lower = [[-hL, 0.3], [-hL - 0.03, 0.62], [-hL + 0.12, 0.78], [-hL + 1.35, 0.9], [hL - 0.75, 0.95], [hL - 0.05, 0.92], [hL, 0.3]];
    cabin = [[-hL + 1.35, 0.9], [-hL + 1.95, 1.36], [hL - 1.35, 1.38], [hL - 0.75, 0.95]];
  }
  const sh = profileShape(lower, [-wb, wb], wr + 0.06);
  const ext = new THREE.ExtrudeGeometry(sh, { depth: W - 0.12, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2, curveSegments: 8 });
  ext.translate(0, 0, -(W - 0.12) / 2);
  B.add(ext, body, P(0, 0, 0), bo);
  // cabin / greenhouse
  const cs = new THREE.Shape(); cs.moveTo(cabin[0][0], cabin[0][1]); for (const p of cabin.slice(1)) cs.lineTo(p[0], p[1]); cs.closePath();
  if (!burnt) {
    const cg = new THREE.ExtrudeGeometry(cs, { depth: W - 0.3, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
    cg.translate(0, 0, -(W - 0.3) / 2);
    B.add(cg, 'glass', P(0, 0, 0), { collider: false });
  }
  // pillars + roof
  const [a0, a1, c1, c0] = cabin;
  const pillar = (p, q, zz) => {
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
    B.add(box(len, 0.07, 0.07), body, P((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, zz, 0, 0, Math.atan2(dy, dx)), bo);
  };
  for (const s of [-1, 1]) {
    const zz = s * (W / 2 - 0.12);
    pillar(a0, a1, zz); pillar(c1, c0, zz);
    const bx = (a0[0] + c0[0]) / 2 + 0.1; pillar([bx, a0[1]], [bx, (a1[1] + c1[1]) / 2], zz);
    B.add(box(c1[0] - a1[0] + 0.1, 0.06, 0.08), body, P((a1[0] + c1[0]) / 2, (a1[1] + c1[1]) / 2, zz), bo);
  }
  const roofG = box(c1[0] - a1[0] + 0.12, 0.05, W - 0.2);
  if (burnt) jitter(roofG, 0.03, r);
  B.add(roofG, body, P((a1[0] + c1[0]) / 2, (a1[1] + c1[1]) / 2 + (burnt ? -0.04 : 0), 0, 0, 0, burnt ? 0.03 : 0), bo);
  // windshield frame cross piece
  B.add(box(0.06, 0.06, W - 0.2), body, P(a0[0], a0[1] + 0.02, 0), bo);
  // bumpers, grille, lights, plates, mirrors
  const bump = burnt ? 'metal_rusty' : 'plastic', bt = burnt ? undefined : 0x2a2a2a;
  B.add(rbox(0.16, 0.2, W + 0.02, 0.05), bump, P(-hL - 0.05, 0.42, 0), { collider: false, tint: bt });
  B.add(rbox(0.16, 0.2, W + 0.02, 0.05), bump, P(hL + 0.05, 0.42, 0), { collider: false, tint: bt });
  B.add(box(0.04, 0.16, 0.8), 'metal_bare', P(-hL - 0.04, 0.66, 0), { collider: false, tint: burnt ? 0x303030 : 0x5a5a5a });
  for (const s of [-1, 1]) {
    B.add(box(0.05, 0.13, 0.3), burnt ? 'void' : 'glass', P(-hL - 0.03, 0.66, s * (W / 2 - 0.3)), { collider: false });
    B.add(box(0.05, 0.12, 0.28), burnt ? 'void' : 'plastic', P(hL + 0.02, 0.72, s * (W / 2 - 0.25)), { collider: false, tint: burnt ? undefined : 0x7a1a14 });
    B.add(rbox(0.12, 0.1, 0.1, 0.02), body, P(a0[0] + 0.1, a0[1] + 0.08, s * (W / 2 + 0.03)), bo);
    // door seams
    B.add(box(0.012, 0.55, 0.01), 'void', P(a0[0] + 0.1, 0.62, s * (W / 2 + 0.005)), { collider: false });
    if (kind !== 'van') B.add(box(0.012, 0.55, 0.01), 'void', P((a0[0] + c0[0]) / 2 + 0.1, 0.62, s * (W / 2 + 0.005)), { collider: false });
    B.add(box(0.14, 0.025, 0.02), 'metal_bare', P(a0[0] + 0.35, 0.8, s * (W / 2 + 0.01)), { collider: false, tint: 0x606060 });
  }
  if (!burnt) {
    B.add(box(0.02, 0.11, 0.5), 'plastic', P(hL + 0.13, 0.5, 0), { collider: false, tint: 0xe8e8e0 });
    B.add(box(0.02, 0.11, 0.5), 'plastic', P(-hL - 0.13, 0.42, 0), { collider: false, tint: 0xe8e8e0 });
  }
  // wheels
  for (const wx of [-wb, wb]) for (const s of [-1, 1]) {
    const wz = s * (W / 2 - 0.12);
    if (burnt) {
      B.add(cyl(0.24, 0.24, 0.16, 12), 'metal_rusty', P(wx, 0.24 + 0.12, wz, Math.PI / 2), { collider: false });
      B.add(new THREE.TorusGeometry(0.22, 0.025, 4, 14), 'metal_rusty', P(wx, 0.36, wz + s * 0.06), { collider: false });
    } else {
      const tg = new THREE.TorusGeometry(0.25, 0.1, 6, 14); tg.scale(1, 1, 1.4);
      B.add(tg, 'rubber', P(wx, wr, wz), { collider: false });
      B.add(cyl(0.2, 0.2, 0.2, 14), 'metal_bare', P(wx, wr, wz, Math.PI / 2), { collider: false, tint: 0x6a6a6a });
      B.add(cyl(0.08, 0.1, 0.22, 8), 'metal_bare', P(wx, wr, wz, Math.PI / 2), { collider: false, tint: 0x3a3a3a });
    }
  }
  // underbody shadow block + interior
  B.add(box(L - 0.4, 0.2, W - 0.3), 'void', P(0, 0.3, 0), { collider: false });
  const seatM = burnt ? 'metal_rusty' : 'cloth_camo', st = burnt ? undefined : 0x3a3530;
  for (const sx of [-0.25, 0.65]) {
    B.add(box(0.5, 0.12, W - 0.4), seatM, P(a0[0] + 0.5 + sx, 0.62, 0), { collider: false, tint: st });
    B.add(box(0.1, 0.55, W - 0.4), seatM, P(a0[0] + 0.78 + sx, 0.9, 0, 0, 0, -0.2), { collider: false, tint: st });
  }
  B.add(new THREE.TorusGeometry(0.17, 0.02, 4, 14), 'rubber', P(a0[0] + 0.3, 1.0, -W / 4, 0, Math.PI / 2, 0).multiply(mat(0, 0, 0, 0, 0, 0.5)), { collider: false });
  B.add(box(0.4, 0.3, W - 0.2), burnt ? 'metal_rusty' : 'plastic', P(a0[0] + 0.1, 0.85, 0), { collider: false, tint: burnt ? undefined : 0x252525 });
  if (hoodOpen) B.add(box(1.2, 0.04, W - 0.1), body, P(-hL + 0.55, 1.15, 0, 0, 0, -0.7).multiply(mat(0.6, 0, 0)), bo);
  if (doorOpen) B.add(box(1.0, 0.6, 0.05), body, P(a0[0] + 0.35, 0.65, W / 2 + 0.35, 0, 0.8, 0).multiply(mat(-0.5, 0, 0)), bo);
  if (burnt) {
    // soot scorch on ground + ash
    B.add(new THREE.PlaneGeometry(L + 1.6, W + 1.6), 'decal_soot', F(0, 0.03 - sink, 0, -Math.PI / 2), { collider: false, uv: 'keep', shadow: false });
  }
  // collision proxies (body + cabin)
  ctx.proxy(L + 0.1, 0.8, W, P(0, 0.62, 0), 'metal');
  ctx.proxy((c0[0] - a0[0]) * 0.8, 0.45, W - 0.2, P((a0[0] + c0[0]) / 2, (a1[1] + a0[1]) / 2 + 0.1, 0), 'metal');
  ctx.addObb(x, z, L / 2 + 0.1, W / 2, yaw, 1.3);
}

/** Bus / heavy truck shell (big silhouette blockers). */
export function bus(ctx, x, z, yaw, { burnt = true, seed = 3 } = {}) {
  const r = rng(seed); const B = ctx.batch; const F = frame(x, z, yaw, burnt ? -0.12 : 0);
  const L = 11, W = 2.5, H = 3.0; const m = burnt ? 'metal_rusty' : 'car_paint';
  // chassis + floor
  B.add(box(L, 0.3, W), m, F(0, 0.75, 0), { collider: false });
  B.add(box(L - 0.4, 0.5, W - 0.4), 'void', F(0, 0.45, 0), { collider: false });
  // side walls: lower panel + window pillars + roof
  for (const s of [-1, 1]) {
    B.add(box(L, 0.9, 0.05), m, F(0, 1.35, s * W / 2), { collider: false });
    B.add(box(L, 0.12, 0.06), m, F(0, 1.85, s * W / 2), { collider: false });
    for (let i = 0; i <= 8; i++) B.add(box(0.1, 1.0, 0.06), m, F(-L / 2 + 0.05 + i * (L - 0.1) / 8, 2.4, s * W / 2), { collider: false });
    B.add(box(L, 0.1, 0.06), m, F(0, 2.9, s * W / 2), { collider: false });
    for (let i = 0; i < 7; i++) if (r() < 0.5) B.add(box(0.3 + r(), 0.2 + r() * 0.3, 0.02), 'void', F(-4 + i * 1.3, 1.2 + r() * 0.4, s * (W / 2 + 0.03)), { collider: false });
  }
  const roof = box(L - 1.5, 0.08, W); jitter(roof, 0.08, r);
  B.add(roof, m, F(0.5, 3.0, 0, 0, 0, 0.02), { collider: false });
  B.add(box(0.06, 1.2, W), m, F(-L / 2, 1.4, 0), { collider: false });
  B.add(box(0.06, 0.12, W), m, F(-L / 2, 2.1, 0), { collider: false });
  B.add(box(0.06, 1.5, W), m, F(L / 2, 1.55, 0), { collider: false });
  B.add(rbox(0.25, 0.3, W + 0.05, 0.08), m, F(-L / 2 - 0.1, 0.6, 0), { collider: false });
  for (const wx of [-L / 2 + 2, L / 2 - 2.5]) for (const s of [-1, 1]) B.add(cyl(0.42, 0.42, 0.25, 14), 'metal_rusty', F(wx, 0.4, s * (W / 2 - 0.2), Math.PI / 2), { collider: false });
  // interior seat frames
  for (let i = 0; i < 9; i++) for (const s of [-1, 1]) B.add(box(0.06, 0.6, 0.9), 'metal_rusty', F(-4 + i * 1.0, 1.2, s * 0.75), { collider: false });
  B.add(new THREE.PlaneGeometry(L + 3, W + 3), 'decal_soot', F(0, 0.15, 0, -Math.PI / 2), { collider: false, uv: 'keep', shadow: false });
  ctx.proxy(L, 2.9, W, F(0, 1.6, 0), 'metal');
  ctx.addObb(x, z, L / 2, W / 2, yaw, 3);
}

// ---------------------------------------------------------------- barriers & cover
let _bagGeo = null;
function bagGeo() {
  if (_bagGeo) return _bagGeo;
  const g = new THREE.BoxGeometry(0.62, 0.17, 0.36, 2, 1, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ex = Math.abs(x) / 0.31, ez = Math.abs(z) / 0.18, ey = Math.abs(y) / 0.085;
    const bulge = (1 - ex * ex * 0.55) * (1 - ez * ez * 0.35);
    p.setXYZ(i, x * (1 - ey * 0.12), y * Math.max(0.25, bulge), z * (1 - ey * ey * 0.18));
  }
  g.computeVertexNormals(); _bagGeo = g; return g;
}
/** Sandbag wall along local x, length L, rows high. */
export function sandbags(ctx, x, z, yaw, L = 3, rows = 5, { seed = 1, curve = 0, cover = true, y0 = 0 } = {}) {
  const r = rng(seed); const B = ctx.batch; const F = frame(x, z, yaw, y0);
  const n = Math.max(1, Math.round(L / 0.58));
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? 0.29 : 0;
    const shrink = row > rows - 2 ? 1 : 0;
    for (let i = 0; i < n - (row % 2) - shrink * (r() < 0.3 ? 1 : 0); i++) {
      const lx = -L / 2 + 0.3 + i * 0.58 + off;
      const lz = curve * (lx / (L / 2)) ** 2;
      const tint = r.pick([0xffffff, 0xe8e0d0, 0xd0c8b8, 0xf0ece0]);
      for (const dz of [-0.19, 0.19]) {
        B.add(bagGeo(), 'sandbag', F(lx + (r() - 0.5) * 0.05, 0.08 + row * 0.155, lz + dz + (r() - 0.5) * 0.04, (r() - 0.5) * 0.04, (r() - 0.5) * 0.12, (r() - 0.5) * 0.06), { collider: false, tint });
      }
    }
  }
  const h = rows * 0.155 + 0.03;
  if (curve === 0) ctx.proxy(L, h, 0.75, F(0, h / 2, 0), 'sandbag');
  else { const segs = 4; for (let k = 0; k < segs; k++) { const a = -L / 2 + (k + 0.5) * L / segs; ctx.proxy(L / segs + 0.1, h, 0.75, F(a, h / 2, curve * (a / (L / 2)) ** 2, 0, -Math.atan(2 * curve * a / (L / 2) ** 2)), 'sandbag'); } }
  if (y0 === 0) ctx.addObb(x, z, L / 2, 0.4 + Math.abs(curve) / 2, yaw, h, cover);
}

/** Concrete jersey barrier (length 3 m). */
let _jerseyGeo = null;
export function jersey(ctx, x, z, yaw, { tint, paint = false } = {}) {
  if (!_jerseyGeo) {
    const s = new THREE.Shape();
    const pts = [[-0.31, 0], [0.31, 0], [0.31, 0.08], [0.19, 0.3], [0.09, 0.81], [-0.09, 0.81], [-0.19, 0.3], [-0.31, 0.08]];
    s.moveTo(...pts[0]); for (const p of pts.slice(1)) s.lineTo(...p); s.closePath();
    _jerseyGeo = new THREE.ExtrudeGeometry(s, { depth: 2.9, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.02, bevelSegments: 1 });
    _jerseyGeo.translate(0, 0, -1.45); _jerseyGeo.rotateY(Math.PI / 2);
  }
  const F = frame(x, z, yaw);
  ctx.batch.add(_jerseyGeo, 'concrete', F(0, 0, 0), { surface: 'concrete', tint });
  if (paint) for (let i = 0; i < 3; i++) ctx.batch.add(new THREE.PlaneGeometry(0.4, 0.3), 'paint_white', F(-1 + i * 1, 0.55, 0.13, -0.2, 0, 0.6), { collider: false, uv: 'keep' });
  // lifting holes
  ctx.batch.add(box(0.2, 0.06, 0.64), 'void', F(-0.9, 0.04, 0), { collider: false });
  ctx.batch.add(box(0.2, 0.06, 0.64), 'void', F(0.9, 0.04, 0), { collider: false });
  ctx.addObb(x, z, 1.5, 0.32, yaw, 0.81);
}

/** HESCO bastion row: n cells of 1.05 m. */
export function hesco(ctx, x, z, yaw, n = 3, { h = 1.4, seed = 2 } = {}) {
  const r = rng(seed); const F = frame(x, z, yaw); const B = ctx.batch;
  for (let i = 0; i < n; i++) {
    const lx = (i - (n - 1) / 2) * 1.07;
    const g = new THREE.BoxGeometry(1.02, h, 1.02, 2, 3, 2); jitter(g, 0.04, r);
    B.add(g, 'sandbag', F(lx, h / 2, 0, 0, (r() - 0.5) * 0.05), { surface: 'sandbag', tint: 0xc8b898 });
    B.add(box(1.06, h + 0.02, 1.06), 'wiregrid', F(lx, h / 2 + 0.01, 0), { collider: false, uvScale: 4 });
    for (const sx of [-0.53, 0.53]) for (const sz of [-0.53, 0.53]) B.add(box(0.04, h + 0.03, 0.04), 'metal_bare', F(lx + sx, h / 2, sz), { collider: false, tint: 0x8a8a80 });
    // dirt fill on top
    const top = cyl(0.5, 0.52, 0.12, 8); jitter(top, 0.06, r);
    B.add(top, 'dirt', F(lx, h + 0.02, 0), { collider: false });
  }
  ctx.addObb(x, z, n * 0.53, 0.53, yaw, h, h < 1.5);
}

/** Czech hedgehog tank trap. */
export function hedgehog(ctx, x, z, yaw) {
  const F = frame(x, z, yaw); const B = ctx.batch;
  const g = box(0.14, 0.14, 2.0);
  const rots = [[0.6, 0, 0], [0.6, 2.1, 0], [0.6, 4.2, 0]];
  for (const [rx, ry] of rots) B.add(g, 'metal_rusty', F(0, 0.55, 0, 0, ry, 0).multiply(mat(0, 0, 0, rx + Math.PI / 4)), { collider: false });
  ctx.proxy(1.2, 1.1, 1.2, F(0, 0.55, 0), 'metal');
  ctx.addObb(x, z, 0.7, 0.7, yaw, 1.1, false);
}

// ---------------------------------------------------------------- clutter
export function crate(ctx, x, y, z, yaw, { s = [1, 0.8, 0.8], military = false, seed = 1 } = {}) {
  const F = frame(x, z, yaw, y); const B = ctx.batch; const [w, h, d] = s; const r = rng(seed);
  if (military) {
    B.add(rbox(w, h, d, 0.02), 'metal_painted', F(0, h / 2, 0), { surface: 'wood', tint: r.pick([0x5a6a48, 0x4a5540, 0x62704e]) });
    B.add(box(w + 0.02, 0.04, d + 0.02), 'metal_painted', F(0, h - 0.12, 0), { collider: false, tint: 0x3a4232 });
    for (const sx of [-1, 1]) B.add(box(0.1, 0.05, 0.12), 'metal_bare', F(sx * (w / 2 + 0.02), h * 0.6, 0), { collider: false });
  } else {
    B.add(box(w - 0.04, h - 0.04, d - 0.04), 'wood_planks', F(0, h / 2, 0), { surface: 'wood', tint: 0xb0a080 });
    const bt = 0x8a7a60;
    for (const sy of [0.05, h - 0.05]) for (const sz of [-1, 1]) B.add(box(w, 0.1, 0.03), 'wood', F(0, sy, sz * (d / 2 - 0.005)), { collider: false, tint: bt });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(box(0.1, h, 0.03), 'wood', F(sx * (w / 2 - 0.05), h / 2, sz * (d / 2 - 0.005)), { collider: false, tint: bt });
    for (const sz of [-1, 1]) B.add(box(Math.hypot(w, h) - 0.15, 0.09, 0.025), 'wood', F(0, h / 2, sz * (d / 2 + 0.01), 0, 0, Math.atan2(h, w) * (r() < 0.5 ? 1 : -1)), { collider: false, tint: bt });
  }
  if (y === 0) ctx.addObb(x, z, w / 2, d / 2, yaw, h, h >= 0.7 && h < 1.6);
}

export function barrel(ctx, x, y, z, { tint = 0x2a4a6a, rust = false, tipped = false, yaw = 0 } = {}) {
  const B = ctx.batch; const m = rust ? 'metal_rusty' : 'metal_painted';
  const T = tipped ? mat(x, 0.3, z, 0, yaw, Math.PI / 2).multiply(mat(0, -0.44, 0)) : mat(x, y, z, 0, yaw, 0);
  B.add(cyl(0.29, 0.29, 0.88, 16), m, T.clone().multiply(mat(0, 0.44, 0)), { surface: 'metal', tint: rust ? undefined : tint });
  for (const yy of [0.02, 0.3, 0.58, 0.86]) B.add(cyl(0.3, 0.3, 0.03, 14, true), m, T.clone().multiply(mat(0, yy, 0, Math.PI / 2)), { collider: false, tint: rust ? undefined : tint });
  B.add(cyl(0.27, 0.27, 0.02, 14), 'metal_rusty', T.clone().multiply(mat(0, 0.885, 0)), { collider: false });
  if (!tipped) ctx.addObb(x, z, 0.3, 0.3, 0, 0.9, false);
}

export function pallet(ctx, x, y, z, yaw) {
  const F = frame(x, z, yaw, y); const B = ctx.batch; const t = 0xa08f70;
  for (let i = 0; i < 7; i++) B.add(box(0.1, 0.022, 1.2), 'wood', F(-0.5 + i * 0.1667, 0.133, 0), { collider: false, tint: t });
  for (const sz of [-0.5, 0, 0.5]) B.add(box(1.0, 0.1, 0.1), 'wood', F(0, 0.07, sz), { collider: false, tint: 0x8a7a5a });
  for (let i = 0; i < 3; i++) B.add(box(0.1, 0.022, 1.2), 'wood', F(-0.45 + i * 0.45, 0.011, 0), { collider: false, tint: t });
}

export function tire(ctx, x, y, z, flat = true, rot = 0) {
  const g = new THREE.TorusGeometry(0.3, 0.11, 8, 16); g.scale(1, 1, 1.5);
  ctx.batch.add(g, 'rubber', flat ? mat(x, y + 0.11, z, Math.PI / 2, rot, 0) : mat(x, y + 0.4, z, 0, rot, 0.2), { collider: false });
}

export function dumpster(ctx, x, z, yaw, { tint = 0x3a5a4a } = {}) {
  const F = frame(x, z, yaw); const B = ctx.batch;
  const s = new THREE.Shape(); s.moveTo(-0.9, 0); s.lineTo(0.9, 0); s.lineTo(1.0, 1.2); s.lineTo(-1.0, 1.2); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.1, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 }); g.translate(0, 0.15, -0.55);
  B.add(g, 'metal_painted', F(0, 0, 0), { surface: 'metal', tint });
  B.add(box(2.05, 0.05, 1.2), 'metal_painted', F(0, 1.45, -0.2, -0.5), { collider: false, tint: tint });
  for (const sx of [-0.8, 0.8]) for (const sz of [-0.45, 0.45]) B.add(cyl(0.07, 0.07, 0.06, 8), 'rubber', F(sx, 0.08, sz, Math.PI / 2), { collider: false });
  B.add(box(1.9, 0.3, 1.0), 'tarp', F(0, 1.3, 0), { collider: false, tint: 0x202020 });
  ctx.addObb(x, z, 1.0, 0.6, yaw, 1.4);
}

export function trashBags(ctx, x, z, n, seed) {
  const r = rng(seed); const B = ctx.batch;
  for (let i = 0; i < n; i++) {
    const g = new THREE.SphereGeometry(0.28, 8, 6); jitter(g, 0.12, r); g.scale(1, 0.7 + r() * 0.3, 1);
    B.add(g, 'plastic', mat(x + (r() - 0.5) * 1.4, 0.18 + (i > 4 ? 0.25 : 0), z + (r() - 0.5) * 1.2, 0, r() * 6, 0), { collider: false, tint: r.pick([0x1a1a1a, 0x222428, 0x2a3a5a, 0x5a5a50]) });
  }
}

/** Shipping container 6 m (or 12) with corrugated sides and doors. */
export function container(ctx, x, y, z, yaw, { len = 6.06, tint = 0x8a3a2a, open = false } = {}) {
  const F = frame(x, z, yaw, y); const B = ctx.batch; const W = 2.44, H = 2.59;
  const o = { collider: false, tint };
  B.add(box(len - 0.1, H - 0.1, W - 0.1), 'metal_painted', F(0, H / 2, 0), { surface: 'metal', tint });
  // corrugation: vertical ribs on the long sides
  for (let lx = -len / 2 + 0.2; lx < len / 2 - 0.1; lx += 0.28) for (const s of [-1, 1]) B.add(box(0.13, H - 0.25, 0.05), 'metal_painted', F(lx, H / 2, s * (W / 2 - 0.03), 0, s * 0.35), o);
  // frame posts & rails
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(box(0.16, H, 0.16), 'metal_painted', F(sx * (len / 2 - 0.08), H / 2, sz * (W / 2 - 0.08)), o);
  for (const sy of [0.07, H - 0.07]) for (const sz of [-1, 1]) B.add(box(len, 0.14, 0.14), 'metal_painted', F(0, sy, sz * (W / 2 - 0.07)), o);
  // door end: bars
  for (const sz of [-0.8, -0.35, 0.35, 0.8]) B.add(cyl(0.025, 0.025, H - 0.3, 6), 'metal_bare', F(len / 2 + 0.02, H / 2, sz), { collider: false });
  // roof ribs
  for (let lx = -len / 2 + 0.3; lx < len / 2; lx += 0.5) B.add(box(0.2, 0.04, W - 0.2), 'metal_painted', F(lx, H - 0.02, 0), o);
  B.add(box(len * 0.6, 0.02, W * 0.8), 'decal_streak_rust', F(0, H + 0.01, 0), { collider: false, uv: 'keep' });
  ctx.addObb(x, z, len / 2, W / 2, yaw, H + y);
}

// ---------------------------------------------------------------- street furniture
export function streetLamp(ctx, x, z, yaw, { h = 8, broken = false } = {}) {
  const F = frame(x, z, yaw); const B = ctx.batch;
  B.add(cyl(0.09, 0.16, h, 8), 'concrete', F(0, h / 2, 0), { surface: 'concrete', tint: 0xb0aca4 });
  B.add(cyl(0.2, 0.22, 0.6, 8), 'concrete', F(0, 0.3, 0), { collider: false });
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, h - 0.4, 0), new THREE.Vector3(0, h + 0.5, 0.2), new THREE.Vector3(0, h + 0.35, 1.8));
  B.add(new THREE.TubeGeometry(curve, 10, 0.045, 6), 'metal_painted', F(0, 0, 0), { collider: false, tint: 0x5a5e5a });
  B.add(rbox(0.35, 0.14, 0.7, 0.05), 'metal_painted', F(0, h + 0.3, 2.0, broken ? 0.5 : 0.08), { collider: false, tint: 0x4a4e4a });
  if (!broken) B.add(box(0.26, 0.04, 0.5), 'lamp_glass', F(0, h + 0.22, 2.0, 0.08), { collider: false });
  ctx.addObb(x, z, 0.2, 0.2, 0, h, false);
}

/** Concrete power pole (returns attachment points for wires, world space). */
export function powerPole(ctx, x, z, yaw, { h = 9.5, lean = 0, wood = false } = {}) {
  const F = frame(x, z, yaw); const B = ctx.batch;
  const base = F(0, 0, 0).multiply(mat(0, 0, 0, lean, 0, lean * 0.5));
  const P = (lx, ly, lz, rx = 0, ry = 0, rz = 0) => base.clone().multiply(mat(lx, ly, lz, rx, ry, rz));
  if (wood) B.add(cyl(0.12, 0.15, h, 8), 'wood', P(0, h / 2, 0), { surface: 'wood', tint: 0x6a5a48 });
  else {
    B.add(box(0.2, h, 0.3), 'concrete', P(0, h / 2, 0), { surface: 'concrete', tint: 0xa8a49c });
    for (let y = 1.5; y < h - 1; y += 0.9) B.add(box(0.22, 0.25, 0.1), 'void', P(0, y, 0), { collider: false });
  }
  const arms = [h - 0.3, h - 1.3];
  const pts = [];
  for (const [k, ay] of arms.entries()) {
    const aw = k === 0 ? 1.8 : 1.3;
    B.add(box(0.1, 0.1, aw), 'metal_rusty', P(0, ay, 0), { collider: false });
    B.add(box(0.05, 0.05, aw * 0.7), 'metal_rusty', P(0, ay - 0.35, 0, 0.45), { collider: false });
    for (const lz of k === 0 ? [-0.8, 0, 0.8] : [-0.55, 0.55]) {
      B.add(cyl(0.05, 0.06, 0.18, 8), 'plastic', P(0, ay + 0.13, lz), { collider: false, tint: 0xd0d8c8 });
      pts.push(new THREE.Vector3(0, ay + 0.23, lz).applyMatrix4(base));
    }
  }
  // transformer can or junction box sometimes
  if ((x * 7 + z) % 3 < 1) B.add(cyl(0.3, 0.3, 0.9, 10), 'metal_painted', P(0.35, h - 3, 0), { collider: false, tint: 0x6a726a });
  ctx.addObb(x, z, 0.2, 0.2, 0, h, false);
  return pts;
}

/** Sagging catenary cable between two world points. */
export function cable(ctx, a, b, sag = 0.8, r = 0.012) {
  const pts = []; const n = 16;
  for (let i = 0; i <= n; i++) {
    const t = i / n; const p = a.clone().lerp(b, t); p.y -= sag * 4 * t * (1 - t); pts.push(p);
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  ctx.batch.add(new THREE.TubeGeometry(curve, 20, Math.max(r, 0.012), 4), 'cable', null, { collider: false, uv: 'keep' });
}

export function bench(ctx, x, z, yaw, broken = false) {
  const F = frame(x, z, yaw); const B = ctx.batch;
  for (const sx of [-0.8, 0.8]) { B.add(box(0.08, 0.45, 0.5), 'concrete', F(sx, 0.22, 0), { collider: false }); }
  for (let i = 0; i < 3; i++) if (!(broken && i === 1)) B.add(box(1.9, 0.04, 0.12), 'wood', F(0, 0.47, -0.16 + i * 0.15), { collider: false, tint: 0x8a6a4a });
  for (let i = 0; i < 2; i++) B.add(box(1.9, 0.1, 0.03), 'wood', F(0, 0.65 + i * 0.14, -0.26, -0.15), { collider: false, tint: 0x8a6a4a });
}

/** Chain-link fence from a to b (2D points [x,z]). */
export function chainFence(ctx, a, b, { h = 2.2, gapAt = null, sag = 0 } = {}) {
  const B = ctx.batch; const dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz); const yaw = Math.atan2(-dz, dx);
  const n = Math.max(1, Math.round(L / 2.5));
  for (let i = 0; i <= n; i++) {
    const t = i / n; const px = a[0] + dx * t, pz = a[1] + dz * t;
    B.add(cyl(0.035, 0.035, h + 0.1, 6), 'metal_bare', mat(px, (h + 0.1) / 2, pz, 0, 0, i === 2 ? 0.08 : 0), { collider: false, tint: 0x8a8a84 });
  }
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  B.add(cyl(0.025, 0.025, L, 6), 'metal_bare', mat(mx, h, mz, 0, yaw, Math.PI / 2), { collider: false, tint: 0x8a8a84 });
  const plane = new THREE.PlaneGeometry(L, h - 0.1, 8, 1);
  if (sag) { const p = plane.attributes.position; for (let i = 0; i < p.count; i++) { const t = p.getX(i) / L + 0.5; p.setZ(i, Math.sin(t * Math.PI) * sag); } plane.computeVertexNormals(); }
  B.add(plane, 'chainlink', mat(mx, h / 2, mz, 0, yaw, 0), { collider: false, uvScale: 2, shadow: true });
  // barbed wire strand on top
  B.add(cyl(0.008, 0.008, L, 3), 'metal_rusty', mat(mx, h + 0.15, mz, 0, yaw, Math.PI / 2), { collider: false });
  ctx.proxy(L, h, 0.08, mat(mx, h / 2, mz, 0, yaw, 0), 'metal');
  ctx.addSegment(a, b, h);
}

/** Soviet concrete panel fence (PO-2 style with relief). */
let _panelGeo = null;
function panelGeo() {
  if (_panelGeo) return _panelGeo;
  const parts = [];
  parts.push(new THREE.BoxGeometry(3.9, 2.4, 0.14).translate(0, 1.2, 0));
  const cone = new THREE.ConeGeometry(0.12, 0.05, 4, 1); cone.rotateX(Math.PI / 2); cone.rotateZ(Math.PI / 4);
  const cone2 = new THREE.ConeGeometry(0.3, 0.06, 4, 1); cone2.rotateX(Math.PI / 2); cone2.rotateZ(Math.PI / 4);
  for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) for (const s of [-1, 1]) {
    const c = cone2.clone(); if (s < 0) c.rotateY(Math.PI);
    c.translate(-1.5 + i * 0.75, 0.55 + j * 0.65, s * 0.085); parts.push(c);
  }
  parts.push(new THREE.BoxGeometry(3.9, 0.12, 0.2).translate(0, 2.4, 0));
  const g = mergeAll(parts); _panelGeo = g; return g;
}
function mergeAll(parts) {
  const ps = parts.map((p) => { const q = p.index ? p.toNonIndexed() : p; for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal') q.deleteAttribute(k); return q; });
  let total = 0; for (const p of ps) total += p.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3); let o = 0;
  for (const p of ps) { pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); o += p.attributes.position.count; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}
export function panelFence(ctx, a, b, { skip = [], seed = 5, lean = [] } = {}) {
  const r = rng(seed); const B = ctx.batch; const dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz); const yaw = Math.atan2(-dz, dx);
  const n = Math.round(L / 4);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n; const px = a[0] + dx * t, pz = a[1] + dz * t;
    if (!skip.includes(i)) {
      const ln = lean.includes(i) ? 0.25 : 0;
      B.add(panelGeo(), 'concrete', mat(px, 0, pz, ln, yaw, (r() - 0.5) * 0.01), { surface: 'concrete', tint: r.pick([0xffffff, 0xe0dcd4, 0xd0ccc4]) });
      B.add(new THREE.PlaneGeometry(3.9, 1.2 + r()), 'decal_streak', mat(px, 1.7, pz, 0, yaw, 0).multiply(mat(0, 0, 0.16)), { collider: false, uv: 'keep' });
    }
    const t0 = i / n; B.add(box(0.3, 2.7, 0.3), 'concrete', mat(a[0] + dx * t0, 1.35, a[1] + dz * t0, 0, yaw, 0), { surface: 'concrete', tint: 0xc8c4bc });
  }
  B.add(box(0.3, 2.7, 0.3), 'concrete', mat(b[0], 1.35, b[1], 0, yaw, 0), { surface: 'concrete', tint: 0xc8c4bc });
  ctx.addSegment(a, b, 2.5);
}

// ---------------------------------------------------------------- nature
export function tree(ctx, x, z, { seed = 1, h = 8, leaves = 0.35 } = {}) {
  const r = rng(seed); const B = ctx.batch; const leafPts = [];
  const up = new THREE.Vector3(0, 1, 0);
  const grow = (p, dir, len, rad, depth) => {
    // slightly kinked limb: two segments
    const mid = p.clone().addScaledVector(dir, len * 0.5);
    const d2 = dir.clone().add(new THREE.Vector3((r() - 0.5) * 0.35, 0.05, (r() - 0.5) * 0.35)).normalize();
    const end = mid.clone().addScaledVector(d2, len * 0.5);
    const segs = depth >= 3 ? [[p, mid, rad, rad * 0.85], [mid, end, rad * 0.85, rad * 0.7]] : [[p, end, rad, rad * 0.7]];
    for (const [a, b, ra, rb] of segs) {
      const v = b.clone().sub(a); const l = v.length(); v.normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(up, v);
      const g = cyl(rb, ra, l, depth > 3 ? 7 : depth > 2 ? 5 : 3, true);
      B.add(g, 'wood', new THREE.Matrix4().compose(a.clone().addScaledVector(v, l / 2), q, new THREE.Vector3(1, 1, 1)), { collider: false, tint: 0x5a5048 });
    }
    if (depth <= 0 || rad < 0.012) { leafPts.push(end); return; }
    const kids = depth >= 4 ? 3 : 2 + (r() < 0.4 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      const leader = k === 0;
      const spread = leader ? 0.35 : 1.1 + (4 - depth) * 0.1;
      const nd = d2.clone().add(new THREE.Vector3((r() - 0.5) * spread * 2, leader ? 0.3 : 0.15 + r() * 0.4, (r() - 0.5) * spread * 2)).normalize();
      grow(end, nd, len * (leader ? 0.8 : 0.6 + r() * 0.15), rad * (leader ? 0.72 : 0.55), depth - 1);
    }
    if (depth <= 2) leafPts.push(end);
  };
  const trunkH = h * 0.32;
  grow(new THREE.Vector3(x, -0.1, z), new THREE.Vector3((r() - 0.5) * 0.12, 1, (r() - 0.5) * 0.12).normalize(), trunkH, 0.16 + h * 0.008, 5);
  for (const p of leafPts) if (r() < leaves) { const s = 0.7 + r() * 0.8; ctx.inst('leaf', mat(p.x, p.y, p.z, r() * 3, r() * 6, r() * 3, s, s, s)); }
  ctx.proxy(0.4, trunkH, 0.4, mat(x, trunkH / 2, z), 'wood');
  ctx.addObb(x, z, 0.25, 0.25, 0, h, false);
}

/** Rubble mound + chunks. walkable mound collider. */
export function rubble(ctx, x, z, { rx = 3, rz = 2.5, h = 1.5, seed = 1, brick = true, yaw = 0, chunks = 40, block = true } = {}) {
  const r = rng(seed); const B = ctx.batch;
  const g = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const n = 1 + (Math.sin(vx * 5.1 + seed) * Math.cos(vz * 4.3 + seed * 2) * 0.18) + (r() - 0.5) * 0.12;
    p.setXYZ(i, vx * rx * n, Math.max(0, vy * h * n * (0.6 + 0.4 * vy)) - 0.05, vz * rz * n);
  }
  g.computeVertexNormals();
  B.add(g, 'rubble', mat(x, 0, z, 0, yaw, 0), { surface: 'dirt' });
  const cm = ['concrete', 'concrete', brick ? 'brick' : 'concrete_dark', 'plaster', 'concrete_dark'];
  for (let i = 0; i < chunks; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.95;
    const lx = Math.cos(a) * d * rx, lz = Math.sin(a) * d * rz;
    const hy = h * Math.sqrt(Math.max(0, 1 - d * d)) * 0.85;
    const s = 0.15 + r() * (i < 6 ? 0.9 : 0.35);
    const cg = box(s * (1 + r()), s * (0.4 + r() * 0.5), s * (1 + r())); jitter(cg, s * 0.3, r);
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    B.add(cg, r.pick(cm), mat(x + lx * c + lz * sn, hy, z - lx * sn + lz * c, r() * 3, r() * 6, r() * 3), { collider: false });
  }
  // rebar
  for (let i = 0; i < 5; i++) {
    const a = r() * 6.28, d = r() * 0.6;
    B.add(cyl(0.01, 0.01, 1 + r() * 1.5, 4), 'metal_rusty', mat(x + Math.cos(a) * d * rx, h * 0.5, z + Math.sin(a) * d * rz, (r() - 0.5) * 2, r() * 6, (r() - 0.5) * 2), { collider: false });
  }
  for (let i = 0; i < chunks * 2; i++) {
    const a = r() * 6.28, d = 0.9 + r() * 0.5; ctx.inst('debris', mat(x + Math.cos(a) * d * rx, 0.03, z + Math.sin(a) * d * rz, r() * 3, r() * 6, r() * 3, 0.5 + r() * 1.5, 0.5 + r(), 0.5 + r() * 1.5));
  }
  if (block) ctx.addObb(x, z, rx * 0.8, rz * 0.8, yaw, h);
}

export function manhole(ctx, x, z) {
  ctx.batch.add(cyl(0.34, 0.34, 0.02, 20), 'metal_rusty', mat(x, 0.03, z), { collider: false });
  ctx.batch.add(new THREE.TorusGeometry(0.36, 0.03, 4, 20), 'metal_bare', mat(x, 0.03, z, Math.PI / 2), { collider: false, tint: 0x505050 });
}

export function kiosk(ctx, x, z, yaw, { tint = 0x4a6a8a, sign = 0 } = {}) {
  const F = frame(x, z, yaw); const B = ctx.batch;
  B.add(box(3, 0.2, 2.2), 'concrete', F(0, 0.1, 0), { surface: 'concrete' });
  B.add(box(3, 1.0, 0.06), 'metal_painted', F(0, 0.7, 1.07), { collider: false, tint });
  for (const s of [-1, 1]) B.add(box(0.06, 2.6, 2.2), 'metal_painted', F(s * 1.47, 1.5, 0), { collider: false, tint });
  B.add(box(3, 2.6, 0.06), 'metal_painted', F(0, 1.5, -1.07), { collider: false, tint });
  for (let i = 0; i < 4; i++) B.add(box(0.05, 1.4, 0.05), 'metal_painted', F(-1.45 + i * 0.97, 1.9, 1.07), { collider: false, tint });
  B.add(new THREE.PlaneGeometry(2.9, 1.3), 'glass', F(0, 1.9, 1.02), { collider: false });
  B.add(box(3.4, 0.12, 2.6), 'metal_painted', F(0, 2.85, 0.1, 0.05), { collider: false, tint: 0x5a5a58 });
  B.add(new THREE.PlaneGeometry(2.8, 0.45), 'sign' + sign, F(0, 2.55, 1.11), { collider: false, uv: 'keep' });
  ctx.proxy(3, 2.8, 2.2, F(0, 1.4, 0), 'metal');
  ctx.addObb(x, z, 1.5, 1.1, yaw, 2.8);
}

export function wreckedTruck(ctx, x, z, yaw, { seed = 7 } = {}) {
  // military/utility truck: cab + flatbed with tarp frame
  const r = rng(seed); const F = frame(x, z, yaw, -0.1); const B = ctx.batch; const m = 'metal_rusty';
  B.add(box(6.5, 0.3, 1.0), m, F(0, 0.8, 0), { collider: false });
  B.add(rbox(1.8, 1.4, 2.3, 0.08), m, F(-2.5, 1.7, 0), { collider: false });
  B.add(rbox(1.0, 0.8, 2.2, 0.06), m, F(-3.6, 1.35, 0), { collider: false });
  B.add(box(0.05, 0.55, 2.0), 'void', F(-3.4 + 0.0, 2.1, 0, 0, 0, 0.12), { collider: false });
  B.add(box(4.3, 0.12, 2.4), 'wood_planks', F(1.1, 1.1, 0), { collider: false, tint: 0x5a4a3a });
  for (const s of [-1, 1]) B.add(box(4.3, 0.5, 0.06), 'wood_planks', F(1.1, 1.4, s * 1.2), { collider: false, tint: 0x4a3a2a });
  for (let i = 0; i < 4; i++) { const g = new THREE.TorusGeometry(1.15, 0.03, 4, 12, Math.PI); B.add(g, 'metal_rusty', F(-0.8 + i * 1.3, 1.65, 0, 0, Math.PI / 2, 0), { collider: false }); }
  const tarp = new THREE.PlaneGeometry(2.4, 1.6, 6, 4); jitter(tarp, 0.15, r);
  B.add(tarp, 'tarp', F(2.0, 2.4, 0.3, -Math.PI / 2 + 0.2, 0, 0.3), { collider: false });
  for (const wx of [-2.5, 0.8, 2.2]) for (const s of [-1, 1]) B.add(cyl(0.5, 0.5, 0.35, 14), wx === -2.5 && s > 0 ? 'metal_rusty' : 'rubber', F(wx, 0.5, s * 1.05, Math.PI / 2), { collider: false });
  B.add(new THREE.PlaneGeometry(9, 4.5), 'decal_soot', F(0, 0.13, 0, -Math.PI / 2), { collider: false, uv: 'keep', shadow: false });
  ctx.proxy(7.5, 2.4, 2.4, F(-0.2, 1.3, 0), 'metal');
  ctx.addObb(x, z, 3.8, 1.25, yaw, 2.5);
}
