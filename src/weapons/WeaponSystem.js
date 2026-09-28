import * as THREE from 'three';
import { makeGunMaterials, VM } from './materials.js';
import { buildRifle, buildMag } from './models/rifle.js';
import { buildPistol } from './models/pistol.js';
import { Hand, Forearm, addWatch } from './arms.js';

/**
 * Weapons + first-person viewmodel. Owner: weapons agent.
 *
 * Public: current {name, ammo, magSize, reserve, fireMode}, reloading, adsAmount (0..1), fovMultiplier,
 *         muzzleObject (Object3D, camera child, positioned where the viewmodel muzzle *appears* on screen),
 *         ejectObject (same for the ejection port), viewmodel (root Group, camera child).
 * Emits: weapon:fire {origin, dir, muzzleWorld, weapon}, hit {...}, weapon:reload {weapon}, weapon:empty,
 *        weapon:switch {weapon}, weapon:mode {weapon, fireMode}.
 * Viewmodel renders in the normal scene pass with its own projection (vmFov) and squashed depth
 * (see materials.js) so it never clips into walls and is lit/shadowed by the real scene.
 */

const DEG = Math.PI / 180;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

class Spring {
  constructor(k = 120, d = 14) { this.x = V3(); this.v = V3(); this.k = k; this.d = d; }
  update(dt, target = null) {
    const n = Math.max(1, Math.ceil(dt / (1 / 240))); const h = dt / n;
    for (let i = 0; i < n; i++) {
      const fx = -(this.x.x - (target ? target.x : 0)) * this.k - this.v.x * this.d;
      const fy = -(this.x.y - (target ? target.y : 0)) * this.k - this.v.y * this.d;
      const fz = -(this.x.z - (target ? target.z : 0)) * this.k - this.v.z * this.d;
      this.v.x += fx * h; this.v.y += fy * h; this.v.z += fz * h;
      this.x.addScaledVector(this.v, h);
    }
    return this.x;
  }
  reset() { this.x.set(0, 0, 0); this.v.set(0, 0, 0); }
}

/** Hand frame from finger (metacarpal) direction F and back-of-hand direction Y (weapon space). */
function frame(F, yl) {
  const Zz = V3(...F).normalize().negate(); const Y = V3(...yl); Y.addScaledVector(Zz, -Y.dot(Zz)).normalize();
  const X = V3().crossVectors(Y, Zz);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Zz));
}
/** Hand pose: palm-centre contact point c, metacarpal direction F, back-of-hand Y. */
function handPose(c, F, yl, fingers, { depth = 0.05, off = 0.024 } = {}) {
  const q = frame(F, yl);
  const Y = V3(0, 1, 0).applyQuaternion(q), Zb = V3(0, 0, 1).applyQuaternion(q);
  const p = V3(...c).addScaledVector(Y, off).addScaledVector(Zb, depth);
  return { p, q, f: fingers };
}

// Finger sets [curl0, curl1, curl2, spread]
const FIST = (a, b, c) => ({ index: [a, b, c, 0], middle: [a, b, c, 0], ring: [a, b, c, 0], pinky: [a, b, c, 0] });

// --------------------------------------------------------------------------------- weapon definitions
const DEFS = {
  rifle: {
    name: 'M4A1', magSize: 30, reserve: 210, rpm: 800, modes: ['auto', 'semi'],
    damage: [34, 22], range: [30, 75], headMul: 1.6, limbMul: 0.85, pellets: 1,
    spread: { hip: 2.6 * DEG, ads: 0.08 * DEG, move: 2.0 * DEG, bloom: 0.45 * DEG, bloomMax: 3.5 * DEG, recover: 7 },
    recoil: {
      back: 0.022, rise: 0.045, side: 0.012, roll: 0.03, adsScale: 0.55,
      cam: [0.0085, 0.0028], // vertical, horizontal (rad per shot)
      pattern: [[1, 0.2], [1.1, 0.5], [1.2, -0.3], [1.1, 0.8], [1.3, 0.6], [1.2, -0.5], [1.0, -0.9], [1.1, -0.4], [0.9, 0.7], [1.0, 1.0], [0.8, 0.3], [0.9, -0.8]],
      recover: 5.5,
    },
    reload: { tac: 2.25, empty: 2.85 },
    adsTime: 0.24, zoom: 1.32, vmFov: 54, vmFovAds: 34,
    hip: { p: [0.088, -0.092, -0.17], r: [0.02, 0.06, -0.07] },
    ads: { eye: 0.15, sightS: 0.042, sightY: 0.0635 },
    sprint: { p: [0.035, -0.125, -0.09], r: [-0.28, 0.72, 0.52] },
    elbowR: [0.3, -0.4, 0.12], elbowL: [-0.3, -0.36, -0.12],
  },
  pistol: {
    name: 'M18', magSize: 17, reserve: 85, rpm: 450, modes: ['semi'],
    damage: [28, 16], range: [15, 35], headMul: 1.5, limbMul: 0.9, pellets: 1,
    spread: { hip: 1.8 * DEG, ads: 0.15 * DEG, move: 1.6 * DEG, bloom: 0.7 * DEG, bloomMax: 3.0 * DEG, recover: 8 },
    recoil: {
      back: 0.03, rise: 0.12, side: 0.02, roll: 0.05, adsScale: 0.6,
      cam: [0.014, 0.003], pattern: [[1, 0.3], [1.1, -0.4], [1, 0.5], [1.2, -0.2]], recover: 7,
    },
    reload: { tac: 1.65, empty: 2.05 },
    adsTime: 0.17, zoom: 1.15, vmFov: 54, vmFovAds: 44,
    hip: { p: [0.062, -0.058, -0.19], r: [0.05, 0.1, -0.03] },
    ads: { eye: 0.27, sightS: 0.004, sightY: 0.0205 },
    sprint: { p: [0.05, -0.16, -0.2], r: [-0.75, 0.25, 0.25] },
    elbowR: [0.2, -0.42, 0.04], elbowL: [-0.14, -0.42, 0.02],
  },
};

