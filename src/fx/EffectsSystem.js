import * as THREE from 'three';
import { buildParticleAtlas, buildDecalAtlas, P, D } from './textures.js';
import { Particles } from './Particles.js';
import { Debris } from './Debris.js';
import { Decals } from './Decals.js';
import { mulberry32 } from './rng.js';

/**
 * Combat VFX. Owner: fx agent.
 * Listens: 'weapon:fire', 'hit', 'enemy:fire'.  Emits: 'fx:shell_land' {position, surface, speed}, 'fx:explosion' {position}.
 * Public API: spawnImpact(point, normal, surface, dir?), explosion(position, {scale}), tracer(from, to, opts),
 *             muzzleFlash(pos, dir, opts), ejectShell(pos, dir), frozen (bool: pause simulation, used by shots).
 */
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

export class EffectsSystem {
  constructor(game) {
    this.game = game;
    this.rand = mulberry32(20190);
    this.time = 0; this.frozen = false; this.shots = 0; this.sunVis = 1;
    this.q = game.quality === 'low' ? 0.5 : 1;
    this.root = new THREE.Group(); this.root.name = 'fx'; game.scene.add(this.root);

    this.particles = new Particles(this, buildParticleAtlas(game.quality === 'low' ? 128 : 256));
    this.debris = new Debris(this);
    this.decals = new Decals(this, buildDecalAtlas(256), 256);

    // dynamic lights (always present so shader light counts never change)
    this.lightA = new THREE.PointLight(0xffa860, 0, 10, 2); this.lightA.name = 'fx-muzzle-light';
    this.lightB = new THREE.PointLight(0xff9a50, 0, 60, 2); this.lightB.name = 'fx-world-light';
    this.root.add(this.lightA, this.lightB);
    this.lightAPeak = 0; this.lightAT = 1; this.lightADur = 0.05;
    this.lightBPeak = 0; this.lightBT = 1; this.lightBDur = 0.1; this.lightBPri = 0;

    this._envT = 0;
    this._initAmbient();

    const ev = game.events;
    ev.on('weapon:fire', (e) => this._onWeaponFire(e));
    ev.on('hit', (h) => this._onHit(h));
    ev.on('enemy:fire', (e) => this._onEnemyFire(e));
  }

  // ------------------------------------------------------------------ helpers
  r(a = 0, b = 1) { return a + (b - a) * this.rand(); }
  sign() { return this.rand() < 0.5 ? -1 : 1; }
  unit(out = new THREE.Vector3()) {
    const u = this.r(-1, 1), t = this.r(0, Math.PI * 2), s = Math.sqrt(1 - u * u);
    return out.set(s * Math.cos(t), u, s * Math.sin(t));
  }
  /** random direction in a cone around dir (spread ~ tangent of half-angle) */
  cone(dir, spread, out = new THREE.Vector3()) {
    this.unit(out).multiplyScalar(spread * Math.sqrt(this.rand())); out.add(dir); return out.normalize();
  }
  plane(n, p) { return new THREE.Vector4(n.x, n.y, n.z, -n.dot(p)); }
  floorBelow(p, max = 6) {
    const col = this.game.collision; if (!col?.bvh) return 0;
    const h = col.raycast(_a.copy(p).addScaledVector(UP, 0.05), _b.set(0, -1, 0), max, { dynamic: false });
    return h ? h.point.y : -1e9;
  }
  /** 1 if point sees the sun (static BVH ray), else small ambient-only factor. */
  sunVisibility(p) {
    const col = this.game.collision; if (!col?.bvh) return 1;
    const sd = this.particles.uniforms.uSunDir.value;
    const h = col.raycast(_a.copy(p).addScaledVector(sd, 0.08), _b.copy(sd), 120, { dynamic: false });
    return h ? 0 : 1;
  }
  classify(s) {
    s = String(s || 'concrete').toLowerCase();
    if (/flesh|body|enemy|head|limb/.test(s)) return 'flesh';
    if (/metal|car|steel|iron|tin|pipe|container/.test(s)) return 'metal';
    if (/wood|plank|crate|pallet/.test(s)) return 'wood';
    if (/glass|window/.test(s)) return 'glass';
    if (/sandbag|tarp|cloth|fabric|rubber|plastic|camo/.test(s)) return 'soft';
    if (/dirt|grass|gravel|mud|soil|sand|earth/.test(s)) return 'dirt';
    if (/brick|roof/.test(s)) return 'brick';
    if (/plaster|tile|drywall/.test(s)) return 'plaster';
    if (/asphalt|road/.test(s)) return 'asphalt';
    return 'concrete';
  }

  // ------------------------------------------------------------------ muzzle
  _muzzlePos(e, out) {
    const mo = this.game.weapons?.muzzleObject;
    if (mo) { mo.updateWorldMatrix(true, false); return mo.getWorldPosition(out); }
    if (e.muzzleWorld) return out.copy(e.muzzleWorld);
    const cam = this.game.camera;
    return out.set(0.12, -0.1, -0.7).applyMatrix4(cam.matrixWorld);
  }

  _onWeaponFire(e) {
    const dir = (e.dir || this.game.camera.getWorldDirection(new THREE.Vector3())).clone().normalize();
    const origin = e.origin || this.game.camera.getWorldPosition(new THREE.Vector3());
    const muzzle = this._muzzlePos(e, new THREE.Vector3());
    const w = e.weapon || this.game.weapons?.current || {};
    const name = String(w.name || w.id || '').toLowerCase();
    const scale = w.flashScale ?? (/shotgun/.test(name) ? 1.4 : /smg|mp5|mp7/.test(name) ? 0.8 : /pistol|m9|glock|1911/.test(name) ? 0.7 : 1);
    this.muzzleFlash(muzzle, dir, { fp: true, scale: scale * 1.25, suppressed: !!w.suppressed });
    this.shots++;
    const every = w.tracerEvery ?? 3;
    if (every > 0 && this.shots % every === 0) {
      const h = this.game.collision?.raycast(origin, dir, 600, { dynamic: true });
      const end = h ? h.point.clone() : origin.clone().addScaledVector(dir, 600);
      this.tracer(muzzle.clone().addScaledVector(dir, 0.4), end, {});
    }
    if (w.shells !== false) this.ejectShell(null, dir);
  }

