import * as THREE from 'three';
import { LOADOUTS, getTemplate, createSoldierMesh } from './SoldierModel.js';
import { SoldierRig, SoldierAnimator, Ragdoll } from './SoldierRig.js';
import { BI } from './Skeleton.js';
import { clamp, lerp, angleWrap, dampAngle, mulberry32 } from './util.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DOWN = V(0, -1, 0);
const _Y = V(0, 1, 0);
const PART_MULT = { head: 4.0, body: 1.0, limb: 0.7 };

/**
 * One enemy soldier: visual (skinned mesh + procedural animator/ragdoll) and AI brain.
 * States: idle | patrol | investigate | combat(moveCover | cover | advance | flank) | dead
 */
export class Soldier {
  constructor(game, manager, { loadout = 0, seed = 1, position = V(), yaw = 0, ai = true } = {}) {
    this.game = game; this.mgr = manager;
    this.rng = mulberry32(seed * 7919 + 13);
    this.loadout = LOADOUTS[loadout % LOADOUTS.length];
    const tpl = getTemplate(this.loadout);
    const { root, mesh, bones, hitboxes } = createSoldierMesh(tpl);
    this.root = root; this.mesh = mesh; this.hitboxes = hitboxes;
    this.rig = new SoldierRig(bones, tpl.rifle);
    this.anim = new SoldierAnimator(this.rig, seed * 0.618);
    this.anim.reloadDur = 2.4 + this.rng() * 0.6;
    root.userData.hittable = true; root.userData.enemy = this; root.name = 'soldier';
    this.position = root.position.copy(position);
    this.yaw = yaw; root.rotation.y = yaw;
    this.vel = V(); this.health = 100; this.alive = true; this.aiEnabled = ai;
    this.state = ai ? 'patrol' : 'idle';
    this.home = position.clone();
    // perception / combat memory
    this.awareness = 0; this.canSee = false; this.lastSeen = null; this.lastSeenT = -99; this.visibleTime = 0;
    this.reaction = 0; this.nextPerceive = this.rng() * 0.2; this.thinkT = 0;
    this.mag = 30; this.burst = 0; this.shotCd = 0; this.burstCd = 0.5; this.hasToken = false;
    this.cover = null; this.coverPhase = 'hide'; this.coverT = 0; this.peekOffset = null; this.suppressed = 0;
    this.path = []; this.moveTarget = null; this.moveSpeed = 0; this.faceTarget = null; this.patrolWait = 0;
    this.stuckT = 0; this.lastPos = position.clone(); this.role = 'rifleman';
    this.deadT = 0; this.ragdoll = null;
    game.scene.add(root);
    game.collision?.addDynamic?.(root);
    this.anim.update(0.016);
    root.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------ helpers
  get eye() { return V(this.position.x, this.position.y + (this.anim._crouch > 0.5 ? 1.05 : 1.62), this.position.z); }
  muzzleWorld(out = V()) {
    const R = this.rig; out.set(0, 0, R.rifle.muzzle).applyQuaternion(R.q[BI.weapon]).add(R.p[BI.weapon]);
    return out.applyAxisAngle(_Y, this.yaw).add(this.position);
  }
  playerTarget() {
    const p = this.game.player; if (!p?.position) return null;
    const eh = p.eyeHeight ?? 1.65;
    return V(p.position.x, p.position.y + eh * 0.78, p.position.z);
  }
  playerEye() { const p = this.game.player; return p?.position ? V(p.position.x, p.position.y + (p.eyeHeight ?? 1.65), p.position.z) : null; }

  // ------------------------------------------------------------ damage
  takeHit(h) {
    if (!this.alive) return;
    const part = h.part || 'body';
    const dmg = (h.damage ?? 30) * (PART_MULT[part] ?? 1);
    this.health -= dmg;
    const dirW = (h.dir ? h.dir.clone() : V(0, 0, -1)).normalize();
    const dirC = dirW.clone().applyAxisAngle(V(0, 1, 0), -this.yaw);
    this.anim.hit(part, dirC);
    this.game.events.emit('enemy:hit', { enemy: this, part, damage: dmg, point: h.point, dir: dirW, killed: this.health <= 0 });
    // being shot reveals the shooter
    const pe = this.playerEye();
    if (pe) { this.lastSeen = pe; this.lastSeenT = this.game.time; this.awareness = 1; }
    if (this.state !== 'combat' && this.aiEnabled) this.enterCombat();
    this.suppressed = Math.max(this.suppressed, 1.5);
    if (this.health <= 0) this.die({ dir: dirW, part, point: h.point });
  }

  die({ dir = V(0, 0, -1), part = 'body', point = null } = {}) {
    if (!this.alive) return;
    this.alive = false; this.state = 'dead'; this.deadT = 0;
    this.releaseCover(); this.mgr?.releaseToken?.(this);
    this.game.collision?.removeDynamic?.(this.root);
    const impulse = dir.clone().setY(0).normalize().multiplyScalar(part === 'head' ? 1.2 : 2.6 + this.rng() * 1.5);
    impulse.y = 0.4;
    this.anim.update(0);
    this.ragdoll = new Ragdoll(this.rig, this.root, this.game.collision, { vel: this.vel.clone(), impulse, part, hitPoint: point });
    this.game.events.emit('enemy:killed', { enemy: this, headshot: part === 'head' });
  }

  releaseCover() { if (this.cover && this.cover.owner === this) this.cover.owner = null; this.cover = null; }

  // ------------------------------------------------------------ per-frame
  update(dt) {
    if (!this.alive) {
      this.deadT += dt; this.ragdoll?.step(dt);
      return;
    }
    if (this.aiEnabled) this.think(dt);
    this.locomotion(dt);
    this.animate(dt);
  }

  animate(dt) {
    const a = this.anim;
    // velocity in char space
    const lv = this.vel.clone().applyAxisAngle(V(0, 1, 0), -this.yaw);
    a.vel.copy(lv);
    a.lookAround = !this.noLook && (this.state === 'patrol' || this.state === 'idle') && !this.faceTarget ? 1 : 0;
    this.root.position.copy(this.position); this.root.rotation.y = this.yaw;
    a.update(dt);
  }

  // ------------------------------------------------------------ locomotion
  goTo(target, speed) {
    if (!target) { this.path = []; this.moveTarget = null; return; }
    const nav = this.mgr?.nav;
    this.path = nav ? nav.path(this.position, target) : [target.clone()];
    this.moveTarget = target.clone(); this.moveSpeed = speed; this.stuckT = 0;
  }
  arrived() { return !this.path.length; }

  locomotion(dt) {
    const col = this.game.collision;
    let desired = V();
    if (this.path.length) {
      const wp = this.path[0];
      const to = V(wp.x - this.position.x, 0, wp.z - this.position.z); const d = to.length();
      const last = this.path.length === 1;
      if (d < (last ? 0.35 : 0.9)) { this.path.shift(); }
      else {
        // string pulling
        if (this.path.length > 1 && this.mgr?.nav && (this.game.frame ?? 0) % 20 === (this.id ?? 0) % 20) {
          if (this.mgr.nav.walkable(this.position, this.path[1])) this.path.shift();
        }
        const sp = last ? Math.min(this.moveSpeed, d * 2.5 + 0.4) : this.moveSpeed;
        desired.copy(to).divideScalar(d).multiplyScalar(sp);
      }
    }
    // separation from squadmates
    if (this.mgr) for (const o of this.mgr.soldiers) {
      if (o === this || !o.alive) continue;
      const dx = this.position.x - o.position.x, dz = this.position.z - o.position.z; const d2 = dx * dx + dz * dz;
      if (d2 < 1.4 && d2 > 1e-6) { const d = Math.sqrt(d2); desired.x += (dx / d) * (1.2 - d) * 2.5; desired.z += (dz / d) * (1.2 - d) * 2.5; }
    }
    const acc = 1 - Math.exp(-8 * dt);
    this.vel.x += (desired.x - this.vel.x) * acc; this.vel.z += (desired.z - this.vel.z) * acc;
    this.position.x += this.vel.x * dt; this.position.z += this.vel.z * dt;
    if (col?.bvh) {
      const a = V(this.position.x, this.position.y + 0.55, this.position.z), b = V(this.position.x, this.position.y + 1.45, this.position.z);
      const push = col.resolveCapsule(a, b, 0.3);
      this.position.x += push.x; this.position.z += push.z;
      if ((this.game.frame ?? 0) % 3 === (this.id ?? 0) % 3) {
        const h = col.raycast(V(this.position.x, this.position.y + 1.0, this.position.z), DOWN, 3, { dynamic: false });
        if (h) this.groundY = h.point.y;
      }
      if (this.groundY !== undefined) this.position.y = lerp(this.position.y, this.groundY, 1 - Math.exp(-15 * dt));
    }
    // stuck detection
    if (this.path.length) {
      this.stuckT += dt;
      if (this.stuckT > 1.2) { if (this.position.distanceTo(this.lastPos) < 0.3) { this.path.shift(); } this.lastPos.copy(this.position); this.stuckT = 0; }
    }
    // facing
    let faceYaw = null;
    if (this.faceTarget) faceYaw = Math.atan2(this.faceTarget.x - this.position.x, this.faceTarget.z - this.position.z);
    else if (Math.hypot(this.vel.x, this.vel.z) > 0.3) faceYaw = Math.atan2(this.vel.x, this.vel.z);
    if (faceYaw !== null) {
      const diff = angleWrap(faceYaw - this.yaw);
      // upper body takes small offsets, body turns for larger ones
      const moving = Math.hypot(this.vel.x, this.vel.z) > 0.3;
      if (moving || Math.abs(diff) > 0.5) this.yaw = dampAngle(this.yaw, faceYaw, moving ? 6 : 5, dt);
    }
    // aim angles (relative to body)
    const a = this.anim;
    if (this.faceTarget) {
      const e = this.eye; const t = this.faceTarget;
      const yawT = Math.atan2(t.x - e.x, t.z - e.z);
      a.aimYaw = clamp(angleWrap(yawT - this.yaw), -1.0, 1.0);
      a.aimPitch = clamp(Math.atan2(t.y - e.y, Math.hypot(t.x - e.x, t.z - e.z)), -0.9, 0.9);
    } else { a.aimYaw = 0; a.aimPitch = -0.05; }
  }

  // ------------------------------------------------------------ AI
  perceive(dt) {
    const g = this.game, pe = this.playerEye();
    if (!pe || g.player?.health <= 0) { this.canSee = false; return; }
    const e = this.eye;
    const to = V().subVectors(pe, e); const d = to.length(); to.divideScalar(d);
    const fwd = V(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const cosA = to.x * fwd.x + to.z * fwd.z;
    const inFov = d < 6 || cosA > (this.state === 'combat' ? -0.2 : 0.35);
    let vis = false;
    if (inFov && d < 110) {
      const nav = this.mgr?.nav;
      const tgt = this.playerTarget();
      vis = nav ? (nav.los(e, pe) || nav.los(e, tgt)) : true;
    }
    this.canSee = vis;
    if (vis) {
      const crouchK = g.player?.crouching ? 0.6 : 1;
      const rate = (this.state === 'combat' ? 6 : 1) * clamp(18 / (d + 4), 0.25, 3) * crouchK * (1 + (g.player?.moveSpeed01 || 0));
      this.awareness = Math.min(1.5, this.awareness + rate * dt);
      if (this.awareness >= 1) { this.lastSeen = pe.clone(); this.lastSeenT = g.time; }
    } else this.awareness = Math.max(0, this.awareness - dt * 0.05);
  }

  hear(pos, loud = 1) {
    if (!this.alive || !this.aiEnabled) return;
    const d = pos.distanceTo(this.position);
    if (d > 90 * loud) return;
    if (this.state === 'combat') { if (!this.canSee && this.game.time - this.lastSeenT > 2) { this.lastSeen = pos.clone(); this.lastSeenT = this.game.time - 1.5; } return; }
    this.awareness = Math.max(this.awareness, d < 30 ? 1 : 0.6);
    this.lastSeen = pos.clone().add(V((this.rng() - 0.5) * d * 0.15, 0, (this.rng() - 0.5) * d * 0.15));
    this.lastSeenT = this.game.time - 1;
    if (this.awareness >= 1) this.enterCombat(); else { this.state = 'investigate'; this.investT = 0; this.goTo(this.lastSeen, 2.2); }
  }

  enterCombat() {
    if (this.state === 'combat') return;
    this.state = 'combat'; this.sub = 'pick'; this.thinkT = 0;
    this.reaction = 0.35 + this.rng() * 0.4;
    this.mgr?.onEngage?.(this);
  }

  think(dt) {
    const g = this.game;
    this.nextPerceive -= dt; if (this.nextPerceive <= 0) { this.perceive(0.15); this.nextPerceive = 0.15; }
    this.suppressed = Math.max(0, this.suppressed - dt);
    this.shotCd -= dt; this.burstCd -= dt;
    const a = this.anim;
    if (this.canSee) this.visibleTime += dt; else this.visibleTime = 0;

    if (this.state === 'patrol') {
      a.ads = 0; a.crouch = 0; a.sprint = 0; this.faceTarget = null;
      if (this.awareness >= 1) { this.enterCombat(); return; }
      if (this.arrived()) {
        this.patrolWait -= dt;
        if (this.patrolWait <= 0) {
          const nav = this.mgr?.nav; let t = null;
          if (nav?.nodes.length) { for (let k = 0; k < 6 && !t; k++) { const n = nav.nodes[Math.floor(this.rng() * nav.nodes.length)]; if (n.distanceTo(this.home) < 16) t = n; } }
          if (t) this.goTo(t, 1.35);
          this.patrolWait = 2 + this.rng() * 4;
        }
      }
      return;
    }
    if (this.state === 'investigate') {
      a.ads = 0.3; a.sprint = 0; this.faceTarget = this.lastSeen;
      if (this.awareness >= 1 && this.canSee) { this.enterCombat(); return; }
      this.investT += dt;
      if (this.arrived() || this.investT > 15) { this.state = 'patrol'; this.home.copy(this.position); this.awareness = 0.3; }
      return;
    }
    if (this.state !== 'combat') return;

    // ---------------- combat
    const known = this.lastSeen; const pe = this.playerEye();
    const sinceSeen = g.time - this.lastSeenT;
    if (this.canSee && pe) this.lastSeen = pe.clone();
    if (this.mag <= 0) this.reload();
    if (this.reloading && a.reloadT < 0) { this.mag = 30; this.reloading = false; }

    this.thinkT -= dt;
    const nav = this.mgr?.nav;
    // choose cover when needed
    if (this.sub === 'pick' || (this.thinkT <= 0 && this.sub === 'cover' && this.coverCompromised())) {
      const c = nav ? this.mgr.pickCover(this) : null;
      this.releaseCover();
      if (c) { this.cover = c; c.owner = this; this.sub = 'moveCover'; this.goTo(c.p, 3.8 + this.rng() * 0.6); }
      else { this.sub = 'advance'; this.goTo(known || this.position, 2.4); }
      this.thinkT = 1.5;
    }
    if (this.sub === 'moveCover') {
      a.crouch = 0;
      const close = known ? known.distanceTo(this.position) : 99;
      // shoot on the move if exposed at close range
      const shootMove = this.canSee && close < 22 && this.visibleTime > this.reaction;
      a.sprint = shootMove ? 0 : (this.vel.length() > 2.5 ? 1 : 0);
      a.ads = shootMove ? 1 : 0;
      this.faceTarget = shootMove ? this.playerTarget() : null;
      if (shootMove) this.tryFire(dt, 0.6);
      if (this.path.length && this.moveSpeed > 3 && shootMove) this.moveSpeed = 2.2;
      if (this.arrived()) { this.sub = 'cover'; this.coverPhase = 'hide'; this.coverT = 0.6 + this.rng() * 1.0; this.thinkT = 2; }
      return;
    }
    if (this.sub === 'cover') {
      const c = this.cover; a.sprint = 0;
      const aimAt = this.canSee ? this.playerTarget() : known;
      this.faceTarget = aimAt || (c ? c.p.clone().addScaledVector(c.n, -5) : null);
      this.coverT -= dt;
      if (this.coverPhase === 'hide') {
        a.ads = 0.2; a.crouch = c?.low !== false ? 1 : 0;
        if (this.coverT <= 0 && a.reloadT < 0 && this.suppressed < 0.5) {
          if (!this.mgr?.requestToken(this)) { this.coverT = 0.5 + this.rng(); return; }
          this.coverPhase = 'peek'; this.coverT = 1.6 + this.rng() * 2.2; this.burstCd = Math.min(this.burstCd, 0.25);
          if (c && !c.low) {
            // step out to the side with a view
            const t = V(-c.n.z, 0, c.n.x); const side = this.rng() < 0.5 ? 1 : -1;
            let best = null;
            for (const s of [side, -side]) {
              const p = c.p.clone().addScaledVector(t, s * 0.9);
              if (known && nav && nav.los(V(p.x, p.y + 1.6, p.z), known)) { best = p; break; }
            }
            this.peekOffset = best || c.p.clone().addScaledVector(t, side * 0.9);
            this.goTo(this.peekOffset, 2.0);
          }
        }
      } else {
        a.crouch = 0; a.ads = 1;
        if (this.canSee) { this.reaction -= dt; this.tryFire(dt, 1); }
        else if (sinceSeen < 3.5 && known) this.tryFire(dt, 0.4, true); // suppressive fire at last known position
        if (this.coverT <= 0 || this.suppressed > 1.2 || a.reloadT >= 0 || this.mag <= 0) {
          this.coverPhase = 'hide'; this.coverT = 1.2 + this.rng() * 2.4 + this.suppressed; this.mgr?.releaseToken(this);
          if (this.mag < 10) this.reload();
          if (c && !c.low) this.goTo(c.p, 2.2);
          // decide to relocate / flank / advance
          if (sinceSeen > 7 || (this.rng() < 0.18)) { this.sub = this.role === 'flanker' || this.rng() < 0.35 ? 'pick' : 'pick'; this.flankBias = this.role === 'flanker' ? 1 : 0; }
        }
      }
      return;
    }
    if (this.sub === 'advance') {
      a.crouch = 0; a.sprint = 0; a.ads = this.canSee ? 1 : 0.6;
      this.faceTarget = this.canSee ? this.playerTarget() : known;
      if (this.canSee) this.tryFire(dt, 0.7);
      if (this.arrived()) { this.sub = 'pick'; if (sinceSeen > 12) { this.state = 'patrol'; this.home.copy(this.position); this.awareness = 0.4; } }
    }
  }

  reload() { if (this.reloading || this.anim.reloadT >= 0) return; this.anim.startReload(); this.reloading = true; this.game.events.emit('enemy:reload', { enemy: this }); }

  coverCompromised() {
    const c = this.cover; const pe = this.playerEye(); if (!c || !pe) return false;
    const to = V().subVectors(pe, c.p).setY(0).normalize();
    return -to.dot(c.n) < 0.1 || pe.distanceTo(c.p) < 4;
  }

  /** burst fire; acc = accuracy multiplier; blind = suppressive fire at last known position */
  tryFire(dt, acc = 1, blind = false) {
    const g = this.game, a = this.anim;
    if (this.reaction > 0 && !blind) { this.reaction -= dt; return; }
    if (a.reloadT >= 0 || this.mag <= 0 || a._ads < 0.6) return;
    if (this.burst <= 0) {
      if (this.burstCd > 0) return;
      this.burst = 3 + Math.floor(this.rng() * 4); this.burstCd = 0.5 + this.rng() * 0.8;
    }
    if (this.shotCd > 0) return;
    this.shotCd = 60 / (this.loadout.rifle === 'ak' ? 620 : 750);
    this.burst--; this.mag--;
    a.fire(this.loadout.rifle === 'ak' ? 1.2 : 1);
    const origin = this.muzzleWorld();
    const tgt = blind ? this.lastSeen?.clone() : this.playerTarget();
    if (!tgt) return;
    const dist = origin.distanceTo(tgt);
    const pl = g.player;
    // hit probability: distance, target motion, exposure time, stance and a global fairness cap
    let p = 0.5 / (1 + (dist / 22) ** 2);
    p *= 1 - 0.55 * (pl?.moveSpeed01 || 0) * (pl?.sprinting ? 1.2 : 1);
    p *= clamp(0.35 + this.visibleTime * 0.25, 0.35, 1);
    if (pl?.crouching) p *= 0.85;
    p *= acc * (this.mgr?.accuracyScale ?? 1);
    if (blind) p = 0;
    const hit = this.rng() < p && this.mgr?.allowDamage?.();
    const aim = tgt.clone();
    if (hit) aim.add(V((this.rng() - 0.5) * 0.25, (this.rng() - 0.5) * 0.35, (this.rng() - 0.5) * 0.25));
    else {
      const dir0 = V().subVectors(tgt, origin).normalize();
      const side = V().crossVectors(dir0, V(0, 1, 0)).normalize();
      const up = V().crossVectors(side, dir0);
      const ang = this.rng() * Math.PI * 2, r = 0.45 + this.rng() * (blind ? 2.5 : 1.3);
      aim.addScaledVector(side, Math.cos(ang) * r).addScaledVector(up, Math.sin(ang) * r * 0.7);
    }
    const dir = aim.sub(origin).normalize();
    g.events.emit('enemy:fire', { origin: origin.clone(), dir: dir.clone(), enemy: this, blind, p });
    const wh = g.collision?.raycast ? g.collision.raycast(origin, dir, 300, { dynamic: false }) : null;
    if (hit && (!wh || wh.distance > dist - 0.3)) {
      const amount = Math.round(lerp(18, 11, clamp(dist / 40, 0, 1)));
      if (typeof pl?.damage === 'function') pl.damage(amount, origin.clone());
      else if (pl) { pl.health = Math.max(0, (pl.health ?? 100) - amount); g.events.emit('player:damaged', { amount, fromPos: origin.clone() }); }
    } else if (wh) {
      g.events.emit('hit', { point: wh.point, normal: wh.normal, surface: wh.surface, object: null, part: null, dir: dir.clone(), damage: 0, source: 'enemy' });
    }
  }

  dispose() {
    this.game.scene.remove(this.root);
    this.game.collision?.removeDynamic?.(this.root);
  }
}
