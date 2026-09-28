import * as THREE from 'three';
import { box, rbox, cyl, mat, rng } from './geom.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Inward-facing 5-sided room (x across, y from 0 up, z from 0 back to -dep). */
function roomParts(w, h, dep) {
  const parts = [];
  const P = (pw, ph, m) => { const g = new THREE.PlaneGeometry(pw, ph); g.applyMatrix4(m); return g; };
  parts.push(['back', P(w, h, mat(0, h / 2, -dep))]);
  parts.push(['side', P(dep, h, mat(-w / 2, h / 2, -dep / 2, 0, Math.PI / 2))]);
  parts.push(['side', P(dep, h, mat(w / 2, h / 2, -dep / 2, 0, -Math.PI / 2))]);
  parts.push(['floor', P(w, dep, mat(0, 0, -dep / 2, -Math.PI / 2))]);
  parts.push(['ceil', P(w, dep, mat(0, h, -dep / 2, Math.PI / 2))]);
  return parts;
}

/** A planar facade frame: u along the wall (viewer's right), y up, d along outward normal. */
export class Facade {
  constructor(ctx, p0, n, L) {
    this.ctx = ctx; this.B = ctx.batch; this.p0 = p0.clone(); this.n = n.clone().normalize();
    this.t = new THREE.Vector3(this.n.z, 0, -this.n.x); this.L = L; this.ry = Math.atan2(this.n.x, this.n.z);
  }
  pt(u, y, d) { return this.p0.clone().addScaledVector(this.t, u).addScaledVector(UP, y).addScaledVector(this.n, d); }
  box(u0, u1, y0, y1, d0, d1, m, o) {
    if (u1 - u0 < 1e-3 || y1 - y0 < 1e-3 || d1 - d0 < 1e-3) return;
    const c = this.pt((u0 + u1) / 2, (y0 + y1) / 2, (d0 + d1) / 2);
    this.B.add(box(u1 - u0, y1 - y0, d1 - d0), m, mat(c.x, c.y, c.z, 0, this.ry, 0), o);
  }
  /** Place a local geometry (x=u, y, z=d) at u,y,d with extra local rotation. */
  geo(g, m, u, y, d, rx = 0, ry = 0, rz = 0, o) {
    const c = this.pt(u, y, d);
    const M = mat(c.x, c.y, c.z, 0, this.ry, 0).multiply(mat(0, 0, 0, rx, ry, rz));
    this.B.add(g, m, M, o);
  }
  plane(u0, u1, y0, y1, d, m, o = {}) {
    const c = this.pt((u0 + u1) / 2, (y0 + y1) / 2, d);
    this.B.add(new THREE.PlaneGeometry(u1 - u0, y1 - y0), m, mat(c.x, c.y, c.z, 0, this.ry, 0), { uv: 'keep', collider: false, shadow: false, ...o });
  }
  /** Rectangles covering band [yA,yB] x [lo,hi] minus holes. */
  rects(yA, yB, holes, lo = 0, hi = this.L, extraBreaks = []) {
    const ys = new Set([yA, yB, ...extraBreaks.filter((y) => y > yA && y < yB)]);
    for (const h of holes) { if (h.y0 > yA && h.y0 < yB) ys.add(h.y0); if (h.y1 > yA && h.y1 < yB) ys.add(h.y1); }
    const arr = [...ys].sort((a, b) => a - b); const out = [];
    for (let k = 0; k < arr.length - 1; k++) {
      const a = arr[k], b = arr[k + 1];
      const cut = holes.filter((h) => h.y0 <= a + 1e-4 && h.y1 >= b - 1e-4).sort((p, q) => p.u0 - q.u0);
      let u = lo;
      for (const h of cut) { if (h.u0 > u) out.push([u, Math.min(h.u0, hi), a, b]); u = Math.max(u, h.u1); }
      if (u < hi) out.push([u, hi, a, b]);
    }
    return out;
  }
  /** Emit wall boxes for a horizontal band with rectangular holes. holes: [{u0,u1,y0,y1}] */
  wall(yA, yB, holes, m, T, o = {}, lo = 0, hi = this.L, extraBreaks = [], matBelow = null) {
    for (const [u0, u1, a, b] of this.rects(yA, yB, holes, lo, hi, extraBreaks)) {
      const mm = matBelow && b <= matBelow.y + 1e-4 ? matBelow : null;
      if (mm) this.box(u0, u1, a, b, -T, mm.out, mm.m, mm.o); else this.box(u0, u1, a, b, -T, 0, m, o);
    }
  }
}

const WIN_TINTS = [0xbfb8a8, 0x9a8e7c, 0xd8d6d0];
const WALLPAPER = [0x8a8070, 0x7a8078, 0x8c7462, 0x6f7480, 0x908a78];

/**
 * Window/door fill for an opening. o: {u0,u1,y0,y1,kind}
 * kinds: window | broken | boarded | blown | balcony | shop | shopShutter | door | entrance
 */
