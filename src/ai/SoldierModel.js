import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BONES, BI, J, createBones } from './Skeleton.js';
import { clean, xf, rbox, box, cyl, sphere, sweep, limb, deform, extrude, strapAlong, tubeAlong, torus } from './geom.js';
import { buildRifle } from './Rifle.js';
import { camoTexture, uniformNormal, gearTextures, hardTextures, headTextures } from './SoldierTextures.js';
import { mulberry32, smooth, makeNoise } from './util.js';

/**
 * Procedural soldier: one SkinnedMesh per soldier (6 material groups) sharing a per-loadout geometry.
 * Everything - body, uniform, plate carrier, pouches, helmet, rifle, magazine - is skinned to the
 * skeleton (rigid gear = 100% weight on one bone), so a soldier is ~6 draw calls.
 */

export const LOADOUTS = [
  { id: 'coalition', camo: 'multicam', gear: 0x9a8a6a, molle: 0x9a8a6a, glove: 0x4e453a, boot: 0x7c6a52, sole: 0x2a2520,
    helmet: 'cover', helmetCamo: true, helmetColor: 0x8a7c60, knit: [108, 98, 80], eyes: 'glasses', nvg: 'mount', rifle: 'm4', furniture: 0x8c7a5e, mag: 0x8c7a5e,
    back: 'hydration', kneepad: 0x8a7a5c, patch: 0x6d7050, holster: true, scarf: 0xa8987a },
  { id: 'russian', camo: 'emr', gear: 0x5a5e48, molle: 0x5a5e48, glove: 0x2a2a28, boot: 0x2a2826, sole: 0x1a1a1a,
    helmet: 'cover', helmetCamo: true, helmetColor: 0x55593f, knit: [36, 36, 36], eyes: 'glasses', nvg: 'none', rifle: 'ak', furniture: 0x1d1e1f, mag: 0x2e2622,
    back: 'pack', kneepad: 0x3a3c30, patch: 0x7a2a22, holster: false, scarf: 0x3a3a34 },
  { id: 'spec', camo: 'black', gear: 0x333436, molle: 0x333436, glove: 0x1e1e1e, boot: 0x222222, sole: 0x151515,
    helmet: 'painted', helmetCamo: false, helmetColor: 0x2c2d2e, knit: [30, 30, 32], eyes: 'gasmask', nvg: 'goggles', rifle: 'm4', furniture: 0x1d1e1f, mag: 0x222222,
    back: 'hydration', kneepad: 0x2a2a2a, patch: 0x505050, holster: true },
  { id: 'militia', camo: 'm81', gear: 0x6a6448, molle: 0x5c5a44, glove: 0x4a4034, boot: 0x3a3028, sole: 0x1e1a16,
    helmet: 'painted', helmetCamo: false, helmetColor: 0x4d5238, knit: [70, 62, 50], eyes: 'glasses', nvg: 'none', rifle: 'ak', furniture: 0x4a3526, mag: 0x2e2622,
    back: 'pack', kneepad: 0x4a4636, patch: 0x3a4a6a, holster: false, scarf: 0x6a6450 },
];

const GROUPS = ['uniform', 'gear', 'molle', 'hard', 'head', 'lens'];
const UVS = { uniform: 1.4, gear: 4, molle: 4, hard: 3.3, head: 1, lens: 1 };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _c = new THREE.Color();

// ------------------------------------------------------------------ skin weights
function segDist(p, a, b) {
  const ab = _ab.subVectors(b, a); const t = Math.max(0, Math.min(1, _ap.subVectors(p, a).dot(ab) / ab.lengthSq()));
  return _ap.copy(a).addScaledVector(ab, t).distanceTo(p);
}
const _ab = new THREE.Vector3(), _ap = new THREE.Vector3();
/** distance-weighted blend among candidate bones (by name). */
function chain(names, sharp = 4) {
  const bs = names.map((n) => BONES[BI[n]]);
  return (v) => {
    const ws = bs.map((b) => [b.i, 1 / Math.pow(segDist(v, b.head, b.tail) + 0.004, sharp)]);
    return ws;
  };
}
function torsoW(v) {
  const y = v.y;
  const hips = 1 - smooth(0.99, 1.1, y);
  let chest = smooth(1.17, 1.3, y);
  const spine = Math.max(0, 1 - hips - chest);
  let neck = smooth(1.49, 1.56, y) * chest; chest -= neck;
  const ax = Math.abs(v.x);
  const cl = smooth(0.1, 0.18, ax) * smooth(1.33, 1.42, y) * 0.7 * chest; chest -= cl;
  const out = [[BI.hips, hips], [BI.spine, spine], [BI.chest, chest], [BI.neck, neck]];
  if (cl > 0) out.push([v.x > 0 ? BI.clavL : BI.clavR, cl]);
  return out;
}

// ------------------------------------------------------------------ part builder
class Builder {
  constructor(seed) { this.parts = Object.fromEntries(GROUPS.map((g) => [g, []])); this.rng = mulberry32(seed); }
  /** o: { g: group, w: boneName | fn(v)->[[bone,w]...], col: hex, rm:[roughMul, metal], uv: scale, jitter } */
  add(geo, o = {}) {
    const g = o.g || 'gear';
    const geom = clean(geo);
    if (this.shift && (o.w === 'head' || o.shift)) geom.translate(this.shift.x, this.shift.y, this.shift.z);
    const n = geom.attributes.position.count;
    const uvS = o.uv ?? UVS[g];
    if (uvS !== 1) { const uv = geom.attributes.uv; for (let i = 0; i < n; i++) uv.setXY(i, uv.getX(i) * uvS, uv.getY(i) * uvS); }
    if (o.uvOff) { const uv = geom.attributes.uv; for (let i = 0; i < n; i++) uv.setXY(i, uv.getX(i) + o.uvOff[0], uv.getY(i) + o.uvOff[1]); }
    _c.setHex(o.col ?? 0xffffff);
    const k = 1 + (o.jitter ?? 0.05) * (this.rng() * 2 - 1);
    const col = new Float32Array(n * 3), rm = new Float32Array(n * 2);
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const rmv = o.rm || [1, 0];
    const p = geom.attributes.position; const v = new THREE.Vector3();
    const w = o.w || 'chest';
    const dusty = g !== 'lens' && g !== 'head' && o.w !== 'weapon' && o.w !== 'mag';
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r * k; col[i * 3 + 1] = _c.g * k; col[i * 3 + 2] = _c.b * k;
      if (dusty) {
        // dust / mud creeping up from the boots, plus faint grime on knees
        const y = geom.attributes.position.getY(i), zz = geom.attributes.position.getZ(i);
        let d = (1 - smooth(0.04, 0.6, y)) * 0.55 + Math.exp(-((y - 0.5) ** 2) / 0.004) * (zz > 0.02 ? 0.25 : 0);
        d *= g === 'uniform' ? 1 : 0.8;
        const lum = (col[i * 3] + col[i * 3 + 1] + col[i * 3 + 2]) / 3;
        const dr = 0.2, dg = 0.16, db = 0.11; // linear dust colour
        const kk = d * (lum < dr ? 0.9 : 0.5);
        col[i * 3] += (dr * (0.6 + lum) - col[i * 3]) * kk; col[i * 3 + 1] += (dg * (0.6 + lum) - col[i * 3 + 1]) * kk; col[i * 3 + 2] += (db * (0.6 + lum) - col[i * 3 + 2]) * kk;
      }
      rm[i * 2] = rmv[0]; rm[i * 2 + 1] = rmv[1];
      if (typeof w === 'string') { si[i * 4] = BI[w]; sw[i * 4] = 1; }
      else {
        v.fromBufferAttribute(p, i);
        const ws = w(v).filter((e) => e[1] > 1e-5).sort((a, b) => b[1] - a[1]).slice(0, 4);
        let s = 0; for (const e of ws) s += e[1];
        ws.forEach((e, j) => { si[i * 4 + j] = e[0]; sw[i * 4 + j] = e[1] / s; });
      }
    }
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geom.setAttribute('rm', new THREE.BufferAttribute(rm, 2));
    geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geom.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.parts[g].push(geom);
    return geom;
  }
  build() {
    const list = [];
    for (const g of GROUPS) {
      const arr = this.parts[g];
      list.push(arr.length ? mergeGeometries(arr, false) : emptyGeo());
    }
    const geo = mergeGeometries(list, true);
    geo.computeBoundingSphere();
    return geo;
  }
}
function emptyGeo() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  g.setAttribute('rm', new THREE.Float32BufferAttribute([1, 0, 1, 0, 1, 0], 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  g.setIndex([0, 1, 2]);
  return g;
}

// fabric noise used to wrinkle cloth surfaces
const clothN = makeNoise(7);
function wrinkle(amp, freq = 30) {
  return (v) => {
    const n = clothN(v.x * freq + 11.3, v.y * freq * 1.7 + v.z * freq, 256) - 0.5;
    v.multiplyScalar(1); return n * amp;
  };
}
function jiggle(geo, amp = 0.002, freq = 40) {
  geo.computeVertexNormals();
  const p = geo.attributes.position, n = geo.attributes.normal; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = (clothN(v.x * freq + 3.1, v.y * freq + v.z * freq * 0.7, 256) - 0.5) * amp;
    p.setXYZ(i, v.x + n.getX(i) * d, v.y + n.getY(i) * d, v.z + n.getZ(i) * d);
  }
  geo.computeVertexNormals();
  return geo;
}
void wrinkle;

