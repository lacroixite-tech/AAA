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

/**
 * Batches static geometry by material key and merges into few draw calls.
 * Each add() transforms the geometry to world space and (optionally) generates world-meter UVs.
 */
export class Batch {
  constructor(game) {
    this.game = game; this.groups = new Map(); this.variants = new Map(); this.colGroups = new Map(); this.meshes = [];
    this.cellSize = 80;
  }
  /**
   * opts: { collider=true, surface, uv:'world'|'keep', uvScale, uo, vo, tint }
   * Visuals are merged per (material, spatial cell) with tints baked into vertex colors;
   * colliders are merged separately per surface into invisible meshes.
   */
  add(geo, matName, matrix, opts = {}) {
    let g = geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (opts.uv !== 'keep' || !g.attributes.uv) worldUV(g, opts.uvScale || 1, opts.uo || 0, opts.vo || 0);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.index) { const n = g.attributes.position.count; const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
    g.clearGroups();
    const custom = this.custom?.has(matName);
    if (!custom) {
      const c = new THREE.Color(opts.tint ?? 0xffffff); const n = g.attributes.position.count;
      const col = new Float32Array(n * 3); for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    if (opts.collider !== false) {
      const surface = opts.surface || defaultSurface(matName);
      const cg = new THREE.BufferGeometry(); cg.setAttribute('position', g.attributes.position); cg.setIndex(g.index);
      let cgp = this.colGroups.get(surface); if (!cgp) this.colGroups.set(surface, cgp = []);
      cgp.push(cg);
    }
    g.computeBoundingBox(); const bb = g.boundingBox;
    const cs = this.cellSize, cl = (v) => Math.max(-1, Math.min(1, Math.floor((v + cs / 2) / cs)));
    const cell = `${cl((bb.min.x + bb.max.x) / 2)},${cl((bb.min.z + bb.max.z) / 2)}`;
    const key = `${matName}|${cell}`;
    let grp = this.groups.get(key);
    if (!grp) { grp = { matName, geos: [], verts: 0 }; this.groups.set(key, grp); }
    grp.geos.push(g); grp.verts += g.attributes.position.count;
    if (grp.verts > 300000) this._flush(key, grp);
    return g;
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
  _flush(key, grp) {
    if (!grp.geos.length) return;
    const merged = mergeGeometries(grp.geos, false);
    grp.geos.forEach((g) => g.dispose());
    grp.geos = []; grp.verts = 0;
    merged.computeBoundingSphere(); merged.computeBoundingBox();
    const mesh = new THREE.Mesh(merged, this.vcMaterial(grp.matName));
    mesh.castShadow = !mesh.material.transparent && !mesh.material.alphaTest; mesh.receiveShadow = true;
    if (mesh.material.transparent) mesh.renderOrder = 1;
    if (mesh.material.alphaTest) mesh.castShadow = true;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    mesh.name = `lvl:${key}`;
    (this.root || this.game.scene).add(mesh);
    this.meshes.push(mesh);
  }
  build(root) {
    this.root = root;
    // small materials: merge all their cells into one draw call
    const tot = new Map();
    for (const g of this.groups.values()) tot.set(g.matName, (tot.get(g.matName) || 0) + g.verts);
    for (const [k, g] of [...this.groups]) {
      if (tot.get(g.matName) < 40000 && !k.endsWith('|all')) {
        const ak = g.matName + '|all'; let a = this.groups.get(ak);
        if (!a) this.groups.set(ak, a = { matName: g.matName, geos: [], verts: 0 });
        a.geos.push(...g.geos); a.verts += g.verts; this.groups.delete(k);
      }
    }
    for (const [k, g] of this.groups) this._flush(k, g);
    for (const [surface, list] of this.colGroups) {
      for (let i = 0; i < list.length; i += 4000) {
        const merged = mergeGeometries(list.slice(i, i + 4000), false);
        const m = new THREE.Mesh(merged, PROXY_MAT); m.visible = false; m.matrixAutoUpdate = false;
        m.userData.collider = true; m.userData.surface = surface; m.name = 'lvl:col:' + surface;
        root.add(m);
      }
    }
    this.colGroups.clear();
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