export function fillOpening(F, o, T, r, style) {
  const B = F.B; const w = o.u1 - o.u0, h = o.y1 - o.y0, uc = (o.u0 + o.u1) / 2;
  const kind = o.kind;
  if (style.lod && kind !== 'shop' && kind !== 'shopShutter' && kind !== 'entrance') {
    F.plane(o.u0, o.u1, o.y0, o.y1, -0.2, kind === 'window' && r() < 0.5 ? 'glass' : 'void', { collider: true, uv: 'world' });
    F.box(o.u0 - 0.06, o.u1 + 0.06, o.y0 - 0.06, o.y0, -0.1, 0.06, 'concrete', { collider: false });
    F.box(o.u0, o.u1, (o.y0 + o.y1) / 2 + 0.2, (o.y0 + o.y1) / 2 + 0.26, -0.2, -0.16, 'wood', { collider: false, tint: 0x8a8070 });
    F.box((o.u0 + o.u1) / 2 - 0.03, (o.u0 + o.u1) / 2 + 0.03, o.y0, o.y1, -0.2, -0.16, 'wood', { collider: false, tint: 0x8a8070 });
    if (kind === 'blown') F.plane(o.u0 - (o.u1 - o.u0) * 0.8, o.u1 + (o.u1 - o.u0) * 0.8, o.y0 - 0.3, o.y1 + (o.y1 - o.y0) * 1.6, 0.012, 'decal_soot');
    return;
  }
  const frameMat = style.frame || 'wood', ft = style.frameTint ?? r.pick(WIN_TINTS);
  const fo = { collider: false, tint: ft };
  const inset = 0.16;
  // interior room
  const dep = kind === 'shop' || kind === 'shopShutter' ? 3.2 : 1.8 + r() * 1.2;
  const iw = w + (kind === 'shop' ? 0.2 : 1.2), ih = Math.max(h + 0.8, 2.6);
  const iy0 = kind === 'shop' || kind === 'shopShutter' || kind === 'door' || kind === 'entrance' || kind === 'balcony' ? o.y0 : o.y0 - 0.85;
  if (kind !== 'door' && kind !== 'entrance') {
    const wp = r.pick(WALLPAPER);
    for (const [part, g] of roomParts(iw, ih, dep)) {
      const m = part === 'floor' ? 'wood' : 'plaster';
      const tint = part === 'floor' ? 0x55483c : part === 'ceil' ? 0x8a8680 : (kind === 'blown' ? 0x3a3530 : wp);
      F.geo(g, m, uc, iy0, -T, 0, 0, 0, { collider: true, surface: 'concrete', tint, shadow: false });
    }
    // occasional furniture silhouette
    if (kind !== 'shop' && r() < 0.35) F.box(uc - iw / 2 + 0.1, uc - iw / 2 + 0.9, iy0, iy0 + 1.9, -T - dep + 0.05, -T - dep + 0.6, 'wood', { collider: false, tint: 0x5a4a3a, shadow: false });
    if (kind === 'shop' && r() < 0.8) {
      for (let s = 0; s < 3; s++) F.box(uc - w / 2 + 0.2, uc + w / 2 - 0.2, iy0 + 0.4 + s * 0.6, iy0 + 0.45 + s * 0.6, -T - dep + 0.05, -T - dep + 0.5, 'wood', { collider: false, tint: 0x6a5a48, shadow: false });
      F.box(uc - w / 2 + 0.3, uc - 0.2, iy0, iy0 + 1.0, -T - 1.6, -T - 1.0, 'wood', { collider: true, surface: 'wood', tint: 0x4a3c30 });
    }
  }
  const sill = () => {
    F.box(o.u0 - 0.08, o.u1 + 0.08, o.y0 - 0.06, o.y0, -0.1, 0.07, style.sillMat || 'metal_painted', { collider: false, tint: style.sillTint });
  };
  const frame = (d, thick = 0.07, mull = true) => {
    F.box(o.u0, o.u1, o.y0, o.y0 + thick, d - 0.06, d, frameMat, fo);
    F.box(o.u0, o.u1, o.y1 - thick, o.y1, d - 0.06, d, frameMat, fo);
    F.box(o.u0, o.u0 + thick, o.y0, o.y1, d - 0.06, d, frameMat, fo);
    F.box(o.u1 - thick, o.u1, o.y0, o.y1, d - 0.06, d, frameMat, fo);
    if (mull) {
      F.box(uc - thick / 2, uc + thick / 2, o.y0, o.y1, d - 0.06, d, frameMat, fo);
      const ty = o.y1 - Math.min(0.45, h * 0.3);
      F.box(o.u0, o.u1, ty - thick / 2, ty + thick / 2, d - 0.06, d, frameMat, fo);
    }
  };
  const curtains = () => {
    if (r() < 0.55) {
      const ci = 'curtain' + r.int(0, 5); const cw = w * (0.3 + r() * 0.4);
      const left = r() < 0.5;
      F.plane(left ? o.u0 : o.u1 - cw, left ? o.u0 + cw : o.u1, o.y0 - 0.1, o.y1 + 0.05, -inset - 0.12, ci);
      if (r() < 0.4) F.plane(left ? o.u1 - cw * 0.6 : o.u0, left ? o.u1 : o.u0 + cw * 0.6, o.y0 - 0.1, o.y1 + 0.05, -inset - 0.14, ci);
    }
  };
  const glass = (full = true) => {
    if (full) F.plane(o.u0, o.u1, o.y0, o.y1, -inset - 0.03, 'glass', { collider: true, surface: 'glass', uv: 'world' });
    else {
      // shards: a jagged partial pane in the lower corners
      const s = new THREE.Shape(); const hw = w / 2, hh = h / 2;
      s.moveTo(-hw, -hh); s.lineTo(hw, -hh); s.lineTo(hw, -hh + h * (0.2 + r() * 0.5));
      s.lineTo(hw * (0.2 + r() * 0.5), -hh + h * 0.15 * r()); s.lineTo(0, -hh + h * (0.3 + r() * 0.4));
      s.lineTo(-hw * (0.3 + r() * 0.5), -hh + h * 0.2 * r()); s.lineTo(-hw, -hh + h * (0.3 + r() * 0.5));
      F.geo(new THREE.ShapeGeometry(s), 'glass', uc, (o.y0 + o.y1) / 2, -inset - 0.03, 0, 0, 0, { collider: false, uv: 'world' });
    }
  };
  switch (kind) {
    case 'window': sill(); frame(-inset); glass(true); curtains(); break;
    case 'broken': sill(); frame(-inset); glass(false); curtains(); break;
    case 'blown': {
      sill();
      // charred remaining frame pieces
      F.box(o.u0, o.u0 + 0.07, o.y0, o.y1 - r() * 0.6, -inset - 0.06, -inset, 'wood', { collider: false, tint: 0x2a2420 });
      F.plane(o.u0 - w * 0.8, o.u1 + w * 0.8, o.y0 - 0.3, o.y1 + h * 1.6, 0.012, 'decal_soot');
      break;
    }
    case 'boarded': {
      sill(); frame(-inset, 0.07, false);
      const n = Math.floor(h / 0.22);
      for (let i = 0; i < n; i++) if (r() > 0.15) {
        const y = o.y0 + 0.1 + i * (h - 0.2) / n; const ang = (r() - 0.5) * 0.08;
        F.geo(box(w + 0.25, 0.18, 0.025), 'wood_planks', uc + (r() - 0.5) * 0.1, y, -0.02, 0, 0, ang, { collider: false, tint: r.pick([0xb8a890, 0x8a7a68, 0xa09080]) });
      }
      F.plane(o.u0, o.u1, o.y0, o.y1, -inset - 0.1, 'void', { collider: true, surface: 'wood' });
      break;
    }
    case 'balcony': {
      frame(-inset, 0.08, false);
      F.box(o.u0, o.u1, o.y0 + 0.95, o.y0 + 1.02, -inset - 0.06, -inset, frameMat, fo);
      F.box(uc - 0.04, uc + 0.04, o.y0, o.y1, -inset - 0.06, -inset, frameMat, fo);
      F.box(o.u0 + 0.07, uc - 0.04, o.y0 + 0.07, o.y0 + 0.95, -inset - 0.05, -inset - 0.02, frameMat, fo); // door panel
      glass(r() > 0.3); curtains(); break;
    }
    case 'shop': {
      // metal storefront frame + big panes, some smashed
      const fm = { collider: false, tint: style.shopTint ?? 0x3a3c3e };
      F.box(o.u0, o.u1, o.y0, o.y0 + 0.1, -0.14, -0.04, 'metal_painted', fm);
      F.box(o.u0, o.u1, o.y1 - 0.1, o.y1, -0.14, -0.04, 'metal_painted', fm);
      F.box(o.u0, o.u0 + 0.08, o.y0, o.y1, -0.14, -0.04, 'metal_painted', fm);
      F.box(o.u1 - 0.08, o.u1, o.y0, o.y1, -0.14, -0.04, 'metal_painted', fm);
      F.box(uc - 0.04, uc + 0.04, o.y0, o.y1, -0.14, -0.04, 'metal_painted', fm);
      if (r() < 0.5) F.plane(o.u0, o.u1, o.y0, o.y1, -0.1, 'glass', { collider: true, surface: 'glass', uv: 'world' });
      else { glass(false); }
      break;
    }
    case 'shopShutter': {
      // roll-down corrugated shutter, partially down
      const down = o.y0 + (o.y1 - o.y0) * (0.25 + r() * 0.7);
      const tint = r.pick([0x9a9890, 0x7a8a8a, 0xa0a8a0]);
      for (let y = down; y < o.y1 - 0.001; y += 0.1) F.box(o.u0 + 0.02, o.u1 - 0.02, y, Math.min(o.y1, y + 0.09), -0.1, -0.06, 'metal_painted', { collider: true, surface: 'metal', tint });
      F.box(o.u0 - 0.05, o.u1 + 0.05, o.y1, o.y1 + 0.35, -0.02, 0.18, 'metal_painted', { collider: false, tint }); // box housing
      F.box(o.u0 - 0.04, o.u0 + 0.04, o.y0, o.y1, -0.12, -0.02, 'metal_bare', { collider: false });
      F.box(o.u1 - 0.04, o.u1 + 0.04, o.y0, o.y1, -0.12, -0.02, 'metal_bare', { collider: false });
      if (r() < 0.5) F.plane(o.u0, o.u1, o.y0, o.y1, -0.25, 'glass', { collider: true, surface: 'glass', uv: 'world' });
      break;
    }
    case 'door': case 'entrance': {
      const dt = style.doorTint ?? r.pick([0x5a4030, 0x3e4a44, 0x6a5a40, 0x4a3a34]);
      F.box(o.u0, o.u1, o.y0, o.y1, -0.2, -0.14, 'metal_painted', { collider: true, surface: 'metal', tint: dt });
      F.box(o.u0 + 0.1, o.u1 - 0.1, o.y0 + 0.2, o.y0 + 1.0, -0.14, -0.12, 'metal_painted', { collider: false, tint: dt });
      F.box(o.u1 - 0.3, o.u1 - 0.12, o.y0 + 1.0, o.y0 + 1.04, -0.14, -0.08, 'metal_bare', { collider: false });
      F.box(o.u0 - 0.1, o.u1 + 0.1, o.y1, o.y1 + 0.1, -0.02, 0.06, 'concrete', { collider: false });
      if (kind === 'entrance') {
        F.box(o.u0 - 0.6, o.u1 + 0.6, o.y1 + 0.35, o.y1 + 0.5, 0, 1.3, 'concrete', { collider: true });
        F.geo(box(0.06, 0.06, 1.3), 'metal_rusty', o.u0 - 0.5, o.y1 + 0.2, 0.65, -0.35, 0, 0, { collider: false });
        F.geo(box(0.06, 0.06, 1.3), 'metal_rusty', o.u1 + 0.5, o.y1 + 0.2, 0.65, -0.35, 0, 0, { collider: false });
        if (o.y0 > 0.05) { // steps
          const n = Math.round(o.y0 / 0.16);
          for (let i = 0; i < n; i++) F.box(o.u0 - 0.5, o.u1 + 0.5, 0, o.y0 - i * (o.y0 / n), 0, 0.3 * (n - i) + 0.1, 'concrete', { collider: true });
        }
      }
      break;
    }
  }
}