// ------------------------------------------------------------------ body
function torsoRings() {
  const T = [
    [0.845, 0.05, 0.05, 0.0], [0.87, 0.125, 0.09, 0.0], [0.91, 0.162, 0.112, -0.006], [0.97, 0.172, 0.117, -0.006],
    [1.03, 0.162, 0.111, 0.0], [1.1, 0.152, 0.106, 0.0], [1.18, 0.158, 0.111, 0.0], [1.26, 0.171, 0.119, -0.004],
    [1.34, 0.181, 0.119, -0.01], [1.4, 0.182, 0.112, -0.015], [1.45, 0.168, 0.096, -0.02], [1.48, 0.14, 0.084, -0.022], [1.51, 0.1, 0.072, -0.022], [1.545, 0.068, 0.062, -0.02],
  ];
  return T.map(([y, rx, rz, z]) => ({
    c: V(0, y, z), x: V(1, 0, 0), z: V(0, 0, 1), rx, rz, p: 2.3,
    bump: (th) => 1 + (y < 1.0 && Math.sin(th) < 0 ? 0.08 * Math.pow(-Math.sin(th), 2) * smooth(0.86, 0.93, y) : 0) + 0.012 * Math.sin(th * 5 + y * 30),
  }));
}

function buildBody(B, L) {
  // torso (combat shirt / trousers)
  B.add(sweep(torsoRings(), 28, { capStart: true }), { g: 'uniform', w: torsoW, col: 0xffffff, jitter: 0 });
  for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
    const sideV = V(s, 0, 0);
    // upper arm (sleeve) with deltoid dome
    B.add(limb(J['shoulder' + k], J['elbow' + k], V(0, 0, 1), (t) => ({
      rx: 0.06 - 0.012 * t + 0.005 * Math.sin(t * Math.PI), rz: 0.058 - 0.01 * t + 0.006 * Math.sin(t * 3),
      ox: 0, oz: 0.004 * Math.sin(t * Math.PI), p: 2,
      bump: (th) => 1 + 0.035 * Math.sin(th * 3 + t * 9) * (0.5 + 0.5 * Math.sin(t * 11)) + 0.02 * Math.sin(th * 7 - t * 5),
    }), { nv: 12, nu: 20, t0: -0.1, domeStart: 0.05 }), { g: 'uniform', w: chain(['clav' + k, 'uarm' + k, 'farm' + k]), jitter: 0 });
    // shoulder pocket + velcro patch (on upper sleeve, outer side)
    const sp = J['shoulder' + k].clone().lerp(J['elbow' + k], 0.35).add(V(0.045 * s, 0, 0.01));
    B.add(xf(rbox(0.012, 0.1, 0.075, 0.005), [sp.x, sp.y, sp.z], [0, 0, 0.07 * s]), { g: 'uniform', w: 'uarm' + k, jitter: 0 });
    B.add(xf(rbox(0.004, 0.05, 0.075, 0.0015), [sp.x + 0.007 * s, sp.y + 0.012, sp.z], [0, 0, 0.07 * s]), { g: 'gear', w: 'uarm' + k, col: k === 'L' ? L.patch : 0x807a66 });
    // forearm sleeve
    B.add(limb(J['elbow' + k], J['wrist' + k], V(0, 0, 1), (t) => ({
      rx: 0.049 + 0.004 * Math.sin(t * 3) - 0.012 * t, rz: 0.047 + 0.005 * Math.sin(t * 3) - 0.009 * t, p: 2,
      bump: (th) => 1 + 0.04 * Math.sin(th * 4 + t * 14) * smooth(0.5, 1, t) + 0.03 * Math.sin(th * 2 + t * 5) * (1 - t),
    }), { nv: 10, nu: 18, t0: -0.08, t1: 0.9 }), { g: 'uniform', w: chain(['uarm' + k, 'farm' + k, 'hand' + k]), jitter: 0 });
    // glove
    buildHand(B, L, s, k);
    // thigh (baggy combat pants)
    B.add(limb(J['hip' + k], J['knee' + k], V(0, 0, 1), (t) => ({
      rx: 0.1 - 0.028 * t, rz: 0.1 - 0.028 * t + 0.01 * Math.sin(t * Math.PI), ox: 0.01 * s * (1 - t), oz: 0.006 * Math.sin(t * Math.PI), p: 2.1,
      bump: (th) => 1 + 0.03 * Math.sin(th * 3 + t * 7) + 0.025 * Math.sin(th * 5 - t * 13) * smooth(0.6, 1, t),
    }), { nv: 14, nu: 22, t0: -0.12, t1: 1.02 }), { g: 'uniform', w: chain(['hips', 'thigh' + k, 'shin' + k]), jitter: 0 });
    // cargo pocket on thigh side
    const tp = J['hip' + k].clone().lerp(J['knee' + k], 0.45).add(V(0.087 * s, 0, 0.012));
    B.add(jiggle(xf(rbox(0.024, 0.16, 0.12, 0.01, 3), [tp.x, tp.y, tp.z], [0, 0, -0.05 * s]), 0.003), { g: 'uniform', w: 'thigh' + k, jitter: 0 });
    B.add(xf(rbox(0.03, 0.035, 0.125, 0.008), [tp.x + 0.004 * s, tp.y + 0.075, tp.z], [0, 0, -0.05 * s]), { g: 'uniform', w: 'thigh' + k, jitter: 0 });
    // shin with calf, bloused over boot
    B.add(limb(J['knee' + k], J['ankle' + k], V(0, 0, 1), (t) => ({
      rx: 0.07 - 0.02 * t + 0.008 * smooth(0.72, 0.8, t) * (1 - smooth(0.8, 0.9, t)), rz: 0.072 - 0.014 * t + 0.01 * Math.exp(-((t - 0.3) ** 2) / 0.03) + 0.008 * smooth(0.72, 0.8, t) * (1 - smooth(0.8, 0.9, t)),
      oz: -0.012 * Math.exp(-((t - 0.3) ** 2) / 0.03), p: 2,
      bump: (th) => 1 + 0.03 * Math.sin(th * 4 + t * 9) + 0.06 * Math.sin(th * 6 + t * 3) * smooth(0.68, 0.8, t) * (1 - smooth(0.82, 0.9, t)),
    }), { nv: 14, nu: 22, t0: -0.06, t1: 0.86 }), { g: 'uniform', w: chain(['thigh' + k, 'shin' + k, 'foot' + k]), jitter: 0 });
    buildKneePad(B, L, s, k);
    buildBoot(B, L, s, k);
    void sideV;
  }
}

