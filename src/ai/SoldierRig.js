import * as THREE from 'three';
import { BONES, BI, J } from './Skeleton.js';
import { clamp, lerp, smooth, damp } from './util.js';

/**
 * Positional pose solver + procedural animator + verlet ragdoll for the soldier skeleton.
 * All pose math happens in character space (feet at origin, forward +Z, left +X); the result is
 * written to the THREE.Bone hierarchy in apply().
 */

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

function perpTo(v, axis, out) { return out.copy(v).addScaledVector(axis, -v.dot(axis)); }

// ------------------------------------------------------------------ Spring (vec3)
class Spring3 {
  constructor(k = 120, c = 14) { this.x = V(); this.v = V(); this.k = k; this.c = c; }
  kick(v) { this.v.add(v); }
  update(dt) {
    const n = Math.max(1, Math.ceil(dt / 0.008)); const h = dt / n;
    for (let i = 0; i < n; i++) { this.v.addScaledVector(this.x, -this.k * h).multiplyScalar(Math.max(0, 1 - this.c * h)); this.x.addScaledVector(this.v, h); }
  }
}

export class SoldierRig {
  constructor(bones, rifle) {
    this.bones = bones; this.rifle = rifle;
    this.q = BONES.map(() => new THREE.Quaternion());
    this.p = BONES.map((b) => b.head.clone());
    this.scale = BONES.map(() => 1);
    this.magInHand = new THREE.Matrix4();
    // hand frame on magazine (weapon space) — same fist shape as a vertical grip
    this.magGrip = { pos: rifle.magwell.clone().add(V(0.018, -0.055, -0.012)), dir: V(-0.05, -0.15, 1), front: V(0, 1, 0.15) };
    const hw = this.frameMatrix(this.magGrip, BI.handL, new THREE.Matrix4());
    this.magInHand.copy(hw).invert();
  }

  /** Set bone char-space orientation so its bind dir -> dir and bind front -> front. */
  orient(i, dir, front) {
    const b = BONES[i];
    _a.copy(dir).normalize();
    perpTo(front, _a, _b);
    if (_b.lengthSq() < 1e-8) perpTo(b.frontO, _a, _b);
    if (_b.lengthSq() < 1e-8) perpTo(V(0.3, 0.2, 1), _a, _b);
    _b.normalize();
    _c.crossVectors(_a, _b);
    _m.makeBasis(_a, _b, _c).multiply(b.bindBasisInv);
    this.q[i].setFromRotationMatrix(_m);
  }
  /** FK: place bone i's head from its parent. */
  fk(i) { const b = BONES[i]; this.p[i].copy(b.offset).applyQuaternion(this.q[b.p]).add(this.p[b.p]); }
  tail(i, out) { const b = BONES[i]; return out.copy(b.tail).sub(b.head).applyQuaternion(this.q[i]).add(this.p[i]); }
  /** char-space point on bone i given a bind-space point */
  bindPoint(i, bindP, out) { const b = BONES[i]; return out.copy(bindP).sub(b.head).applyQuaternion(this.q[i]).add(this.p[i]); }
  /** 4x4 char transform of hand bone for a grip frame given in some space */
  frameMatrix(fr, handBone, out) {
    _a.copy(fr.dir).normalize(); perpTo(fr.front, _a, _b).normalize(); _c.crossVectors(_a, _b);
    _m2.makeBasis(_a, _b, _c).multiply(BONES[handBone].bindBasisInv);
    _q2.setFromRotationMatrix(_m2);
    return out.compose(fr.pos, _q2, _e.set(1, 1, 1));
  }

  /** Two-bone IK: upper bone u (head already placed), lower bone l, reaching target with pole hint. */
  ik(u, l, target, pole, rule = 'arm') {
    const A = this.p[u]; const l1 = BONES[u].len, l2 = BONES[l].len;
    const dvec = _a.copy(target).sub(A); let d = dvec.length();
    const dn = dvec.clone().divideScalar(d || 1);
    d = clamp(d, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-4);
    const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d); const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    const pp = perpTo(pole, dn, V()).normalize();
    const mid = A.clone().addScaledVector(dn, x).addScaledVector(pp, h);
    const up = mid.clone().sub(A).normalize(); const lo = target.clone().sub(mid).normalize();
    // anterior-side rules (see Skeleton.js)
    if (rule === 'arm') {
      this.orient(u, up, perpTo(lo, up, V()).lengthSq() > 1e-6 ? perpTo(lo, up, V()) : pp.clone().negate());
      this.fk(l);
      this.orient(l, lo, perpTo(up.clone().negate(), lo, V()).lengthSq() > 1e-6 ? perpTo(up.clone().negate(), lo, V()) : pp.clone().negate());
    } else {
      this.orient(u, up, perpTo(lo, up, V()).negate().lengthSq() > 1e-6 ? perpTo(lo, up, V()).negate() : pp);
      this.fk(l);
      this.orient(l, lo, perpTo(up, lo, V()).lengthSq() > 1e-6 ? perpTo(up, lo, V()) : pp);
    }
  }

  apply() {
    const bones = this.bones;
    for (const b of BONES) {
      const bone = bones[b.i];
      if (b.p < 0) { bone.quaternion.identity(); bone.position.set(0, 0, 0); continue; }
      bone.quaternion.copy(this.q[b.p]).invert().multiply(this.q[b.i]);
      if (b.p === 0) bone.position.copy(this.p[b.i]); else bone.position.copy(b.offset);
      const s = this.scale[b.i]; bone.scale.set(s, s, s);
    }
  }
}

