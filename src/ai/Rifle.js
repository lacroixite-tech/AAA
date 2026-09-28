import * as THREE from 'three';
import { rbox, box, cyl, xf, sweep, extrude, deform, tubeAlong, torus } from './geom.js';

/**
 * Procedural NPC rifles built in "weapon space": origin on the bore axis at the rear of the upper
 * receiver, +Z toward the muzzle, +Y up, +X = weapon's left side.
 * add(geo, {g:'hard', w:'weapon'|'mag', col, rm:[roughMul, metal]})
 */
const BLACK = 0x1d1e1f, ANOD = 0x27282a, STEEL = 0x34353a, FDE = 0x8c7a5e, RUBBER = 0x141414, WOOD = 0x5a3a22, PLUM = 0x3b2a26;

export const RIFLES = {
  m4: {
    right: { pos: new THREE.Vector3(-0.012, -0.108, -0.028), dir: new THREE.Vector3(0.06, -0.12, 1), front: new THREE.Vector3(0, 1, 0.3) },
    left: { pos: new THREE.Vector3(0.014, -0.1, 0.235), dir: new THREE.Vector3(-0.05, -0.1, 1), front: new THREE.Vector3(0, 1, 0.1) },
    magwell: new THREE.Vector3(0, -0.1, 0.1), muzzle: 0.74, sightY: 0.068, buttZ: -0.3,
  },
  ak: {
    right: { pos: new THREE.Vector3(-0.012, -0.105, -0.03), dir: new THREE.Vector3(0.06, -0.12, 1), front: new THREE.Vector3(0, 1, 0.3) },
    left: { pos: new THREE.Vector3(0.014, -0.1, 0.24), dir: new THREE.Vector3(-0.05, -0.1, 1), front: new THREE.Vector3(0, 1, 0.1) },
    magwell: new THREE.Vector3(0, -0.1, 0.1), muzzle: 0.72, sightY: 0.07, buttZ: -0.3,
  },
};

function pistolGrip(add, col) {
  // angled, finger-grooved grip (extruded profile, side view in z/y)
  const s = new THREE.Shape();
  s.moveTo(0.0, 0); s.lineTo(0.04, 0); s.lineTo(0.028, -0.03); s.quadraticCurveTo(0.03, -0.05, 0.02, -0.06);
  s.lineTo(0.005, -0.105); s.quadraticCurveTo(-0.01, -0.118, -0.03, -0.11); s.lineTo(-0.024, -0.06); s.quadraticCurveTo(-0.028, -0.02, 0.0, 0);
  const g = extrude(s, 0.026, 0.004);
  g.rotateY(-Math.PI / 2); // shape x -> +z, extrusion -> x
  xf(g, [0, -0.052, 0.035]);
  add(g, { col, rm: [1.1, 0] });
}

function rail(add, z0, z1, y, col) {
  const len = z1 - z0;
  add(xf(box(0.022, 0.006, len), [0, y, (z0 + z1) / 2]), { col, rm: [0.8, 0.4] });
  const n = Math.floor(len / 0.01);
  for (let i = 0; i < n; i++) add(xf(box(0.021, 0.004, 0.005), [0, y + 0.005, z0 + 0.005 + i * 0.01]), { col, rm: [0.8, 0.4] });
}

function redDot(add) {
  // EOTech-style holographic sight
  add(xf(rbox(0.036, 0.012, 0.09, 0.003), [0, 0.052, 0.08]), { col: BLACK, rm: [0.9, 0.2] }); // base / battery housing
  add(xf(rbox(0.04, 0.045, 0.02, 0.004), [0, 0.078, 0.042]), { col: BLACK, rm: [0.9, 0.2] }); // rear hood
  add(xf(rbox(0.04, 0.045, 0.012, 0.004), [0, 0.078, 0.118]), { col: BLACK, rm: [0.9, 0.2] }); // front hood
  add(xf(rbox(0.006, 0.04, 0.08, 0.002), [0.018, 0.078, 0.08]), { col: BLACK, rm: [0.9, 0.2] });
  add(xf(rbox(0.006, 0.04, 0.08, 0.002), [-0.018, 0.078, 0.08]), { col: BLACK, rm: [0.9, 0.2] });
  add(xf(rbox(0.04, 0.005, 0.085, 0.002), [0, 0.1, 0.08]), { col: BLACK, rm: [0.9, 0.2] });
  add(xf(box(0.03, 0.03, 0.002), [0, 0.078, 0.052]), { g: 'lens', col: 0x223344 });
  add(xf(box(0.03, 0.03, 0.002), [0, 0.078, 0.11]), { g: 'lens', col: 0x223344 });
  add(xf(cyl(0.007, 0.007, 0.012, 10), [0.024, 0.06, 0.07], [0, 0, Math.PI / 2]), { col: BLACK, rm: [0.9, 0.2] }); // knob
  // magnifier flipped to side
  add(xf(cyl(0.017, 0.017, 0.085, 14), [0.045, 0.078, -0.005], [Math.PI / 2, 0, 0]), { col: BLACK, rm: [0.8, 0.2] });
  add(xf(box(0.03, 0.03, 0.03), [0.028, 0.062, -0.005]), { col: BLACK, rm: [0.9, 0.2] });
}