// --------------------------------------------------------------------------------- hand poses (weapon space)
function riflePoses() {
  const P = {};
  P.rGrip = handPose([0.017, -0.084, 0.03], [0, -0.3, -0.95], [1, 0.3, 0], {
    index: [0.85, 1.2, 0.5, 0.05], middle: [1.6, 1.65, 0.8, 0], ring: [1.65, 1.65, 0.8, 0], pinky: [1.65, 1.55, 0.75, -0.05],
  }, { depth: 0.05, off: 0.021 });
  P.rGrip.t = [0, 0, 0, 0.35, 0.25]; P.rGrip.tw = [-0.75, 0.25, -0.6];
  // left hand: palm up under the handguard, fingers across/up the right side, thumb along the left
  P.lGuard = handPose([0.011, -0.031, Z(0.36)], [0.75, 0.1, -0.66], [0, -1, 0], {
    index: [1.1, 1.2, 0.6, 0], middle: [1.15, 1.2, 0.6, 0], ring: [1.2, 1.2, 0.6, 0], pinky: [1.25, 1.1, 0.6, 0],
  }, { depth: 0.05, off: 0.022 });
  P.lGuard.t = [0, 0, 0, 0.15, 0.1]; P.lGuard.tw = [0.12, 0.22, -0.96];
  // grabbing the magazine: palm on the front of the mag, fingers wrap its right side
  P.lMag = handPose([0.0, -0.1, Z(0.185)], [0.7, 0.0, 0.5], [-0.5, 0, -0.8], FIST(1.2, 1.3, 0.8), { depth: 0.045, off: 0.022 });
  P.lMag.t = [-0.5, 0.6, 0, 0.3, 0.2];
  P.lBelow = { p: P.lMag.p.clone().add(V3(-0.06, -0.26, 0.08)), q: P.lMag.q.clone(), f: P.lMag.f, t: P.lMag.t };
  P.lInsert = { p: P.lMag.p.clone().add(V3(0, -0.035, 0.0)), q: P.lMag.q.clone(), f: P.lMag.f, t: P.lMag.t };
  // charging handle: hand above-left-rear, fingers hooking the T-handle latch
  P.lCh = handPose([-0.03, 0.03, 0.0], [0.8, -0.3, 0.3], [-0.3, 0.3, 0.9], FIST(1.2, 1.3, 0.8), { depth: 0.045, off: 0.022 });
  P.lCh.t = [-0.3, 0.5, 0, 0.3, 0.2];
  P.lChPulled = { p: P.lCh.p.clone().add(V3(0, 0.002, 0.065)), q: P.lCh.q, f: P.lCh.f, t: P.lCh.t };
  return P;
}

function pistolPoses() {
  const P = {};
  P.rGrip = handPose([0.0165, -0.078, Z(0.012)], [0, -0.25, -0.97], [1, 0.3, 0], {
    index: [0.6, 0.9, 0.4, 0.05], middle: [1.45, 1.55, 0.8, 0], ring: [1.5, 1.55, 0.8, 0], pinky: [1.5, 1.45, 0.75, -0.05],
  }, { depth: 0.05, off: 0.021 });
  P.rGrip.t = [0, 0, 0, 0.1, 0.05]; P.rGrip.tw = [-0.35, 0.1, -0.93];
  // support hand wraps over the right-hand fingers from the left
  P.lGrip = handPose([-0.022, -0.095, Z(0.03)], [0.5, -0.1, -0.85], [-1, -0.2, 0.2], FIST(1.25, 1.35, 0.8), { depth: 0.05, off: 0.021 });
  P.lGrip.t = [0, 0, 0, 0.05, 0.05]; P.lGrip.tw = [0.05, 0.15, -1];
  P.lBelow = { p: P.lGrip.p.clone().add(V3(-0.05, -0.28, 0.05)), q: P.lGrip.q.clone(), f: FIST(1.1, 1.2, 0.8), t: P.lGrip.t };
  P.lMag = handPose([-0.005, -0.16, Z(0.0)], [0.6, 0.2, -0.3], [-0.3, -0.9, 0.2], FIST(1.2, 1.3, 0.7), { depth: 0.045, off: 0.022 });
  P.lMag.t = [-0.3, 0.5, 0, 0.3, 0.2];
  P.lInsert = { p: P.lMag.p.clone().add(V3(0, -0.05, 0.01)), q: P.lMag.q, f: P.lMag.f, t: P.lMag.t };
  return P;
}
function Z(s) { return -s; }

function blendPose(a, b, t, out) {
  out.p.lerpVectors(a.p, b.p, t); out.q.slerpQuaternions(a.q, b.q, t);
  for (const k of ['index', 'middle', 'ring', 'pinky']) {
    const fa = a.f[k] || a.f.all, fb = b.f[k] || b.f.all; out.f[k] = out.f[k] || [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) out.f[k][i] = lerp(fa[i] || 0, fb[i] || 0, t);
  }
  out.tw = a.tw && b.tw ? a.tw.map((v, i) => lerp(v, b.tw[i], t)) : (t < 0.5 ? a.tw : b.tw);
  out.t = out.t || [0, 0, 0, 0, 0];
  for (let i = 0; i < 5; i++) out.t[i] = lerp(a.t[i], b.t[i], t);
  return out;
}
const newPose = () => ({ p: V3(), q: new THREE.Quaternion(), f: {}, t: [0, 0, 0, 0, 0] });