// ------------------------------------------------------------------ weapon holding poses (chest-anchored)
// butt: point in aim frame relative to shoulder pocket; rot: Euler (x pitch, y yaw, z roll) applied in aim frame
const POSES = {
  aim: { off: V(0, 0, 0), rot: new THREE.Euler(0, 0, 0) },
  low: { off: V(0.03, -0.05, 0.03), rot: new THREE.Euler(0.48, 0.32, -0.12) },
  sprint: { off: V(0.1, -0.12, 0.06), rot: new THREE.Euler(0.55, 1.0, -0.5) },
  reload: { off: V(0.07, -0.08, 0.06), rot: new THREE.Euler(-0.1, 0.35, 0.6) },
};
const BUTT = V(0, -0.03, -0.305); // butt pad centre in weapon space

/**
 * Procedural animator. Drive by setting inputs, then call update(dt) -> writes rig pose.
 * Inputs: vel (Vector3 char-space m/s), crouch 0..1, aimYaw, aimPitch (rad, rel. to body), ads 0..1,
 *         sprint 0..1, lean -1..1, reloading (bool). Events: fire(), hit(part, dirChar), startReload().
 */
export class SoldierAnimator {
  constructor(rig, seed = 0) {
    this.rig = rig;
    this.vel = V(); this.crouch = 0; this.aimYaw = 0; this.aimPitch = 0; this.ads = 0; this.sprint = 0; this.lean = 0;
    this.t = seed * 1.37; this.phase = seed % 1; this.moveBlend = 0; this.kneel = 0; this.lowReady = 1;
    this._crouch = 0; this._ads = 0; this._sprint = 0; this._lean = 0; this._aimYaw = 0; this._aimPitch = 0; this._vel = V();
    this.recoil = new Spring3(260, 18); this.chestFlinch = new Spring3(90, 9); this.headFlinch = new Spring3(140, 10);
    this.pelvisDip = new Spring3(80, 8); this.armJolt = new Spring3(120, 10);
    this.reloadT = -1; this.reloadDur = 2.6; this.magHidden = false;
    this.bladed = 1; // combat stance: left foot forward
    this.feet = [V(), V()];
  }
  fire(kick = 1) {
    this.recoil.kick(V((Math.random() - 0.5) * 0.4, 0.9 + Math.random() * 0.4, -2.2).multiplyScalar(kick));
  }
  hit(part, dir) {
    const d = dir.clone().setY(0).normalize();
    const axis = V().crossVectors(UP, d); // rotate away from the shot
    if (part === 'head') this.headFlinch.kick(axis.multiplyScalar(14));
    else if (part === 'limb') { this.armJolt.kick(d.clone().multiplyScalar(1.2)); this.pelvisDip.kick(V(0, -0.8, 0)); this.chestFlinch.kick(axis.multiplyScalar(3)); }
    else { this.chestFlinch.kick(axis.multiplyScalar(7)); this.pelvisDip.kick(V(0, -0.5, 0)); }
  }
  startReload() { if (this.reloadT < 0) { this.reloadT = 0; } }

