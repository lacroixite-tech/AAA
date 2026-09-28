import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Geometry helpers used to sculpt soldiers and rifles. All sizes in meters. */

const _v = new THREE.Vector3(), _n = new THREE.Vector3();

/** Make sure geometry is indexed and only has position/normal/uv. */
export function clean(geo) {
  let g = geo;
  if (!g.index) {
    const n = g.attributes.position.count; const idx = new Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(idx);
  }
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.clearGroups();
  return g;
}

/** Apply position/rotation(euler XYZ, radians)/scale to a geometry. */
export function xf(geo, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...(Array.isArray(scl) ? scl : [scl, scl, scl])));
  geo.applyMatrix4(m); return geo;
}
export function xfm(geo, m) { geo.applyMatrix4(m); return geo; }

/** Box-projected UVs in meters (1 uv = 1 m * scale), picked from dominant normal axis. */
export function planarUV(geo, scale = 1) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else if (ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv.setXY(i, u * scale, v * scale);
  }
  uv.needsUpdate = true; return geo;
}

/** Light rounded box (~96 verts): chamfered-rounded edges with smooth normals, UVs planar in meters. */
export function rbox(w, h, d, r = 0.005) {
  r = Math.max(1e-4, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const g = new THREE.BoxGeometry(1, 1, 1, 3, 3, 3);
  const half = [w / 2, h / 2, d / 2];
  const p = g.attributes.position, n = g.attributes.normal;
  const map = (c, hh) => (c < -0.4 ? -hh : c < 0 ? -hh + r : c < 0.4 ? hh - r : hh);
  const q = new THREE.Vector3(), inner = new THREE.Vector3(), dn = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    q.set(map(p.getX(i), half[0]), map(p.getY(i), half[1]), map(p.getZ(i), half[2]));
    inner.set(Math.max(-half[0] + r, Math.min(half[0] - r, q.x)), Math.max(-half[1] + r, Math.min(half[1] - r, q.y)), Math.max(-half[2] + r, Math.min(half[2] - r, q.z)));
    dn.subVectors(q, inner);
    if (dn.lengthSq() > 1e-12) { dn.normalize(); q.copy(inner).addScaledVector(dn, r); n.setXYZ(i, dn.x, dn.y, dn.z); }
    p.setXYZ(i, q.x, q.y, q.z);
  }
  const out = clean(g);
  return planarUV(out, 1);
}
export function box(w, h, d) { return clean(new THREE.BoxGeometry(w, h, d)); }
export function cyl(rt, rb, h, seg = 12, open = false) { return clean(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)); }
export function sphere(r, ws = 12, hs = 8) { return clean(new THREE.SphereGeometry(r, ws, hs)); }
export function torus(r, t, rs = 6, ts = 16, arc = Math.PI * 2) { return clean(new THREE.TorusGeometry(r, t, rs, ts, arc)); }

/**
 * Generic ring-sweep: rings = [{c:Vector3, x:Vector3, z:Vector3, rx, rz, p?, bump?(theta)}]
 * Produces a closed tube (optionally capped). UV: u = arc length (m), v = distance along (m).
 */
export function sweep(rings, nu = 16, { capStart = false, capEnd = false } = {}) {
  const pos = [], uv = [], idx = [];
  let vacc = 0;
  const rows = rings.length;
  for (let r = 0; r < rows; r++) {
    const R = rings[r];
    if (r > 0) vacc += R.c.distanceTo(rings[r - 1].c);
    const pe = R.p || 2;
    let uacc = 0, prev = null;
    for (let j = 0; j <= nu; j++) {
      const th = (j / nu) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const ce = Math.sign(c) * Math.pow(Math.abs(c), 2 / pe), se = Math.sign(s) * Math.pow(Math.abs(s), 2 / pe);
      const b = R.bump ? R.bump(th) : 1;
      _v.copy(R.c).addScaledVector(R.x, ce * R.rx * b).addScaledVector(R.z, se * R.rz * b);
      if (prev) uacc += _v.distanceTo(prev);
      prev = prev ? prev.copy(_v) : _v.clone();
      pos.push(_v.x, _v.y, _v.z); uv.push(uacc, vacc);
    }
  }
  const W = nu + 1;
  // winding: outward requires x == tangent x z; flip otherwise
  const mid = Math.max(0, Math.min(rows - 2, rows >> 1));
  const tan = rings[mid + 1].c.clone().sub(rings[mid].c);
  const flip = tan.lengthSq() > 1e-12 && new THREE.Vector3().crossVectors(tan, rings[mid].z).dot(rings[mid].x) < 0;
  for (let r = 0; r < rows - 1; r++) for (let j = 0; j < nu; j++) {
    const a = r * W + j, b = a + 1, c = a + W, d = c + 1;
    if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // orientation check: make normals point outward
  g.computeVertexNormals();
  fixSeamNormals(g, rows, W);
  const flipAll = flip;
  const cap = (row, flip) => {
    const R = rings[row]; const base = pos.length / 3;
    pos.push(R.c.x, R.c.y, R.c.z); uv.push(0, 0);
    for (let j = 0; j < nu; j++) { const a = row * W + j, b = a + 1; if (flip !== flipAll) idx.push(base, a, b); else idx.push(base, b, a); }
  };
  if (capStart || capEnd) {
    if (capStart) cap(0, true);
    if (capEnd) cap(rows - 1, false);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals(); fixSeamNormals(g, rows, W);
  }
  return g;
}

function fixSeamNormals(g, rows, W) {
  const n = g.attributes.normal;
  for (let r = 0; r < rows; r++) {
    const a = r * W, b = r * W + W - 1;
    _n.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, _n.x, _n.y, _n.z); n.setXYZ(b, _n.x, _n.y, _n.z);
  }
}