/** Evaluate keyed track: keys [[time, value]]; value = pose name or number array. */
function sampleKeys(keys, t) {
  if (t <= keys[0][0]) return [keys[0][1], keys[0][1], 0];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, a] = keys[i], [t1, b] = keys[i + 1];
    if (t <= t1) return [a, b, smooth((t - t0) / Math.max(t1 - t0, 1e-5))];
  }
  const l = keys[keys.length - 1][1]; return [l, l, 0];
}
function sampleVec(keys, t) {
  const [a, b, k] = sampleKeys(keys, t); return a.map((v, i) => lerp(v, b[i], k));
}

// --------------------------------------------------------------------------------- reload scripts
function rifleReload(empty) {
  const D = empty ? DEFS.rifle.reload.empty : DEFS.rifle.reload.tac;
  const hand = [[0, 'lGuard'], [0.26, 'lMag'], [0.42, 'lMag'], [0.62, 'lInsert'], [0.86, 'lBelow'], [1.12, 'lBelow'], [1.36, 'lInsert'], [1.5, 'lMag'], [1.56, 'lMag']];
  const wr = [[0, [0, 0, 0, 0, 0, 0]], [0.28, [0.1, 0.12, 0.42, -0.03, 0.02, 0.03]], [0.5, [0.09, 0.14, 0.46, -0.03, 0.025, 0.03]], [0.9, [0.12, 0.16, 0.38, -0.02, 0.01, 0.02]],
    [1.34, [0.1, 0.12, 0.42, -0.03, 0.02, 0.03]], [1.46, [0.14, 0.12, 0.44, -0.03, 0.03, 0.03]], [1.58, [0.08, 0.1, 0.4, -0.03, 0.018, 0.03]]];
  if (!empty) {
    hand.push([1.9, 'lGuard'], [D, 'lGuard']);
    wr.push([1.95, [0.02, 0.02, 0.05, 0, 0, 0]], [D, [0, 0, 0, 0, 0, 0]]);
  } else {
    hand.push([1.8, 'lCh'], [1.9, 'lCh'], [2.04, 'lChPulled'], [2.12, 'lChPulled'], [2.5, 'lGuard'], [D, 'lGuard']);
    wr.push([1.8, [0.02, -0.12, -0.22, -0.01, 0.01, 0.0]], [2.04, [0.05, -0.14, -0.25, -0.01, 0.02, 0.01]], [2.14, [-0.03, -0.1, -0.2, -0.01, 0.0, 0.0]], [2.55, [0, 0, 0.02, 0, 0, 0]], [D, [0, 0, 0, 0, 0, 0]]);
  }
  return {
    D, hand, wr, attach: [0.4, 1.46], swap: 0.95, refill: 1.46, slap: 1.48,
    ch: empty ? [[0, 0], [1.9, 0], [2.04, 1], [2.1, 1], [2.14, 0], [D, 0]] : [[0, 0], [D, 0]],
    bump: empty ? [1.48, 2.14] : [1.48],
  };
}
function pistolReload(empty) {
  const D = empty ? DEFS.pistol.reload.empty : DEFS.pistol.reload.tac;
  const hand = [[0, 'lGrip'], [0.22, 'lBelow'], [0.62, 'lBelow'], [0.88, 'lInsert'], [1.02, 'lMag'], [1.08, 'lMag'], [1.36, 'lGrip'], [D, 'lGrip']];
  const wr = [[0, [0, 0, 0, 0, 0, 0]], [0.2, [0.22, -0.18, -0.35, -0.02, 0.015, 0.02]], [0.9, [0.25, -0.2, -0.38, -0.02, 0.02, 0.02]], [1.04, [0.3, -0.18, -0.34, -0.02, 0.028, 0.02]],
    [1.12, [0.2, -0.16, -0.32, -0.02, 0.012, 0.02]], [empty ? 1.5 : 1.4, [0.05, -0.05, -0.1, 0, 0, 0]], [D, [0, 0, 0, 0, 0, 0]]];
  return { D, hand, wr, attach: [0.62, 1.03], drop: [0.18, 0.5], swap: 0.6, refill: 1.03, slap: 1.03, slideRelease: empty ? 1.3 : null, bump: empty ? [1.04, 1.3] : [1.04] };
}