  update(dt) {
    const R = this.rig; this.t += dt;
    // smoothing of inputs
    this._crouch = damp(this._crouch, this.crouch, 7, dt);
    this._ads = damp(this._ads, this.ads, 9, dt);
    this._sprint = damp(this._sprint, this.sprint, 6, dt);
    this._lean = damp(this._lean, this.lean, 6, dt);
    this._aimYaw = damp(this._aimYaw, this.aimYaw, 12, dt);
    this._aimPitch = damp(this._aimPitch, this.aimPitch, 12, dt);
    this._vel.x = damp(this._vel.x, this.vel.x, 8, dt); this._vel.z = damp(this._vel.z, this.vel.z, 8, dt);
    for (const s of [this.recoil, this.chestFlinch, this.headFlinch, this.pelvisDip, this.armJolt]) s.update(dt);

    const speed = Math.hypot(this._vel.x, this._vel.z);
    this.moveBlend = damp(this.moveBlend, smooth(0.08, 0.5, speed), 10, dt);
    const mv = this.moveBlend;
    const crouch = this._crouch;
    this.kneel = damp(this.kneel, crouch > 0.5 && speed < 0.4 ? 1 : 0, 6, dt);
    const kneel = this.kneel;
    const run = smooth(2.2, 4.5, speed);

    // ---- reload phase
    let rl = 0; // reload pose blend
    if (this.reloadT >= 0) {
      this.reloadT += dt / this.reloadDur;
      rl = smooth(0, 0.1, this.reloadT) * (1 - smooth(0.85, 1, this.reloadT));
      if (this.reloadT >= 1) { this.reloadT = -1; rl = 0; }
    }

    // ---- gait
    const duty = lerp(0.6, 0.36, run);
    const halfStride = clamp(0.16 + speed * 0.14, 0.16, 0.62) * (1 - 0.3 * crouch);
    if (speed > 0.05) this.phase = (this.phase + dt * speed / (2 * halfStride / duty)) % 1;
    else this.phase = damp(this.phase, Math.round(this.phase * 2) / 2, 3, dt) % 1;

    // ---- pelvis
    const breath = Math.sin(this.t * 1.7);
    const standH = 0.955 - 0.02 * this._ads;
    const crouchH = lerp(0.72, 0.56, kneel);
    let hipY = lerp(standH, crouchH, crouch);
    const bobA = lerp(0.022, 0.05, run) * mv;
    hipY += -bobA * (0.5 + 0.5 * Math.cos(this.phase * Math.PI * 4 - 0.6)) + bobA * 0.5;
    hipY += this.pelvisDip.x.y * 0.1 - 0.02 * run * mv;
    const pelvisYawStance = -0.32 * this.bladed * (1 - mv) * (1 - kneel * 0.3);
    // moving: hips follow movement direction partially
    const moveYaw = speed > 0.3 ? Math.atan2(this._vel.x, this._vel.z) : 0;
    const legYaw = mv * clamp(Math.abs(moveYaw) > Math.PI / 2 ? moveYaw - Math.sign(moveYaw) * Math.PI : moveYaw, -0.9, 0.9) * 0.5;
    const pelvisYaw = pelvisYawStance + legYaw + Math.sin(this.phase * Math.PI * 2) * 0.08 * mv;
    const pelvisPitch = 0.06 + 0.1 * run * mv + 0.25 * crouch * (1 - kneel) + 0.08 * kneel;
    const pelvisRoll = Math.cos(this.phase * Math.PI * 2) * 0.04 * mv;
    const sway = Math.sin(this.phase * Math.PI * 2) * 0.02 * mv;
    R.p[BI.hips].set(sway, hipY, -0.03 * crouch * (1 - kneel) - 0.06 * kneel);
    const qPelvis = new THREE.Quaternion().setFromEuler(new THREE.Euler(pelvisPitch, pelvisYaw, pelvisRoll, 'YXZ'));
    R.orient(BI.hips, V(0, 1, 0).applyQuaternion(qPelvis), V(0, 0, 1).applyQuaternion(qPelvis));

    // ---- aim frame & upper body
    const sprint = this._sprint;
    const aimYaw = this._aimYaw * (1 - sprint * 0.8), aimPitch = this._aimPitch * (1 - sprint);
    const lean = this._lean;
    const cf = this.chestFlinch.x;
    const chestLean = 0.1 + 0.12 * this._ads + 0.25 * sprint + 0.08 * run * mv - 0.05 * kneel;
    const qAim = new THREE.Quaternion().setFromEuler(new THREE.Euler(-aimPitch, aimYaw, 0, 'YXZ'));
    const qChest = new THREE.Quaternion().setFromEuler(new THREE.Euler(-aimPitch * 0.85 + chestLean + breath * 0.012 + cf.x * 0.1, aimYaw + cf.y * 0.1 - 0.28 * this._ads * (1 - sprint), lean * 0.35 + cf.z * 0.1 - 0.06 * this._ads, 'YXZ'));
    const qSpine = qPelvis.clone().slerp(qChest, 0.55);
    R.fk(BI.spine); R.orient(BI.spine, V(0, 1, 0).applyQuaternion(qSpine), V(0, 0, 1).applyQuaternion(qSpine));
    R.fk(BI.chest); R.orient(BI.chest, V(0, 1, 0).applyQuaternion(qChest), V(0, 0, 1).applyQuaternion(qChest));
    // shoulder pocket
    R.fk(BI.neck);
    const pocket = V(-0.095, 0.2 + 0.035 * this._ads, 0.075).applyQuaternion(qChest).add(R.p[BI.chest]);

    // ---- weapon transform (blend of holding poses)
    let wOff = V(), wQ = new THREE.Quaternion();
    const wA = this._ads, wL = (1 - wA) * (1 - sprint), wS = sprint * (1 - wA);
    const blends = [[POSES.aim, wA], [POSES.low, wL], [POSES.sprint, wS]];
    let tw = 0;
    for (const [pz, w] of blends) {
      if (w <= 1e-4) continue;
      const q = new THREE.Quaternion().setFromEuler(pz.rot);
      tw += w;
      wOff.addScaledVector(pz.off, w);
      if (tw === w) wQ.copy(q); else wQ.slerp(q, w / tw);
    }
    if (rl > 0) { wOff.lerp(POSES.reload.off, rl); wQ.slerp(new THREE.Quaternion().setFromEuler(POSES.reload.rot), rl); }
    // recoil
    const rc = this.recoil.x;
    wOff.add(V(0, rc.y * 0.008, rc.z * 0.012));
    wQ.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-rc.y * 0.03, rc.x * 0.02, 0)));
    // sway
    wQ.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(this.t * 1.1) * 0.006 * (1 - wA * 0.6) + Math.sin(this.phase * Math.PI * 4) * 0.02 * mv, Math.sin(this.t * 0.7) * 0.008 + Math.cos(this.phase * Math.PI * 2) * 0.03 * mv, 0)));
    const aimFrame = qAim.clone().slerp(qChest, 0.35 * (1 - wA));
    const wQuat = aimFrame.clone().multiply(wQ);
    const wPos = pocket.clone().add(wOff.applyQuaternion(aimFrame)).sub(BUTT.clone().applyQuaternion(wQuat)).add(this.armJolt.x.clone().multiplyScalar(0.05));
    R.p[BI.weapon].copy(wPos); R.q[BI.weapon].copy(wQuat);
    const wM = new THREE.Matrix4().compose(wPos, wQuat, V(1, 1, 1));

    // ---- neck/head: look along aim, cheek weld when ADS
    const hf = this.headFlinch.x;
    const qHead = new THREE.Quaternion().setFromEuler(new THREE.Euler(-aimPitch + 0.36 * wA + hf.x * 0.1 + 0.05 * (1 - wA), aimYaw * 1.0 + hf.y * 0.1 - 0.06 * wA, 0.3 * wA + hf.z * 0.1, 'YXZ'));
    const qNeck = qChest.clone().slerp(qHead, 0.5).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12 * wA, 0, 0)));
    R.orient(BI.neck, V(0, 1, 0).applyQuaternion(qNeck), V(0, 0, 1).applyQuaternion(qNeck));
    R.fk(BI.head); R.orient(BI.head, V(0, 1, 0).applyQuaternion(qHead), V(0, 0, 1).applyQuaternion(qHead));

    // ---- arms
    const gripR = this.rig.rifle.right, gripL = this.rig.rifle.left;
    const tR = gripR.pos.clone().applyMatrix4(wM);
    let tL = gripL.pos.clone().applyMatrix4(wM);
    const dirL = gripL.dir.clone().transformDirection(wM), frL = gripL.front.clone().transformDirection(wM);
    let handLdir = dirL, handLfront = frL;
    // reload choreography for the support hand
    this.magAttached = false; this.magHidden = false;
    if (this.reloadT >= 0) {
      const t = this.reloadT;
      const mg = this.rig.magGrip; const tMag = mg.pos.clone().applyMatrix4(wM);
      const pouch = V(0.02, -0.1, 0.2).applyQuaternion(qChest).add(R.p[BI.chest]);
      const mdir = mg.dir.clone().transformDirection(wM), mfr = mg.front.clone().transformDirection(wM);
      const pDir = V(0, -0.3, 1).applyQuaternion(qChest), pFr = V(0, 1, 0.3).applyQuaternion(qChest);
      const seg = (a, b) => smooth(a, b, t);
      let pos = tL.clone(), d = dirL.clone(), f = frL.clone();
      const to = (p2, d2, f2, k) => { pos.lerp(p2, k); d.lerp(d2, k); f.lerp(f2, k); };
      to(tMag, mdir, mfr, seg(0.08, 0.2)); // hand to magazine
      const pull = seg(0.22, 0.32);
      if (t > 0.2 && t < 0.36) { this.magAttached = true; pos.add(V(0, -0.12 * pull, 0).applyQuaternion(wQuat)); }
      if (t >= 0.34 && t < 0.46) this.magHidden = true;
      to(pouch, pDir, pFr, seg(0.34, 0.46) * (1 - seg(0.5, 0.64)));
      if (t >= 0.46 && t < 0.74) this.magAttached = true;
      if (t > 0.64 && t < 0.74) pos.add(V(0, -0.06 * (1 - seg(0.64, 0.72)), 0).applyQuaternion(wQuat));
      // after insertion: slap bolt / return to handguard
      const back = seg(0.74, 0.9);
      pos.lerp(tL, back); d.lerp(dirL, back); f.lerp(frL, back);
      tL = pos; handLdir = d; handLfront = f;
    }
    for (const [k, target, hd, hfr, pole] of [
      ['R', tR, gripR.dir.clone().transformDirection(wM), gripR.front.clone().transformDirection(wM), V(-0.5, -1, -0.35 + 0.3 * wA)],
      ['L', tL, handLdir, handLfront, V(0.35, -1, 0.1)],
    ]) {
      // clavicle: small shrug toward the hand target
      R.fk(BI['clav' + k]);
      const cb = BONES[BI['clav' + k]];
      const restTail = cb.tail.clone().sub(J.chest).applyQuaternion(qChest).add(R.p[BI.chest]);
      const toT = target.clone().sub(restTail);
      const tail = restTail.clone().addScaledVector(toT, 0.12);
      if (k === 'R') tail.y += 0.015 * wA;
      R.orient(BI['clav' + k], tail.sub(R.p[BI['clav' + k]]), V(0, 0, 1).applyQuaternion(qChest));
      R.fk(BI['uarm' + k]);
      R.ik(BI['uarm' + k], BI['farm' + k], target, pole.applyQuaternion(qChest), 'arm');
      R.fk(BI['hand' + k]);
      R.orient(BI['hand' + k], hd, hfr);
    }
    // magazine
    if (this.magAttached) {
      const hM = new THREE.Matrix4().compose(R.p[BI.handL], R.q[BI.handL], V(1, 1, 1)).multiply(this.rig.magInHand);
      hM.decompose(R.p[BI.mag], R.q[BI.mag], _e);
    } else { R.p[BI.mag].copy(wPos); R.q[BI.mag].copy(wQuat); }
    R.scale[BI.mag] = this.magHidden ? 0.001 : 1;

    // ---- legs
    const fwdDir = speed > 0.05 ? V(this._vel.x / speed, 0, this._vel.z / speed) : V(0, 0, 1);
    for (let li = 0; li < 2; li++) {
      const k = li === 0 ? 'L' : 'R', s = li === 0 ? 1 : -1;
      const ph = (this.phase + li * 0.5) % 1;
      // neutral stance positions (bladed combat stance / crouch-kneel)
      const bl = this.bladed * (1 - mv);
      const stand = V(s * 0.12 + (s > 0 ? 0.02 : -0.01) * bl, 0, (s > 0 ? 0.11 : -0.1) * bl);
      const walkBase = V(s * 0.1, 0, -0.02);
      const kneelP = s > 0 ? V(0.15, 0, 0.3) : V(-0.13, 0.0, -0.4);
      let base = stand.clone().lerp(walkBase, mv).lerp(kneelP, kneel);
      base.x *= 1 + 0.2 * crouch * (1 - kneel);
      let foot = base.clone(); let lift = 0; let pitch = 0;
      if (mv > 0.001) {
        let off, sw;
        if (ph < duty) { off = halfStride - 2 * halfStride * (ph / duty); sw = 0; pitch = -0.35 * smooth(0.7, 1, ph / duty); }
        else { sw = (ph - duty) / (1 - duty); off = -halfStride + 2 * halfStride * smooth(0, 1, sw); lift = Math.sin(sw * Math.PI) * lerp(0.1, 0.22, run) * (1 - 0.4 * crouch); pitch = lerp(-0.5, 0.25, smooth(0.2, 0.9, sw)); }
        foot.addScaledVector(fwdDir, off * mv); foot.y += lift * mv; pitch *= mv;
        void sw;
      }
      if (kneel > 0 && s < 0) pitch = lerp(pitch, -1.1, kneel);
      foot.y += 0.085;
      // IK
      R.fk(BI['thigh' + k]);
      const pole = V(s * 0.12, -0.05, 1).applyQuaternion(qPelvis);
      if (kneel > 0.01 && s < 0) pole.lerp(V(-0.1, -1.2, 0.35), kneel);
      R.ik(BI['thigh' + k], BI['shin' + k], foot, pole, 'leg');
      R.fk(BI['foot' + k]);
      const fYaw = (s > 0 ? 0.25 : -0.15) * (1 - mv) * (1 - kneel) + legYaw * 0.6 + pelvisYaw * 0.3;
      const fd = V(Math.sin(fYaw) * Math.cos(pitch), -0.39 + Math.sin(-pitch) * 0.9, Math.cos(fYaw) * Math.cos(pitch));
      R.orient(BI['foot' + k], fd, V(0, 1, 0));
      this.feet[li].copy(foot);
    }
    R.apply();
  }
}