function buildHand(B, L, s, k) {
  // Hand local frame: origin = wrist, down = -Y (fingers), thumb = +Z, palm normal = medial (m = -s)
  const W = J['wrist' + k]; const m = -s;
  const P = (x, y, z) => V(W.x + x * m, W.y + y, W.z + z);
  const gc = P(0.034, -0.068, 0.0); // grip cylinder center (axis Z)
  const add = (geo, extra = {}) => B.add(geo, { g: 'gear', w: 'hand' + k, col: L.glove, uv: 6, rm: [1.05, 0], ...extra });
  // glove cuff over sleeve end
  B.add(limb(P(0, 0.035, 0), P(0, -0.012, 0), V(0, 0, 1), () => ({ rx: 0.036, rz: 0.04, p: 2.4 }), { nv: 2, nu: 16 }), { g: 'gear', w: chain(['farm' + k, 'hand' + k]), col: L.glove, uv: 6 });
  // palm / back of hand: tapered superellipse sweep from wrist to knuckles
  const hr = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    hr.push({ c: P(0.006 + 0.004 * Math.sin(t * Math.PI), -0.005 - t * 0.085, 0.002), x: V(m, 0, 0), z: V(0, 0, 1), rx: 0.017 - 0.003 * t + 0.002 * Math.sin(t * Math.PI), rz: 0.034 + 0.01 * t, p: 2.6 });
  }
  add(sweep(hr, 16, { capStart: true, capEnd: true }));
  // low-profile knuckle armour + velcro wrist strap
  const kg = rbox(0.006, 0.026, 0.07, 0.003);
  add(xf(kg, [W.x - 0.011 * m, W.y - 0.075, W.z + 0.002]), { col: 0x2a2724, rm: [0.9, 0] });
  for (let i = 0; i < 3; i++) add(xf(rbox(0.004, 0.004, 0.068, 0.0015), [W.x - 0.015 * m, W.y - 0.066 - i * 0.009, W.z + 0.002]), { col: 0x222020, rm: [0.9, 0] });
  add(xf(rbox(0.04, 0.018, 0.078, 0.006), [W.x + 0.004 * m, W.y - 0.006, W.z]), { col: L.glove, rm: [1.1, 0] });
  // fingers wrapping the grip cylinder
  const zs = [0.029, 0.01, -0.009, -0.027], lens = [0.9, 1.0, 0.95, 0.8], rads = [0.0095, 0.0098, 0.0092, 0.0083];
  zs.forEach((z, i) => {
    const pts = []; const R = 0.024;
    const a0 = Math.atan2(-0.09 + 0.068, 0.0 - 0.034); // angle of knuckle rel. grip center
    const span = 3.7 * lens[i];
    for (let j = 0; j <= 8; j++) {
      const a = a0 + span * (j / 8); // increasing angle = wrapping under, then front, then up
      pts.push(V(gc.x + Math.cos(a) * R * m * (j === 0 ? 1.2 : 1), gc.y - Math.sin(-a) * R * (j === 0 ? 1.2 : 1), W.z + z));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const rings = [];
    for (let j = 0; j <= 16; j++) {
      const u = j / 16; const c = curve.getPointAt(u), tn = curve.getTangentAt(u);
      const up = V(0, 0, 1); const x = new THREE.Vector3().crossVectors(tn, up).normalize();
      const r = rads[i] * (1 - 0.18 * u) * (1 + 0.1 * Math.max(0, Math.cos(u * Math.PI * 3)));
      rings.push({ c, x, z: up.clone(), rx: r, rz: r * 0.95, p: 2.2 });
    }
    add(sweep(rings, 10, { capEnd: true }));
  });
  // thumb (over the other side of the grip)
  const th = [P(0.012, -0.022, 0.04), P(0.03, -0.035, 0.05), P(0.052, -0.05, 0.035), P(0.06, -0.06, 0.018)];
  add(tubeAlong(th, 0.0105, 10, 8));
  add(xf(sphere(0.0105, 8, 6), [th[3].x, th[3].y, th[3].z]));
}

function buildKneePad(B, L, s, k) {
  const K = J['knee' + k];
  const pad = rbox(0.1, 0.13, 0.03, 0.012, 3);
  deform(pad, (v) => { v.z -= v.x * v.x * 5 + v.y * v.y * 2.5; });
  B.add(xf(pad, [K.x + 0.004 * s, K.y - 0.015, K.z + 0.07]), { g: 'hard', w: 'shin' + k, col: L.kneepad, rm: [1.1, 0] });
  const inner = rbox(0.11, 0.15, 0.02, 0.01, 2);
  deform(inner, (v) => { v.z -= v.x * v.x * 4.5 + v.y * v.y * 2; });
  B.add(xf(inner, [K.x + 0.004 * s, K.y - 0.015, K.z + 0.056]), { g: 'gear', w: 'shin' + k, col: L.gear });
  // strap around the upper shin
  const pts = [];
  for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI * 2; pts.push(V(K.x + Math.sin(a) * 0.066, K.y - 0.075, K.z - 0.002 + Math.cos(a) * 0.067)); }
  B.add(strapAlong(pts, 0.025, 0.004, (c) => c.clone().sub(V(K.x, c.y, K.z)), 24), { g: 'gear', w: 'shin' + k, col: 0x222222 });
}

function buildBoot(B, L, s, k) {
  const A = J['ankle' + k];
  const x0 = A.x, z0 = A.z;
  // foot/vamp: rings along +Z from heel to toe
  const rings = [];
  const N = 14; const zh = z0 - 0.07, zt = z0 + 0.215;
  for (let i = 0; i <= N; i++) {
    const t = i / N; const z = zh + (zt - zh) * t;
    const w = 0.078 + 0.036 * Math.sin(Math.min(1, t * 1.2) * Math.PI * 0.85) - 0.012 * smooth(0.85, 1, t);
    const top = 0.14 - 0.07 * smooth(0.25, 0.85, t) - 0.01 * smooth(0.88, 1, t);
    const bot = 0.025;
    rings.push({ c: V(x0 + 0.004 * s * t, (top + bot) / 2, z), x: V(1, 0, 0), z: V(0, 1, 0), rx: w / 2, rz: (top - bot) / 2, p: 2.6 });
  }
  const foot = sweep(rings, 20, { capStart: true, capEnd: true });
  const fw = (v) => [[BI['foot' + k], 1 - smooth(0.09, 0.14, v.y) * (1 - smooth(z0 + 0.02, z0 + 0.07, v.z))], [BI['shin' + k], smooth(0.09, 0.14, v.y) * (1 - smooth(z0 + 0.02, z0 + 0.07, v.z))]];
  B.add(foot, { g: 'gear', w: fw, col: L.boot, uv: 5, rm: [0.85, 0] });
  // ankle shaft
  B.add(limb(V(x0, 0.075, z0 - 0.01), V(x0, 0.245, z0 - 0.004), V(0, 0, 1), (t) => ({ rx: 0.05 + 0.004 * t, rz: 0.058 - 0.004 * t, p: 2.3 }), { nv: 5, nu: 20 }),
    { g: 'gear', w: fw, col: L.boot, uv: 5, rm: [0.85, 0] });
  // padded collar
  B.add(xf(torus(0.052, 0.008, 6, 20), [x0, 0.245, z0 - 0.004], [Math.PI / 2, 0, 0]), { g: 'gear', w: 'shin' + k, col: L.boot, uv: 5 });
  // sole with toe/heel rand
  const sole = rbox(0.104, 0.028, 0.295, 0.011);
  deform(sole, (v) => { v.x *= 0.78 + 0.22 * Math.sin(Math.min(1, (v.z + 0.15) / 0.3 * 1.25) * Math.PI * 0.85); if (v.z > 0.1) v.y += (v.z - 0.1) ** 2 * 1.5; });
  B.add(xf(sole, [x0 + 0.002 * s, 0.014, z0 + 0.07]), { g: 'hard', w: 'foot' + k, col: L.sole, rm: [1.2, 0] });
  // tread lugs
  for (let i = 0; i < 7; i++) B.add(xf(box(0.09, 0.006, 0.02), [x0, 0.002, zh + 0.02 + i * 0.04]), { g: 'hard', w: 'foot' + k, col: 0x111111, rm: [1.2, 0] });
  // laces: crossing thin bars up the front
  for (let i = 0; i < 6; i++) {
    const y = 0.1 + i * 0.024, zz = z0 + 0.075 - i * 0.012 - (i > 2 ? (i - 2) * 0.004 : 0);
    B.add(xf(box(0.05, 0.004, 0.006), [x0, y, zz + (i < 3 ? 0.03 - i * 0.012 : 0.0)], [0.35 - i * 0.08, 0, (i % 2 ? 0.3 : -0.3)]), { g: 'hard', w: i < 3 ? 'foot' + k : 'shin' + k, col: 0x1a1a18, rm: [1.1, 0] });
  }
  // toe cap scuff guard
  const toe = rbox(0.09, 0.04, 0.07, 0.018, 3);
  B.add(xf(toe, [x0 + 0.003 * s, 0.042, zt - 0.035]), { g: 'hard', w: 'foot' + k, col: L.sole, rm: [1.0, 0] });
}