// --------------------------------------------------------------------------------- system
export class WeaponSystem {
  constructor(game) {
    this.game = game;
    const cam = game.camera;
    this.mats = makeGunMaterials(true);
    this.rand = rng(game.shotName ? 1234 : (Date.now() & 0xffff));

    this.viewmodel = new THREE.Group(); this.viewmodel.name = 'viewmodel';
    cam.add(this.viewmodel);
    this.mount = new THREE.Group(); this.viewmodel.add(this.mount);

    // weapons
    const rifle = buildRifle(this.mats); const pistol = buildPistol(this.mats);
    this.slots = [
      { key: 'rifle', def: DEFS.rifle, model: rifle, poses: riflePoses(), ammo: 30, reserve: DEFS.rifle.reserve, modeIdx: 0 },
      { key: 'pistol', def: DEFS.pistol, model: pistol, poses: pistolPoses(), ammo: 17, reserve: DEFS.pistol.reserve, modeIdx: 0 },
    ];
    for (const s of this.slots) { s.model.group.visible = false; this.mount.add(s.model.group); }
    this.tris = { rifle: rifle.tris, pistol: pistol.tris };

    // hands (weapon space, re-parented under the current weapon group) + forearms (viewmodel space)
    this.rHand = new Hand(this.mats, 'right'); this.lHand = new Hand(this.mats, 'left');
    this.rArm = new Forearm(this.mats, 3); this.lArm = new Forearm(this.mats, 7);
    addWatch(this.lArm, this.mats);
    this.viewmodel.add(this.rArm.root, this.lArm.root);
    this.lPose = newPose(); this.rPose = newPose();

    // apparent-position helpers for FX (camera children)
    this.muzzleObject = new THREE.Object3D(); this.muzzleObject.name = 'muzzle'; cam.add(this.muzzleObject);
    this.ejectObject = new THREE.Object3D(); cam.add(this.ejectObject);

    // state
    this.idx = 0; this.pending = -1;
    this.switchT = 0; this.switchPhase = 'draw'; // 'holster'|'draw'|null
    this.cooldown = 0; this.reloading = false; this.reloadT = 0; this.reloadScript = null;
    this.adsAmount = 0; this.adsRaw = 0; this.fovMultiplier = 1; this.sprintAmount = 0;
    this.inspectT = -1; this.bloom = 0; this.shotsInBurst = 0; this.triggerHeld = false;
    this.recoilCam = V3(); this.kickCam = new Spring(260, 18);
    this.posSpring = new Spring(160, 16); this.rotSpring = new Spring(170, 15);
    this.swaySpring = new Spring(90, 13); this.moveSpring = new Spring(60, 11);
    this.bobPhase = 0; this.bobAmp = 0; this.lastOnGround = true; this.lastVy = 0;
    this.slideT = 1; this.boltT = 1; this.dustOpen = 0; this.dustV = 0; this.chT = 0; this.magDropT = -1;
    this.baseFov = cam.fov; this._lastFov = cam.fov; this._camOff = V3(); this._lastCamRot = null;
    this._debug = null;
    this._setWeapon(0, true);
    this.switchT = game.shotName ? 1 : 0; this.switchPhase = game.shotName ? null : 'draw';

    // mouse wheel switching (Input has no wheel)
    addEventListener('wheel', (e) => { if (!this.game.input.disabled) this.wheel = Math.sign(e.deltaY); }, { passive: true });
    this.wheel = 0;

    // fallback environment map (only if lighting hasn't provided one) so metals never render black
    this._envChecked = false;
  }

  // ------------------------------------------------------------------ public API
  get slot() { return this.slots[this.idx]; }
  get spread() { return this.currentSpread(); }
  get current() { const s = this.slot; return { name: s.def.name, key: s.key, id: s.key, flashScale: s.key === 'pistol' ? 0.7 : 1, ammo: s.ammo, magSize: s.def.magSize, reserve: s.reserve, fireMode: s.def.modes[s.modeIdx] }; }
  get ammo() { return this.slot.ammo; }
  get reserve() { return this.slot.reserve; }