// ------------------------------------------------------------------ Ragdoll (verlet, position based)
const PN = ['hips', 'spine', 'chest', 'neck', 'head', 'headTip', 'nose', 'shoulderL', 'elbowL', 'wristL', 'handTipL', 'shoulderR', 'elbowR', 'wristR', 'handTipR', 'hipL', 'kneeL', 'ankleL', 'toeL', 'hipR', 'kneeR', 'ankleR', 'toeR', 'butt', 'muzzle'];
const PI_ = Object.fromEntries(PN.map((n, i) => [n, i]));

export class Ragdoll {
  /**
   * @param rig SoldierRig (current pose), root Object3D (soldier group), collision (CollisionWorld)
   */
  constructor(rig, root, collision, { vel = V(), impulse = V(), part = 'body', hitPoint = null } = {}) {
    this.rig = rig; this.root = root; this.collision = collision;
    root.updateMatrixWorld(true);
    this.M = root.matrixWorld.clone(); this.Minv = this.M.clone().invert();
    const R = rig; const P = {};
    const bp = (bone, bindPt) => R.bindPoint(BI[bone], bindPt, V());
    P.hips = R.p[BI.hips].clone(); P.spine = R.p[BI.spine].clone(); P.chest = R.p[BI.chest].clone(); P.neck = R.p[BI.neck].clone();
    P.head = R.p[BI.head].clone(); P.headTip = R.tail(BI.head, V()); P.nose = bp('head', V(0, 1.7, 0.12));
    for (const k of ['L', 'R']) {
      P['shoulder' + k] = R.p[BI['uarm' + k]].clone(); P['elbow' + k] = R.p[BI['farm' + k]].clone(); P['wrist' + k] = R.p[BI['hand' + k]].clone(); P['handTip' + k] = R.tail(BI['hand' + k], V());
      P['hip' + k] = R.p[BI['thigh' + k]].clone(); P['knee' + k] = R.p[BI['shin' + k]].clone(); P['ankle' + k] = R.p[BI['foot' + k]].clone(); P['toe' + k] = R.tail(BI['foot' + k], V());
    }
    const wM = new THREE.Matrix4().compose(R.p[BI.weapon], R.q[BI.weapon], V(1, 1, 1));
    P.butt = V(0, 0, -0.3).applyMatrix4(wM); P.muzzle = V(0, 0, rig.rifle.muzzle).applyMatrix4(wM);
    this.weaponUp = V(0, 1, 0).applyQuaternion(R.q[BI.weapon]);
    this.x = PN.map((n) => P[n].clone().applyMatrix4(this.M));
    this.prev = this.x.map((p) => p.clone());
    this.rad = PN.map((n) => (/hips|spine|chest/.test(n) ? 0.12 : /head|nose|neck/.test(n) ? 0.09 : /butt|muzzle/.test(n) ? 0.03 : /toe|handTip|ankle|wrist/.test(n) ? 0.045 : 0.06));
    this.ground = this.x.map(() => -1e9);
    this.t = 0; this.sleep = false; this.holdWeapon = 0.25;
    // constraints [a, b, rest, stiffness, mode] mode: 0 equal, 1 min only, 2 max only
    this.cons = [];
    const C = (a, b, st = 1, mode = 0, restMul = 1) => { const ia = PI_[a], ib = PI_[b]; this.cons.push([ia, ib, this.x[ia].distanceTo(this.x[ib]) * restMul, st, mode]); };
    const L = (a, b, len, st = 1, mode = 1) => this.cons.push([PI_[a], PI_[b], len, st, mode]);
    // spine chain + torso box
    C('hips', 'spine'); C('spine', 'chest'); C('chest', 'neck'); C('neck', 'head'); C('head', 'headTip'); C('head', 'nose'); C('nose', 'headTip'); C('neck', 'nose', 0.6); C('neck', 'headTip', 0.8);
    for (const k of ['L', 'R']) {
      C('chest', 'shoulder' + k); C('neck', 'shoulder' + k); C('spine', 'shoulder' + k, 0.4);
      C('hips', 'hip' + k); C('spine', 'hip' + k, 0.8); C('chest', 'hip' + k, 0.3);
      C('shoulder' + k, 'elbow' + k); C('elbow' + k, 'wrist' + k); C('wrist' + k, 'handTip' + k); C('elbow' + k, 'handTip' + k, 0.5);
      C('hip' + k, 'knee' + k); C('knee' + k, 'ankle' + k); C('ankle' + k, 'toe' + k); C('knee' + k, 'toe' + k, 0.6);
      // joint limits (min distances)
      L('shoulder' + k, 'wrist' + k, 0.16); L('hip' + k, 'ankle' + k, 0.3); L('hips', 'knee' + k, 0.25);
      L('chest', 'hip' + k, 0.3); L('nose', 'shoulder' + k, 0.12);
    }
    C('shoulderL', 'shoulderR'); C('hipL', 'hipR'); C('shoulderL', 'hipR', 0.25); C('shoulderR', 'hipL', 0.25);
    L('hips', 'neck', 0.4); L('head', 'chest', 0.2); L('nose', 'chest', 0.2); L('hips', 'chest', 0.26);
    C('butt', 'muzzle');
    // initial velocities (per step displacement)
    const dt = 1 / 60;
    for (let i = 0; i < this.x.length; i++) {
      const v = vel.clone();
      this.prev[i].addScaledVector(v, -dt);
    }
    // impulse near hit
    const hp = hitPoint ? hitPoint.clone() : this.x[PI_[part === 'head' ? 'head' : 'chest']].clone();
    for (let i = 0; i < this.x.length; i++) {
      const w = Math.exp(-this.x[i].distanceToSquared(hp) / 0.08);
      this.prev[i].addScaledVector(impulse, -dt * w);
    }
    // knees buckle forward, torso falls back/forward depending on impulse
    const fwd = V(0, 0, 1).transformDirection(this.M);
    for (const k of ['kneeL', 'kneeR']) this.prev[PI_[k]].addScaledVector(fwd, -dt * (0.9 + Math.random() * 0.6)).add(V(0, dt * 0.6, 0));
    this.prev[PI_.hips].add(V(0, dt * 0.4, 0));
  }