// ------------------------------------------------------------------ head, helmet, face gear
const HC = V(0, 1.705, 0.012);
function buildHead(B, L) {
  const g = new THREE.SphereGeometry(1, 64, 40);
  deform(g, (v) => {
    const nx = v.x, ny = v.y, nz = v.z;
    let sx = 0.08, sy = 0.114, sz = 0.1;
    const jaw = smooth(-0.15, -0.95, ny);
    const lowK = ny < 0 ? 0.9 : 1;
    sx *= 1 - 0.16 * jaw; sz *= 1 - 0.12 * jaw * (nz < 0 ? 2.2 : 0.4);
    let x = nx * sx, y = ny * sy * lowK, z = nz * sz;
    const fr = Math.max(0, nz);
    const ax = Math.abs(nx);
    z += 0.03 * Math.exp(-(nx * nx) / 0.006 - ((ny + 0.13) ** 2) / 0.02) * fr * smooth(-0.32, -0.1, ny); // nose (bridge -> tip)
    z += 0.01 * Math.exp(-(nx * nx) / 0.004 - ((ny - 0.02) ** 2) / 0.01) * fr; // nasal bridge
    z += 0.01 * Math.exp(-((ny - 0.2) ** 2) / 0.006) * smooth(0.55, 0.9, nz); // brow ridge
    z -= 0.016 * Math.exp(-((ax - 0.34) ** 2) / 0.012 - ((ny - 0.06) ** 2) / 0.008) * fr; // eye sockets
    x += 0.008 * Math.sign(nx) * Math.exp(-((ax - 0.62) ** 2) / 0.03 - ((ny + 0.08) ** 2) / 0.02); // cheekbones
    z += 0.004 * Math.exp(-((ax - 0.45) ** 2) / 0.02 - ((ny + 0.12) ** 2) / 0.02) * fr;
    z += 0.016 * Math.exp(-(nx * nx) / 0.04 - ((ny + 0.8) ** 2) / 0.015) * fr; // chin
    z -= 0.006 * Math.exp(-(nx * nx) / 0.03 - ((ny + 0.62) ** 2) / 0.004) * fr; // below lip crease
    z += 0.006 * Math.exp(-(nx * nx) / 0.04 - ((ny + 0.47) ** 2) / 0.008) * fr; // lips
    x *= 1 + 0.08 * Math.exp(-((ny + 0.55) ** 2) / 0.03); // jaw angle
    // occipital bulge, flatter sides
    z -= 0.008 * smooth(0.0, -0.7, nz) * smooth(-0.6, 0.1, ny);
    v.set(x + HC.x, y + HC.y, z + HC.z);
  });
  const ht = headTextures(L.id, { knit: L.knit, skin: [178, 132, 108], open: L.eyes !== 'gasmask' });
  void ht;
  B.add(clean(g), { g: 'head', shift: true, w: (v) => [[BI.head, smooth(1.585, 1.625, v.y)], [BI.neck, 1 - smooth(1.585, 1.625, v.y)]], jitter: 0 });
  // balaclava neck (bunched fabric)
  B.add(limb(V(0, 1.46, -0.02), V(0, 1.64, -0.005), V(0, 0, 1), (t) => ({ rx: 0.074 - 0.01 * t, rz: 0.072 - 0.008 * t, oz: 0.01 * t, p: 2, bump: (th) => 1 + 0.05 * Math.sin(th * 5 + t * 12) * (1 - t) }), { nv: 6, nu: 20 }),
    { g: 'head', w: chain(['chest', 'neck', 'head']), uv: 1.7, uvOff: [0, 0.03] });
}