  _setWeapon(i, instant = false) {
    this.idx = i; const s = this.slot;
    for (const o of this.slots) o.model.group.visible = o === s;
    s.model.group.add(this.rHand.root, this.lHand.root);
    this.reloading = false; this.reloadScript = null; this.inspectT = -1;
    if (s.key === 'rifle') this._updateSelector();
    if (!instant) this.game.events.emit('weapon:switch', { weapon: s.def.name });
  }
  _updateSelector() {
    const s = this.slots[0]; const mode = s.def.modes[s.modeIdx];
    const a = mode === 'auto' ? Math.PI : Math.PI / 2;
    for (const sel of s.model.selector) sel.rotation.x = -a;
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const g = this.game, inp = g.input, p = g.player, s = this.slot, def = s.def;
    this._ensureEnv();
    // remove last frame's camera offset if nobody reset the camera
    const cam = g.camera;
    if (this._lastCamRot && cam.rotation.x === this._lastCamRot.x && cam.rotation.y === this._lastCamRot.y && cam.rotation.z === this._lastCamRot.z) {
      cam.rotation.x -= this._camOff.x; cam.rotation.y -= this._camOff.y; cam.rotation.z -= this._camOff.z;
    }
    if (this._debug) { this._applyDebug(this._debug.opts, this._debug.frame); return; }

    // --- switching
    let want = -1;
    if (inp.wasPressed('Digit1')) want = 0;
    if (inp.wasPressed('Digit2')) want = 1;
    if (this.wheel) { want = (this.idx + (this.wheel > 0 ? 1 : this.slots.length - 1)) % this.slots.length; this.wheel = 0; }
    if (want >= 0 && want !== this.idx && this.switchPhase !== 'holster') { this.pending = want; this.switchPhase = 'holster'; this.switchT = 0; }
    if (this.switchPhase) {
      this.switchT += dt / (this.switchPhase === 'holster' ? 0.26 : 0.42);
      if (this.switchT >= 1) {
        if (this.switchPhase === 'holster') { this._setWeapon(this.pending); this.switchPhase = 'draw'; this.switchT = 0; }
        else { this.switchPhase = null; this.switchT = 1; }
      }
    }
    const busy = !!this.switchPhase;

    // --- fire mode / inspect
    if (inp.wasPressed('KeyB') && def.modes.length > 1) { s.modeIdx = (s.modeIdx + 1) % def.modes.length; this._updateSelector(); g.events.emit('weapon:mode', { weapon: def.name, fireMode: def.modes[s.modeIdx] }); this.rotSpring.v.z += 0.4; }
    if (inp.wasPressed('KeyI') && !this.reloading && !busy) this.inspectT = 0;

    // --- sprint / ADS
    const sprinting = !!(p && p.sprinting) && !this.reloading;
    this.sprintAmount = lerp(this.sprintAmount, sprinting ? 1 : 0, 1 - Math.exp(-dt * 9));
    const wantAds = inp.mouse.right && !busy && !sprinting && !(this.reloading && s.key === 'rifle' && this.reloadT > 0.15 && this.reloadT < this.reloadScript.D - 0.3);
    this.adsRaw = clamp(this.adsRaw + (wantAds ? 1 : -1) * dt / def.adsTime, 0, 1);
    this.adsAmount = smooth(this.adsRaw);
    if (p) p.aiming = this.adsAmount > 0.5;
    if (wantAds || this.triggerHeld) this.inspectT = -1;

    // --- reload
    if (inp.wasPressed('KeyR')) this.startReload();
    if (this.reloading) this._tickReload(dt);

    // --- fire
    this.cooldown -= dt;
    const trig = inp.mouse.left;
    const mode = def.modes[s.modeIdx];
    const canFire = !busy && !this.reloading && this.sprintAmount < 0.35;
    if (trig && canFire) {
      const pressed = inp.mouse.leftPressed || !this.triggerHeld;
      if (s.ammo <= 0) { if (pressed) { g.events.emit('weapon:empty', { weapon: def.name }); if (s.reserve > 0) this.startReload(); } }
      else if (this.cooldown <= 0 && (mode === 'auto' || pressed)) this.fire();
    }
    if (!trig) this.shotsInBurst = 0;
    this.triggerHeld = trig;

    // spread recovery
    this.bloom = Math.max(0, this.bloom - dt * def.spread.recover * def.spread.bloom * 4);
    // camera recoil recovery (only when not firing)
    if (!trig || this.cooldown < -0.08) { const k = Math.exp(-dt * def.recoil.recover); this.recoilCam.multiplyScalar(k); }

    // inspect
    if (this.inspectT >= 0) { this.inspectT += dt; if (this.inspectT > 3.4) this.inspectT = -1; }

    // --- movement: sway, bob, jump/land
    const mdx = inp.mouse.dx || 0, mdy = inp.mouse.dy || 0;
    const swayK = 1 - this.adsAmount * 0.8;
    this.swaySpring.v.x += clamp(-mdy * 0.0009, -0.05, 0.05) * swayK * 60 * dt * 10;
    this.swaySpring.v.y += clamp(-mdx * 0.0009, -0.05, 0.05) * swayK * 60 * dt * 10;
    this.swaySpring.update(dt);
    if (p) {
      const hv = Math.hypot(p.velocity.x, p.velocity.z);
      const onG = p.onGround !== false;
      const targetAmp = onG ? clamp(hv / 6, 0, 1.3) : 0;
      this.bobAmp = lerp(this.bobAmp, targetAmp, 1 - Math.exp(-dt * 8));
      this.bobPhase += dt * (hv * 1.55 + 0.001);
      if (onG && !this.lastOnGround) { const imp = clamp(-this.lastVy / 8, 0.2, 1.4); this.moveSpring.v.y -= 0.35 * imp; this.rotSpring.v.x -= 0.9 * imp; }
      if (!onG && this.lastOnGround && p.velocity.y > 1) { this.moveSpring.v.y -= 0.18; this.rotSpring.v.x += 0.5; }
      this.lastOnGround = onG; this.lastVy = p.velocity.y;
      // strafe lean
      const right = V3(Math.cos(p.yaw || 0), 0, -Math.sin(p.yaw || 0));
      this._strafe = lerp(this._strafe || 0, clamp(right.dot(p.velocity) / 5, -1, 1), 1 - Math.exp(-dt * 6));
    }
    this.moveSpring.update(dt);
    this.posSpring.update(dt); this.rotSpring.update(dt); this.kickCam.update(dt);

    // --- mechanical parts
    this.slideT = Math.min(1, this.slideT + dt / 0.075);
    this.boltT = Math.min(1, this.boltT + dt / 0.06);
    if (this.dustOpen > 0 && this.dustOpen < 1) { this.dustV += dt * 60; this.dustOpen = Math.min(1, this.dustOpen + this.dustV * dt); }

    this._pose(dt);
  }

  startReload() {
    const s = this.slot;
    if (this.reloading || this.switchPhase || s.ammo >= s.def.magSize || s.reserve <= 0) return;
    const empty = s.ammo === 0;
    this.reloadScript = s.key === 'rifle' ? rifleReload(empty) : pistolReload(empty);
    this.reloadScript.empty = empty; this.reloadScript.bumped = [];
    this.reloading = true; this.reloadT = 0; this.inspectT = -1;
    this.game.events.emit('weapon:reload', { weapon: s.def.name, empty, duration: this.reloadScript.D });
  }
  _tickReload(dt) {
    const R = this.reloadScript, s = this.slot;
    const prev = this.reloadT; this.reloadT += dt;
    if (prev < R.refill && this.reloadT >= R.refill) {
      const n = Math.min(s.def.magSize - s.ammo, s.reserve); s.ammo += n; s.reserve -= n;
    }
    for (const b of R.bump) if (prev < b && this.reloadT >= b) { this.posSpring.v.y += 0.25; this.rotSpring.v.x += 1.0; this.rotSpring.v.z -= 0.3; }
    if (this.reloadT >= R.D) { this.reloading = false; this.reloadScript = null; }
  }