  _onEnemyFire(e) {
    if (!e?.origin || !e?.dir) return;
    const dir = e.dir.clone().normalize();
    this.muzzleFlash(e.origin, dir, { fp: false, scale: 1.3 });
    const h = this.game.collision?.raycast(e.origin, dir, 400, { dynamic: false, ignore: e.enemy });
    const end = h ? h.point.clone() : e.origin.clone().addScaledVector(dir, 400);
    this.tracer(e.origin.clone().addScaledVector(dir, 0.5), end, { color: [14, 6, 1.8] });
    if (h && !e.noImpact && h.distance > 1) this.spawnImpact(h.point, h.normal, h.surface, dir);
  }

  /** Multi-layer muzzle flash + light + lingering smoke. */
  muzzleFlash(pos, dir, { fp = true, scale = 1, suppressed = false } = {}) {
    const ps = this.particles; const s = scale * (suppressed ? 0.4 : 1); const R = () => this.rand();
    const side = dir.clone().cross(UP); if (side.lengthSq() < 1e-4) side.set(1, 0, 0); side.normalize();
    const up2 = side.clone().cross(dir).normalize();
    const hot = suppressed ? 0.35 : 1;
    const P0 = pos.clone();
    this.sunVis = this.sunVisibility(P0);
    // hot core
    ps.spawn({ pos: P0.clone().addScaledVector(dir, 0.02 * s), size: 0.075 * s, size1: 0.09 * s, tile: P.CORE, color: [6 * hot, 3.4 * hot, 1.3 * hot], life: 0.05, additive: 1, fadeIn: 0, fadeOut: 0.7, rot: R() * 6.28 });
    ps.spawn({ pos: P0.clone().addScaledVector(dir, 0.04 * s), size: 0.26 * s, tile: P.GLOW, color: [1.1 * hot, 0.5 * hot, 0.16 * hot], life: 0.05, additive: 1, fadeIn: 0, fadeOut: 0.8 });
    // front star (perpendicular to barrel) + camera-facing star so it reads in first person
    ps.spawn({ pos: P0.clone().addScaledVector(dir, 0.05 * s), mode: 2, axis: dir, size: this.r(0.26, 0.36) * s, tile: P.STAR, color: [3.2 * hot, 1.3 * hot, 0.32 * hot], life: 0.05, additive: 1, fadeIn: 0, fadeOut: 0.6, rot: R() * 6.28 });
    ps.spawn({ pos: P0.clone().addScaledVector(dir, 0.07 * s), size: this.r(0.22, 0.3) * s * (fp ? 1 : 1.3), tile: P.STAR, color: [2.6 * hot, 1.05 * hot, 0.26 * hot], life: 0.05, additive: 1, fadeIn: 0, fadeOut: 0.6, rot: R() * 6.28 });
    if (!suppressed) {
      // flame petals: forward tongues + radial petals (read as a burst from behind the gun)
      const n = 3 + Math.floor(R() * 2);
      for (let i = 0; i < n; i++) {
        const ax = this.cone(dir, 0.15, new THREE.Vector3());
        ps.spawn({ pos: P0.clone(), mode: 1, axis: ax, anchor: 1, len: this.r(0.22, 0.45) * s * (fp ? 1 : 1.4), size: this.r(0.08, 0.12) * s, tile: P.FLAME, color: [3.6, 1.35, 0.3], life: 0.05, additive: 1, fadeIn: 0, fadeOut: 0.6 });
      }
      const np = 4 + Math.floor(R() * 3); const a0 = R() * 6.28;
      for (let i = 0; i < np; i++) {
        const a = a0 + (i / np) * 6.28 + this.r(-0.3, 0.3);
        const ax = dir.clone().multiplyScalar(this.r(0.5, 1.1)).addScaledVector(side, Math.cos(a)).addScaledVector(up2, Math.sin(a)).normalize();
        ps.spawn({ pos: P0.clone().addScaledVector(dir, 0.03 * s), mode: 1, axis: ax, anchor: 1, len: this.r(0.1, 0.2) * s, size: this.r(0.05, 0.08) * s, tile: P.FLAME, color: [3.2, 1.2, 0.28], life: 0.05, additive: 1, fadeIn: 0, fadeOut: 0.6 });
      }
      // muzzle-brake side vents
      for (const sg of [-1, 1]) {
        const ax = side.clone().multiplyScalar(sg).addScaledVector(dir, 0.35).addScaledVector(up2, this.r(-0.15, 0.15)).normalize();
        ps.spawn({ pos: P0.clone().addScaledVector(dir, 0.015), mode: 1, axis: ax, anchor: 1, len: this.r(0.1, 0.17) * s, size: 0.06 * s, tile: P.FLAME, color: [3.4, 1.3, 0.3], life: 0.045, additive: 1, fadeIn: 0, fadeOut: 0.6 });
      }
      const up3 = up2.clone().addScaledVector(dir, 0.4).normalize();
      ps.spawn({ pos: P0.clone().addScaledVector(dir, 0.015), mode: 1, axis: up3, anchor: 1, len: this.r(0.06, 0.1) * s, size: 0.045 * s, tile: P.FLAME, color: [3, 1.15, 0.26], life: 0.045, additive: 1, fadeIn: 0 });
      // burning powder sparks
      for (let i = 0; i < 6 * this.q; i++) {
        const v = this.cone(dir, 0.35, new THREE.Vector3()).multiplyScalar(this.r(10, 30));
        ps.spawn({ pos: P0.clone(), vel: v, mode: 1, stretch: 0.012, size: 0.004, minPx: 1, tile: P.SPARK, color: [7, 3.2, 1], color1: [2, 0.4, 0.05], life: this.r(0.05, 0.14), additive: 1, anchor: -1, drag: 4, fadeIn: 0, fadeOut: 0.5 });
      }
    }
    // lingering smoke wisps
    for (let i = 0; i < 2; i++) {
      const v = dir.clone().multiplyScalar(this.r(0.5, 1.4)).addScaledVector(UP, this.r(0.15, 0.35)).addScaledVector(this.unit(_c), 0.15);
      ps.spawn({ pos: P0.clone().addScaledVector(dir, this.r(0.02, 0.12)), vel: v, size: 0.05 * s, size1: this.r(0.28, 0.5) * s, sizePow: 1.6, tile: i ? P.SMOKE2 : P.SMOKE0,
        color: [0.5, 0.49, 0.48], alpha: fp ? 0.11 : 0.22, life: this.r(0.9, 1.7), lit: 1, drag: 1.6, buoy: 0.25, turb: 0.5, rot: R() * 6.28, rotVel: this.r(-1, 1),
        fadeIn: 0.04, fadeOut: 0.75, erode: 0.0, erode1: 0.45 });
    }
    // light
    const lp = P0.clone().addScaledVector(dir, 0.18);
    if (fp) { this.lightA.position.copy(lp); this.lightAPeak = (suppressed ? 1.2 : 6) * scale; this.lightAT = 0; this.lightADur = 0.06; }
    else this._worldLight(lp, 20 * scale, 0.06, 1);
    this.sunVis = 1;
  }

