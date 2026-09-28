import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Procedural first-person arms: tactical gloves (coyote fabric, black moulded knuckle armour,
 * synthetic-leather palm/fingertips, velcro wrist strap) and multicam sleeves with rolled cuffs.
 * Hand space: wrist at origin, fingers toward -Z, back of hand +Y, palm -Y, right-hand thumb at -X.
 * The left hand is the same rig mirrored on X.
 */

const FINGERS = {
  //        knuckle position            segment lengths           radius
  index:  { p: [-0.029, 0.002, -0.088], L: [0.043, 0.026, 0.023], r: 0.0098, spread: 0.07 },
  middle: { p: [-0.009, 0.003, -0.093], L: [0.047, 0.030, 0.024], r: 0.0102, spread: 0.0 },
  ring:   { p: [0.011, 0.002, -0.089], L: [0.044, 0.028, 0.023], r: 0.0096, spread: -0.06 },
  pinky:  { p: [0.029, -0.001, -0.080], L: [0.034, 0.022, 0.020], r: 0.0086, spread: -0.14 },
};

function capsule(r, len, taper = 0.9) {
  // capsule along -Z from 0 to -len, slightly flattened (dorsal-palmar) and tapered
  const g = new THREE.CapsuleGeometry(r, Math.max(len - r * 0.6, 0.001), 5, 12);
  g.rotateX(-Math.PI / 2); // +Y -> -Z
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    z -= len / 2 - r * 0.15;
    const t = THREE.MathUtils.clamp(-z / len, 0, 1);
    const k = 1 - (1 - taper) * t;
    x *= k * 1.04; y *= k * (y < 0 ? 0.86 : 0.94);
    pos.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

function blob(sx, sy, sz, e = 0.6, ws = 28, hs = 20) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const f = (v) => Math.sign(v) * Math.pow(Math.abs(v), e);
    p.setXYZ(i, f(x) * sx, f(y) * sy, f(z) * sz);
  }
  g.computeVertexNormals();
  return g;
}

function palmGeo() {
  // palm: rounded slab, wider at knuckles, thicker at the heel, dorsal side domed.
  const g = blob(0.043, 0.0165, 0.052, 0.55, 32, 24);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = (z + 0.052) / 0.104; // 0 at knuckles (-z), 1 at wrist
    x *= 1 - 0.2 * t * t;
    if (y > 0) y *= 1.05 + 0.25 * (1 - Math.abs(x) / 0.045); // dome
    else y *= 1 + 0.35 * t; // heel of palm
    // thenar bulge toward thumb side (-x), palm side
    if (x < 0 && y < 0) y -= 0.006 * Math.max(0, -x / 0.043) * Math.sin(Math.PI * t);
    p.setXYZ(i, x, y, z - 0.047);
  }
  g.computeVertexNormals();
  return g;
}