  fire() {
    const g = this.game, s = this.slot, def = s.def, R = def.recoil;
    s.ammo--; this.cooldown += 60 / def.rpm; if (this.cooldown < 0) this.cooldown = 60 / def.rpm * 0.5;
    this.inspectT = -1;
    const cam = g.camera;
    // aim direction with spread
    cam.updateMatrixWorld(true);
    const origin = cam.getWorldPosition(V3());
    const fwd = cam.getWorldDirection(V3());
    const spread = this.currentSpread();
    const ang = Math.sqrt(this.rand()) * spread, rot = this.rand() * Math.PI * 2;
    const up = V3(0, 1, 0).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    const rt = V3().crossVectors(fwd, up).normalize(); up.crossVectors(rt, fwd).normalize();
    const dir = fwd.clone().multiplyScalar(Math.cos(ang)).addScaledVector(rt, Math.sin(ang) * Math.cos(rot)).addScaledVector(up, Math.sin(ang) * Math.sin(rot)).normalize();

    this.bloom = Math.min(def.spread.bloomMax, this.bloom + def.spread.bloom);
    // recoil: visual springs
    const adsK = lerp(1, R.adsScale, this.adsAmount);
    const rs = (this.rand() - 0.5) * 2;
    this.posSpring.v.z += R.back * 60 * adsK * (0.85 + this.rand() * 0.3);
    this.posSpring.v.y += R.back * 12 * adsK;
    this.rotSpring.v.x += R.rise * 60 * adsK * (1 - this.adsAmount * 0.55);
    this.rotSpring.v.y += R.side * 60 * rs * adsK;
    this.rotSpring.v.z += R.roll * 60 * (this.rand() - 0.5) * 2;
    // camera: pattern (persistent while firing, recovers after) + small shake
    const pat = R.pattern[this.shotsInBurst % R.pattern.length];
    const ck = lerp(1, 0.8, this.adsAmount);
    this.recoilCam.x += R.cam[0] * pat[0] * ck;
    this.recoilCam.y += R.cam[1] * pat[1] * ck;
    this.kickCam.v.x += R.cam[0] * 30 * ck; this.kickCam.v.z += (this.rand() - 0.5) * 0.25 * R.cam[0] * 30;
    this.shotsInBurst++;
    // mechanics
    if (s.key === 'pistol') this.slideT = 0; else { this.boltT = 0; if (this.dustOpen === 0) { this.dustOpen = 0.001; this.dustV = 0; } }

    // events
    this._pose(0);
    const muzzleWorld = this.muzzleObject.getWorldPosition(V3());
    g.events.emit('weapon:fire', { origin, dir: dir.clone(), muzzleWorld, weapon: this.current, weaponName: def.name, ejectWorld: this.ejectObject.getWorldPosition(V3()), ads: this.adsAmount });
    const hit = g.collision.raycast(origin, dir, 1000);
    if (hit) {
      const [d0, d1] = def.damage, [r0, r1] = def.range;
      let dmg = lerp(d0, d1, clamp((hit.distance - r0) / (r1 - r0), 0, 1));
      if (hit.part === 'head') dmg *= def.headMul; else if (hit.part === 'limb') dmg *= def.limbMul;
      g.events.emit('hit', { ...hit, dir: dir.clone(), damage: Math.round(dmg), weapon: def.name, headshot: hit.part === 'head' });
    }
    if (s.ammo === 0) g.events.emit('weapon:empty', { weapon: def.name, lastRound: true });
  }

  currentSpread() {
    const def = this.slot.def, p = this.game.player;
    const mv = p ? clamp(Math.hypot(p.velocity.x, p.velocity.z) / 6, 0, 1) : 0;
    const air = p && p.onGround === false ? 1 : 0;
    const hip = def.spread.hip + mv * def.spread.move + air * def.spread.move + this.bloom;
    const ads = def.spread.ads + mv * def.spread.move * 0.15 + this.bloom * 0.15;
    return lerp(hip, ads, this.adsAmount);
  }