  step(dt) {
    if (this.sleep) return;
    this.t += dt;
    const n = this.x.length, g = -9.8;
    // ground probe (once per frame)
    const col = this.collision;
    for (let i = 0; i < n; i++) {
      if ((i + Math.floor(this.t * 60)) % 2 && this.ground[i] > -1e8) continue;
      const o = this.x[i].clone(); o.y += 0.6;
      const h = col?.raycast ? col.raycast(o, V(0, -1, 0), 3, { dynamic: false }) : null;
      this.ground[i] = h ? h.point.y : 0;
    }
    const sub = 2, h = dt / sub;
    for (let s = 0; s < sub; s++) {
      for (let i = 0; i < n; i++) {
        const x = this.x[i], p = this.prev[i];
        const vx = (x.x - p.x) * 0.995, vy = (x.y - p.y) * 0.995, vz = (x.z - p.z) * 0.995;
        p.copy(x);
        x.x += vx; x.y += vy + g * h * h; x.z += vz;
      }
      // weapon held briefly in right hand
      if (this.t < this.holdWeapon) {
        const w = this.x[PI_.wristR], b = this.x[PI_.butt];
        const m = this.x[PI_.muzzle]; const off = V().subVectors(w, b).multiplyScalar(0.5);
        b.add(off); m.add(off);
      }
      for (let it = 0; it < 6; it++) {
        for (const [a, b, rest, st, mode] of this.cons) {
          const pa = this.x[a], pb = this.x[b];
          _d.subVectors(pb, pa); const d = _d.length() || 1e-6;
          if (mode === 1 && d >= rest) continue;
          if (mode === 2 && d <= rest) continue;
          const diff = ((d - rest) / d) * 0.5 * st;
          pa.addScaledVector(_d, diff); pb.addScaledVector(_d, -diff);
        }
        // ground
        for (let i = 0; i < n; i++) {
          const x = this.x[i], r = this.rad[i], gy = this.ground[i] + r * 0.6;
          if (x.y < gy) {
            x.y = gy;
            const p = this.prev[i]; // friction
            p.x = lerp(p.x, x.x, 0.35); p.z = lerp(p.z, x.z, 0.35);
          }
        }
      }
    }
    // walls: push torso/limb particles out of static geometry
    if (col?.resolveCapsule) {
      for (let i = 0; i < n; i++) {
        const a = this.x[i].clone(), b = this.x[i].clone(); b.y += 0.001;
        const push = col.resolveCapsule(a, b, this.rad[i] * 0.8);
        if (push.lengthSq() > 0) { push.y = Math.max(0, push.y); this.x[i].add(push); }
      }
    }
    // sleep
    if (this.t > 2.5) {
      let e = 0; for (let i = 0; i < n; i++) e += this.x[i].distanceToSquared(this.prev[i]);
      if (e < 1e-6 || this.t > 8) this.sleep = true;
    }
    this.pose();
  }