function helmetPoint(c, R, phi, el, off = 0) {
  return V(c.x + Math.sin(phi) * Math.cos(el) * (R.x + off), c.y + Math.sin(el) * (R.y + off), c.z + Math.cos(phi) * Math.cos(el) * (R.z + off));
}
function lerpKeys(keys, a) {
  a = Math.abs(a);
  for (let i = 0; i < keys.length - 1; i++) if (a <= keys[i + 1][0]) { const t = (a - keys[i][0]) / (keys[i + 1][0] - keys[i][0]); const u = t * t * (3 - 2 * t); return keys[i][1] + (keys[i + 1][1] - keys[i][1]) * u; }
  return keys[keys.length - 1][1];
}
/** shell patch over phi range/elevation range; rimFn(phi) gives lower elevation. */
function shellPatch(c, R, phi0, phi1, elTop, rimFn, off, nu = 48, nv = 14) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= nv; i++) for (let j = 0; j <= nu; j++) {
    const phi = phi0 + (phi1 - phi0) * (j / nu);
    const el = elTop + (rimFn(phi) - elTop) * (i / nv);
    const p = helmetPoint(c, R, phi, el, off);
    pos.push(p.x, p.y, p.z); uv.push(phi * 0.13, el * 0.13);
  }
  const W = nu + 1;
  for (let i = 0; i < nv; i++) for (let j = 0; j < nu; j++) { const a = i * W + j, b = a + 1, cc = a + W, d = cc + 1; idx.push(a, b, cc, b, d, cc); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  // ensure outward
  const n = g.attributes.normal; const p0 = V(pos[(W * 4 + 5) * 3], pos[(W * 4 + 5) * 3 + 1], pos[(W * 4 + 5) * 3 + 2]);
  if (V(n.getX(W * 4 + 5), n.getY(W * 4 + 5), n.getZ(W * 4 + 5)).dot(p0.sub(c)) < 0) { idx.reverse(); g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}

function buildHelmet(B, L) {
  const c = V(0, 1.722, 0.004); const R = V(0.117, 0.118, 0.13);
  const rimKeys = [[0, 0.16], [0.75, 0.2], [1.2, 0.5], [1.75, 0.47], [2.25, 0.02], [Math.PI, -0.2]];
  const rim = (phi) => lerpKeys(rimKeys, phi);
  const shellGroup = L.helmetCamo ? 'uniform' : 'hard';
  const col = L.helmetCamo ? 0xe8e8e8 : L.helmetColor;
  const hw = 'head';
  // outer shell
  B.add(shellPatch(c, R, -Math.PI, Math.PI, Math.PI / 2 - 0.001, rim, 0, 64, 16), { g: shellGroup, w: hw, col, rm: [L.helmetCamo ? 1 : 0.95, 0], uv: L.helmetCamo ? 3 : 3.3, jitter: 0 });
  // inner shell (dark) so the rim reads as thick
  const inner = shellPatch(c, R, -Math.PI, Math.PI, Math.PI / 2 - 0.001, rim, -0.01, 48, 10);
  inner.index.array.reverse(); inner.computeVertexNormals();
  B.add(inner, { g: 'hard', w: hw, col: 0x1a1a1a, rm: [1.2, 0] });
  // rubber edge trim
  const rp = []; for (let i = 0; i <= 64; i++) { const phi = -Math.PI + (i / 64) * Math.PI * 2; rp.push(helmetPoint(c, R, phi, rim(phi), -0.004)); }
  B.add(clean(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rp, true), 96, 0.0055, 6, true)), { g: 'hard', w: hw, col: 0x1c1c1c, rm: [1.2, 0] });
  // cover seams / folds (camo): a couple of raised seams along the top
  if (L.helmetCamo) {
    for (const ph of [-0.6, 0.6]) {
      const pts = []; for (let i = 0; i <= 10; i++) { const el = 1.5 - (i / 10) * 1.2; pts.push(helmetPoint(c, R, ph + Math.PI, el, 0.002)); }
      B.add(tubeAlong(pts, 0.003, 12, 4), { g: 'uniform', w: hw, col: 0xd0d0d0 });
    }
  }
  // velcro loop panels: top & sides
  B.add(shellPatch(c, R, -0.55, 0.55, 1.35, () => 0.72, 0.004, 12, 6), { g: 'gear', w: hw, col: L.helmetCamo ? L.gear : 0x3a3a38, uv: 8 });
  for (const s of [-1, 1]) {
    const a0 = s > 0 ? 1.95 : -2.55, a1 = s > 0 ? 2.55 : -1.95;
    void a0; void a1;
    // ARC rails
    const pts = []; for (let i = 0; i <= 10; i++) { const phi = s * (0.9 + i / 10 * 1.05); pts.push(helmetPoint(c, R, phi, rim(phi) + 0.07, 0.006)); }
    B.add(strapAlong(pts, 0.02, 0.011, (p) => p.clone().sub(c), 16), { g: 'hard', w: hw, col: 0x222222, rm: [0.9, 0.1] });
    // headset ear cup (Comtac-style)
    const ec = V(s * 0.093, 1.693, 0.002);
    const cup = cyl(0.043, 0.046, 0.034, 20); deform(cup, (v) => { const r = Math.hypot(v.x, v.z); if (v.y > 0.01) v.y += (0.004 - r * r * 2); }, true);
    B.add(xf(cup, [ec.x + s * 0.012, ec.y, ec.z], [0, 0, -s * Math.PI / 2]), { g: 'hard', w: hw, col: 0x2c2d29, rm: [1.4, 0] });
    B.add(xf(cyl(0.047, 0.047, 0.012, 20), [ec.x - s * 0.006, ec.y, ec.z], [0, 0, -s * Math.PI / 2]), { g: 'hard', w: hw, col: 0x141414, rm: [1.2, 0] }); // ear seal
    B.add(xf(cyl(0.012, 0.012, 0.01, 10), [ec.x + s * 0.03, ec.y + 0.018, ec.z - 0.01], [0, 0, -s * Math.PI / 2]), { g: 'hard', w: hw, col: 0x222222 }); // volume knob
    B.add(xf(cyl(0.004, 0.004, 0.04, 6), [ec.x + s * 0.025, ec.y + 0.035, ec.z + 0.018], [0.4, 0, 0]), { g: 'hard', w: hw, col: 0x111111 }); // antenna stub
    // headband arm to rail
    B.add(xf(rbox(0.008, 0.05, 0.02, 0.003), [ec.x + s * 0.01, ec.y + 0.045, ec.z], [0, 0, s * 0.3]), { g: 'hard', w: hw, col: 0x222222 });
  }
  // counterweight / battery pouch at back
  const bp = helmetPoint(c, R, Math.PI, 0.18, 0.02);
  B.add(jiggle(xf(rbox(0.1, 0.055, 0.035, 0.01, 3), [bp.x, bp.y, bp.z], [-0.2, 0, 0]), 0.002), { g: 'gear', w: hw, col: L.gear });
  // bungee cords
  for (const s of [-1, 1]) {
    const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(helmetPoint(c, R, s * (0.5 + t * 2.1), 0.95 - Math.sin(t * Math.PI) * 0.35, 0.0035)); }
    B.add(tubeAlong(pts, 0.0016, 20, 4), { g: 'hard', w: hw, col: 0x1a1a1a });
  }
  // NVG shroud
  const sp = helmetPoint(c, R, 0, 0.33, 0.006);
  B.add(xf(rbox(0.05, 0.032, 0.008, 0.003), [sp.x, sp.y, sp.z], [-0.33, 0, 0]), { g: 'hard', w: hw, col: 0x1e1e1e, rm: [0.8, 0.2] });
  if (L.nvg === 'mount' || L.nvg === 'goggles') {
    const mp = helmetPoint(c, R, 0, 0.33, 0.018);
    B.add(xf(rbox(0.028, 0.03, 0.022, 0.004), [mp.x, mp.y, mp.z], [-0.33, 0, 0]), { g: 'hard', w: hw, col: 0x202020, rm: [0.7, 0.3] });
  }
  if (L.nvg === 'goggles') {
    // PVS-31 style binocular flipped up
    const g0 = helmetPoint(c, R, 0, 0.5, 0.05);
    B.add(xf(rbox(0.07, 0.03, 0.04, 0.006), [g0.x, g0.y, g0.z], [-0.6, 0, 0]), { g: 'hard', w: hw, col: 0x1c1c1c });
    const th = 1.05, ax = V(0, Math.cos(th), Math.sin(th));
    for (const s of [-1, 1]) {
      const cp = V(g0.x + s * 0.03, g0.y + 0.012, g0.z + 0.02);
      B.add(xf(cyl(0.017, 0.019, 0.075, 16), [cp.x, cp.y, cp.z], [th, 0, 0]), { g: 'hard', w: hw, col: 0x222222, rm: [0.8, 0.2] });
      const lp = cp.clone().addScaledVector(ax, -0.0385);
      B.add(xf(cyl(0.0165, 0.0165, 0.003, 16), [lp.x, lp.y, lp.z], [th, 0, 0]), { g: 'lens', col: 0x1a2a24 });
    }
    // battery pack cable
    B.add(tubeAlong([helmetPoint(c, R, 0.3, 0.6, 0.012), helmetPoint(c, R, 1.2, 1.0, 0.01), helmetPoint(c, R, 2.6, 0.5, 0.012), helmetPoint(c, R, Math.PI, 0.25, 0.03)], 0.0025, 20, 4), { g: 'hard', w: hw, col: 0x111111 });
  }
  // chin strap
  for (const s of [-1, 1]) {
    const pts = [helmetPoint(c, R, s * 1.45, rim(1.45) + 0.02, -0.03), V(s * 0.075, 1.63, 0.035), V(s * 0.045, 1.595, 0.07), V(0, 1.587, 0.085)];
    B.add(strapAlong(pts, 0.016, 0.003, (p) => p.clone().sub(V(0, 1.66, 0)), 12), { g: 'gear', w: hw, col: 0x2a2a28 });
  }
  // IR strobe / patch on top-back
  const st = helmetPoint(c, R, Math.PI * 0.85, 1.0, 0.014);
  B.add(xf(rbox(0.03, 0.02, 0.04, 0.005), [st.x, st.y, st.z]), { g: 'hard', w: hw, col: 0x2a2a2a });
}

function buildScarf(B, L) {
  if (!L.scarf) return;
  const loops = [[1.505, 0.1, 0.09, 0.034, 0.3, 0.02], [1.548, 0.09, 0.082, 0.028, 1.9, 0.012]];
  for (const [y, rx, rz, hh, ph, drop] of loops) {
    const rings = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const fr = Math.max(0, Math.cos(a));
      const c = V(Math.sin(a) * rx * (1 + 0.04 * Math.sin(a * 3 + ph)), y + Math.sin(a * 2 + ph) * 0.006 - fr * fr * drop, -0.018 + Math.cos(a) * rz * (1 + 0.05 * fr));
      const out = V(Math.sin(a), 0, Math.cos(a));
      const t = 1 + 0.2 * Math.sin(a * 3 + ph) + 0.12 * Math.sin(a * 7 + ph * 2);
      const up = V(0, 1, 0).applyAxisAngle(V(Math.cos(a), 0, -Math.sin(a)), 0.25 * Math.sin(a * 4 + ph));
      rings.push({ c, x: out, z: up, rx: 0.013 * t, rz: hh * t, p: 2.2, bump: (th) => 1 + 0.18 * Math.sin(th * 2 + a * 6 + ph) * Math.abs(Math.cos(th)) });
    }
    B.add(sweep(rings, 12), { g: 'gear', w: chain(['chest', 'neck']), col: L.scarf, uv: 6 });
  }
  // knot / hanging tail at the front
  const knot = sweep([0, 1, 2, 3, 4].map((i) => ({ c: V(0.012 * Math.sin(i), 1.5 - i * 0.022, 0.07 + i * 0.006), x: V(1, 0, 0), z: V(0, 0.2, 1).normalize(), rx: 0.03 - i * 0.004, rz: 0.012, p: 2 })), 10, { capStart: true, capEnd: true });
  B.add(knot, { g: 'gear', w: 'chest', col: L.scarf, uv: 6 });
}