  // ------------------------------------------------------------------ pose composition
  _pose(dt) {
    const g = this.game, s = this.slot, def = s.def, M = s.model, P = s.poses, cam = g.camera;
    const t = this._timeOverride ?? g.time;
    const ads = this.adsAmount, sprint = this.sprintAmount * (1 - ads);
    // base pose
    const adsP = [0, -def.ads.sightY, -def.ads.eye + def.ads.sightS];
    const pos = V3(...def.hip.p).lerp(V3(...adsP), ads);
    const rot = V3(...def.hip.r).lerp(V3(0, 0, 0), ads);
    pos.lerp(V3(...def.sprint.p), sprint); rot.lerp(V3(...def.sprint.r), sprint);
    // idle breathing
    const breath = 1 - ads * 0.85;
    pos.x += Math.sin(t * 1.1) * 0.0012 * breath; pos.y += Math.sin(t * 1.7) * 0.0014 * breath;
    rot.x += Math.sin(t * 1.3) * 0.004 * breath; rot.y += Math.cos(t * 0.9) * 0.004 * breath;
    // bob
    const ba = this.bobAmp * (1 - ads * 0.85) * (1 + sprint * 0.9);
    const ph = this.bobPhase;
    pos.x += Math.sin(ph) * 0.009 * ba; pos.y += -Math.abs(Math.cos(ph)) * 0.008 * ba + 0.003 * ba;
    rot.z += Math.sin(ph) * 0.02 * ba; rot.y += Math.sin(ph) * 0.012 * ba * (1 + sprint); rot.x += Math.cos(ph * 2) * 0.01 * ba;
    rot.z -= (this._strafe || 0) * 0.05 * (1 - ads * 0.7);
    // sway (lag) + springs
    const sw = this.swaySpring.x;
    rot.x += sw.x; rot.y += sw.y; rot.z += sw.y * 0.6; pos.x += sw.y * 0.05; pos.y += sw.x * 0.05;
    pos.add(this.moveSpring.x);
    pos.x += this.posSpring.x.x; pos.y += this.posSpring.x.y; pos.z += this.posSpring.x.z;
    rot.x += this.rotSpring.x.x; rot.y += this.rotSpring.x.y; rot.z += this.rotSpring.x.z;
    // reload offsets
    if (this.reloading && this.reloadScript) {
      const w = sampleVec(this.reloadScript.wr, this.reloadT);
      const k = 1 - ads;
      rot.x += w[0] * k; rot.y += w[1] * k; rot.z += w[2] * k; pos.x += w[3] * k; pos.y += w[4] * k; pos.z += w[5] * k;
    }
    // inspect
    if (this.inspectT >= 0) {
      const it = this.inspectT;
      const a = smooth(it / 0.7) * (1 - smooth((it - 1.5) / 0.6));
      const b = smooth((it - 1.5) / 0.6) * (1 - smooth((it - 2.8) / 0.6));
      rot.z += a * 0.75 - b * 0.35; rot.y += a * 0.45 + b * -0.35; rot.x += b * 0.35 + a * 0.1;
      pos.x += a * -0.05 + b * -0.03; pos.y += a * 0.03 + b * 0.02; pos.z += a * 0.03;
    }
    // switch
    if (this.switchPhase) {
      const k = this.switchPhase === 'holster' ? smooth(this.switchT) : 1 - easeOut(this.switchT);
      pos.y -= k * 0.26; pos.x += k * 0.03; rot.x -= k * 0.9; rot.z -= k * 0.35;
    }
    this.mount.position.copy(pos);
    this.mount.rotation.set(rot.x, rot.y, rot.z, 'YXZ');

    // ---- moving parts
    if (s.key === 'rifle') {
      const bt = this.boltT < 1 ? Math.sin(Math.min(1, this.boltT) * Math.PI) : 0;
      M.bolt.position.z = bt * 0.028;
      M.bolt.visible = this.dustOpen > 0;
      M.dust.rotation.z = -Math.min(1, this.dustOpen) * 1.95;
      let chv = 0;
      if (this.reloading && this.reloadScript && this.reloadScript.ch) chv = sampleVec(this.reloadScript.ch.map(([a, b]) => [a, [b]]), this.reloadT)[0];
      M.ch.position.z = chv * 0.062;
      M.trigger.position.z = this.cooldown > 0 && this.triggerHeld ? 0.0012 : 0;
    } else {
      const empty = s.ammo === 0 && !(this.reloading && this.reloadScript?.slideRelease && this.reloadT > this.reloadScript.slideRelease);
      let sl = this.slideT < 1 ? Math.sin(Math.min(1, this.slideT) * Math.PI) : 0;
      if (s.ammo === 0 && this.slideT > 0.5) sl = 1;
      if (this.reloading && this.reloadScript && s.ammo > 0 && this.reloadScript.empty) {
        sl = this.reloadT < this.reloadScript.slideRelease ? 1 : Math.max(0, 1 - (this.reloadT - this.reloadScript.slideRelease) / 0.05);
      }
      M.slide.position.z = (empty ? Math.max(sl, 1) : sl) * 0.03 * (s.ammo === 0 || sl > 0 ? 1 : 0);
    }

    // ---- hands
    const lp = this.lPose;
    let leftName = s.key === 'rifle' ? 'lGuard' : 'lGrip';
    blendPose(P[leftName], P[leftName], 0, lp);
    let magAttach = false;
    if (this.reloading && this.reloadScript) {
      const R = this.reloadScript;
      const [a, b, k] = sampleKeys(R.hand, this.reloadT);
      blendPose(P[a], P[b], k, lp);
      magAttach = this.reloadT >= R.attach[0] && this.reloadT < R.attach[1];
    }
    this._applyHand(this.lHand, lp);
    this._applyHand(this.rHand, P.rGrip);

    // magazine follows left hand while attached; pistol mag drops
    const mag = M.mag;
    mag.visible = true;
    if (magAttach) {
      const R = this.reloadScript;
      const grab = s.key === 'rifle' ? P.lMag : P.lMag;
      const handM = new THREE.Matrix4().compose(lp.p, lp.q, V3(1, 1, 1));
      const grabM = new THREE.Matrix4().compose(grab.p, grab.q, V3(1, 1, 1));
      const m = handM.multiply(grabM.invert()).multiply(M.magRest);
      m.decompose(mag.position, mag.quaternion, mag.scale);
      void R;
    } else if (this.reloading && this.reloadScript?.drop && this.reloadT >= this.reloadScript.drop[0] && this.reloadT < this.reloadScript.attach[0]) {
      const k = (this.reloadT - this.reloadScript.drop[0]);
      M.magRest.decompose(mag.position, mag.quaternion, mag.scale);
      mag.position.y -= 4.9 * k * k + 0.3 * k; mag.position.z += 0.2 * k;
      mag.visible = this.reloadT < this.reloadScript.drop[1];
    } else {
      M.magRest.decompose(mag.position, mag.quaternion, mag.scale);
    }

    // ---- camera / projection
    const vmFov = lerp(def.vmFov, def.vmFovAds, ads);
    this.fovMultiplier = 1 / lerp(1, def.zoom, ads);
    if (cam.fov !== this._lastFov) this.baseFov = cam.fov;
    cam.fov = this.baseFov * this.fovMultiplier; this._lastFov = cam.fov;
    cam.updateProjectionMatrix();
    VM.proj.value.makePerspective(...perspArgs(vmFov, cam.aspect, 0.01, 20));
    this.vmFov = vmFov;
    // camera recoil
    const off = this._camOff.set(this.recoilCam.x + this.kickCam.x.x, this.recoilCam.y, this.kickCam.x.z);
    cam.rotation.x += off.x; cam.rotation.y += off.y; cam.rotation.z += off.z;
    this._lastCamRot = { x: cam.rotation.x, y: cam.rotation.y, z: cam.rotation.z };

    // ---- forearms + FX anchors
    this.viewmodel.updateMatrixWorld(true);
    this._placeArm(this.rArm, this.rHand, def.elbowR);
    this._placeArm(this.lArm, this.lHand, def.elbowL);
    const k = Math.tan(cam.fov * DEG / 2) / Math.tan(vmFov * DEG / 2);
    const tmp = V3();
    M.muzzle.getWorldPosition(tmp); cam.worldToLocal(tmp); this.muzzleObject.position.set(tmp.x * k, tmp.y * k, tmp.z);
    M.ejectPort.getWorldPosition(tmp); cam.worldToLocal(tmp); this.ejectObject.position.set(tmp.x * k, tmp.y * k, tmp.z);
    this.muzzleObject.updateMatrixWorld(); this.ejectObject.updateMatrixWorld();
  }