/**
 * Build a rectangular apartment/commercial block.
 * spec: { rect:[x0,x1,z0,z1], floors, gh, fh, wall, wallTint, trim, trimTint, plinthMat, style:'soviet'|'old',
 *         sides:{px,nx,pz,nz: 'front'|'back'|'blank'|null}, roof:'gable'|'flat'|'none', shops:{side:[bayIdx...]},
 *         entrances:{side:[bayIdx]}, balconies:true, damage:0..1, seed, openGround:[side?], skipBays }
 */
export function buildBlock(ctx, spec) {
  const r = rng(spec.seed || 1);
  const [x0, x1, z0, z1] = spec.rect;
  const floors = spec.floors ?? 4, gh = spec.gh ?? 3.6, fh = spec.fh ?? 3.0;
  const H = gh + (floors - 1) * fh; const T = 0.42;
  const wall = spec.wall || 'plaster', wo = { tint: spec.wallTint, surface: 'concrete' };
  const trim = spec.trim || 'plaster', to = { tint: spec.trimTint ?? 0xd8d0c0, collider: false };
  const plinth = spec.plinthMat || 'concrete_dark';
  const style = { lod: spec.lod, frame: spec.frame || 'wood', frameTint: spec.frameTint, sillMat: spec.sillMat, sillTint: spec.sillTint, shopTint: spec.shopTint };
  const plinthH = spec.plinthH ?? 0.7;
  const parapet = spec.roof === 'flat' ? 0.7 : 0.25;
  const sides = {
    px: { p0: new THREE.Vector3(x1, 0, z1), n: new THREE.Vector3(1, 0, 0), L: z1 - z0 },
    nx: { p0: new THREE.Vector3(x0, 0, z0), n: new THREE.Vector3(-1, 0, 0), L: z1 - z0 },
    pz: { p0: new THREE.Vector3(x0, 0, z1), n: new THREE.Vector3(0, 0, 1), L: x1 - x0 },
    nz: { p0: new THREE.Vector3(x1, 0, z0), n: new THREE.Vector3(0, 0, -1), L: x1 - x0 },
  };
  if (!spec.noFootprint) ctx.addFootprint(x0, x1, z0, z1, H);
  const yF = (f) => (f === 0 ? 0 : gh + (f - 1) * fh);
  const floorFloor = (f) => (f === 0 ? plinthH : yF(f)); // interior floor level
  const out = { H, facades: {} };

  for (const key of ['px', 'nx', 'pz', 'nz']) {
    const kind = spec.sides?.[key]; if (kind == null) continue;
    const S = sides[key]; const F = new Facade(ctx, S.p0, S.n, S.L); out.facades[key] = F;
    const isX = key === 'px' || key === 'nx';
    const lo = isX ? T : 0, hi = isX ? S.L - T : S.L; // x-facing facades tuck inside the z-facing ones at corners
    const edge = spec.edge ?? 1.4;
    const bayW0 = spec.bay ?? 3.3;
    const nb = Math.max(1, Math.round((S.L - 2 * edge) / bayW0));
    const bw = (S.L - 2 * edge) / nb;
    const bayU = (i) => edge + (i + 0.5) * bw;
    const shops = new Set(spec.shops?.[key] || []);
    const entr = new Set(spec.entrances?.[key] || []);
    const openG = spec.openGround?.[key];
    const balcCols = new Set();
    if (spec.balconies && kind === 'front') for (let i = 0; i < nb; i++) if ((i + (spec.balcOff || 0)) % (spec.balcEvery || 3) === 1) balcCols.add(i);
    const damage = spec.damage ?? 0.3;
    const holes = [];
    const fills = [];
    for (let f = 0; f < floors; f++) {
      for (let i = 0; i < nb; i++) {
        const u = bayU(i);
        if (kind === 'blank') continue;
        if (kind === 'back' && f > 0 && i % 2 === 1 && !spec.denseBack) {
          // stairwell windows at half-landings on back facades
          continue;
        }
        if (spec.skip?.[key]?.some(([bi, bf]) => bi === i && (bf === f || bf === -1))) continue;
        if (f === 0) {
          if (openG && u > openG[0] - 1.2 && u < openG[1] + 1.2) continue;
          if (shops.has(i)) { const w = Math.min(bw - 0.5, 2.8); const hole = { u0: u - w / 2, u1: u + w / 2, y0: 0.45, y1: gh - 0.75, kind: r() < 0.45 ? 'shopShutter' : 'shop' }; holes.push(hole); fills.push(hole); continue; }
          if (entr.has(i)) { const hole = { u0: u - 0.7, u1: u + 0.7, y0: plinthH - 0.25, y1: plinthH + 2.1, kind: 'entrance' }; holes.push(hole); fills.push(hole); continue; }
        }
        const ff = floorFloor(f);
        const balc = balcCols.has(i) && f > 0;
        let w = spec.winW ?? 1.45, h = spec.winH ?? 1.55, y0 = ff + 0.85;
        if (balc) { w = 1.7; h = 2.25; y0 = ff + 0.02; }
        if (f === 0) { y0 = Math.max(y0, plinthH + 0.75); }
        const dr = r();
        let wk = balc ? 'balcony' : 'window';
        if (dr < damage * 0.35) wk = 'blown'; else if (dr < damage * 0.8) wk = 'broken'; else if (dr < damage * 1.05 && f < 2) wk = 'boarded';
        if (balc && (wk === 'broken' || wk === 'boarded')) wk = 'balcony';
        const hole = { u0: u - w / 2, u1: u + w / 2, y0, y1: y0 + h, kind: wk, f, i, balc };
        holes.push(hole); fills.push(hole);
      }
    }
    // wall body
    if (openG) holes.push({ u0: openG[0], u1: openG[1], y0: -1, y1: gh - 0.3 });
    F.wall(0, H + parapet, holes, wall, T, wo, lo, hi, [plinthH, ...Array.from({ length: floors }, (_, f) => yF(f))], { y: plinthH, m: plinth, out: 0.06, o: { surface: 'concrete' } });
    for (const o of fills) fillOpening(F, o, T, r, style);
    // shop signage boards + awnings above storefronts
    for (const o of fills) if (o.kind === 'shop' || o.kind === 'shopShutter') {
      const si = r.int(0, 11), sw = o.u1 - o.u0 + 0.5;
      F.box(o.u0 - 0.25, o.u1 + 0.25, o.y1 + 0.12, o.y1 + 0.68, 0.02, 0.12, 'metal_painted', { collider: false, tint: 0x3a3a38 });
      if (r() < 0.85) F.plane(o.u0 - 0.2, o.u1 + 0.2, o.y1 + 0.15, o.y1 + 0.65, 0.125, 'sign' + si, { shadow: false });
      if (r() < 0.35) { // torn fabric awning
        F.geo(box(sw, 0.03, 1.0), 'tarp', (o.u0 + o.u1) / 2, o.y1 + 0.05, 0.5, 0.35, 0, 0, { collider: false, tint: r.pick([0x8a3a2a, 0x3a5a6a, 0x6a6a3a]) });
      }
    }

    // window surrounds / pediments (old style), string courses, cornice
    if (spec.style === 'old') {
      for (const o of fills) if (o.kind !== 'shop' && o.kind !== 'shopShutter' && o.kind !== 'entrance' && !o.balc && o.f > 0) {
        F.box(o.u0 - 0.14, o.u0, o.y0 - 0.05, o.y1 + 0.1, 0, 0.05, trim, to);
        F.box(o.u1, o.u1 + 0.14, o.y0 - 0.05, o.y1 + 0.1, 0, 0.05, trim, to);
        F.box(o.u0 - 0.22, o.u1 + 0.22, o.y1 + 0.1, o.y1 + 0.28, 0, 0.1, trim, to);
        F.box(o.u0 - 0.28, o.u1 + 0.28, o.y1 + 0.28, o.y1 + 0.36, 0, 0.16, trim, to);
        F.box(o.u0 - 0.05, o.u1 + 0.05, o.y0 - 0.45, o.y0 - 0.06, 0, 0.03, trim, to); // apron panel
      }
      // corner quoins
      for (let y = plinthH; y < H - 0.3; y += 0.6) {
        const wq = (Math.round(y / 0.6) % 2) ? 0.5 : 0.8;
        F.box(0, wq, y, y + 0.55, 0, 0.04, trim, to); F.box(S.L - wq, S.L, y, y + 0.55, 0, 0.04, trim, to);
      }
    }
    for (let f = 1; f < floors; f++) F.box(0, S.L, yF(f) - 0.08, yF(f) + 0.1, 0, spec.style === 'old' ? 0.1 : 0.05, trim, to);
    if (spec.style === 'old') F.box(0, S.L, gh - 0.4, gh - 0.08, 0, 0.14, trim, to);
    // cornice (stacked projecting bands + dentils)
    const cor = spec.roof === 'flat' ? 0.25 : 0.45;
    F.box(-0.05, S.L + 0.05, H - 0.35, H - 0.15, 0, 0.1, trim, to);
    F.box(-0.15, S.L + 0.15, H - 0.15, H, 0, 0.22, trim, to);
    F.box(-0.25, S.L + 0.25, H, H + 0.12, 0, cor, trim, { ...to, collider: false });
    if (spec.style === 'old') for (let u = 0.2; u < S.L - 0.1; u += 0.35) F.box(u, u + 0.14, H - 0.35, H - 0.15, 0.1, 0.2, trim, to);
    if (spec.roof === 'flat') F.box(-0.02, S.L + 0.02, H + parapet - 0.06, H + parapet + 0.04, -T - 0.05, 0.05, 'metal_painted', { collider: false, tint: 0x6a6860 });

    // balconies
    for (const o of fills) if (o.balc) {
      const uc = (o.u0 + o.u1) / 2, bw2 = Math.min(bw - 0.3, 3.0), dep = 1.15, yb = o.y0 - 0.02;
      const type = r();
      F.box(uc - bw2 / 2, uc + bw2 / 2, yb - 0.16, yb, 0, dep, 'concrete', { collider: true });
      F.plane(uc - bw2 / 2, uc + bw2 / 2, yb - 1.2, yb - 0.16, 0.015, 'decal_streak');
      if (type < 0.4) {
        // steel bar railing (alpha-tested baluster card) + solid top rail
        const ri = r.int(0, 2), rt = [0x3a4a3a, 0x5a3a2a, 0x2e3440][ri];
        F.box(uc - bw2 / 2, uc + bw2 / 2, yb + 1.0, yb + 1.05, dep - 0.06, dep, 'metal_painted', { collider: false, tint: rt });
        F.geo(new THREE.PlaneGeometry(bw2, 1.0), 'railing' + ri, uc, yb + 0.5, dep - 0.03, 0, 0, 0, { collider: false, uvScale: 1 });
        for (const s2 of [-1, 1]) {
          F.geo(new THREE.PlaneGeometry(dep, 1.0), 'railing' + ri, uc + s2 * (bw2 / 2 - 0.01), yb + 0.5, dep / 2, 0, Math.PI / 2, 0, { collider: false, uvScale: 1 });
          F.box(uc + s2 * bw2 / 2 - 0.03, uc + s2 * bw2 / 2 + 0.01, yb + 1.0, yb + 1.05, 0, dep, 'metal_painted', { collider: false, tint: rt });
        }
      } else if (type < 0.75) {
        // concrete / corrugated sheet parapet
        const pm = r() < 0.5 ? 'concrete' : 'metal_painted'; const pt = pm === 'metal_painted' ? r.pick([0x7a8a90, 0x9a9070, 0x6a7a5a]) : undefined;
        F.box(uc - bw2 / 2, uc + bw2 / 2, yb, yb + 1.0, dep - 0.06, dep, pm, { collider: true, tint: pt, surface: pm === 'concrete' ? 'concrete' : 'metal' });
        F.box(uc - bw2 / 2, uc - bw2 / 2 + 0.06, yb, yb + 1.0, 0, dep, pm, { collider: false, tint: pt });
        F.box(uc + bw2 / 2 - 0.06, uc + bw2 / 2, yb, yb + 1.0, 0, dep, pm, { collider: false, tint: pt });
        F.box(uc - bw2 / 2 - 0.02, uc + bw2 / 2 + 0.02, yb + 1.0, yb + 1.05, dep - 0.08, dep + 0.02, 'metal_rusty', { collider: false });
      } else {
        // glazed-in balcony with timber frames (very common)
        const ft = r.pick([0xc8c0b0, 0x8a7058, 0xe0dcd0]);
        F.box(uc - bw2 / 2, uc + bw2 / 2, yb, yb + 0.95, dep - 0.05, dep, 'wood_planks', { collider: true, surface: 'wood', tint: 0xa89880 });
        F.box(uc - bw2 / 2, uc - bw2 / 2 + 0.05, yb, yb + 0.95, 0, dep, 'wood_planks', { collider: false, tint: 0xa89880 });
        F.box(uc + bw2 / 2 - 0.05, uc + bw2 / 2, yb, yb + 0.95, 0, dep, 'wood_planks', { collider: false, tint: 0xa89880 });
        const top = o.y1 + 0.2;
        F.box(uc - bw2 / 2, uc + bw2 / 2, yb + 0.95, yb + 1.0, 0, dep, 'wood', { collider: false, tint: ft });
        F.box(uc - bw2 / 2, uc + bw2 / 2, top - 0.06, top, dep - 0.06, dep, 'wood', { collider: false, tint: ft });
        const n = Math.round(bw2 / 0.6);
        for (let k = 0; k <= n; k++) { const u = uc - bw2 / 2 + k * bw2 / n; F.box(u - 0.03, u + 0.03, yb + 1.0, top, dep - 0.06, dep, 'wood', { collider: false, tint: ft }); }
        if (r() < 0.7) F.plane(uc - bw2 / 2, uc + bw2 / 2, yb + 1.0, top, dep - 0.03, 'glass', { collider: false, uv: 'world' });
        F.box(uc - bw2 / 2 - 0.05, uc + bw2 / 2 + 0.05, top, top + 0.05, 0, dep + 0.08, 'metal_rusty', { collider: false });
      }
      if (r() < 0.2) { // satellite dish
        const g = new THREE.SphereGeometry(0.3, 12, 6, 0, Math.PI * 2, 0, 0.6); F.geo(g, 'plastic', uc + bw2 / 2 - 0.35, yb + 1.3, dep - 0.1, -1.2 + r() * 0.3, r() * 0.5, 0, { collider: false, tint: 0xd8d8d0 });
      }
    }
    // entrance canopy etc handled in fill. AC units, drainpipes, stains
    for (const o of fills) {
      if ((o.kind === 'window' || o.kind === 'broken') && o.f > 0 && r() < (spec.acRate ?? 0.12)) {
        const side = r() < 0.5 ? -1 : 1; const u = side < 0 ? o.u0 - 0.55 : o.u1 + 0.55;
        F.geo(rbox(0.8, 0.55, 0.3, 0.03), 'plastic', u, o.y0 - 0.1, 0.18, 0, 0, 0, { collider: false, tint: 0xd8d4c8 });
        F.box(u - 0.3, u + 0.3, o.y0 - 0.3, o.y0 - 0.1, 0.33, 0.335, 'metal_bare', { collider: false });
        F.box(u - 0.38, u - 0.34, o.y0 - 0.45, o.y0 - 0.37, 0, 0.35, 'metal_rusty', { collider: false });
        F.box(u + 0.34, u + 0.38, o.y0 - 0.45, o.y0 - 0.37, 0, 0.35, 'metal_rusty', { collider: false });
        F.plane(u - 0.4, u + 0.4, o.y0 - 1.6, o.y0 - 0.35, 0.01, 'decal_streak_rust');
      }
      if (o.kind !== 'shop' && o.kind !== 'shopShutter' && o.kind !== 'entrance' && r() < 0.55) F.plane(o.u0 - 0.1, o.u1 + 0.1, o.y0 - 1.4 - r(), o.y0 - 0.06, 0.008, 'decal_streak');
    }
    const pipeT = spec.pipeTint;
    const pipes = [0.3, S.L - 0.3]; if (S.L > 24 && kind !== 'blank') pipes.push(edge + Math.round(nb / 2) * bw);
    for (const u of pipes) {
      const pm = pipeT ? 'metal_painted' : 'metal_rusty';
      const top = H + 0.1;
      F.geo(cyl(0.055, 0.055, top - 0.4, 8), pm, u, (top + 0.4) / 2, 0.12, 0, 0, 0, { collider: false, tint: pipeT });
      F.geo(cyl(0.14, 0.06, 0.3, 8), pm, u, top, 0.14, 0, 0, 0, { collider: false, tint: pipeT });
      F.geo(cyl(0.055, 0.055, 0.45, 8), pm, u, 0.3, 0.28, 0.9, 0, 0, { collider: false, tint: pipeT });
      for (let y = 1.5; y < top; y += 2.2) F.box(u - 0.08, u + 0.08, y, y + 0.05, 0, 0.18, 'metal_rusty', { collider: false });
      F.plane(u - 0.35, u + 0.35, 0.1, 2.0, 0.006, 'decal_stain');
    }
    // grime: under cornice and at the base
    for (let u = 0; u < S.L - 0.5; u += 3) {
      const w = Math.min(3.2, S.L - u);
      F.plane(u, u + w, H - 2.8 - r() * 1.2, H - 0.36, 0.007, 'decal_streak');
      F.plane(u, u + w, plinthH, plinthH + 0.6 + r() * 1.1, 0.07, 'decal_dirt', { uv: 'keep' });
    }
    // plaster spalling: exposed brick patches
    if (wall === 'plaster') {
      const n = Math.round(S.L / 6 * (0.5 + damage));
      for (let k = 0; k < n; k++) {
        const s = new THREE.Shape(); const R = 0.3 + r() * 1.1; const m = 9;
        for (let j = 0; j < m; j++) { const a = j / m * Math.PI * 2, rr = R * (0.5 + r() * 0.6); const px = Math.cos(a) * rr * 1.4, py = Math.sin(a) * rr; j ? s.lineTo(px, py) : s.moveTo(px, py); }
        const u = 1 + r() * (S.L - 2), y = plinthH + 0.6 + r() * (H - plinthH - 1.5);
        if (fills.some((o) => u > o.u0 - R * 1.4 && u < o.u1 + R * 1.4 && y > o.y0 - R && y < o.y1 + R)) continue;
        F.geo(new THREE.ShapeGeometry(s), 'brick', u, y, 0.01, 0, 0, 0, { collider: false, shadow: false });
      }
    }
    // shell/bullet impact scars
    for (let k = 0; k < Math.round(S.L / 5 * damage); k++) {
      const u = 1 + r() * (S.L - 2), y = 1 + r() * (H - 2), s = 0.4 + r() * 1.0;
      F.plane(u - s, u + s, y - s, y + s, 0.012, 'decal_stain');
    }
    ctx.facades.push({ F, fills, H, key, spec, bayU, nb, bw });
  }

  // roof
  const rh = spec.roofH ?? Math.min(3.2, (Math.min(x1 - x0, z1 - z0)) * 0.22);
  if (spec.roof === 'gable') {
    const alongX = (x1 - x0) >= (z1 - z0);
    const Lr = alongX ? x1 - x0 : z1 - z0, Wr = alongX ? z1 - z0 : x1 - x0;
    const oh = 0.5, half = Wr / 2 + oh, slope = Math.atan2(rh, Wr / 2), len = half / Math.cos(slope);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, yb = H + 0.12;
    for (const s of [-1, 1]) {
      const off = (half / 2) - 0.02; const cy = yb + rh / 2 - oh * Math.tan(slope) / 2;
      const g = box(Lr + 2 * oh * 0.6, 0.12, len);
      const M = alongX ? mat(cx, cy, cz + s * off, s * slope, 0, 0) : mat(cx + s * off, cy, cz, 0, Math.PI / 2, 0).multiply(mat(0, 0, 0, s * slope));
      ctx.batch.add(g, 'roof_tiles', M, { surface: 'concrete' });
      // fascia board under eave
      const fz = s * (half - 0.02);
      const Mf = alongX ? mat(cx, yb - oh * Math.tan(slope) - 0.1, cz + fz) : mat(cx + fz, yb - oh * Math.tan(slope) - 0.1, cz, 0, Math.PI / 2, 0);
      ctx.batch.add(box(Lr + 0.6, 0.22, 0.04), 'wood', Mf, { collider: false, tint: 0x6a5a4a });
      // gutter
      const Mg = alongX ? mat(cx, yb - oh * Math.tan(slope) - 0.06, cz + s * (half + 0.06), 0, 0, Math.PI / 2) : mat(cx + s * (half + 0.06), yb - oh * Math.tan(slope) - 0.06, cz, Math.PI / 2, 0, 0);
      ctx.batch.add(cyl(0.07, 0.07, Lr + 0.6, 8, true), 'metal_rusty', Mg, { collider: false });
    }
    // ridge cap
    ctx.batch.add(box(alongX ? Lr + 0.6 : 0.3, 0.12, alongX ? 0.3 : Lr + 0.6), 'metal_rusty', mat(cx, yb + rh + 0.02, cz, alongX ? Math.PI / 4 * 0 : 0), { collider: false });
    // gable end triangles
    for (const s of [-1, 1]) {
      const sh = new THREE.Shape(); sh.moveTo(-Wr / 2, 0); sh.lineTo(Wr / 2, 0); sh.lineTo(0, rh); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: T, bevelEnabled: false });
      const M = alongX ? mat(s < 0 ? x0 : x1 - T, yb - 0.12, cz, 0, Math.PI / 2, 0) : mat(cx, yb - 0.12, s < 0 ? z0 : z1 - T);
      ctx.batch.add(g, spec.wall || 'plaster', M, { tint: spec.wallTint });
    }
    // roof interior cap (so the underside doesn't read hollow from above-windows)
    ctx.batch.add(box(x1 - x0, 0.1, z1 - z0), 'concrete_dark', mat(cx, H + 0.05, cz), { collider: true });
    // chimneys + antennas
    const nC = Math.max(2, Math.round(Lr / 10));
    for (let k = 0; k < nC; k++) {
      const a = -Lr / 2 + (k + 0.5) * Lr / nC + (r() - 0.5) * 2, b = (r() - 0.5) * Wr * 0.4;
      const px = alongX ? cx + a : cx + b, pz = alongX ? cz + b : cz + a;
      const hgt = rh + 1.2 + r() * 0.6;
      ctx.batch.add(box(0.7, hgt, 0.5), 'brick', mat(px, yb + hgt / 2, pz), { collider: false });
      ctx.batch.add(box(0.85, 0.12, 0.65), 'concrete', mat(px, yb + hgt, pz), { collider: false });
      ctx.batch.add(box(0.72, 0.8, 0.52), 'decal_streak', mat(px, yb + hgt - 0.5, pz), { collider: false, uv: 'keep' });
      if (r() < 0.8) antenna(ctx, px + (alongX ? 1.2 : 0.6), yb + rh * 0.7, pz + (alongX ? 0.4 : 1.2), r);
    }
  } else if (spec.roof === 'flat') {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    ctx.batch.add(box(x1 - x0, 0.3, z1 - z0), 'concrete_dark', mat(cx, H - 0.15, cz), { collider: true });
    ctx.batch.add(box(x1 - x0 - 1, 0.04, z1 - z0 - 1), 'tarp', mat(cx, H + 0.02, cz), { collider: false, tint: 0x3a3836 });
    // stair/elevator headhouse, vents, antennas
    const hx = cx + (r() - 0.5) * (x1 - x0) * 0.4, hz = cz + (r() - 0.5) * (z1 - z0) * 0.4;
    ctx.batch.add(box(3.5, 2.6, 3), 'brick', mat(hx, H + 1.3, hz), { collider: false });
    ctx.batch.add(box(3.8, 0.15, 3.3), 'concrete', mat(hx, H + 2.65, hz), { collider: false });
    for (let k = 0; k < 4; k++) antenna(ctx, x0 + 2 + r() * (x1 - x0 - 4), H, z0 + 2 + r() * (z1 - z0 - 4), r);
    for (let k = 0; k < 3; k++) ctx.batch.add(cyl(0.2, 0.2, 0.8, 8), 'metal_rusty', mat(x0 + 2 + r() * (x1 - x0 - 4), H + 0.4, z0 + 2 + r() * (z1 - z0 - 4)), { collider: false });
  }
  return out;
}

export function antenna(ctx, x, y, z, r) {
  const B = ctx.batch; const h = 2 + r() * 2.5;
  B.add(cyl(0.02, 0.025, h, 5), 'metal_bare', mat(x, y + h / 2, z, (r() - 0.5) * 0.12, 0, (r() - 0.5) * 0.12), { collider: false, shadow: true });
  const ry = r() * Math.PI;
  B.add(box(1.6, 0.025, 0.025), 'metal_bare', mat(x, y + h - 0.1, z, 0, ry, 0), { collider: false });
  for (let k = 0; k < 5; k++) B.add(box(0.02, 0.02, 0.9 - k * 0.12), 'metal_bare', mat(x + Math.cos(ry) * (k * 0.35 - 0.7), y + h - 0.1, z - Math.sin(ry) * (k * 0.35 - 0.7), 0, ry, 0), { collider: false });
}