function suppressor(add, z0, r, len) {
  add(xf(cyl(r, r, len, 20), [0, 0, z0 + len / 2], [Math.PI / 2, 0, 0]), { col: 0x2b2a28, rm: [1.0, 0.3] });
  add(xf(cyl(r * 0.8, r, 0.012, 20), [0, 0, z0 + len + 0.006], [Math.PI / 2, 0, 0]), { col: 0x2b2a28, rm: [1.0, 0.3] });
  add(xf(cyl(r * 1.02, r * 1.02, 0.01, 20), [0, 0, z0 + 0.03], [Math.PI / 2, 0, 0]), { col: 0x222222, rm: [1.0, 0.3] });
}

function stanagMag(add, col) {
  // curved 30-round polymer magazine (in weapon space, seated), weight on 'mag' bone
  const rings = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10; const y = -0.06 - t * 0.19; const z = 0.112 + t * t * 0.05;
    rings.push({ c: new THREE.Vector3(0, y, z), x: new THREE.Vector3(1, 0, 0), z: new THREE.Vector3(0, 0.25 * t, 1).normalize(), rx: 0.0125, rz: 0.032 + (i === 10 ? 0.003 : 0), p: 6 });
  }
  const g = sweep(rings, 20, { capStart: true, capEnd: true });
  add(g, { g: 'hard', w: 'mag', col, rm: [1.1, 0] });
  // ribs + base plate
  for (let i = 0; i < 3; i++) add(xf(rbox(0.027, 0.004, 0.066, 0.0015), [0, -0.1 - i * 0.03, 0.116 + (i * 0.03 / 0.19) ** 2 * 0.05]), { g: 'hard', w: 'mag', col, rm: [1.1, 0] });
  add(xf(rbox(0.03, 0.012, 0.075, 0.004), [0, -0.252, 0.165], [0.2, 0, 0]), { g: 'hard', w: 'mag', col, rm: [1.1, 0] });
}

function akMag(add, col) {
  const rings = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12; const a = t * 0.55; const R = 0.3;
    const c = new THREE.Vector3(0, -0.06 - Math.sin(a) * R, 0.105 + (1 - Math.cos(a)) * R);
    const tan = new THREE.Vector3(0, -Math.cos(a), Math.sin(a));
    const zf = new THREE.Vector3(0, Math.sin(a), Math.cos(a));
    rings.push({ c, x: new THREE.Vector3(1, 0, 0), z: zf, rx: 0.013, rz: 0.03, p: 6 });
    void tan;
  }
  add(sweep(rings, 20, { capStart: true, capEnd: true }), { g: 'hard', w: 'mag', col, rm: [1.1, 0] });
  for (let i = 1; i < 6; i++) { const a = i / 6 * 0.55, R = 0.3; add(xf(rbox(0.028, 0.004, 0.064, 0.0015), [0, -0.06 - Math.sin(a) * R, 0.105 + (1 - Math.cos(a)) * R], [-a, 0, 0]), { g: 'hard', w: 'mag', col, rm: [1.1, 0] }); }
}