  _worldLight(pos, peak, dur, pri) {
    if (this.lightBT < this.lightBDur && pri < this.lightBPri) {
      // don't steal from a stronger active light (explosions win); still allow if much closer to camera
      return;
    }
    this.lightB.position.copy(pos); this.lightBPeak = peak; this.lightBT = 0; this.lightBDur = dur; this.lightBPri = pri;
  }

  /** Brass ejection from weapons.ejectObject (or estimated from the camera), bounces on the BVH. */
  ejectShell(pos, dir) {
    const cam = this.game.camera; cam.updateMatrixWorld();
    dir = dir || cam.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3(1, 0, 0).transformDirection(cam.matrixWorld);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(cam.matrixWorld);
    if (!pos) {
      const W = this.game.weapons;
      const eo = W?.ejectObject || W?.ejectionPort;
      if (eo) { eo.updateWorldMatrix(true, false); pos = eo.getWorldPosition(new THREE.Vector3()); }
      else pos = new THREE.Vector3(0.1, -0.09, -0.32).applyMatrix4(cam.matrixWorld);
    }
    const vel = right.clone().multiplyScalar(this.r(2.0, 3.0)).addScaledVector(up, this.r(1.2, 2.0)).addScaledVector(dir, this.r(-0.5, 0.2));
    if (this.game.player?.velocity) vel.add(this.game.player.velocity);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
    const w = up.clone().multiplyScalar(this.r(18, 30) * this.sign()).addScaledVector(dir, this.r(-6, 6));
    this.debris.spawn({ kind: 'shell', pos, vel, q, w, scale: 1, radius: 0.005, color: [1, 1, 1], life: 12, rest: 0.45, friction: 0.7, drag: 0.1, event: 'fx:shell_land' });
  }

  /** Bright tracer streak travelling from `from` to `to`. */
  tracer(from, to, { speed = 380, len = 5.5, width = 0.022, color = [14, 5.5, 1.6] } = {}) {
    const dir = to.clone().sub(from); const dist = dir.length(); if (dist < 1) return; dir.divideScalar(dist);
    const life = (dist + len) / speed + 0.02;
    const head = Math.min(dist, len * 0.7) / speed; // appear already streaking out of the muzzle
    const a = this.particles.spawn({ tracer: true, pos: from, dir, dist, speed, len, size: width, minPx: 1.6, tile: P.TRACER, color, life, additive: 1, fadeIn: 0, fadeOut: 0 });
    const b = this.particles.spawn({ tracer: true, pos: from, dir, dist, speed, len: len * 0.9, size: width * 7, minPx: 5, tile: P.TRACER, color: color.map((c) => c * 0.1), life, additive: 1, fadeIn: 0, fadeOut: 0 });
    if (a) a.age = head; if (b) b.age = head;
  }

  // ------------------------------------------------------------------ impacts
  _onHit(h) {
    if (!h?.point) return;
    const surface = h.object ? 'flesh' : h.surface;
    this.spawnImpact(h.point, h.normal || _d.set(0, 1, 0), surface, h.dir);
  }

  /** Public: surface-specific bullet impact (particles + debris + decal). */
  spawnImpact(point, normal, surface = 'concrete', dir = null) {
    const n = normal.clone().normalize();
    const p = point.clone();
    const d = dir ? dir.clone().normalize() : n.clone().negate();
    if (n.dot(d) > 0) n.negate();
    const refl = d.clone().addScaledVector(n, -2 * d.dot(n)).normalize();
    const kind = this.classify(surface);
    const ctx = { p, n, d, refl, plane: this.plane(n, p), floorY: this.floorBelow(p), kind };
    this.sunVis = this.sunVisibility(p.clone().addScaledVector(n, 0.15));
    switch (kind) {
      case 'metal': this._impactMetal(ctx); break;
      case 'wood': this._impactWood(ctx); break;
      case 'dirt': this._impactDirt(ctx, [0.3, 0.24, 0.17], D.DIRT); break;
      case 'soft': this._impactDirt(ctx, [0.46, 0.4, 0.3], D.CLOTH, true); break;
      case 'glass': this._impactGlass(ctx); break;
      case 'flesh': this._impactFlesh(ctx); break;
      case 'brick': this._impactMineral(ctx, [0.5, 0.33, 0.26], D.BRICK); break;
      case 'plaster': this._impactMineral(ctx, [0.72, 0.7, 0.65], D.PLASTER); break;
      case 'asphalt': this._impactMineral(ctx, [0.36, 0.35, 0.34], this.rand() < 0.5 ? D.CONCRETE0 : D.CONCRETE1, 0.6); break;
      default: this._impactMineral(ctx, [0.56, 0.54, 0.5], this.rand() < 0.5 ? D.CONCRETE0 : D.CONCRETE1);
    }
    this.sunVis = 1;
    this.game.events.emit('fx:impact', { point: p, normal: n, surface: kind });
  }

  _dust(ctx, col, { count = 6, speed = [2, 6], size = [0.06, 0.1], size1 = [0.45, 0.9], life = [0.9, 1.8], alpha = [0.4, 0.65], spread = 0.45, bias = 0.3, tiles = [P.DUST, P.SMOKE0, P.SMOKE1, P.SMOKE2] } = {}) {
    const { p, n, refl, plane } = ctx; const base = n.clone().lerp(refl, bias).normalize();
    for (let i = 0; i < count * this.q; i++) {
      const v = this.cone(base, spread, new THREE.Vector3()).multiplyScalar(this.r(speed[0], speed[1]));
      const k = this.r(0.85, 1.1);
      this.particles.spawn({ pos: p.clone().addScaledVector(n, 0.03), vel: v, drag: 5, size: this.r(size[0], size[1]), size1: this.r(size1[0], size1[1]), sizePow: 2.6,
        tile: tiles[i % tiles.length], color: [col[0] * k, col[1] * k, col[2] * k], alpha: this.r(alpha[0], alpha[1]), life: this.r(life[0], life[1]), lit: 1,
        rot: this.r(0, 6.28), rotVel: this.r(-1.2, 1.2), fadeIn: 0.02, fadeOut: 0.85, alphaPow: 1.3, buoy: 0.12, turb: 0.25, erode: 0, erode1: 0.45, plane, soft: 0.12 });
    }
  }