function buildFaceGear(B, L) {
  if (L.eyes === 'glasses') {
    // wraparound ballistic glasses
    const pts = [];
    for (let i = 0; i <= 16; i++) { const a = -1.25 + (i / 16) * 2.5; pts.push(V(Math.sin(a) * 0.09, 1.713 + Math.cos(a) * 0.003, 0.012 + Math.cos(a) * 0.118)); }
    const lens = strapAlong(pts, 0.036, 0.003, (p) => V(p.x, 0, p.z - 0.012), 32);
    deform(lens, (v) => { if (v.y < 1.713) { v.y += 0.014 * Math.exp(-((v.x / 0.016) ** 2)) - 0.004 * Math.exp(-(((Math.abs(v.x) - 0.04) / 0.02) ** 2)); } });
    B.add(lens, { g: 'lens', w: 'head', col: 0x0a0a0a });
    // frame top bar
    const top = pts.map((p) => V(p.x * 1.02, p.y + 0.019, (p.z - 0.012) * 1.02 + 0.012));
    B.add(tubeAlong(top, 0.0028, 24, 5), { g: 'hard', w: 'head', col: 0x151515 });
    // nose bridge
    B.add(xf(rbox(0.012, 0.01, 0.01, 0.003), [0, 1.697, 0.13]), { g: 'hard', w: 'head', col: 0x151515 });
  } else if (L.eyes === 'gasmask') {
    // full-face respirator
    const c = V(0, 1.69, 0.012), R = V(0.088, 0.125, 0.113);
    const mask = shellPatch(c, R, -1.45, 1.45, 0.42, (phi) => -0.95 + Math.abs(phi) * 0.25, 0.006, 40, 18);
    deform(mask, (v) => { const f = Math.max(0, (v.z - 0.07) / 0.06); v.z += 0.018 * Math.exp(-(v.x * v.x) / 0.0015) * f * smooth(1.7, 1.63, v.y); }, true);
    B.add(mask, { g: 'hard', w: 'head', col: 0x1a1a1a, rm: [1.1, 0] });
    for (const s of [-1, 1]) {
      const ep = helmetPoint(c, R, s * 0.38, 0.14, 0.014);
      const ring = torus(0.022, 0.0045, 8, 20); xf(ring, [ep.x, ep.y, ep.z], [0, s * 0.38, 0]);
      B.add(ring, { g: 'hard', w: 'head', col: 0x2a2a2a, rm: [0.7, 0.2] });
      B.add(xf(cyl(0.022, 0.022, 0.003, 20), [ep.x, ep.y, ep.z], [Math.PI / 2, s * 0.38, 0]), { g: 'lens', w: 'head', col: 0x151a1c });
    }
    // filter canister on left cheek + exhale valve
    const fp = helmetPoint(c, R, 0.75, -0.5, 0.012);
    B.add(xf(cyl(0.036, 0.036, 0.032, 20), [fp.x, fp.y, fp.z], [Math.PI / 2 - 0.5, 0.75, 0]), { g: 'hard', w: 'head', col: 0x3a3c34, rm: [0.9, 0.2] });
    B.add(xf(torus(0.036, 0.003, 4, 20), [fp.x, fp.y, fp.z], [-0.5, 0.75, 0]), { g: 'hard', w: 'head', col: 0x2a2a28 });
    const vp = helmetPoint(c, R, 0, -0.5, 0.025);
    B.add(xf(cyl(0.022, 0.026, 0.03, 16), [vp.x, vp.y, vp.z], [Math.PI / 2 + 0.4, 0, 0]), { g: 'hard', w: 'head', col: 0x1c1c1c });
    B.add(xf(cyl(0.016, 0.016, 0.02, 12), [vp.x, vp.y - 0.004, vp.z + 0.018], [Math.PI / 2 + 0.4, 0, 0]), { g: 'hard', w: 'head', col: 0x111111 });
    // head harness straps
    for (const s of [-1, 1]) B.add(strapAlong([helmetPoint(c, R, s * 1.2, 0.2, 0.006), helmetPoint(c, R, s * 1.8, 0.25, 0.012), helmetPoint(c, R, s * 2.5, 0.1, 0.012)], 0.018, 0.003, (p) => p.clone().sub(c), 10), { g: 'hard', w: 'head', col: 0x151515 });
  }
}

// ------------------------------------------------------------------ plate carrier & load bearing
function plateShape(w, h, cut) {
  const s = new THREE.Shape(); const x = w / 2, y = h / 2, r = 0.02;
  s.moveTo(-x + r, -y); s.lineTo(x - r, -y); s.quadraticCurveTo(x, -y, x, -y + r);
  s.lineTo(x, y - cut); s.quadraticCurveTo(x, y - cut * 0.4, x - cut * 0.7, y - 0.004); s.quadraticCurveTo(x - cut * 0.9, y, x - cut - 0.01, y);
  s.lineTo(-x + cut + 0.01, y); s.quadraticCurveTo(-x + cut * 0.9, y, -x + cut * 0.7, y - 0.004); s.quadraticCurveTo(-x, y - cut * 0.4, -x, y - cut);
  s.lineTo(-x, -y + r); s.quadraticCurveTo(-x, -y, -x + r, -y);
  return s;
}
const PC = { zf: 0.148, zb: -0.152, k: 1.7 };
const plateZ = (x, front = true) => (front ? PC.zf - PC.k * x * x : PC.zb + PC.k * x * x);
function onPlate(x, y, dz = 0) { return { p: [x, y, plateZ(x) + dz], r: [0, Math.atan(2 * PC.k * x), 0] }; }