export function buildRifle(kind, add, opt = {}) {
  const A = (geo, o = {}) => add(geo, { g: 'hard', w: 'weapon', ...o });
  const body = opt.furniture || BLACK;
  if (kind === 'ak') {
    // ------------------------------------------------ AK-12 / AK-74M style
    A(xf(rbox(0.036, 0.062, 0.26, 0.004), [0, -0.018, 0.08]), { col: STEEL, rm: [0.7, 0.6] }); // receiver
    A(xf(rbox(0.037, 0.02, 0.22, 0.008), [0, 0.02, 0.08]), { col: STEEL, rm: [0.6, 0.6] }); // dust cover (rounded)
    rail(A, -0.02, 0.19, 0.035, ANOD);
    A(xf(box(0.004, 0.012, 0.03), [-0.02, 0.0, 0.14]), { col: STEEL, rm: [0.5, 0.8] }); // charging handle
    A(xf(box(0.004, 0.025, 0.07), [-0.019, -0.03, 0.05]), { col: STEEL, rm: [0.6, 0.7] }); // selector lever
    A(xf(rbox(0.045, 0.05, 0.25, 0.01), [0, -0.005, 0.34]), { col: body, rm: [1.05, 0] }); // handguard
    for (let i = 0; i < 5; i++) A(xf(box(0.046, 0.006, 0.02), [0, -0.012, 0.25 + i * 0.045]), { col: 0x101010, rm: [1.2, 0] });
    rail(A, 0.23, 0.46, 0.022, ANOD);
    A(xf(cyl(0.012, 0.012, 0.12, 12), [0, 0.03, 0.34], [Math.PI / 2, 0, 0]), { col: STEEL, rm: [0.6, 0.6] }); // gas tube
    A(xf(cyl(0.009, 0.009, 0.26, 12), [0, 0, 0.54], [Math.PI / 2, 0, 0]), { col: STEEL, rm: [0.5, 0.8] }); // barrel
    A(xf(rbox(0.024, 0.04, 0.03, 0.004), [0, 0.012, 0.48]), { col: STEEL, rm: [0.6, 0.7] }); // gas block / front sight
    A(xf(cyl(0.014, 0.012, 0.075, 14), [0, 0, 0.705], [Math.PI / 2, 0, 0]), { col: STEEL, rm: [0.7, 0.6] }); // muzzle brake
    akMag(add, opt.magColor || 0x3a2e28);
    pistolGrip(A, body);
    A(xf(torus(0.02, 0.003, 6, 12, Math.PI), [0, -0.06, 0.06], [0, Math.PI / 2, Math.PI]), { col: STEEL, rm: [0.6, 0.6] }); // trigger guard
    // folding adjustable stock
    A(xf(rbox(0.035, 0.04, 0.12, 0.006), [0, -0.01, -0.08]), { col: body, rm: [1.05, 0] });
    A(xf(rbox(0.04, 0.12, 0.05, 0.01), [0, -0.045, -0.2]), { col: body, rm: [1.05, 0] });
    A(xf(rbox(0.036, 0.035, 0.14, 0.008), [0, 0.02, -0.19]), { col: body, rm: [1.05, 0] }); // cheek rest
    A(xf(rbox(0.042, 0.13, 0.02, 0.008), [0, -0.045, -0.28]), { col: RUBBER, rm: [1.2, 0] });
    A(xf(rbox(0.02, 0.04, 0.12, 0.004), [0, -0.04, -0.12]), { col: body, rm: [1.05, 0] });
    // vertical grip + optic (collimator)
    A(xf(cyl(0.015, 0.017, 0.09, 12), [0, -0.075, 0.245], [0.15, 0, 0]), { col: body, rm: [1.05, 0] });
    A(xf(rbox(0.034, 0.06, 0.07, 0.008), [0, 0.07, 0.06]), { col: BLACK, rm: [0.9, 0.2] });
    A(xf(cyl(0.017, 0.017, 0.012, 16), [0, 0.078, 0.1], [Math.PI / 2, 0, 0]), { g: 'lens', col: 0x221a14 });
    A(xf(cyl(0.017, 0.017, 0.006, 16), [0, 0.078, 0.022], [Math.PI / 2, 0, 0]), { g: 'lens', col: 0x221a14 });
    // flashlight
    A(xf(cyl(0.012, 0.012, 0.09, 12), [-0.034, 0.0, 0.42], [Math.PI / 2, 0, 0]), { col: BLACK, rm: [0.9, 0.3] });
    A(xf(cyl(0.012, 0.012, 0.003, 12), [-0.034, 0.0, 0.466], [Math.PI / 2, 0, 0]), { g: 'lens', col: 0x777766 });
    return RIFLES.ak;
  }
  // ------------------------------------------------ M4 / MK18 style carbine
  A(xf(rbox(0.028, 0.052, 0.2, 0.004), [0, 0.009, 0.1]), { col: ANOD, rm: [0.85, 0.35] }); // upper receiver
  // lower receiver: side profile extruded (magwell flare, trigger area, buffer tower)
  const lp = new THREE.Shape();
  lp.moveTo(-0.004, -0.018); lp.lineTo(0.172, -0.018); lp.lineTo(0.172, -0.04); lp.quadraticCurveTo(0.16, -0.05, 0.148, -0.05);
  lp.lineTo(0.146, -0.104); lp.lineTo(0.138, -0.109); lp.lineTo(0.082, -0.109); lp.lineTo(0.078, -0.07); lp.lineTo(0.03, -0.066);
  lp.quadraticCurveTo(0.012, -0.066, 0.005, -0.055); lp.lineTo(-0.004, -0.04); lp.lineTo(-0.004, -0.018);
  const lg = extrude(lp, 0.024, 0.0025); lg.rotateY(-Math.PI / 2);
  A(lg, { col: ANOD, rm: [0.85, 0.35] });
  A(xf(rbox(0.03, 0.012, 0.07, 0.003), [0, -0.103, 0.112]), { col: ANOD, rm: [0.85, 0.35] }); // magwell lip
  for (const s of [-1, 1]) A(xf(box(0.002, 0.01, 0.045), [s * 0.0125, -0.075, 0.113]), { col: 0x151515, rm: [1, 0.2] }); // magwell texture
  A(xf(rbox(0.004, 0.02, 0.05, 0.001), [-0.015, 0.012, 0.12]), { col: 0x1a1a1a, rm: [0.7, 0.5] }); // ejection port cover
  A(xf(cyl(0.007, 0.007, 0.016, 10), [-0.018, 0.015, 0.05], [0, 0, Math.PI / 2]), { col: ANOD, rm: [0.8, 0.4] }); // forward assist
  A(xf(rbox(0.05, 0.01, 0.02, 0.003), [0, 0.03, -0.005]), { col: ANOD, rm: [0.8, 0.4] }); // charging handle
  A(xf(box(0.004, 0.006, 0.016), [0.014, -0.028, 0.03], [0, 0, 0]), { col: STEEL, rm: [0.5, 0.8] }); // selector
  A(xf(box(0.004, 0.012, 0.012), [0.014, -0.045, 0.1]), { col: STEEL, rm: [0.5, 0.8] }); // mag release
  rail(A, -0.005, 0.195, 0.038, ANOD);
  // free-float M-LOK handguard (octagonal)
  const hg = sweep([0, 1].map((t) => ({ c: new THREE.Vector3(0, 0.004, 0.2 + t * 0.34), x: new THREE.Vector3(1, 0, 0), z: new THREE.Vector3(0, 1, 0), rx: 0.024, rz: 0.028, p: 3.2 })), 8, { capStart: true, capEnd: true });
  A(hg, { col: ANOD, rm: [0.9, 0.35] });
  rail(A, 0.2, 0.54, 0.034, ANOD);
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) {
    A(xf(box(0.002, 0.009, 0.03), [s * 0.0245, -0.003, 0.24 + i * 0.05]), { col: 0x080808, rm: [1.2, 0] }); // M-LOK slots
  }
  for (let i = 0; i < 4; i++) A(xf(box(0.012, 0.002, 0.03), [0, -0.0245, 0.25 + i * 0.07]), { col: 0x080808, rm: [1.2, 0] });
  A(xf(cyl(0.009, 0.009, 0.12, 12), [0, 0, 0.58], [Math.PI / 2, 0, 0]), { col: STEEL, rm: [0.5, 0.8] }); // barrel
  if (opt.suppressor !== false) suppressor(A, 0.575, 0.021, 0.17);
  else A(xf(cyl(0.011, 0.011, 0.06, 12), [0, 0, 0.66], [Math.PI / 2, 0, 0]), { col: STEEL, rm: [0.7, 0.6] });
  // buffer tube + stock
  A(xf(cyl(0.015, 0.015, 0.2, 14), [0, -0.005, -0.1], [Math.PI / 2, 0, 0]), { col: ANOD, rm: [0.8, 0.4] });
  A(xf(rbox(0.018, 0.02, 0.05, 0.003), [0, -0.034, -0.03], [0.3, 0, 0]), { col: ANOD, rm: [0.8, 0.4] });
  const st = new THREE.Shape();
  st.moveTo(0.06, 0.03); st.lineTo(-0.1, 0.035); st.quadraticCurveTo(-0.12, 0.035, -0.12, 0.02); st.lineTo(-0.12, -0.08);
  st.quadraticCurveTo(-0.12, -0.095, -0.1, -0.09); st.lineTo(-0.06, -0.035); st.lineTo(0.06, -0.02); st.lineTo(0.06, 0.03);
  const sg = extrude(st, 0.036, 0.005); sg.rotateY(-Math.PI / 2);
  A(xf(sg, [0, -0.005, -0.18]), { col: body, rm: [1.05, 0] });
  A(xf(rbox(0.044, 0.125, 0.018, 0.006), [0, -0.03, -0.305]), { col: RUBBER, rm: [1.2, 0] }); // butt pad
  A(xf(box(0.038, 0.03, 0.06), [0, -0.005, -0.12]), { col: body, rm: [1.05, 0] });
  pistolGrip(A, body);
  A(xf(torus(0.02, 0.0028, 6, 12, Math.PI), [0, -0.058, 0.06], [0, Math.PI / 2, Math.PI]), { col: ANOD, rm: [0.8, 0.4] }); // trigger guard
  A(xf(box(0.004, 0.02, 0.006), [0, -0.05, 0.055], [0.3, 0, 0]), { col: STEEL, rm: [0.5, 0.8] }); // trigger
  // angled foregrip
  A(xf(rbox(0.022, 0.025, 0.07, 0.008), [0, -0.034, 0.265], [0.35, 0, 0]), { col: body, rm: [1.05, 0] });
  A(xf(rbox(0.024, 0.07, 0.03, 0.01), [0, -0.06, 0.24], [-0.25, 0, 0]), { col: body, rm: [1.05, 0] });
  // weapon light + pressure pad cable
  A(xf(cyl(0.013, 0.013, 0.1, 14), [-0.036, 0.02, 0.47], [Math.PI / 2, 0, 0]), { col: BLACK, rm: [0.9, 0.3] });
  A(xf(cyl(0.016, 0.013, 0.02, 14), [-0.036, 0.02, 0.525], [Math.PI / 2, 0, 0]), { col: BLACK, rm: [0.9, 0.3] });
  A(xf(cyl(0.015, 0.015, 0.003, 14), [-0.036, 0.02, 0.536], [Math.PI / 2, 0, 0]), { g: 'lens', col: 0x9a9a88 });
  A(xf(box(0.014, 0.012, 0.03), [-0.026, 0.02, 0.47]), { col: BLACK, rm: [0.9, 0.3] });
  A(tubeAlong([new THREE.Vector3(-0.036, 0.01, 0.43), new THREE.Vector3(-0.03, -0.01, 0.39), new THREE.Vector3(-0.02, -0.02, 0.35)], 0.0025, 10, 4), { col: BLACK, rm: [1, 0] });
  // IR laser box on top-left
  A(xf(rbox(0.035, 0.028, 0.07, 0.004), [0.01, 0.055, 0.46]), { col: opt.laserColor || FDE, rm: [1, 0] });
  A(xf(cyl(0.005, 0.005, 0.004, 8), [0.01, 0.058, 0.497], [Math.PI / 2, 0, 0]), { g: 'lens', col: 0x333322 });
  redDot(A);
  // back-up sights folded
  A(xf(rbox(0.02, 0.012, 0.025, 0.002), [0, 0.048, 0.005]), { col: ANOD, rm: [0.8, 0.4] });
  A(xf(rbox(0.02, 0.012, 0.025, 0.002), [0, 0.044, 0.52]), { col: ANOD, rm: [0.8, 0.4] });
  // sling (hangs from the front sling swivel to the stock, under the rifle)
  const slingPts = [new THREE.Vector3(0.02, -0.01, 0.2), new THREE.Vector3(0.03, -0.07, 0.12), new THREE.Vector3(0.03, -0.09, -0.02), new THREE.Vector3(0.025, -0.06, -0.16), new THREE.Vector3(0.022, -0.02, -0.22)];
  A(tubeAlong(slingPts, 0.004, 16, 4).scale(1, 1, 1), { g: 'gear', col: opt.slingColor || 0x3c3a32, rm: [1, 0] });
  stanagMag(add, opt.magColor || FDE);
  void deform; void cyl; void WOOD; void PLUM;
  return RIFLES.m4;
}