  /** fast narrow jet of dust streaks shooting out of the hole */
  _jet(ctx, col, count = 3) {
    const { p, n, refl, plane } = ctx; const base = n.clone().lerp(refl, 0.2).normalize();
    for (let i = 0; i < count * this.q; i++) {
      const v = this.cone(base, 0.25, new THREE.Vector3()).multiplyScalar(this.r(7, 13));
      this.particles.spawn({ pos: p.clone().addScaledVector(n, 0.02), vel: v, drag: 9, mode: 1, stretch: 0.045, anchor: -1, size: this.r(0.035, 0.06), size1: this.r(0.14, 0.22),
        tile: P.SMOKE2, color: col, alpha: this.r(0.6, 0.8), lit: 1, life: this.r(0.25, 0.4), fadeIn: 0, fadeOut: 0.7, erode: 0.05, erode1: 0.6, plane, soft: 0.08 });
    }
  }

  _grit(ctx, col, count, { speed = [3, 9], size = [0.012, 0.024], spread = 0.75, lit = 1, tile = P.GLOW } = {}) {
    const { p, n, refl, floorY } = ctx; const base = n.clone().lerp(refl, 0.25).normalize();
    for (let i = 0; i < count * this.q; i++) {
      const v = this.cone(base, spread, new THREE.Vector3()).multiplyScalar(this.r(speed[0], speed[1]));
      const k = this.r(0.4, 0.9);
      this.particles.spawn({ pos: p.clone().addScaledVector(n, 0.01), vel: v, gravity: 9.8, drag: 0.8, mode: 1, stretch: 0.012, size: this.r(size[0], size[1]), minPx: 1.6,
        tile, color: [col[0] * k, col[1] * k, col[2] * k], lit, alpha: 1, life: this.r(0.35, 0.9), fadeIn: 0, fadeOut: 0.25, anchor: -1, floorY, rest: 0.2 });
    }
  }

  _chunks(ctx, col, count, { size = [0.006, 0.018], speed = [2, 5], kind = 'chunk', spread = 0.8, trail = null } = {}) {
    const { p, n } = ctx;
    for (let i = 0; i < count * this.q; i++) {
      const v = this.cone(n, spread, new THREE.Vector3()).multiplyScalar(this.r(speed[0], speed[1]));
      const k = this.r(0.65, 1.1); const s = this.r(size[0], size[1]);
      const scale = kind === 'splinter' ? new THREE.Vector3(s * 0.25, s * 0.25, s * this.r(2.5, 5)) : kind === 'shard' ? new THREE.Vector3(s, s, s) : s;
      this.debris.spawn({ kind, pos: p.clone().addScaledVector(n, 0.02), vel: v, scale, radius: s * 0.5, color: [col[0] * k, col[1] * k, col[2] * k], life: this.r(3, 5), rest: kind === 'shard' ? 0.25 : 0.35, spin: 25, trail });
    }
  }

  _impactMineral(ctx, col, decal, dark = 1) {
    const { p, n } = ctx; const ps = this.particles;
    ps.spawn({ pos: p.clone().addScaledVector(n, 0.03), size: 0.1, tile: P.FLARE, color: [2.5, 2.0, 1.4], life: 0.04, additive: 1, fadeIn: 0, rot: this.r(0, 6.28) });
    this._jet(ctx, col);
    this._dust(ctx, col);
    // slow lingering cloud
    this._dust(ctx, col, { count: 2, speed: [0.3, 0.8], size: [0.15, 0.25], size1: [0.9, 1.3], life: [1.6, 2.8], alpha: [0.07, 0.12], spread: 0.6, bias: 0 });
    // grit sprite burst (reads as a spray of chips)
    ps.spawn({ pos: p.clone().addScaledVector(n, 0.03), vel: n.clone().multiplyScalar(2.2), drag: 5, size: 0.06, size1: 0.4, tile: P.GRIT, color: col.map((c) => c * 0.45), lit: 1, alpha: 0.6, life: 0.35, fadeIn: 0, fadeOut: 0.6, rot: this.r(0, 6.28) });
    this._grit(ctx, col.map((c) => c * 0.8 * dark), 16);
    this._chunks(ctx, col, 4);
    this.decals.add(p, n, decal, this.r(0.15, 0.2));
  }

  _impactMetal(ctx) {
    const { p, n, refl, floorY, plane } = ctx; const ps = this.particles;
    ps.spawn({ pos: p.clone().addScaledVector(n, 0.02), size: 0.2, tile: P.GLOW, color: [7, 4, 1.8], life: 0.05, additive: 1, fadeIn: 0 });
    ps.spawn({ pos: p.clone().addScaledVector(n, 0.02), size: 0.4, tile: P.FLARE, color: [6, 3.8, 1.8], life: 0.06, additive: 1, fadeIn: 0, rot: this.r(0, 6.28) });
    ps.spawn({ pos: p.clone().addScaledVector(n, 0.005), mode: 2, axis: n, size: 0.05, tile: P.GLOW, color: [3, 1.0, 0.2], life: 0.5, additive: 1, fadeIn: 0, fadeOut: 0.9 }); // hot spot
    const base = refl.clone().multiplyScalar(0.7).addScaledVector(n, 0.5).normalize();
    for (let i = 0; i < 22 * this.q; i++) {
      const v = this.cone(base, 0.6, new THREE.Vector3()).multiplyScalar(this.r(3, 14));
      const long = this.rand() < 0.25;
      ps.spawn({ pos: p.clone().addScaledVector(n, 0.01), vel: v, gravity: 9.8, drag: long ? 0.6 : 1.4, mode: 1, stretch: 0.035, size: this.r(0.007, 0.014), minPx: 2,
        tile: P.SPARK, color: [16, 8, 2.4], color1: [3, 0.55, 0.06], life: long ? this.r(0.6, 1.1) : this.r(0.15, 0.5), additive: 1, anchor: -1, fadeIn: 0, fadeOut: 0.35, floorY, rest: 0.45 });
    }
    this._dust(ctx, [0.42, 0.41, 0.4], { count: 2, speed: [0.8, 2], size: [0.04, 0.06], size1: [0.25, 0.45], life: [0.6, 1.2], alpha: [0.25, 0.35] });
    this._chunks(ctx, [0.28, 0.3, 0.27], 2, { size: [0.004, 0.008] });
    this.decals.add(p, n, this.rand() < 0.5 ? D.METAL0 : D.METAL1, this.r(0.09, 0.12));
    void plane;
  }

