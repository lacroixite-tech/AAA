import * as THREE from 'three';
import { Soldier } from './Soldier.js';
import { NavGraph } from './Nav.js';
import { LOADOUTS, getTemplate } from './SoldierModel.js';
import { mulberry32, clamp } from './util.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/**
 * Enemy soldiers + squad director. Owner: ai agent.
 * - spawns waves at level.enemySpawns (keeps the fight going), manages corpses
 * - squad coordination: limited "attack tokens" (fair CoD-style pressure), flanker role, cover booking
 * - listens: 'hit' (damage to soldiers), 'weapon:fire' (hearing + suppression)
 * - emits: 'enemy:fire', 'enemy:hit', 'enemy:killed', 'wave:start'
 * Public: soldiers[], enemies (alias), alive (count), wave, nav
 */
export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.soldiers = []; this.rng = mulberry32(1234);
    this.wave = 0; this.waveRemaining = 0; this.waveDelay = 2.5; this.spawnCd = 0; this.maxAlive = 4;
    this.tokens = new Set(); this.maxTokens = 2; this.accuracyScale = 1; this.damageWindow = [];
    this.idc = 0;
    const shot = game.shotName;
    this.shotMode = !!shot;
    this.aiShot = !!(shot && shot.startsWith('ai_'));
    this.nav = null; this.ready = false; // heavy init (nav probing, textures) deferred to first update
    game.events.on('hit', (h) => {
      const s = h?.object?.userData?.enemy;
      if (s && this.soldiers.includes(s)) s.takeHit(h);
    });
    game.events.on('weapon:fire', (e) => this.onPlayerFire(e));

  }

  init() {
    this.ready = true;
    const game = this.game;
    try { this.nav = new NavGraph(game); } catch (e) { console.warn('[ai] nav failed', e); this.nav = null; }
    if (!this.shotMode) for (const L of LOADOUTS) getTemplate(L); // warm so spawns don't hitch
    if (this.shotMode && !this.aiShot) {
      // other areas' screenshots: static sentries at spawns (deterministic, no AI)
      const sp = this.spawnPoints();
      sp.slice(0, 3).forEach((p, i) => {
        const pp = this.game.player?.position;
        const yaw = pp ? Math.atan2(pp.x - p.x, pp.z - p.z) : 0;
        this.spawn(p, { ai: false, yaw, loadout: i });
      });
    }
  }

  get enemies() { return this.soldiers; }
  get alive() { let n = 0; for (const s of this.soldiers) if (s.alive) n++; return n; }
  get list() { return this.soldiers; }

  spawnPoints() {
    const L = this.game.level || {};
    const raw = Array.isArray(L.enemySpawns) && L.enemySpawns.length ? L.enemySpawns : null;
    const pts = raw ? raw.map((p) => (p.isVector3 ? p.clone() : V(p.x ?? p[0] ?? 0, p.y ?? p[1] ?? 0, p.z ?? p[2] ?? 0))) : [];
    if (!pts.length) {
      const ps = L.playerSpawn?.position || V();
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; pts.push(V(ps.x + Math.sin(a) * 30, ps.y, ps.z + Math.cos(a) * 30)); }
    }
    return pts;
  }

  spawn(pos, { ai = true, yaw = 0, loadout } = {}) {
    const id = this.idc++;
    const s = new Soldier(this.game, this, { loadout: loadout ?? Math.floor(this.rng() * LOADOUTS.length), seed: id + 1, position: pos.clone(), yaw, ai });
    s.id = id;
    s.role = id % 4 === 3 ? 'flanker' : 'rifleman';
    this.soldiers.push(s);
    return s;
  }

  // ------------------------------------------------------------ squad director
  requestToken(s) {
    if (this.tokens.has(s)) return true;
    for (const t of this.tokens) if (!t.alive || t.state !== 'combat') this.tokens.delete(t);
    if (this.tokens.size < this.maxTokens) { this.tokens.add(s); s.hasToken = true; return true; }
    return false;
  }
  releaseToken(s) { this.tokens.delete(s); s.hasToken = false; }
  /** global cap on damage rate so being engaged by many enemies stays fair */
  allowDamage() {
    const t = this.game.time; this.damageWindow = this.damageWindow.filter((x) => t - x < 1.0);
    if (this.damageWindow.length >= 3) return false;
    this.damageWindow.push(t); return true;
  }
  onEngage(s) {
    // alert nearby squadmates
    for (const o of this.soldiers) if (o !== s && o.alive && o.aiEnabled && o.state !== 'combat' && o.position.distanceTo(s.position) < 30) {
      o.lastSeen = s.lastSeen?.clone() || null; o.lastSeenT = this.game.time - 2; o.awareness = 1; o.enterCombat();
    }
  }

  pickCover(s) {
    const nav = this.nav; if (!nav || !nav.cover.length) return null;
    const threat = s.lastSeen || this.game.player?.position; if (!threat) return null;
    let best = null, bs = -Infinity;
    const cur = s.position; const lineDir = V().subVectors(cur, threat).setY(0).normalize();
    for (const c of nav.cover) {
      if (c.owner && c.owner !== s && c.owner.alive) continue;
      if (c === s.cover) continue;
      const dSelf = c.p.distanceTo(cur); if (dSelf > 28) continue;
      const toT = V().subVectors(threat, c.p).setY(0); const dT = toT.length(); toT.divideScalar(dT || 1);
      if (dT < 7) continue;
      const prot = -toT.dot(c.n); if (prot < 0.25) continue;
      let sc = prot * 3 - dSelf * 0.12 - Math.abs(dT - 17) * 0.08 + (c.low ? 0.4 : 0);
      // flankers want angle off the current engagement line; others prefer to close distance slightly
      const fromT = V().subVectors(c.p, threat).setY(0).normalize();
      const off = 1 - fromT.dot(lineDir);
      if (s.role === 'flanker' || s.flankBias) sc += off * 4; else sc += (s.position.distanceTo(threat) - dT) * 0.05;
      // don't cluster
      for (const o of this.soldiers) if (o !== s && o.alive && o.cover && o.cover.p.distanceTo(c.p) < 2.5) sc -= 2;
      sc += this.rng() * 0.6;
      if (sc > bs) { bs = sc; best = c; }
    }
    s.flankBias = 0;
    return best;
  }

  onPlayerFire(e) {
    if (!e?.origin) return;
    const o = e.origin, d = e.dir;
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      s.hear(o, 1);
      // suppression: bullet passing close
      if (d) {
        const to = V().subVectors(s.eye, o); const t = to.dot(d);
        if (t > 0) { const miss = to.addScaledVector(d, -t).length(); if (miss < 2.0) s.suppressed = Math.min(3, s.suppressed + (2.0 - miss) * 0.5); }
      }
    }
  }

  // ------------------------------------------------------------ waves
  update(dt) {
    const g = this.game;
    if (!this.ready) this.init();
    if (!this.shotMode) this.updateWaves(dt);
    this.maxTokens = 2 + Math.min(2, Math.floor(this.wave / 3));
    for (const s of this.soldiers) s.update(dt);
    // corpse cleanup
    const dead = this.soldiers.filter((s) => !s.alive);
    if (dead.length > 8 || dead.some((s) => s.deadT > 40)) {
      const old = dead.sort((a, b) => b.deadT - a.deadT)[0];
      if (old && (dead.length > 8 || old.deadT > 40)) { old.dispose(); this.soldiers.splice(this.soldiers.indexOf(old), 1); }
    }
    void g;
  }

  updateWaves(dt) {
    const alive = this.alive;
    if (this.waveRemaining <= 0 && alive === 0) {
      this.waveDelay -= dt;
      if (this.waveDelay <= 0) {
        this.wave++; this.waveRemaining = 4 + this.wave * 2; this.maxAlive = Math.min(3 + this.wave, 8);
        this.waveDelay = 6; this.spawnCd = 0;
        this.accuracyScale = clamp(0.85 + this.wave * 0.05, 0.85, 1.25);
        this.game.events.emit('wave:start', { wave: this.wave, count: this.waveRemaining });
      }
      return;
    }
    this.spawnCd -= dt;
    if (this.waveRemaining > 0 && alive < this.maxAlive && this.spawnCd <= 0) {
      const p = this.chooseSpawn();
      if (p) {
        const s = this.spawn(p, { ai: true, yaw: this.yawToPlayer(p) });
        this.waveRemaining--;
        // later waves arrive already hunting the player
        if (this.wave > 1 || this.rng() < 0.3) { s.lastSeen = this.game.player?.position?.clone() || null; s.lastSeenT = this.game.time - 3; s.awareness = 1; s.enterCombat(); }
      }
      this.spawnCd = 1.2 + this.rng() * 2.0;
    }
  }

  yawToPlayer(p) { const pp = this.game.player?.position; return pp ? Math.atan2(pp.x - p.x, pp.z - p.z) : 0; }

  chooseSpawn() {
    const pts = this.spawnPoints(); const pp = this.game.player?.position;
    if (!pp) return pts[Math.floor(this.rng() * pts.length)];
    const eye = V(pp.x, pp.y + 1.6, pp.z);
    const scored = pts.map((p) => {
      const d = p.distanceTo(pp);
      const vis = this.nav ? this.nav.los(eye, V(p.x, p.y + 1.5, p.z)) : false;
      const crowd = this.soldiers.filter((s) => s.alive && s.position.distanceTo(p) < 2).length;
      return { p, s: (d > 16 ? 2 : -5) + (vis ? -3 : 0) - crowd * 2 + this.rng() * 1.5 - Math.abs(d - 35) * 0.03 };
    }).sort((a, b) => b.s - a.s);
    const p = scored[0].p.clone();
    p.x += (this.rng() - 0.5) * 1.5; p.z += (this.rng() - 0.5) * 1.5;
    return p;
  }
}