function sleeveGeo(len = 0.34, r0 = 0.037, r1 = 0.05, seed = 1) {
  // Tube along +Z (wrist -> elbow), elliptical, with cloth folds and a rolled cuff near the wrist.
  const radial = 40, rings = 90;
  const pos = [], idx = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const folds = Array.from({ length: 14 }, () => ({ z: 0.03 + rnd() * (len - 0.05), a: rnd() * 6.28, amp: 0.003 + rnd() * 0.005, w: 0.006 + rnd() * 0.012, tw: (rnd() - 0.5) * 30 }));
  for (let j = 0; j <= rings; j++) {
    const t = j / rings, z = t * len;
    let R = r0 + (r1 - r0) * Math.pow(t, 0.8);
    // rolled cuff bulges
    const cuff = Math.exp(-Math.pow((z - 0.012) / 0.008, 2)) * 0.006 + Math.exp(-Math.pow((z - 0.03) / 0.009, 2)) * 0.005;
    R += cuff;
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      let rr = R;
      for (const f of folds) { const zz = z - f.z - Math.sin(a - f.a) * f.tw * 0.001; rr += f.amp * Math.exp(-Math.pow(zz / f.w, 2)) * (0.35 + 0.65 * Math.pow(Math.max(0, Math.cos(a - f.a)), 2)); }
      rr += 0.0008 * Math.sin(a * 11 + z * 90) * t;
      pos.push(Math.cos(a) * rr * 1.08, Math.sin(a) * rr * 0.9, z);
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < radial; i++) {
    const a = j * (radial + 1) + i, b = a + radial + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function tint(g, c = [1, 1, 1]) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g.index ? g.toNonIndexed() : g;
}
function mesh(g, m) { const o = new THREE.Mesh(tint(g), m); o.frustumCulled = false; o.receiveShadow = true; return o; }

export class Hand {
  constructor(mats, side = 'right') {
    this.side = side;
    this.root = new THREE.Group(); // positioned in weapon space by poses
    const mir = new THREE.Group(); if (side === 'left') mir.scale.x = -1;
    this.root.add(mir); this.mir = mir;

    // palm + back
    mir.add(mesh(palmGeo(), mats.glove));
    const pad = blob(0.036, 0.006, 0.04, 0.5, 20, 12); pad.translate(-0.002, -0.017, -0.05);
    mir.add(mesh(pad, mats.glovePalm));
    // moulded knuckle armour: low-profile shell over the knuckle line + back-of-hand plate
    const armour = [];
    const kn = blob(0.04, 0.0065, 0.017, 0.4, 28, 12); kn.translate(-0.001, 0.0145, -0.078); kn.rotateX(0.04); armour.push(kn);
    mir.add(mesh(mergeGeometries(armour.map((g) => (g.index ? g.toNonIndexed() : g))), mats.gloveDark));
    // wrist cuff + velcro strap (curved band)
    const cuff = new THREE.CylinderGeometry(0.035, 0.033, 0.045, 28, 1, true); cuff.rotateX(Math.PI / 2); cuff.scale(1.05, 0.7, 1); cuff.translate(0, -0.001, 0.014);
    mir.add(mesh(cuff, mats.glove));
    const strap = new THREE.CylinderGeometry(0.0375, 0.0375, 0.022, 24, 1, false, -1.2, 2.2); strap.rotateX(Math.PI / 2); strap.scale(1.05, 0.72, 1); strap.translate(0, -0.001, 0.012);
    mir.add(mesh(strap, mats.gloveDark));

    // fingers
    this.fingers = {};
    for (const [name, f] of Object.entries(FINGERS)) {
      const j0 = new THREE.Group(); j0.position.set(...f.p); mir.add(j0);
      const j1 = new THREE.Group(); j1.position.z = -f.L[0]; j0.add(j1);
      const j2 = new THREE.Group(); j2.position.z = -f.L[1]; j1.add(j2);
      j0.add(mesh(capsule(f.r * 1.02, f.L[0] + f.r * 0.4, 0.93), mats.glove));
      j1.add(mesh(capsule(f.r * 0.95, f.L[1] + f.r * 0.3, 0.93), mats.glove));
      j2.add(mesh(capsule(f.r * 0.9, f.L[2], 0.85), mats.glove));
      // leather fingertip + armour pad on proximal segment
      const tip = blob(f.r * 0.85, f.r * 0.5, f.L[2] * 0.45, 0.7, 12, 8); tip.translate(0, -f.r * 0.45, -f.L[2] * 0.6);
      j2.add(mesh(tip, mats.glovePalm));
      const kp = blob(f.r * 0.8, f.r * 0.35, f.L[0] * 0.3, 0.5, 12, 8); kp.translate(0, f.r * 0.72, -f.L[0] * 0.55);
      j0.add(mesh(kp, mats.gloveDark));
      this.fingers[name] = [j0, j1, j2];
    }
    // thumb: CMC (inside palm) -> proximal -> distal
    const t0 = new THREE.Group(); t0.position.set(-0.03, -0.007, -0.022); mir.add(t0);
    const t1 = new THREE.Group(); t1.position.z = -0.042; t0.add(t1);
    const t2 = new THREE.Group(); t2.position.z = -0.032; t1.add(t2);
    t0.add(mesh(capsule(0.0135, 0.05, 0.85), mats.glove));
    t1.add(mesh(capsule(0.0112, 0.034, 0.95), mats.glove));
    t2.add(mesh(capsule(0.0106, 0.028, 0.85), mats.glove));
    const ttip = blob(0.009, 0.005, 0.012, 0.7, 12, 8); ttip.translate(0, -0.006, -0.016); t2.add(mesh(ttip, mats.glovePalm));
    this.thumb = [t0, t1, t2];
    this.root.traverse((o) => { o.frustumCulled = false; });
  }

  /** pose: {f:{index:[c0,c1,c2,spread],...}, t:[rx,ry,rz,c1,c2]} — angles in radians. */
  setFingers(pose) {
    for (const [name, js] of Object.entries(this.fingers)) {
      const v = pose.f[name] || pose.f.all || [0.3, 0.3, 0.2, 0];
      const f = FINGERS[name];
      js[0].rotation.set(-v[0], f.spread + (v[3] || 0), 0, 'YXZ');
      js[1].rotation.set(-v[1], 0, 0);
      js[2].rotation.set(-v[2], 0, 0);
    }
    const t = pose.t;
    this.thumb[0].rotation.set(t[0], t[1], t[2], 'YXZ');
    this.thumb[1].rotation.set(-t[3], 0, 0);
    this.thumb[2].rotation.set(-t[4], 0, 0);
  }
}

export class Forearm {
  constructor(mats, seed = 1) {
    this.root = new THREE.Group();
    const s = mesh(sleeveGeo(0.36, 0.036, 0.05, seed), mats.sleeve);
    s.position.z = 0.03; this.root.add(s);
    // rolled cuff lip so the sleeve opening has thickness
    const lip = new THREE.TorusGeometry(0.0375, 0.0055, 10, 40); lip.scale(1.1, 0.92, 1.1);
    const lm = mesh(lip, mats.sleeve); lm.position.z = 0.031; this.root.add(lm);
    // glove cuff tail visible under the sleeve edge
    const under = new THREE.CylinderGeometry(0.035, 0.035, 0.05, 24, 1, true); under.rotateX(Math.PI / 2); under.scale(1.04, 0.82, 1); under.translate(0, 0, 0.035);
    this.root.add(mesh(under, mats.glove));
    this.root.traverse((o) => { o.frustumCulled = false; });
  }
}

export function addWatch(forearm, mats) {
  const g = new THREE.Group();
  const body = new RoundedBoxGeometry(0.036, 0.012, 0.04, 3, 0.005);
  const band = new THREE.CylinderGeometry(0.039, 0.039, 0.02, 28, 1, true); band.rotateX(Math.PI / 2); band.scale(1.08, 0.86, 1);
  const bm = mesh(band, mats.poly); g.add(bm);
  const b = mesh(body, mats.poly); b.position.set(0, 0.038, 0); g.add(b);
  const face = new THREE.CylinderGeometry(0.012, 0.012, 0.002, 20); face.translate(0, 0.045, 0);
  g.add(mesh(face, mats.lensInner));
  g.position.z = 0.06;
  forearm.root.add(g);
  return g;
}