  _impactWood(ctx) {
    const col = [0.46, 0.35, 0.23];
    this._dust(ctx, col, { count: 3, alpha: [0.35, 0.55] });
    this._grit(ctx, [0.6, 0.45, 0.28], 10);
    this._chunks(ctx, [0.78, 0.6, 0.4], 7, { kind: 'splinter', size: [0.008, 0.016], speed: [2, 6] });
    this.decals.add(ctx.p, ctx.n, this.rand() < 0.5 ? D.WOOD0 : D.WOOD1, this.r(0.13, 0.17));
  }

  _impactDirt(ctx, col, decal, soft = false) {
    const { p, n, floorY } = ctx; const ps = this.particles;
    const upish = n.clone().addScaledVector(UP, 0.8).normalize();
    for (let i = 0; i < (soft ? 3 : 7) * this.q; i++) {
      const v = this.cone(upish, 0.35, new THREE.Vector3()).multiplyScalar(this.r(2.5, 6));
      ps.spawn({ pos: p.clone().addScaledVector(n, 0.02), vel: v, gravity: 9.8, drag: 1.2, size: this.r(0.05, 0.1), size1: this.r(0.14, 0.26), tile: P.CLUMPS, color: col.map((c) => c * 0.75), lit: 1, alpha: 1,
        life: this.r(0.45, 0.8), fadeIn: 0, fadeOut: 0.35, rot: this.r(0, 6.28), rotVel: this.r(-3, 3), floorY });
    }
    this._grit({ ...ctx, n: upish }, col.map((c) => c * 0.7), soft ? 6 : 20, { speed: [2, 7], size: [0.008, 0.018], spread: 0.5 });
    this._dust(ctx, col.map((c) => c * 1.4), { count: soft ? 3 : 4, speed: [1.5, 4], size1: [0.4, 0.9], life: [1, 2.2], alpha: [0.35, 0.55], bias: 0 });
    if (!soft) this._chunks(ctx, col, 3, { size: [0.008, 0.02], speed: [2, 4] });
    this.decals.add(p, n, decal, this.r(0.16, 0.22));
    void floorY;
  }

  _impactGlass(ctx) {
    const { p, n, d, floorY } = ctx; const ps = this.particles;
    this._chunks({ ...ctx, n: n.clone().lerp(d, 0.6).normalize() }, [0.8, 0.9, 0.92], 9, { kind: 'shard', size: [0.008, 0.025], speed: [1.5, 4], spread: 1 });
    for (let i = 0; i < 12 * this.q; i++) {
      const v = this.cone(n, 0.9, new THREE.Vector3()).multiplyScalar(this.r(1, 4));
      ps.spawn({ pos: p.clone(), vel: v, gravity: 9.8, size: this.r(0.02, 0.05), tile: P.FLARE, color: [2.5, 2.7, 3], life: this.r(0.3, 0.8), additive: 1, flicker: 0.8, rot: this.r(0, 6.28), floorY });
    }
    this._dust(ctx, [0.8, 0.82, 0.85], { count: 2, alpha: [0.2, 0.3], size1: [0.2, 0.4] });
    this.decals.add(p, n, D.GLASS, this.r(0.22, 0.32), { check: false });
  }

