import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Deterministic PRNG (mulberry32). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  const f = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * f());
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.chance = (p) => f() < p;
  return f;
}

export const PROXY_MAT = new THREE.MeshBasicMaterial({ visible: false });
const _v = new THREE.Vector3(), _n = new THREE.Vector3();
/** Box-project UVs in world meters (1 UV = 1 m) using each vertex normal's dominant axis. */
export function worldUV(geo, scale = 1, offU = 0, offV = 0) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i); _n.fromBufferAttribute(n, i);
    const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
    let u, v;
    if (ay >= ax && ay >= az) { u = _v.x; v = _v.z; }
    else if (ax >= az) { u = _n.x > 0 ? -_v.z : _v.z; v = _v.y; }
    else { u = _n.z > 0 ? _v.x : -_v.x; v = _v.y; }
    uv[i * 2] = u * scale + offU; uv[i * 2 + 1] = v * scale + offV;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
/** Compose a matrix from position + euler rotation (+scale). */
export function mat(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

export function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
export function rbox(w, h, d, r = 0.03, seg = 1) { return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)); }
export function cyl(rt, rb, h, seg = 10, open = false) { return new THREE.CylinderGeometry(rt, rb, h, seg, 1, open); }

/** Jitter vertex positions (for rubble/dents). Keeps normals recomputed. */
export function jitter(geo, amt, r) {
  const g = geo.index ? geo : geo; const p = g.attributes.position;
  // weld-aware: hash by rounded position so shared corners move together
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let d = map.get(k); if (!d) { d = [(r() - 0.5) * amt, (r() - 0.5) * amt, (r() - 0.5) * amt]; map.set(k, d); }
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  g.computeVertexNormals();
  return g;
}

class Buf {
  constructor(T, n = 4096) { this.T = T; this.a = new T(n); this.n = 0; }
  reserve(k) { if (this.n + k > this.a.length) { let m = this.a.length * 2; while (m < this.n + k) m *= 2; const b = new this.T(m); b.set(this.a.subarray(0, this.n)); this.a = b; } }
  view() { return this.a.slice(0, this.n); }
}
class Stream {
  constructor(color) { this.pos = new Buf(Float32Array); this.nor = color !== null ? new Buf(Float32Array) : null; this.uv = color !== null ? new Buf(Float32Array) : null; this.col = color ? new Buf(Float32Array) : null; this.idx = new Buf(Uint32Array); this.verts = 0; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.view(), 3));
    if (this.nor) g.setAttribute('normal', new THREE.BufferAttribute(this.nor.view(), 3));
    if (this.uv) g.setAttribute('uv', new THREE.BufferAttribute(this.uv.view(), 2));
    if (this.col) g.setAttribute('color', new THREE.BufferAttribute(this.col.view(), 3));
    const iv = this.idx.view();
    g.setIndex(new THREE.BufferAttribute(this.verts > 65535 ? iv : Uint16Array.from(iv), 1));
    return g;
  }
}
const _nm = new THREE.Matrix3(), _c = new THREE.Color(), _bc = new THREE.Vector3();
const IDENT = new THREE.Matrix4();

/**
 * Batches static geometry by material key and merges into few draw calls.
 * Geometry is streamed straight into per-group typed arrays (transformed to world space, world-meter UVs,
 * tint as vertex color) — no per-piece clones. Visual groups = material x coarse spatial cell;
 * colliders are streamed separately per surface into invisible meshes.
 */
