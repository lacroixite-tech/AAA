import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Area-weighted creased normals (non-indexed): big flat faces stay flat next to small bevels. */
export function toCreasedNormals(geo, crease) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position.array, n = p.length / 9;
  const fn = new Float32Array(n * 3), fu = new Float32Array(n * 3);
  const map = new Map(); const q = 1e5;
  const key = (i) => `${Math.round(p[i] * q)},${Math.round(p[i + 1] * q)},${Math.round(p[i + 2] * q)}`;
  for (let f = 0; f < n; f++) {
    const o = f * 9;
    const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2];
    const bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const l = Math.hypot(cx, cy, cz) || 1e-12;
    fu[f * 3] = cx; fu[f * 3 + 1] = cy; fu[f * 3 + 2] = cz;
    fn[f * 3] = cx / l; fn[f * 3 + 1] = cy / l; fn[f * 3 + 2] = cz / l;
    for (let v = 0; v < 3; v++) { const k = key(o + v * 3); let a = map.get(k); if (!a) map.set(k, (a = [])); a.push(f); }
  }
  const out = new Float32Array(p.length); const c = Math.cos(crease);
  for (let f = 0; f < n; f++) for (let v = 0; v < 3; v++) {
    const o = f * 9 + v * 3; const list = map.get(key(o));
    let x = 0, y = 0, z = 0;
    const af = Math.hypot(fu[f * 3], fu[f * 3 + 1], fu[f * 3 + 2]);
    for (const h of list) {
      const d = fn[f * 3] * fn[h * 3] + fn[f * 3 + 1] * fn[h * 3 + 1] + fn[f * 3 + 2] * fn[h * 3 + 2];
      if (d < c) continue;
      // large faces ignore much smaller, non-coplanar neighbours (keeps big caps perfectly flat next to bevels)
      if (d < 0.9999 && af > 6 * Math.hypot(fu[h * 3], fu[h * 3 + 1], fu[h * 3 + 2])) continue;
      x += fu[h * 3]; y += fu[h * 3 + 1]; z += fu[h * 3 + 2];
    }
    const l = Math.hypot(x, y, z) || 1;
    out[o] = x / l; out[o + 1] = y / l; out[o + 2] = z / l;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return g;
}

/**
 * Geometry helpers for hard-surface weapon modelling.
 * Weapon space: X right, Y up, -Z forward (muzzle). Profiles use s = forward distance (= -z).
 */

const DEG = Math.PI / 180;
export { DEG };

/** Polygon with per-vertex fillets: pts = [[x, y, r?], ...]. Returns array of Vector2. */
export function filletPts(pts, segs = 3) {
  const out = []; const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x, y, r = 0] = pts[i];
    if (!r) { out.push(new THREE.Vector2(x, y)); continue; }
    const A = pts[(i - 1 + n) % n], B = pts[(i + 1) % n];
    const P = new THREE.Vector2(x, y);
    const u = new THREE.Vector2(A[0] - x, A[1] - y), v = new THREE.Vector2(B[0] - x, B[1] - y);
    const lu = u.length(), lv = v.length(); u.normalize(); v.normalize();
    const th = Math.acos(THREE.MathUtils.clamp(u.dot(v), -1, 1));
    let d = r / Math.tan(th / 2); d = Math.min(d, lu * 0.49, lv * 0.49);
    const T1 = P.clone().addScaledVector(u, d), T2 = P.clone().addScaledVector(v, d);
    for (let k = 0; k <= segs; k++) {
      const t = k / segs, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
      out.push(new THREE.Vector2(T1.x * a + P.x * b + T2.x * c, T1.y * a + P.y * b + T2.y * c));
    }
  }
  return out;
}

export function shape(pts, holes = [], segs = 3) {
  const s = new THREE.Shape(filletPts(pts, segs));
  for (const h of holes) s.holes.push(new THREE.Path(filletPts(h, segs)));
  return s;
}

/** Rounded rectangle points centred at (cx, cy). */
export function rrect(cx, cy, w, h, r) {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  return [[x0, y0, r], [x1, y0, r], [x1, y1, r], [x0, y1, r]];
}
export function circlePts(cx, cy, r, n = 12) {
  const o = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return o;
}