  _impactFlesh(ctx) {
    const { p, n, d, floorY } = ctx; const ps = this.particles;
    const red = [0.24, 0.018, 0.014];
    for (let i = 0; i < 4 * this.q; i++) {
      const v = this.cone(n, 0.7, new THREE.Vector3()).multiplyScalar(this.r(0.6, 1.8));
      ps.spawn({ pos: p.clone(), vel: v, drag: 6, size: this.r(0.06, 0.1), size1: this.r(0.35, 0.6), tile: P.BLOOD, color: red, lit: 0.9, alpha: 0.9, life: this.r(0.25, 0.5), fadeIn: 0, fadeOut: 0.7, rot: this.r(0, 6.28), erode: 0, erode1: 0.5 });
    }
    for (let i = 0; i < 5 * this.q; i++) { // exit spray
      const v = this.cone(d, 0.35, new THREE.Vector3()).multiplyScalar(this.r(2, 5));
      ps.spawn({ pos: p.clone().addScaledVector(d, 0.15), vel: v, drag: 5, size: this.r(0.08, 0.14), size1: this.r(0.4, 0.8), tile: P.BLOOD, color: red.map((c) => c * 0.8), lit: 0.9, alpha: 0.85, life: this.r(0.3, 0.6), fadeIn: 0, fadeOut: 0.7, rot: this.r(0, 6.28), erode1: 0.6 });
    }
    for (let i = 0; i < 14 * this.q; i++) {
      const v = this.cone(this.rand() < 0.5 ? n : d, 0.8, new THREE.Vector3()).multiplyScalar(this.r(1.5, 4.5));
      ps.spawn({ pos: p.clone(), vel: v, gravity: 9.8, mode: 1, stretch: 0.02, size: this.r(0.006, 0.014), minPx: 0.8, tile: P.GLOW, color: [0.25, 0.015, 0.01], lit: 1, life: this.r(0.4, 0.9), fadeIn: 0, fadeOut: 0.2, anchor: -1, floorY });
    }
    // splatter on the wall behind / floor below
    const col = this.game.collision;
    if (col?.bvh) {
      const h = col.raycast(p.clone().addScaledVector(d, 0.3), d, 3.5, { dynamic: false });
      if (h) {
        const hn = h.normal.clone(); if (hn.dot(d) > 0) hn.negate();
        const t0 = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), hn));
        const pd = d.clone().addScaledVector(hn, -d.dot(hn)).normalize();
        const rot = Math.atan2(t0.clone().cross(pd).dot(hn), t0.dot(pd));
        this.decals.add(h.point, hn, D.BLOOD1, this.r(0.7, 1.1) * (1 - h.distance / 5), { rot, check: false, life: 60 });
      }
      if (floorY > -1e8 && p.y - floorY < 2.2) this.decals.add(new THREE.Vector3(p.x + d.x * 0.4, floorY, p.z + d.z * 0.4), UP, this.rand() < 0.5 ? D.BLOOD0 : D.BLOOD_DROPS, this.r(0.35, 0.6), { check: false, life: 60 });
    }
  }

  // ------------------------------------------------------------------ explosion
  /** Grenade / explosive: fireball, shockwave, sparks, debris with smoke trails, rising plume, scorch decal. */
  explosion(position, { scale = 1 } = {}) {
    const ps = this.particles; const S = scale; const q = this.q;
    const pos = position.clone();
    const floorY = this.floorBelow(pos.clone().addScaledVector(UP, 0.4), 3);
    const ground = floorY > -1e8 ? floorY : pos.y;
    const plane = new THREE.Vector4(0, 1, 0, -ground);
    const c = new THREE.Vector3(pos.x, Math.max(pos.y, ground) + 0.15, pos.z);
    this.sunVis = this.sunVisibility(c.clone().addScaledVector(UP, 2));
    // flash
    ps.spawn({ pos: c.clone().addScaledVector(UP, 0.6), size: 7 * S, tile: P.GLOW, color: [14, 9, 5], life: 0.12, additive: 1, fadeIn: 0, fadeOut: 0.9 });
    ps.spawn({ pos: c.clone().addScaledVector(UP, 0.6), size: 3 * S, tile: P.CORE, color: [20, 14, 8], life: 0.07, additive: 1, fadeIn: 0 });
    // fireball
    for (let i = 0; i < 22 * q; i++) {
      const dir = this.unit(new THREE.Vector3()); dir.y = Math.abs(dir.y) * 1.3 + 0.15; dir.normalize();
      const sp = this.r(3, 11) * S;
      ps.spawn({ pos: c.clone().addScaledVector(dir, this.r(0.1, 0.5) * S), vel: dir.multiplyScalar(sp), drag: 5.5, buoy: 2.5, size: this.r(0.8, 1.4) * S, size1: this.r(2.8, 4.4) * S, sizePow: 3,
        tile: P.FIRE, color: [0.16, 0.14, 0.13], lit: 1, alpha: 1, life: this.r(0.8, 1.4), heat: this.r(0.7, 1.5), heat1: 0, heatPow: 1.4, emissive: 1.15,
        rot: this.r(0, 6.28), rotVel: this.r(-1.5, 1.5), fadeIn: 0, fadeOut: 0.5, erode: 0.0, erode1: 0.6, plane, soft: 0.5 });
    }
    // inner blinding core billows
    for (let i = 0; i < 6 * q; i++) {
      const dir = this.unit(new THREE.Vector3()); dir.y = Math.abs(dir.y) + 0.3; dir.normalize();
      ps.spawn({ pos: c.clone().addScaledVector(dir, 0.3 * S), vel: dir.multiplyScalar(this.r(2, 5) * S), drag: 6, size: 1.2 * S, size1: 3.2 * S, tile: P.FIRE, color: [0.1, 0.1, 0.1], lit: 0.3,
        life: this.r(0.25, 0.4), heat: 1.6, heat1: 0.6, emissive: 1.4, additive: 0.6, rot: this.r(0, 6.28), fadeIn: 0, fadeOut: 0.6, plane, soft: 0.4 });
    }
    // dark sooty smoke wrapped around the fireball (contrast)
    for (let i = 0; i < 12 * q; i++) {
      const dir = this.unit(new THREE.Vector3()); dir.y = Math.abs(dir.y) * 1.2 + 0.25; dir.normalize();
      ps.spawn({ pos: c.clone().addScaledVector(dir, this.r(0.4, 1.0) * S), vel: dir.multiplyScalar(this.r(3, 8) * S), drag: 4.5, buoy: 1.2, size: 1.0 * S, size1: this.r(3, 4.5) * S, sizePow: 2.5,
        tile: [P.SMOKE0, P.SMOKE1][i % 2], color: [0.07, 0.065, 0.06], color1: [0.16, 0.155, 0.15], lit: 1, alpha: 0.9, life: this.r(3, 5), rot: this.r(0, 6.28), rotVel: this.r(-0.4, 0.4),
        fadeIn: 0.02, fadeOut: 0.6, erode: 0, erode1: 0.5, plane, soft: 0.5, turb: 0.4 });
    }
    // upward dirt/debris column (streaked dust jets)
    for (let i = 0; i < 10 * q; i++) {
      const dir = this.cone(UP, 0.5, new THREE.Vector3());
      ps.spawn({ pos: c.clone(), vel: dir.multiplyScalar(this.r(8, 16) * S), drag: 3.5, gravity: 3, mode: 1, stretch: 0.12, anchor: -1, size: 0.3 * S, size1: this.r(1.0, 1.6) * S,
        tile: P.SMOKE2, color: [0.3, 0.26, 0.21], lit: 1, alpha: 0.8, life: this.r(0.8, 1.4), fadeIn: 0, fadeOut: 0.7, erode: 0.05, erode1: 0.6, plane, soft: 0.4 });
    }
    // shockwave ring on ground + air ring
    ps.spawn({ pos: new THREE.Vector3(c.x, ground + 0.08, c.z), mode: 2, axis: UP, size: 1 * S, size1: 18 * S, sizePow: 2.5, tile: P.RING, color: [0.3, 0.27, 0.23], lit: 0.6, alpha: 0.35, life: 0.45, fadeIn: 0, fadeOut: 0.9 });
    ps.spawn({ pos: c.clone().addScaledVector(UP, 0.8), size: 1 * S, size1: 12 * S, sizePow: 1.6, tile: P.RING, color: [1.2, 1.1, 1.0], additive: 1, alpha: 0.35, life: 0.18, fadeIn: 0, fadeOut: 0.9 });
    // ground dust skirt
    for (let i = 0; i < 18 * q; i++) {
      const a = this.r(0, 6.28); const dir = new THREE.Vector3(Math.cos(a), this.r(0.02, 0.2), Math.sin(a));
      ps.spawn({ pos: new THREE.Vector3(c.x, ground + 0.3, c.z).addScaledVector(dir, 0.5 * S), vel: dir.multiplyScalar(this.r(7, 14) * S), drag: 3.2, size: 0.6 * S, size1: this.r(2.5, 4.5) * S, sizePow: 2.5,
        tile: [P.DUST, P.SMOKE0, P.SMOKE1][i % 3], color: [0.5, 0.45, 0.38], lit: 1, alpha: this.r(0.5, 0.75), life: this.r(2.5, 4.5), buoy: 0.35, turb: 0.4,
        rot: this.r(0, 6.28), rotVel: this.r(-0.5, 0.5), fadeIn: 0.02, fadeOut: 0.75, erode: 0, erode1: 0.55, plane, soft: 0.6 });
    }
    // smoke plume (rises, darker core)
    for (let i = 0; i < 30 * q; i++) {
      const dir = this.unit(new THREE.Vector3()); dir.y = Math.abs(dir.y) * 2 + 0.6; dir.normalize();
      const g = this.r(0.1, 0.2);
      ps.spawn({ pos: c.clone().addScaledVector(dir, this.r(0.2, 1.0) * S), vel: dir.multiplyScalar(this.r(1.2, 3.5) * S), drag: 1.6, buoy: 0.55, delay: this.r(0.02, 0.25),
        size: 1.0 * S, size1: this.r(4, 6.5) * S, sizePow: 1.7, tile: [P.SMOKE0, P.SMOKE1, P.SMOKE2][i % 3], color: [g, g * 0.97, g * 0.94], color1: [g * 2.2, g * 2.15, g * 2.1], lit: 1,
        alpha: this.r(0.75, 0.95), life: this.r(5, 9), turb: 0.6, rot: this.r(0, 6.28), rotVel: this.r(-0.25, 0.25), fadeIn: 0.03, fadeOut: 0.6, erode: 0, erode1: 0.5, plane, soft: 0.8 });
    }
    // sparks / burning fragments
    for (let i = 0; i < 45 * q; i++) {
      const dir = this.unit(new THREE.Vector3()); dir.y = Math.abs(dir.y) + 0.2; dir.normalize();
      ps.spawn({ pos: c.clone().addScaledVector(dir, 0.3), vel: dir.multiplyScalar(this.r(8, 26) * S), gravity: 9.8, drag: 0.9, mode: 1, stretch: 0.03, size: this.r(0.01, 0.022) * S, minPx: 1.4,
        tile: P.SPARK, color: [12, 6, 2], color1: [3, 0.6, 0.06], life: this.r(0.5, 1.6), additive: 1, anchor: -1, fadeIn: 0, fadeOut: 0.3, floorY: ground, rest: 0.35 });
    }
    // dirt clumps
    for (let i = 0; i < 20 * q; i++) {
      const dir = this.unit(new THREE.Vector3()); dir.y = Math.abs(dir.y) * 2 + 0.5; dir.normalize();
      ps.spawn({ pos: c.clone(), vel: dir.multiplyScalar(this.r(5, 13) * S), gravity: 9.8, drag: 0.8, size: this.r(0.15, 0.35) * S, size1: this.r(0.3, 0.6) * S, tile: P.CLUMPS, color: [0.14, 0.12, 0.1], lit: 1, alpha: 1,
        life: this.r(0.9, 1.6), fadeIn: 0, fadeOut: 0.3, rot: this.r(0, 6.28), rotVel: this.r(-4, 4), floorY: ground });
    }
    // debris chunks, some trailing smoke
    const trailFn = (p) => ps.spawn({ pos: p.clone(), vel: this.unit(new THREE.Vector3()).multiplyScalar(0.2), size: 0.08 * S, size1: this.r(0.4, 0.8) * S, tile: P.SMOKE2, color: [0.2, 0.19, 0.18], lit: 1, alpha: 0.45, life: this.r(1, 2), buoy: 0.3, rot: this.r(0, 6.28), fadeIn: 0.05, fadeOut: 0.8, erode1: 0.5 });
    for (let i = 0; i < 24 * q; i++) {
      const dir = this.unit(new THREE.Vector3()); dir.y = Math.abs(dir.y) * 1.5 + 0.35; dir.normalize();
      const s = this.r(0.02, 0.07) * S; const k = this.r(0.25, 0.5);
      this.debris.spawn({ kind: 'chunk', pos: c.clone().addScaledVector(dir, 0.2), vel: dir.multiplyScalar(this.r(5, 15) * S), scale: s, radius: s * 0.6, color: [k, k * 0.95, k * 0.88], life: this.r(5, 8), rest: 0.3, spin: 20,
        trail: i < 8 ? { fn: trailFn, interval: 0.035, duration: this.r(0.5, 1.1) } : null });
    }
    // scorch decal
    if (floorY > -1e8) this.decals.add(new THREE.Vector3(c.x, ground, c.z), UP, D.SCORCH, this.r(3.4, 4.2) * S, { check: false, offset: 0.004 });
    // light
    this._worldLight(c.clone().addScaledVector(UP, 1.0), 900 * S, 0.28, 10);
    this.sunVis = 1;
    this.game.events.emit('fx:explosion', { position: c.clone() });
  }

  // ------------------------------------------------------------------ ambient
  _initAmbient() {
    const n = this.game.quality === 'low' ? 80 : 180;
    this.motes = []; this.embers = [];
    for (let i = 0; i < n; i++) {
      const p = this.particles.spawn({ pos: this.unit(new THREE.Vector3()).multiplyScalar(this.r(0.5, 9)), size: this.r(0.004, 0.009), minPx: 1.2, tile: P.GLOW, color: [0, 0, 0], additive: 1, life: 1e9, fadeIn: 0, fadeOut: 0 });
      if (p) { p._ph = this.r(0, 100); this.motes.push(p); }
    }
    for (let i = 0; i < (this.game.quality === 'low' ? 20 : 45); i++) {
      const ember = i % 3 !== 0;
      const p = this.particles.spawn({ pos: new THREE.Vector3(this.r(-25, 25), this.r(0, 12), this.r(-25, 25)), vel: new THREE.Vector3(this.r(-0.3, 0.3), ember ? this.r(0.3, 0.8) : -this.r(0.2, 0.5), this.r(-0.3, 0.3)),
        size: ember ? this.r(0.012, 0.022) : this.r(0.015, 0.03), minPx: ember ? 1.3 : 1, tile: ember ? P.GLOW : P.CLUMPS, color: ember ? [6, 1.6, 0.25] : [0.22, 0.21, 0.2],
        additive: ember ? 1 : 0, lit: ember ? 0 : 1, life: 1e9, fadeIn: 0, fadeOut: 0, flicker: ember ? 0.7 : 0, rotVel: this.r(-3, 3) });
      if (p) { p._ember = ember; p._ph = this.r(0, 100); this.embers.push(p); }
    }
  }

  _updateAmbient(dt) {
    const cam = this.game.camera; const cp = cam.getWorldPosition(_a); const t = this.time;
    const sunDir = this.particles.uniforms.uSunDir.value; const sunC = this.particles.uniforms.uSunColor.value;
    const B = 9; const view = cam.getWorldDirection(_b);
    for (const p of this.motes) {
      // brownian drift, wrap in a box around the camera
      p.pos.x += Math.sin(t * 0.31 + p._ph) * 0.03 * dt; p.pos.y += Math.sin(t * 0.23 + p._ph * 1.3) * 0.02 * dt + 0.004 * dt; p.pos.z += Math.cos(t * 0.27 + p._ph) * 0.03 * dt;
      for (const k of ['x', 'y', 'z']) { const lim = k === 'y' ? 4 : B; const d = p.pos[k] - cp[k]; if (d > lim) p.pos[k] -= lim * 2; else if (d < -lim) p.pos[k] += lim * 2; }
      // visible mostly when looking toward the sun (forward scattering), glint twinkle
      const dx = p.pos.x - cp.x, dy = p.pos.y - cp.y, dz = p.pos.z - cp.z; const l = Math.hypot(dx, dy, dz) + 1e-4;
      const mu = (dx * sunDir.x + dy * sunDir.y + dz * sunDir.z) / l;
      const phase = 0.08 + Math.pow(Math.max(0, mu), 6) * 1.6;
      const tw = 0.6 + 0.4 * Math.sin(t * 2.3 + p._ph * 7);
      const k = phase * tw * 0.06 * Math.min(1, l / 1.2) * (dx * view.x + dy * view.y + dz * view.z > 0 ? 1 : 0);
      p.c0.setRGB(sunC.r * k, sunC.g * k, sunC.b * k); p.c1.copy(p.c0);
    }
    for (const p of this.embers) {
      p.vel.x += Math.sin(t * 0.9 + p._ph) * 0.4 * dt; p.vel.z += Math.cos(t * 0.7 + p._ph) * 0.4 * dt;
      p.vel.x *= 0.995; p.vel.z *= 0.995;
      if (!p._ember) { p.vel.x += Math.sin(t * 2.2 + p._ph) * 0.8 * dt; }
      for (const k of ['x', 'z']) { const d = p.pos[k] - cp[k]; if (d > 25) p.pos[k] -= 50; else if (d < -25) p.pos[k] += 50; }
      if (p.pos.y > cp.y + 14) p.pos.y = cp.y - 2; if (p.pos.y < cp.y - 2 && !p._ember) p.pos.y = cp.y + 12;
    }
  }

  // ------------------------------------------------------------------ frame
  _syncEnvironment() {
    const U = this.particles.uniforms; const env = this.game.environment; const scene = this.game.scene;
    const sun = env?.sun;
    if (env?.sunDirection) U.uSunDir.value.copy(env.sunDirection).normalize();
    else if (sun) U.uSunDir.value.copy(sun.position).sub(sun.target?.position || _c.set(0, 0, 0)).normalize();
    if (env?.sunColor) U.uSunColor.value.copy(env.sunColor);
    else if (sun) U.uSunColor.value.copy(sun.color).multiplyScalar(sun.intensity);
    let amb = new THREE.Color(0, 0, 0), gr = new THREE.Color(0, 0, 0);
    scene.traverse((o) => {
      if (!o.visible) return;
      if (o.isHemisphereLight) { amb.add(o.color.clone().multiplyScalar(o.intensity)); gr.add(o.groundColor.clone().multiplyScalar(o.intensity)); }
      else if (o.isAmbientLight) { amb.add(o.color.clone().multiplyScalar(o.intensity)); gr.add(o.color.clone().multiplyScalar(o.intensity)); }
    });
    if (scene.environment) { const k = scene.environmentIntensity ?? 1; amb.add(new THREE.Color(0.35, 0.4, 0.5).multiplyScalar(k)); gr.add(new THREE.Color(0.2, 0.17, 0.14).multiplyScalar(k)); }
    if (env?.skyAmbient) { amb.copy(env.skyAmbient); gr.copy(env.skyAmbient).multiplyScalar(0.45).multiply(new THREE.Color(1.1, 0.95, 0.8)); }
    if (amb.r + amb.g + amb.b < 0.05) { amb.setRGB(0.4, 0.45, 0.55); gr.setRGB(0.2, 0.17, 0.14); }
    U.uAmbient.value.copy(amb); U.uGround.value.copy(gr);
  }

  update(dt) {
    const sim = !this.frozen;
    if (sim) this.time += dt;
    if ((this._envT -= dt) <= 0) { this._envT = 1; this._syncEnvironment(); }
    if (sim) {
      this.lightAT += dt; this.lightBT += dt;
      this._updateAmbient(dt);
      this.decals.update(dt);
    }
    // lights: fast attack/decay with slight flicker
    const fa = Math.max(0, 1 - this.lightAT / this.lightADur);
    this.lightA.intensity = this.lightAPeak * fa * fa;
    const fb = Math.max(0, 1 - this.lightBT / this.lightBDur);
    this.lightB.intensity = this.lightBPeak * fb * fb * (this.lightBPri >= 10 ? 1 : 1);
    const U = this.particles.uniforms;
    U.uFlashPos.value.copy(this.lightA.position); U.uFlashColor.value.copy(this.lightA.color).multiplyScalar(this.lightA.intensity * 0.35);
    U.uFlash2Pos.value.copy(this.lightB.position); U.uFlash2Color.value.copy(this.lightB.color).multiplyScalar(this.lightB.intensity * 0.35);
    this.debris.update(dt, sim);
    this.particles.update(dt, sim);
  }
}