export class Batch {
  constructor(game) {
    this.game = game; this.groups = new Map(); this.variants = new Map(); this.colGroups = new Map(); this.meshes = [];
    this.cellSize = 80;
  }
  /** opts: { collider=true, surface, uv:'world'|'keep', uvScale, uo, vo, tint } */
  add(geo, matName, matrix, opts = {}) {
    const M = matrix || IDENT;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv;
    const n = P.count, index = geo.index;
    const e = M.elements;
    _nm.getNormalMatrix(M); const ne = _nm.elements;
    if (!geo.boundingBox) geo.computeBoundingBox();
    geo.boundingBox.getCenter(_bc).applyMatrix4(M);
    const cs = this.cellSize, cl = (v) => Math.max(-1, Math.min(1, Math.floor((v + cs / 2) / cs)));
    const key = `${matName}|${cl(_bc.x)},${cl(_bc.z)}`;
    const custom = this.custom?.has(matName);
    let grp = this.groups.get(key);
    if (!grp) { grp = { matName, s: new Stream(custom ? false : true), key }; this.groups.set(key, grp); }
    const S = grp.s; const base = S.verts;
    S.pos.reserve(n * 3); S.nor.reserve(n * 3); S.uv.reserve(n * 2); if (S.col) S.col.reserve(n * 3);
    const pa = S.pos.a, na = S.nor.a, ua = S.uv.a;
    let po = S.pos.n, uo = S.uv.n;
    const keepUV = opts.uv === 'keep' && U; const sc = opts.uvScale || 1, ou = opts.uo || 0, ov = opts.vo || 0;
    for (let i = 0; i < n; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      const a = N.getX(i), b = N.getY(i), c = N.getZ(i);
      let nx = ne[0] * a + ne[3] * b + ne[6] * c, ny = ne[1] * a + ne[4] * b + ne[7] * c, nz = ne[2] * a + ne[5] * b + ne[8] * c;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      pa[po] = wx; pa[po + 1] = wy; pa[po + 2] = wz; na[po] = nx; na[po + 1] = ny; na[po + 2] = nz; po += 3;
      if (keepUV) { ua[uo] = U.getX(i); ua[uo + 1] = U.getY(i); }
      else {
        const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz); let u, v;
        if (ay >= ax && ay >= az) { u = wx; v = wz; } else if (ax >= az) { u = nx > 0 ? -wz : wz; v = wy; } else { u = nz > 0 ? wx : -wx; v = wy; }
        ua[uo] = u * sc + ou; ua[uo + 1] = v * sc + ov;
      }
      uo += 2;
    }
    S.pos.n = po; S.nor.n = po; S.uv.n = uo;
    if (S.col) {
      if (Array.isArray(opts.tint)) _c.setRGB(...opts.tint); else _c.set(opts.tint ?? 0xffffff); const ca = S.col.a; let co = S.col.n;
      for (let i = 0; i < n; i++) { ca[co] = _c.r; ca[co + 1] = _c.g; ca[co + 2] = _c.b; co += 3; }
      S.col.n = co;
    }
    const ni = index ? index.count : n;
    S.idx.reserve(ni); const ia = S.idx.a; let io = S.idx.n;
    if (index) for (let i = 0; i < ni; i++) ia[io++] = index.getX(i) + base; else for (let i = 0; i < ni; i++) ia[io++] = i + base;
    S.idx.n = io; S.verts += n;
    if (opts.collider !== false) {
      const surface = opts.surface || defaultSurface(matName);
      let C = this.colGroups.get(surface); if (!C) this.colGroups.set(surface, C = new Stream(null));
      const cb = C.verts; C.pos.reserve(n * 3); C.pos.a.set(pa.subarray(po - n * 3, po), C.pos.n); C.pos.n += n * 3;
      C.idx.reserve(ni); const ca = C.idx.a; let co = C.idx.n;
      for (let i = 0; i < ni; i++) ca[co++] = ia[S.idx.n - ni + i] - base + cb;
      C.idx.n = co; C.verts += n;
    }
    if (S.verts > 400000) this._flush(grp, true);
  }
  register(name, material) { (this.custom ||= new Map()).set(name, material); }
  /** Material for a batch group: custom level materials, or a vertex-colored clone of the library material. */
  vcMaterial(name) {
    if (this.custom?.has(name)) return this.custom.get(name);
    const k = name + '#vc'; let m = this.variants.get(k);
    if (!m) {
      const base = this.game.materials.get(name);
      m = base.clone();
      if (Object.prototype.hasOwnProperty.call(base, 'onBeforeCompile')) m.onBeforeCompile = base.onBeforeCompile;
      if (Object.prototype.hasOwnProperty.call(base, 'customProgramCacheKey')) m.customProgramCacheKey = base.customProgramCacheKey;
      m.userData = { ...base.userData };
      m.vertexColors = true;
      this.variants.set(k, m);
    }
    return m;
  }
  /** Tinted clone (used for instanced meshes). */
  material(name, tint) {
    if (this.custom?.has(name)) return this.custom.get(name);
    const base = this.game.materials.get(name);
    if (tint == null) return base;
    const k = name + '#' + tint;
    let m = this.variants.get(k);
    if (!m) {
      m = base.clone();
      if (Object.prototype.hasOwnProperty.call(base, 'onBeforeCompile')) m.onBeforeCompile = base.onBeforeCompile;
      if (Object.prototype.hasOwnProperty.call(base, 'customProgramCacheKey')) m.customProgramCacheKey = base.customProgramCacheKey;
      if (m.color) m.color.multiply(new THREE.Color(tint));
      this.variants.set(k, m);
    }
    return m;
  }
  _flush(grp, reset) {
    if (!grp.s.verts) return;
    const geo = grp.s.geometry();
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, this.vcMaterial(grp.matName));
    const mt = mesh.material;
    mesh.castShadow = !mt.transparent; mesh.receiveShadow = true;
    if (mt.transparent) mesh.renderOrder = 1;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    mesh.name = `lvl:${grp.key}`;
    (this.root || this.game.scene).add(mesh);
    this.meshes.push(mesh);
    if (reset) grp.s = new Stream(grp.s.col ? true : false);
  }
  build(root) {
    this.root = root;
    // small materials: merge all their cells into one draw call
    const byMat = new Map();
    for (const g of this.groups.values()) { if (!byMat.has(g.matName)) byMat.set(g.matName, []); byMat.get(g.matName).push(g); }
    for (const [name, list] of byMat) {
      const tot = list.reduce((a, g) => a + g.s.verts, 0);
      if (tot < 40000 && list.length > 1) {
        const target = list[0]; target.key = name + '|all';
        for (const g of list.slice(1)) {
          const S = g.s, T = target.s, base = T.verts;
          for (const k of ['pos', 'nor', 'uv', 'col']) if (T[k]) { T[k].reserve(S[k].n); T[k].a.set(S[k].a.subarray(0, S[k].n), T[k].n); T[k].n += S[k].n; }
          T.idx.reserve(S.idx.n); for (let i = 0; i < S.idx.n; i++) T.idx.a[T.idx.n++] = S.idx.a[i] + base;
          T.verts += S.verts; this.groups.delete(g.key);
        }
      }
    }
    for (const g of this.groups.values()) this._flush(g, false);
    for (const [surface, C] of this.colGroups) {
      const m = new THREE.Mesh(C.geometry(), PROXY_MAT); m.visible = false; m.matrixAutoUpdate = false;
      m.userData.collider = true; m.userData.surface = surface; m.name = 'lvl:col:' + surface;
      root.add(m);
    }
    this.colGroups.clear(); this.groups.clear();
    return this.meshes;
  }
}

export function defaultSurface(m) {
  if (typeof m !== 'string') return 'concrete';
  if (m.startsWith('metal') || m === 'car_paint') return 'metal';
  if (m.startsWith('wood')) return 'wood';
  if (m === 'dirt' || m === 'gravel' || m === 'grass' || m === 'rubble') return 'dirt';
  if (m === 'sandbag' || m === 'tarp' || m === 'cloth_camo') return 'sandbag';
  if (m === 'glass') return 'glass';
  if (m === 'rubber' || m === 'plastic') return 'plastic';
  return 'concrete';
}

/** Invisible collision proxy box (for detailed props whose visuals are non-colliding). */
export function proxyBox(parent, w, h, d, matrix, surface = 'concrete') {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), PROXY_MAT);
  m.applyMatrix4(matrix); m.visible = false;
  m.userData.collider = true; m.userData.surface = surface;
  parent.add(m); return m;
}