function buildVest(B, L) {
  const W = torsoW;
  // front / back plate bags
  for (const front of [true, false]) {
    const g = extrude(plateShape(0.275, front ? 0.325 : 0.345, 0.055), 0.042, 0.008);
    if (!front) g.rotateY(Math.PI);
    deform(g, (v) => { v.z += plateZ(v.x, front); v.y += front ? 1.245 : 1.255; });
    B.add(jiggle(g, 0.0015, 25), { g: 'molle', w: W, col: L.molle });
  }
  // cummerbund (both sides)
  for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 10; i++) { const a = -0.72 + (i / 10) * 1.44; pts.push(V(s * Math.cos(a) * 0.185, 1.165, -0.004 + Math.sin(a) * 0.15)); }
    B.add(jiggle(strapAlong(pts, 0.17, 0.022, (p) => V(p.x, 0, p.z + 0.004), 20), 0.0015), { g: 'molle', w: W, col: L.molle });
  }
  // shoulder straps with padding
  for (const s of [-1, 1]) {
    const pts = [V(s * 0.1, 1.395, 0.135), V(s * 0.115, 1.46, 0.085), V(s * 0.125, 1.5, 0.0), V(s * 0.12, 1.47, -0.1), V(s * 0.1, 1.415, -0.145)];
    B.add(strapAlong(pts, 0.058, 0.022, (p) => p.clone().sub(V(s * 0.1, 1.36, -0.005)), 20), { g: 'gear', w: W, col: L.gear });
    // strap buckle at front
    B.add(xf(rbox(0.05, 0.03, 0.012, 0.004), [s * 0.1, 1.405, 0.148]), { g: 'hard', w: W, col: 0x1e1e1e });
  }
  // triple mag pouch + mags
  for (let i = -1; i <= 1; i++) {
    const x = i * 0.074; const P = onPlate(x, 1.148, 0.036);
    B.add(jiggle(xf(rbox(0.07, 0.115, 0.036, 0.008, 3), P.p, P.r), 0.0015), { g: 'gear', w: W, col: L.gear });
    // elastic band / flap strap
    const P2 = onPlate(x, 1.18, 0.056);
    B.add(xf(rbox(0.072, 0.02, 0.004, 0.002), P2.p, P2.r), { g: 'gear', w: W, col: 0x222222 });
    // magazine sticking out
    const P3 = onPlate(x, 1.225, 0.036);
    B.add(xf(rbox(0.026, 0.07, 0.062, 0.004), P3.p, [0, P3.r[1] + Math.PI / 2, 0]), { g: 'hard', w: W, col: L.mag, rm: [1.1, 0] });
    const P4 = onPlate(x, 1.262, 0.036);
    B.add(xf(rbox(0.03, 0.01, 0.066, 0.004), P4.p, [0, P4.r[1] + Math.PI / 2, 0]), { g: 'hard', w: W, col: 0x1a1a1a, rm: [1.1, 0] });
    // pull tab
    const P5 = onPlate(x, 1.272, 0.036);
    B.add(xf(torus(0.008, 0.002, 4, 8, Math.PI), P5.p, P5.r), { g: 'gear', w: W, col: 0x1d1d1d });
  }
  // admin / placard flap with patches
  { const P = onPlate(0, 1.33, 0.026); B.add(jiggle(xf(rbox(0.2, 0.075, 0.02, 0.008, 3), P.p, P.r), 0.001), { g: 'gear', w: W, col: L.gear }); }
  { const P = onPlate(-0.045, 1.338, 0.037); B.add(xf(rbox(0.075, 0.045, 0.003, 0.002), P.p, P.r), { g: 'gear', w: W, col: L.patch, uv: 10 }); }
  { const P = onPlate(0.055, 1.338, 0.037); B.add(xf(rbox(0.05, 0.03, 0.003, 0.002), P.p, P.r), { g: 'gear', w: W, col: 0x2a2a2a, uv: 10 }); }
  // tourniquet on front upper right
  { const P = onPlate(-0.1, 1.29, 0.05); B.add(xf(rbox(0.025, 0.075, 0.03, 0.009), P.p, P.r), { g: 'hard', w: W, col: 0x191919, rm: [1.1, 0] }); }
  // radio pouch + radio (left side) with antenna
  {
    const rp = V(0.192, 1.2, -0.02);
    B.add(jiggle(xf(rbox(0.04, 0.14, 0.07, 0.008, 3), [rp.x, rp.y, rp.z], [0, 0, 0.03]), 0.0015), { g: 'gear', w: W, col: L.gear });
    B.add(xf(rbox(0.032, 0.05, 0.06, 0.006), [rp.x + 0.001, rp.y + 0.09, rp.z]), { g: 'hard', w: W, col: 0x2a2c26, rm: [0.9, 0.1] });
    B.add(xf(cyl(0.008, 0.008, 0.02, 10), [rp.x, rp.y + 0.125, rp.z - 0.02]), { g: 'hard', w: W, col: 0x151515 });
    B.add(tubeAlong([V(rp.x, rp.y + 0.13, rp.z - 0.02), V(0.19, 1.44, -0.1), V(0.16, 1.62, -0.15), V(0.14, 1.78, -0.17)], 0.003, 16, 5), { g: 'hard', w: W, col: 0x111111 });
    // PTT cable to front of left strap
    B.add(tubeAlong([V(rp.x, rp.y + 0.12, rp.z + 0.02), V(0.17, 1.36, 0.08), V(0.12, 1.42, 0.13)], 0.003, 16, 5), { g: 'hard', w: W, col: 0x111111 });
    B.add(xf(rbox(0.035, 0.045, 0.02, 0.006), [0.115, 1.425, 0.14], [0.3, 0, 0]), { g: 'hard', w: W, col: 0x1c1c1c });
  }
  // grenade pouches (right side)
  for (let i = 0; i < 2; i++) {
    const a = -0.25 + i * 0.4; const gp = V(-Math.cos(a) * 0.205, 1.18, Math.sin(a) * 0.16);
    B.add(jiggle(xf(cyl(0.029, 0.03, 0.085, 14), [gp.x, gp.y, gp.z]), 0.001), { g: 'gear', w: W, col: L.gear });
    B.add(xf(cyl(0.02, 0.026, 0.03, 12), [gp.x, gp.y + 0.055, gp.z]), { g: 'hard', w: W, col: 0x3d4230, rm: [0.9, 0.2] });
    B.add(xf(box(0.008, 0.035, 0.012), [gp.x - 0.005, gp.y + 0.06, gp.z + 0.02]), { g: 'hard', w: W, col: 0x606060, rm: [0.6, 0.6] });
  }
  // back: hydration carrier or assault pack
  if (L.back === 'hydration') {
    B.add(jiggle(xf(rbox(0.21, 0.32, 0.055, 0.02, 4), [0, 1.23, -0.205]), 0.003), { g: 'molle', w: W, col: L.molle });
    B.add(tubeAlong([V(-0.08, 1.38, -0.2), V(-0.13, 1.47, -0.1), V(-0.13, 1.47, 0.05), V(-0.11, 1.4, 0.15), V(-0.1, 1.33, 0.165)], 0.007, 20, 6), { g: 'gear', w: W, col: L.gear });
  } else {
    B.add(jiggle(xf(rbox(0.26, 0.36, 0.12, 0.04, 4), [0, 1.2, -0.25]), 0.004), { g: 'molle', w: W, col: L.molle });
    B.add(jiggle(xf(rbox(0.2, 0.14, 0.05, 0.02, 3), [0, 1.11, -0.325]), 0.003), { g: 'gear', w: W, col: L.gear });
    for (const s of [-1, 1]) B.add(xf(rbox(0.03, 0.3, 0.008, 0.003), [s * 0.08, 1.21, -0.315]), { g: 'gear', w: W, col: 0x222222 });
    B.add(tubeAlong([V(-0.12, 1.35, -0.25), V(-0.14, 1.26, -0.28), V(-0.12, 1.12, -0.28)], 0.004, 10, 4), { g: 'hard', w: W, col: 0x1a1a1a });
  }
  // drag handle
  B.add(xf(torus(0.025, 0.006, 5, 10, Math.PI), [0, 1.43, -0.17], [0.3, 0, 0]), { g: 'gear', w: W, col: 0x222222 });

  // battle belt + pouches
  const belt = []; for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; belt.push(V(Math.cos(a) * 0.182, 0.975, -0.004 + Math.sin(a) * 0.128)); }
  const bc = new THREE.CatmullRomCurve3(belt, true);
  const rings = []; for (let i = 0; i <= 48; i++) { const u = (i % 48) / 48; const c = bc.getPointAt(u), t = bc.getTangentAt(u); const nrm = V(c.x, 0, c.z + 0.004).normalize(); const sd = new THREE.Vector3().crossVectors(t, nrm).normalize(); rings.push({ c, x: sd, z: nrm, rx: 0.026, rz: 0.008, p: 8 }); }
  B.add(sweep(rings, 12), { g: 'molle', w: 'hips', col: L.molle });
  B.add(xf(rbox(0.06, 0.045, 0.012, 0.005), [0, 0.975, 0.135]), { g: 'hard', w: 'hips', col: 0x202020, rm: [0.7, 0.3] }); // buckle
  // pistol mag pouches left front
  for (let i = 0; i < 2; i++) { const a = 0.95 - i * 0.28; const p = V(Math.cos(a) * 0.19, 0.99, Math.sin(a) * 0.14); B.add(jiggle(xf(rbox(0.03, 0.08, 0.025, 0.006), [p.x, p.y, p.z], [0, Math.PI / 2 - a, 0]), 0.001), { g: 'gear', w: 'hips', col: L.gear }); }
  // dump pouch back-left, utility back-right
  B.add(jiggle(xf(rbox(0.12, 0.13, 0.055, 0.02, 3), [0.12, 0.93, -0.14], [0, 0.6, 0]), 0.004), { g: 'gear', w: 'hips', col: L.gear });
  B.add(jiggle(xf(rbox(0.1, 0.09, 0.045, 0.012, 3), [-0.13, 0.96, -0.13], [0, -0.6, 0]), 0.002), { g: 'gear', w: 'hips', col: L.gear });
  // drop-leg holster (right thigh)
  if (L.holster) {
    const hp = J.hipR.clone().lerp(J.kneeR, 0.28).add(V(-0.085, 0, 0.01));
    B.add(xf(rbox(0.012, 0.15, 0.07, 0.005), [hp.x, hp.y, hp.z], [0, 0, 0.06]), { g: 'hard', w: 'thighR', col: 0x1c1c1c });
    B.add(xf(rbox(0.035, 0.13, 0.05, 0.01), [hp.x - 0.02, hp.y - 0.01, hp.z + 0.005], [0, 0, 0.06]), { g: 'hard', w: 'thighR', col: 0x222222, rm: [0.8, 0.1] });
    B.add(xf(rbox(0.025, 0.06, 0.03, 0.006), [hp.x - 0.02, hp.y + 0.07, hp.z - 0.012], [0.25, 0, 0.06]), { g: 'hard', w: 'thighR', col: 0x151515 });
    for (const dy of [0.04, -0.05]) {
      const pts = []; const K = J.hipR.clone().lerp(J.kneeR, 0.28);
      for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI * 2; pts.push(V(K.x + Math.sin(a) * 0.082, K.y + dy, K.z + 0.006 + Math.cos(a) * 0.084)); }
      B.add(strapAlong(pts, 0.03, 0.004, (p) => p.clone().sub(V(K.x, p.y, K.z)), 20), { g: 'gear', w: 'thighR', col: 0x222222 });
    }
  }
}