/**
 * Limb tube between points a->b. `front` = reference forward vector.
 * profile(t) -> {rx, rz, ox?, oz?, p?, bump?}  (ox: offset along side axis, oz along front axis)
 * t range can extend beyond [0,1] via tStart/tEnd; ends are domed when dome=true.
 */
export function limb(a, b, front, profile, { nv = 12, nu = 16, t0 = 0, t1 = 1, domeStart = 0, domeEnd = 0 } = {}) {
  const d = new THREE.Vector3().subVectors(b, a); const len = d.length(); d.normalize();
  const z = front.clone().addScaledVector(d, -front.dot(d)).normalize();
  const x = new THREE.Vector3().crossVectors(d, z).normalize();
  const rings = [];
  const mk = (t, k = 1, extra = 0) => {
    const pr = profile(Math.min(Math.max(t, 0), 1));
    const c = a.clone().addScaledVector(d, t * len + extra).addScaledVector(x, pr.ox || 0).addScaledVector(z, pr.oz || 0);
    rings.push({ c, x, z, rx: Math.max(pr.rx * k, 1e-4), rz: Math.max(pr.rz * k, 1e-4), p: pr.p, bump: pr.bump, t });
  };
  if (domeStart) { for (let i = 0; i < 4; i++) { const ang = (1 - i / 4) * Math.PI / 2; mk(t0, Math.cos(ang), -Math.sin(ang) * domeStart); } }
  for (let i = 0; i <= nv; i++) mk(t0 + (t1 - t0) * (i / nv));
  if (domeEnd) { for (let i = 1; i <= 4; i++) { const ang = (i / 4) * Math.PI / 2; mk(t1, Math.cos(ang), Math.sin(ang) * domeEnd); } }
  const g = sweep(rings, nu);
  g.userData.ringT = rings.map((r) => r.t); g.userData.nu = nu;
  return g;
}

/** Deform all vertices with fn(v:Vector3) (mutates v). Recomputes normals. */
export function deform(geo, fn, recompute = true) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i); fn(_v, i); p.setXYZ(i, _v.x, _v.y, _v.z); }
  p.needsUpdate = true; if (recompute) geo.computeVertexNormals(); return geo;
}

/** Extruded shape (meters) with bevel; returns clean indexed geometry, depth along +z centered. */
export function extrude(shape, depth, bevel = 0.004, curveSeg = 8) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: curveSeg });
  g.translate(0, 0, -depth / 2);
  const out = clean(g);
  // extrude UVs are in shape units (meters) on caps; sides use distance — fine for tiling textures
  return out;
}

export function roundedRectShape(w, h, r) {
  const s = new THREE.Shape(); const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Tube following a curve (for cables, hoses, straps with round section). */
export function tubeAlong(points, radius, seg = 24, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(points);
  return clean(new THREE.TubeGeometry(curve, seg, radius, radial, false));
}

/** Flat strap following a curve: width w, thickness t, `up` = hint for the strap's face normal. */
export function strapAlong(points, w, t, up, seg = 24) {
  const curve = new THREE.CatmullRomCurve3(points);
  const rings = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg; const c = curve.getPointAt(u); const tan = curve.getTangentAt(u);
    const nrm = (typeof up === 'function' ? up(c, u) : up.clone()); nrm.addScaledVector(tan, -nrm.dot(tan)).normalize();
    const side = new THREE.Vector3().crossVectors(tan, nrm).normalize();
    rings.push({ c, x: side, z: nrm, rx: w / 2, rz: t / 2, p: 8 });
  }
  return sweep(rings, 12);
}

export function merge(list) {
  const gs = list.filter(Boolean).map((g) => clean(g));
  return gs.length ? mergeGeometries(gs, false) : null;
}