function extrudeCentered(sh, depth, bevel, bevelSegs, curveSegs) {
  const b = Math.min(bevel, depth * 0.45);
  const g = new THREE.ExtrudeGeometry(sh, {
    depth: Math.max(depth - 2 * b, 1e-5), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b,
    bevelSegments: bevelSegs, steps: 1, curveSegments: curveSegs,
  });
  g.translate(0, 0, -(depth - 2 * b) / 2);
  return g;
}

/** Side profile (s forward, y up) extruded across X with width w. */
export function sideX(sh, w, bevel = 0.001, bevelSegs = 2, curveSegs = 6) {
  const g = extrudeCentered(sh, w, bevel, bevelSegs, curveSegs);
  g.rotateY(Math.PI / 2); // (x,y,z)->(z,y,-x): x=extrude, z=-s
  return g;
}
/** Top profile (x right, s forward) extruded along Y (height h, centred). */
export function topY(sh, h, bevel = 0.001, bevelSegs = 2, curveSegs = 6) {
  const g = extrudeCentered(sh, h, bevel, bevelSegs, curveSegs);
  g.rotateX(-Math.PI / 2); // (x,y,z)->(x,z,-y): y=extrude, z=-s
  return g;
}
/** Front profile (x right, y up) extruded along Z (length l, centred). */
export function frontZ(sh, l, bevel = 0.001, bevelSegs = 2, curveSegs = 6) {
  return extrudeCentered(sh, l, bevel, bevelSegs, curveSegs);
}
/** Lathe around the bore (Z) axis: pts = [[radius, s], ...] (s forward). */
export function latheZ(pts, segs = 24, phiStart = 0, phiLength = Math.PI * 2) {
  if (pts[pts.length - 1][1] < pts[0][1]) pts = pts.slice().reverse(); // keep outward winding
  const g = new THREE.LatheGeometry(pts.map(([r, s]) => new THREE.Vector2(Math.max(r, 1e-5), s)), segs, phiStart, phiLength);
  g.rotateX(-Math.PI / 2); // y -> -z  (s forward)
  return g;
}
/** Cylinder along an arbitrary axis: 'x' | 'y' | 'z'. */
export function cyl(r, len, segs = 16, axis = 'z', r2 = r) {
  const g = new THREE.CylinderGeometry(r2, r, len, segs, 1);
  if (axis === 'z') g.rotateX(-Math.PI / 2);
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  return g;
}
export function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

/** Accumulates geometry per material key, merges into one mesh per material. */
export class PartBuilder {
  constructor(crease = 50) { this.lists = new Map(); this.crease = crease * DEG; }
  add(key, geo, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], tint = [1, 1, 1], crease = null, smooth = false } = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (!smooth) g = toCreasedNormals(g, crease != null ? crease * DEG : this.crease);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.morphAttributes = {};
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r, 'XYZ')), new THREE.Vector3(...s));
    g.applyMatrix4(m);
    const n = g.attributes.position.count; const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = tint[0]; col[i * 3 + 1] = tint[1]; col[i * 3 + 2] = tint[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!this.lists.has(key)) this.lists.set(key, []);
    this.lists.get(key).push(g);
    return g;
  }
  build(mats, { castShadow = false, receiveShadow = true } = {}) {
    const grp = new THREE.Group(); let tris = 0;
    for (const [key, list] of this.lists) {
      const g = mergeGeometries(list, false);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mats[key]);
      mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow; mesh.name = key;
      grp.add(mesh); tris += g.attributes.position.count / 3;
    }
    grp.userData.tris = tris;
    return grp;
  }
}

/** Plane with a UV sub-rectangle of the markings atlas (u0,v0,u1,v1 in 0..1, v from top). */
export function decalPlane(w, h, uv) {
  const g = new THREE.PlaneGeometry(w, h);
  const a = g.attributes.uv;
  const [u0, v0, u1, v1] = uv;
  for (let i = 0; i < a.count; i++) {
    const u = a.getX(i), v = a.getY(i);
    a.setXY(i, u0 + (u1 - u0) * u, 1 - (v0 + (v1 - v0) * (1 - v)));
  }
  return g;
}