// ------------------------------------------------------------------ materials
function patchMaterial(m) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 rm;\nvarying vec2 vRM;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRM = rm;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vRM;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * vRM.x, 0.04, 1.0);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = max(metalnessFactor, vRM.y);');
  };
  m.customProgramCacheKey = () => 'soldier-rm';
  return m;
}

const matCache = new Map();
export function soldierMaterials(L) {
  if (matCache.has(L.id)) return matCache.get(L.id);
  const gp = gearTextures(false), gm = gearTextures(true), hd = hardTextures();
  const ht = headTextures(L.id, { knit: L.knit, skin: [178, 132, 108], open: L.eyes !== 'gasmask' });
  const mats = [
    patchMaterial(new THREE.MeshPhysicalMaterial({ map: camoTexture(L.camo), normalMap: uniformNormal(), normalScale: new THREE.Vector2(1.1, 1.1), roughness: 1, envMapIntensity: 0.75, vertexColors: true, sheen: 1, sheenRoughness: 0.75, sheenColor: new THREE.Color(0.07, 0.07, 0.065) })),
    patchMaterial(new THREE.MeshPhysicalMaterial({ map: gp.map, normalMap: gp.normalMap, roughnessMap: gp.roughnessMap, roughness: 1, vertexColors: true, sheen: 1, sheenRoughness: 0.7, sheenColor: new THREE.Color(0.06, 0.06, 0.055) })),
    patchMaterial(new THREE.MeshPhysicalMaterial({ map: gm.map, normalMap: gm.normalMap, normalScale: new THREE.Vector2(1.4, 1.4), roughnessMap: gm.roughnessMap, roughness: 1, vertexColors: true, sheen: 1, sheenRoughness: 0.7, sheenColor: new THREE.Color(0.06, 0.06, 0.055) })),
    patchMaterial(new THREE.MeshStandardMaterial({ map: hd.map, roughnessMap: hd.roughnessMap, normalMap: hd.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.62, metalness: 0, vertexColors: true })),
    patchMaterial(new THREE.MeshPhysicalMaterial({ map: ht.map, normalMap: ht.normalMap, roughnessMap: ht.roughnessMap, roughness: 1, vertexColors: true, sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color(0.08, 0.08, 0.08) })),
    patchMaterial(new THREE.MeshPhysicalMaterial({ roughness: 0.12, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.08, vertexColors: true, color: 0xffffff, envMapIntensity: 0.5 })),
  ];
  matCache.set(L.id, mats);
  return mats;
}

// ------------------------------------------------------------------ template + instance
const tplCache = new Map();
export function getTemplate(L) {
  if (tplCache.has(L.id)) return tplCache.get(L.id);
  const B = new Builder(L.id.length * 7919);
  buildBody(B, L);
  B.shift = V(0, -0.018, 0.006);
  buildHead(B, L);
  buildHelmet(B, L);
  buildFaceGear(B, L);
  B.shift = null;
  buildScarf(B, L);
  buildVest(B, L);
  const rifle = buildRifle(L.rifle, (geo, o) => B.add(geo, o), { furniture: L.furniture, magColor: L.mag, suppressor: L.id !== 'militia' });
  const geometry = B.build();
  bakeAO(geometry);
  const tpl = { loadout: L, geometry, materials: soldierMaterials(L), rifle };
  tplCache.set(L.id, tpl);
  return tpl;
}

/** Cheap baked cavity AO into vertex colors: darken vertices hemmed in by nearby geometry (voxel density). */
function bakeAO(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal, c = geo.attributes.color, si = geo.attributes.skinIndex;
  const cell = 0.03; const grid = new Map();
  const key = (x, y, z) => ((Math.floor(x / cell) + 512) * 1024 + (Math.floor(y / cell) + 512)) * 1024 + (Math.floor(z / cell) + 512);
  const island = (i) => { const b = si.getX(i); return b === BI.weapon || b === BI.mag ? 1 : 0; };
  for (let i = 0; i < p.count; i++) {
    const k = key(p.getX(i), p.getY(i), p.getZ(i)) * 2 + island(i);
    grid.set(k, (grid.get(k) || 0) + 1);
  }
  const v = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); nn.fromBufferAttribute(n, i);
    let occ = 0;
    const isl = island(i);
    for (const d of [0.025, 0.05, 0.08]) {
      const k = key(v.x + nn.x * d, v.y + nn.y * d, v.z + nn.z * d) * 2 + isl;
      occ += Math.min(1, (grid.get(k) || 0) / 18) * (d < 0.03 ? 0.5 : 1);
    }
    const ao = 1 - Math.min(0.55, occ * 0.28);
    c.setXYZ(i, c.getX(i) * ao, c.getY(i) * ao, c.getZ(i) * ao);
  }
  c.needsUpdate = true;
}

const hitMat = new THREE.MeshBasicMaterial({ visible: false });
/**
 * Create a soldier instance: { root:Group, mesh:SkinnedMesh, bones[], hitboxes[] }.
 */
export function createSoldierMesh(tpl) {
  const root = new THREE.Group();
  const { bones, root: rootBone } = createBones();
  const mesh = new THREE.SkinnedMesh(tpl.geometry, tpl.materials);
  mesh.add(rootBone);
  root.add(mesh);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  mesh.bind(skeleton);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.raycast = () => {}; // hits go to hitboxes only
  // hitboxes
  const hitboxes = [];
  const hb = (bone, part, geo, pos) => {
    const m = new THREE.Mesh(geo, hitMat); m.position.copy(pos); m.userData.part = part; m.userData.hitbox = true;
    m.castShadow = false; m.visible = true; bones[BI[bone]].add(m); hitboxes.push(m); return m;
  };
  hb('head', 'head', new THREE.SphereGeometry(0.125, 10, 8), V(0, 0.115, 0.012));
  hb('neck', 'head', new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8), V(0, 0.05, 0.01));
  hb('chest', 'body', new THREE.BoxGeometry(0.42, 0.26, 0.34), V(0, 0.07, 0));
  hb('spine', 'body', new THREE.BoxGeometry(0.38, 0.22, 0.3), V(0, 0.08, 0));
  hb('hips', 'body', new THREE.BoxGeometry(0.36, 0.2, 0.26), V(0, -0.02, 0));
  for (const k of ['L', 'R']) {
    for (const [bn, r] of [['uarm', 0.06], ['farm', 0.05], ['thigh', 0.09], ['shin', 0.07], ['hand', 0.05], ['foot', 0.06]]) {
      const b = BONES[BI[bn + k]]; const g = new THREE.CylinderGeometry(r, r, b.len + r, 8);
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.dir);
      g.applyQuaternion(q);
      hb(bn + k, 'limb', g, b.dir.clone().multiplyScalar(b.len / 2));
    }
  }
  for (const h of hitboxes) h.material = hitMat;
  return { root, mesh, bones, skeleton, hitboxes };
}