  _applyHand(hand, pose) {
    hand.root.position.copy(pose.p); hand.root.quaternion.copy(pose.q);
    hand.setFingers(pose);
    if (pose.tw) {
      const d = V3(...pose.tw).normalize().applyQuaternion(pose.q.clone().invert());
      if (hand.side === 'left') d.x = -d.x;
      hand.thumb[0].quaternion.setFromUnitVectors(V3(0, 0, -1), d);
    }
  }
  _placeArm(arm, hand, elbow) {
    const wrist = hand.root.getWorldPosition(V3()); this.viewmodel.worldToLocal(wrist);
    const hq = hand.root.getWorldQuaternion(new THREE.Quaternion());
    const vq = this.viewmodel.getWorldQuaternion(new THREE.Quaternion()).invert();
    hq.premultiply(vq);
    const dir = V3(...elbow).sub(wrist).normalize();
    // blend forearm axis toward the hand's own axis (+Z) near the wrist to reduce the kink
    const handBack = V3(0, 0, 1).applyQuaternion(hq);
    const z = dir.clone().lerp(handBack, 0.35).normalize();
    const up = V3(0, 1, 0).applyQuaternion(hq);
    if (hand.side === 'left') up.applyAxisAngle(z, 0);
    const x = V3().crossVectors(up, z).normalize(); const y = V3().crossVectors(z, x);
    arm.root.position.copy(wrist);
    arm.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  }

  _ensureEnv() {
    if (this._envChecked) return;
    if (this.game.time < 0.5 && !this.game.shotName) return;
    this._envChecked = true;
    if (this.game.scene.environment) return;
    // Lighting has no IBL: build a small sky/ground gradient env so metal still reads.
    const r = this.game.renderer; const pm = new THREE.PMREMGenerator(r);
    const sc = new THREE.Scene();
    const geo = new THREE.SphereGeometry(10, 32, 16);
    const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: 'varying vec3 p; void main(){ float h = normalize(p).y; vec3 sky = mix(vec3(0.9,0.75,0.55), vec3(0.35,0.5,0.75), smoothstep(0.0,0.6,h)); vec3 gr = vec3(0.12,0.1,0.08); gl_FragColor = vec4(mix(gr, sky, smoothstep(-0.05,0.05,h)) * 1.2, 1.); }' });
    sc.add(new THREE.Mesh(geo, mat));
    this._fallbackEnv = pm.fromScene(sc, 0.02).texture;
    for (const m of Object.values(this.mats)) if (m.isMeshStandardMaterial) { m.envMap = this._fallbackEnv; m.needsUpdate = true; }
    pm.dispose();
  }

  // ------------------------------------------------------------------ debug / screenshot poses
  /**
   * Force a deterministic viewmodel pose (used by src/debug/shots/weapons.js).
   * opts: {weapon:'rifle'|'pistol', ads:0..1, sprint:0..1, reload:seconds|null, empty:bool, inspect:seconds|null, fired:bool}
   */
  debugPose(opts, frame = 0) {
    this._debug = { opts, frame };
    this._applyDebug(opts, frame);
  }
  _applyDebug(o, frame) {
    const want = o.weapon === 'pistol' ? 1 : 0;
    if (want !== this.idx) this._setWeapon(want, true);
    const s = this.slot;
    this.switchPhase = null; this.switchT = 1;
    this.adsRaw = o.ads || 0; this.adsAmount = smooth(this.adsRaw);
    this.sprintAmount = o.sprint || 0;
    this.bobAmp = o.bob || 0; this.bobPhase = o.bobPhase || 0;
    this.posSpring.reset(); this.rotSpring.reset(); this.swaySpring.reset(); this.moveSpring.reset(); this.kickCam.reset(); this.recoilCam.set(0, 0, 0);
    if (o.empty) s.ammo = 0; else if (s.ammo === 0) s.ammo = s.def.magSize;
    if (o.reload != null) {
      if (!this.reloading) { this.reloading = true; this.reloadScript = s.key === 'rifle' ? rifleReload(!!o.empty) : pistolReload(!!o.empty); this.reloadScript.empty = !!o.empty; }
      this.reloadT = o.reload;
    } else { this.reloading = false; this.reloadScript = null; }
    this.inspectT = o.inspect != null ? o.inspect : -1;
    if (o.fired) { this.dustOpen = 1; } else this.dustOpen = 0;
    this._timeOverride = o.time ?? 0.35;
    this._pose(0);
    if (this.game.player) this.game.player.aiming = this.adsAmount > 0.5;
  }

  /** Place a world-space (normal projection, shadow casting) rifle for the close-up beauty shot. */
  showcase(pos, rotY = 0) {
    if (this._showcase) return this._showcase;
    const mats = makeGunMaterials(false);
    if (this._fallbackEnv) for (const m of Object.values(mats)) if (m.isMeshStandardMaterial) { m.envMap = this._fallbackEnv; }
    const r = buildRifle(mats, { forWorld: true });
    r.dust.rotation.z = -1.95; r.bolt.visible = true;
    const grp = new THREE.Group(); grp.add(r.group);
    grp.position.copy(pos); grp.rotation.y = rotY;
    this.game.scene.add(grp);
    grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this._showcase = { group: grp, model: r };
    return this._showcase;
  }
}

function perspArgs(fovDeg, aspect, near, far) {
  const top = near * Math.tan(fovDeg * DEG / 2), h = 2 * top, w = aspect * h;
  return [-w / 2, w / 2, top, -top, near, far];
}