  /** map particles to bones */
  pose() {
    const R = this.rig; const P = this.x.map((p) => p.clone().applyMatrix4(this.Minv));
    const g = (n) => P[PI_[n]];
    const sideH = V().subVectors(g('hipL'), g('hipR'));
    const sideS = V().subVectors(g('shoulderL'), g('shoulderR'));
    const frontOf = (side, dir) => V().crossVectors(side, dir);
    R.p[BI.hips].copy(g('hips'));
    let dir = V().subVectors(g('spine'), g('hips'));
    R.orient(BI.hips, dir, frontOf(sideH, dir));
    R.fk(BI.spine); dir = V().subVectors(g('chest'), R.p[BI.spine]);
    R.orient(BI.spine, dir, frontOf(sideH.clone().add(sideS), dir));
    R.fk(BI.chest); dir = V().subVectors(g('neck'), R.p[BI.chest]);
    const chestFront = frontOf(sideS, dir);
    R.orient(BI.chest, dir, chestFront);
    R.fk(BI.neck); dir = V().subVectors(g('head'), R.p[BI.neck]); R.orient(BI.neck, dir, chestFront);
    R.fk(BI.head); dir = V().subVectors(g('headTip'), R.p[BI.head]);
    R.orient(BI.head, dir, V().subVectors(g('nose'), R.p[BI.head]));
    for (const k of ['L', 'R']) {
      R.fk(BI['clav' + k]); R.orient(BI['clav' + k], V().subVectors(g('shoulder' + k), R.p[BI['clav' + k]]), chestFront);
      R.fk(BI['uarm' + k]);
      const ua = V().subVectors(g('elbow' + k), R.p[BI['uarm' + k]]);
      const fa = V().subVectors(g('wrist' + k), g('elbow' + k));
      R.orient(BI['uarm' + k], ua, perpTo(fa, ua.clone().normalize(), V()).lengthSq() > 1e-5 ? perpTo(fa, ua.clone().normalize(), V()) : chestFront);
      R.fk(BI['farm' + k]);
      R.orient(BI['farm' + k], fa, perpTo(ua.clone().negate(), fa.clone().normalize(), V()).lengthSq() > 1e-5 ? perpTo(ua.clone().negate(), fa.clone().normalize(), V()) : chestFront);
      R.fk(BI['hand' + k]);
      R.orient(BI['hand' + k], V().subVectors(g('handTip' + k), g('wrist' + k)), V(0, 0, 1).applyQuaternion(R.q[BI['farm' + k]]));
      R.fk(BI['thigh' + k]);
      const th = V().subVectors(g('knee' + k), R.p[BI['thigh' + k]]);
      const sh = V().subVectors(g('ankle' + k), g('knee' + k));
      const tf = perpTo(sh, th.clone().normalize(), V()).negate();
      R.orient(BI['thigh' + k], th, tf.lengthSq() > 1e-5 ? tf : frontOf(sideH, V(0, 1, 0)));
      R.fk(BI['shin' + k]);
      const sf = perpTo(th, sh.clone().normalize(), V());
      R.orient(BI['shin' + k], sh, sf.lengthSq() > 1e-5 ? sf : frontOf(sideH, V(0, 1, 0)));
      R.fk(BI['foot' + k]);
      R.orient(BI['foot' + k], V().subVectors(g('toe' + k), g('ankle' + k)), sh.clone().negate());
    }
    // weapon
    const wd = V().subVectors(g('muzzle'), g('butt')).normalize();
    const up = perpTo(this.weaponUp.clone().transformDirection(this.Minv), wd, V()).normalize();
    const xAx = V().crossVectors(up, wd);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAx, up, wd));
    R.q[BI.weapon].copy(q);
    R.p[BI.weapon].copy(g('butt')).sub(V(0, 0, -0.3).applyQuaternion(q));
    R.p[BI.mag].copy(R.p[BI.weapon]); R.q[BI.mag].copy(q);
    R.apply();
  }
}
