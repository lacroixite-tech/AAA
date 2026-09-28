import * as THREE from 'three';
import { bakeAll, RECIPES } from './SoundBank.js';
import { makeIR } from './dsp.js';

/**
 * Procedural WebAudio sound engine. Owner: audio agent.
 *
 *   game.audio.play(name, { position, volume, rate, delay, send, lowpass, bus, loop, spatial }) -> voice | null
 *
 * All sounds are synthesized and pre-rendered at load (OfflineAudioContext, see SoundBank.js), several seeded
 * variants each (round-robin + per-play pitch/filter jitter). Mix graph:
 *
 *   sources -> [lowpass] -> gain -> [HRTF panner] -> bus(sfx|amb|foley|ui)
 *                                  \-> reverb send -> Convolver(outdoor|indoor IR) -> wet
 *   sfx/amb/foley/wet -> duck -> hurt low-pass -> master -> compressor -> limiter -> destination
 *   ui (hitmarkers, heartbeat, tinnitus) -> master (not muffled)
 */
const SOUND_SPEED = 343;
const BULLET_SPEED = 820;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _fwd = new THREE.Vector3(), _up = new THREE.Vector3();

const SURFACE_MAP = {
  concrete: 'concrete', concrete_dark: 'concrete', plaster: 'concrete', brick: 'concrete', asphalt: 'concrete', tiles: 'concrete',
  roof_tiles: 'concrete', stone: 'concrete', rubble: 'concrete',
  metal: 'metal', metal_painted: 'metal', metal_rusty: 'metal', metal_bare: 'metal', car_paint: 'metal', car: 'metal',
  wood: 'wood', wood_planks: 'wood',
  dirt: 'dirt', grass: 'dirt', gravel: 'dirt', sandbag: 'dirt', mud: 'dirt', tarp: 'dirt', cloth_camo: 'dirt', rubber: 'dirt', plastic: 'wood',
  glass: 'glass', flesh: 'flesh', body: 'flesh',
};
const STEP_MAP = {
  concrete: 'concrete', concrete_dark: 'concrete', plaster: 'concrete', brick: 'concrete', asphalt: 'concrete', tiles: 'concrete', stone: 'concrete',
  metal: 'metal', metal_painted: 'metal', metal_rusty: 'metal', metal_bare: 'metal', car_paint: 'metal',
  wood: 'wood', wood_planks: 'wood',
  dirt: 'dirt', grass: 'dirt', sandbag: 'dirt', mud: 'dirt', tarp: 'dirt',
  gravel: 'gravel', rubble: 'gravel', glass: 'glass',
};

/** Per-sound mixing defaults. */
const DEF = {
  rifle: { vol: 0.95, pv: 0.035, bus: 'sfx', send: 0.14 }, pistol: { vol: 0.85, pv: 0.04, bus: 'sfx', send: 0.12 },
  shotgun: { vol: 1, pv: 0.03, bus: 'sfx', send: 0.18 }, sniper: { vol: 1, pv: 0.02, bus: 'sfx', send: 0.2 },
  tail_rifle: { vol: 0.34, pv: 0.03, bus: 'sfx' }, tail_pistol: { vol: 0.3, pv: 0.03, bus: 'sfx' }, tail_indoor: { vol: 0.4, pv: 0.03, bus: 'sfx' },
  enemy_rifle: { vol: 0.9, pv: 0.05, ref: 6, send: 0.25 }, distant_rifle: { vol: 0.8, pv: 0.06, ref: 30, send: 0.3 },
  whiz: { vol: 0.6, pv: 0.1, ref: 1.5 }, snap: { vol: 0.55, pv: 0.06, ref: 1.5 },
  impact_concrete: { vol: 0.7, pv: 0.08, ref: 2.5, send: 0.1 }, impact_metal: { vol: 0.55, pv: 0.08, ref: 2.5, send: 0.1 },
  impact_wood: { vol: 0.6, pv: 0.08, ref: 2.5, send: 0.08 }, impact_dirt: { vol: 0.65, pv: 0.08, ref: 2.5, send: 0.06 },
  impact_flesh: { vol: 0.8, pv: 0.08, ref: 3, send: 0.05 }, impact_glass: { vol: 0.6, pv: 0.06, ref: 3, send: 0.08 },
  hitmarker: { vol: 0.42, pv: 0.02, bus: 'ui' }, hitmarker_head: { vol: 0.45, pv: 0.02, bus: 'ui' },
  kill: { vol: 0.55, pv: 0.01, bus: 'ui' }, kill_head: { vol: 0.55, pv: 0.01, bus: 'ui' },
  shell: { vol: 0.16, pv: 0.08, ref: 1.2 }, dryfire: { vol: 0.45, pv: 0.03, bus: 'foley' },
  mag_out: { vol: 0.5, pv: 0.03, bus: 'foley' }, mag_in: { vol: 0.55, pv: 0.03, bus: 'foley' }, bolt: { vol: 0.55, pv: 0.03, bus: 'foley' },
  slide: { vol: 0.55, pv: 0.03, bus: 'foley' }, pump: { vol: 0.6, pv: 0.03, bus: 'foley' }, cloth: { vol: 0.2, pv: 0.08, bus: 'foley' },
  gear: { vol: 0.16, pv: 0.1, bus: 'foley' }, jump: { vol: 0.3, pv: 0.06, bus: 'foley' }, land: { vol: 0.5, pv: 0.06, bus: 'foley' },
  hurt: { vol: 0.8, pv: 0.06, bus: 'foley' }, heartbeat: { vol: 0.55, pv: 0, bus: 'ui' }, tinnitus: { vol: 0.35, pv: 0, bus: 'ui' },
  explosion: { vol: 1, pv: 0.06, ref: 8, send: 0.3 }, explosion_far: { vol: 0.9, pv: 0.08, ref: 40, send: 0.35 },
  amb_wind: { vol: 0.2, pv: 0, bus: 'amb' }, amb_hum: { vol: 0.18, pv: 0, bus: 'amb' },
  bird: { vol: 0.2, pv: 0.08, ref: 10, bus: 'amb' }, crow: { vol: 0.3, pv: 0.06, ref: 15, bus: 'amb' },
};
for (const k of Object.keys(RECIPES)) if (k.startsWith('step_')) DEF[k] = { vol: 0.32, pv: 0.07, bus: 'foley' };

export class AudioSystem {
  constructor(game) {
    this.game = game;
    this.buffers = new Map();
    this.last = new Map(); // round-robin memory
    this.voices = 0; this.maxVoices = 72;
    this.enabled = true;
    this.indoor = 0; this._indoorT = 0;
    this.muffle = 0; // transient damage muffle 0..1
    this.duck = 0;   // explosion ducking 0..1
    this._hb = 0; this._ambT = 4; this._lastHitmarker = -1; this._shellEvents = false;
    this._reloadVoices = []; this._tails = [];
    this._lastSurface = 'concrete';
    this.names = Object.keys(RECIPES);
    // Bake at 48 kHz without an AudioContext (buffers are context-independent and resampled on playback),
    // so no context exists — and no autoplay warning fires — until the first user gesture.
    this.sampleRate = 48000;
    if (!(window.AudioContext || window.webkitAudioContext) || !window.OfflineAudioContext) { this.enabled = false; return; }
    this._bindUnlock();
    this._bindEvents();
    this.ready = bakeAll(this.sampleRate, {
      names: this._bakeOrder(),
      onEach: (n, b) => this.buffers.set(n, b),
    }).then(() => { this.loaded = true; }).catch((e) => console.warn('[audio] bake failed', e));
  }

  /** Create the realtime context + mix graph. Called on the first user gesture (or manually for tests). */
  init() {
    if (this.ctx || !this.enabled) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch { this.enabled = false; return null; }
    this._buildGraph();
    this.ctx.addEventListener?.('statechange', () => { if (this.ctx.state === 'running') this._startAmbience(); });
    return this.ctx;
  }

  _bakeOrder() {
    const first = ['rifle', 'pistol', 'tail_rifle', 'tail_pistol', 'hitmarker', 'kill', 'impact_concrete', 'impact_flesh', 'dryfire', 'step_concrete'];
    return [...first, ...this.names.filter((n) => !first.includes(n))];
  }

  /* ------------------------------------------------------------------ graph */
  _buildGraph() {
    const c = this.ctx;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 8; comp.ratio.value = 3; comp.attack.value = 0.006; comp.release.value = 0.12;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -1; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
    this.master = c.createGain(); this.master.gain.value = 0.85 * (this.volume ?? 1);
    this.master.connect(comp); comp.connect(lim); lim.connect(c.destination);
    this.compressor = comp; this.limiter = lim;

    this.hurtLP = c.createBiquadFilter(); this.hurtLP.type = 'lowpass'; this.hurtLP.frequency.value = 20000; this.hurtLP.Q.value = 0.5;
    this.duckGain = c.createGain();
    this.duckGain.connect(this.hurtLP); this.hurtLP.connect(this.master);

    this.bus = {};
    for (const [name, v] of [['sfx', 1], ['foley', 1], ['amb', 1]]) { const g = c.createGain(); g.gain.value = v; g.connect(this.duckGain); this.bus[name] = g; }
    this.bus.ui = c.createGain(); this.bus.ui.connect(this.master);

    // reverbs: two convolvers crossfaded by indoor amount
    this.revSend = c.createGain();
    this.convOut = c.createConvolver(); this.convOut.normalize = false; this.convOut.buffer = makeIR(c, 'outdoor', 11);
    this.convIn = c.createConvolver(); this.convIn.normalize = false; this.convIn.buffer = makeIR(c, 'indoor', 23);
    this.revOutGain = c.createGain(); this.revInGain = c.createGain(); this.revInGain.gain.value = 0;
    this.revSend.connect(this.revOutGain); this.revSend.connect(this.revInGain);
    this.revOutGain.connect(this.convOut); this.revInGain.connect(this.convIn);
    this.wet = c.createGain(); this.wet.gain.value = 0.9;
    this.convOut.connect(this.wet); this.convIn.connect(this.wet); this.wet.connect(this.duckGain);

    const L = c.listener;
    if (L.upX) { L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
  }

  _bindUnlock() {
    const evs = ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'click'];
    const unlock = () => {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      if (this.ctx.state === 'running') for (const ev of evs) removeEventListener(ev, unlock, true);
    };
    for (const ev of evs) addEventListener(ev, unlock, true);
  }

  /** Master volume 0..1 (persists until reload). */
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = 0.85 * v; }

  get running() { return this.enabled && !!this.ctx && this.ctx.state === 'running'; }

  /* ------------------------------------------------------------------ play */
  /**
   * @param {string} name   recipe name (see RECIPES / this.names)
   * @param {object} o      position (Vector3), volume, rate, delay (s), send (reverb), lowpass (Hz), bus, loop, variant, priority
   */
  play(name, o = {}) {
    if (!this.running) return null;
    const list = this.buffers.get(name); if (!list?.length) return null;
    const d = DEF[name] || {};
    if (this.voices >= this.maxVoices && !o.priority) return null;
    const c = this.ctx; const now = c.currentTime; const when = now + (o.delay || 0);

    let vi = o.variant;
    if (vi == null) { vi = Math.floor(Math.random() * list.length); if (list.length > 1 && vi === this.last.get(name)) vi = (vi + 1) % list.length; }
    this.last.set(name, vi);

    const src = c.createBufferSource(); src.buffer = list[vi % list.length]; src.loop = !!o.loop;
    const pv = o.pitchVar ?? d.pv ?? 0.04;
    src.playbackRate.value = (o.rate || 1) * (1 + (Math.random() * 2 - 1) * pv);
    let node = src;
    if (o.lowpass && o.lowpass < 19000) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lowpass; f.Q.value = 0.6; node.connect(f); node = f; }
    if (o.highpass) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = o.highpass; node.connect(f); node = f; }
    const g = c.createGain(); g.gain.value = (o.volume ?? 1) * (d.vol ?? 0.7) * (o.loop ? 1 : 0.92 + Math.random() * 0.08);
    node.connect(g);
    const bus = this.bus[o.bus || d.bus || 'sfx'];
    let panner = null;
    if (o.position && o.spatial !== false) {
      panner = c.createPanner();
      const dist = this._listenerPos().distanceTo(o.position);
      panner.panningModel = dist < 60 || o.hrtf ? 'HRTF' : 'equalpower';
      panner.distanceModel = 'inverse'; panner.refDistance = o.ref ?? d.ref ?? 3; panner.rolloffFactor = o.rolloff ?? 1; panner.maxDistance = 10000;
      if (panner.positionX) { panner.positionX.value = o.position.x; panner.positionY.value = o.position.y; panner.positionZ.value = o.position.z; }
      else panner.setPosition(o.position.x, o.position.y, o.position.z);
      g.connect(panner); panner.connect(bus);
    } else g.connect(bus);
    const send = o.send ?? d.send ?? 0;
    let sg = null;
    if (send > 0) { sg = c.createGain(); sg.gain.value = send; g.connect(sg); sg.connect(this.revSend); }
    src.start(when, o.offset || 0);
    this.voices++;
    const voice = { src, gain: g, panner, name, when, stop: (fade = 0.05) => { try { const t = c.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + fade); src.stop(t + fade + 0.01); } catch { /* already stopped */ } } };
    src.onended = () => { this.voices--; try { src.disconnect(); g.disconnect(); panner?.disconnect(); sg?.disconnect(); } catch { /* */ } };
    return voice;
  }

  _listenerPos() { return this.game.camera.getWorldPosition(_v2); }

  /* ------------------------------------------------------------------ events */
  _bindEvents() {
    const ev = this.game.events;
    ev.on('weapon:fire', (e) => this.onPlayerFire(e));
    ev.on('enemy:fire', (e) => this.onEnemyFire(e));
    ev.on('hit', (e) => this.onHit(e));
    ev.on('enemy:hit', (e) => this.hitmarker(e?.part === 'head' || e?.headshot));
    ev.on('enemy:killed', (e) => this.play(e?.headshot ? 'kill_head' : 'kill', { delay: 0.03, priority: true }));
    ev.on('weapon:reload', (e) => this.onReload(e));
    ev.on('weapon:empty', () => this.play('dryfire', { priority: true }));
    ev.on('player:footstep', (e) => this.onFootstep(e));
    ev.on('player:jump', () => this.play('jump'));
    ev.on('player:land', (e) => this.onLand(e));
    ev.on('player:damaged', (e) => this.onDamaged(e));
    ev.on('fx:shell_land', (e) => { this._shellEvents = true; const p = e?.position || e?.point || e; if (p?.isVector3) this.play('shell', { position: p, volume: e?.volume ?? 1, rate: e?.pistol ? 1.15 : 1 }); });
    for (const n of ['fx:explosion', 'explosion']) ev.on(n, (e) => this.explosion(e?.position || e?.point || e, e?.radius));
  }

  weaponClass(w) {
    w = w ?? this.game.weapons?.current;
    const cls = typeof w === 'object' && w ? (w.class || w.type || w.category || '') : '';
    const name = String(cls + ' ' + (typeof w === 'string' ? w : w?.name || w?.id || '')).toLowerCase();
    if (/pistol|handgun|sidearm|1911|usp|glock|p226|m9\b|x16|deagle|revolver|\.357|makarov|sym9/.test(name)) return 'pistol';
    if (/shotgun|725|870|r9-0|origin|spas|pump/.test(name)) return 'shotgun';
    if (/sniper|dmr|hdr|ax-50|ax50|kar98|svd|dragunov|m82|barrett|awp|marksman|spr/.test(name)) return 'sniper';
    return 'rifle';
  }

  onPlayerFire(e) {
    if (!this.running) return;
    const w = e?.weapon ?? this.game.weapons?.current;
    if (w?.suppressed) { this.play('pistol', { volume: 0.35, lowpass: 2200, rate: 1.3 }); return; }
    const cls = this.weaponClass(w);
    this.play(cls, { priority: true, send: (DEF[cls].send) * (1 + this.indoor * 1.5) });
    // tail layer: outdoor slapback or indoor boom; cap concurrent tails for auto fire
    const tailName = this.indoor > 0.5 ? 'tail_indoor' : cls === 'pistol' ? 'tail_pistol' : 'tail_rifle';
    const now = this.ctx.currentTime;
    this._tails = this._tails.filter((t) => now - t.when < 2.5);
    if (this._tails.length >= 3) this._tails.shift().stop(0.12);
    const tv = cls === 'shotgun' || cls === 'sniper' ? 1.4 : 1;
    const t = this.play(tailName, { volume: tv, priority: true }); if (t) this._tails.push(t);
    if (cls === 'shotgun') this.play('pump', { delay: 0.35 });
    // shell casing fallback when FX doesn't emit fx:shell_land
    if (!this._shellEvents && cls !== 'shotgun') {
      const p = this._listenerPos().clone(); const pl = this.game.player;
      const yaw = pl?.yaw ?? 0; p.x += Math.cos(yaw) * 0.6; p.z -= Math.sin(yaw) * 0.6; p.y = (pl?.position?.y ?? p.y - 1.6) + 0.02;
      this.play('shell', { position: p, delay: 0.35 + Math.random() * 0.25, rate: cls === 'pistol' ? 1.15 : 1, volume: 0.9 });
    }
  }

  onEnemyFire(e) {
    if (!this.running || !e?.origin) return;
    const L = this._listenerPos(); const o = e.origin; const dist = L.distanceTo(o);
    const name = dist < 45 ? 'enemy_rifle' : 'distant_rifle';
    const lp = Math.max(1400, 20000 * Math.exp(-dist / 120));
    this.play(name, { position: o, delay: dist / SOUND_SPEED, lowpass: lp, send: (DEF[name].send) * (1 + Math.min(1, dist / 80)), volume: dist > 200 ? 0.7 : 1 });
    // bullet flyby: closest approach of the shot ray to the listener
    if (e.dir) {
      const d = _fwd.copy(e.dir).normalize(); const t = _v.copy(L).sub(o).dot(d);
      if (t > 2) {
        const P = _v.copy(o).addScaledVector(d, t); const miss = P.distanceTo(L);
        if (miss < 4.5) {
          const delay = t / BULLET_SPEED;
          const pos = P.clone().addScaledVector(d, 1.5);
          this.play('whiz', { position: pos, delay: Math.max(0, delay - 0.05), volume: Math.min(1.2, 1.6 / (miss + 0.6)), hrtf: true });
          if (miss < 1.6) this.play('snap', { delay, volume: 1 - miss / 2, priority: true });
        }
      }
    }
  }

  onHit(h) {
    if (!this.running || !h?.point) return;
    let obj = h.object, flesh = h.surface === 'flesh' || !!h.part;
    while (!flesh && obj) { if (obj.userData?.hittable || obj.userData?.enemy) flesh = true; obj = obj.parent; }
    const surf = flesh ? 'flesh' : (SURFACE_MAP[h.surface] || 'concrete');
    const dist = this._listenerPos().distanceTo(h.point);
    this.play('impact_' + surf, { position: h.point, delay: dist > 30 ? dist / SOUND_SPEED : 0, volume: flesh ? 1 : 0.9 });
    if (surf === 'metal' && Math.random() < 0.35 && dist > 3) this.play('whiz', { position: h.point, volume: 0.25, rate: 1.4 }); // ricochet
    if (flesh && h.fromPlayer !== false) this.hitmarker(h.part === 'head');
  }

  hitmarker(head) {
    if (!this.running) return;
    const t = this.ctx.currentTime; if (t - this._lastHitmarker < 0.035) return;
    this._lastHitmarker = t;
    this.play(head ? 'hitmarker_head' : 'hitmarker', { priority: true });
  }

  onReload(e) {
    if (!this.running) return;
    for (const v of this._reloadVoices) if (v.when > this.ctx.currentTime) v.stop(0.01);
    this._reloadVoices = [];
    const w = e?.weapon ?? this.game.weapons?.current; const cls = this.weaponClass(w);
    const T = e?.duration ?? e?.time ?? w?.reloadTime ?? this.game.weapons?.reloadTime ?? (cls === 'pistol' ? 1.6 : 2.3);
    const empty = e?.empty ?? ((w?.ammo ?? 1) === 0);
    const seq = cls === 'shotgun'
      ? [['cloth', 0.02], ['mag_in', 0.35], ['mag_in', 0.7], ['pump', 0.85]]
      : [['cloth', 0.02], ['mag_out', 0.22], ['cloth', 0.4], ['mag_in', empty ? 0.6 : 0.72], ...(empty ? [[cls === 'pistol' ? 'slide' : 'bolt', 0.84]] : [])];
    for (const [n, f] of seq) { const v = this.play(n, { delay: f * T, priority: true, rate: cls === 'pistol' ? 1.1 : 1 }); if (v) this._reloadVoices.push(v); }
  }

  onFootstep(e) {
    if (!this.running) return;
    const s = STEP_MAP[e?.surface] || 'concrete'; this._lastSurface = s;
    const p = this.game.player; const k = e?.intensity ?? (p?.sprinting ? 1 : p?.crouching ? 0.45 : 0.75);
    this.play('step_' + s, { volume: 0.5 + k * 0.6, lowpass: p?.crouching ? 3500 : undefined });
    if (p?.sprinting || k > 0.95) this.play('gear', { delay: 0.03 + Math.random() * 0.04, volume: 0.9 });
    else if (Math.random() < 0.25) this.play('gear', { volume: 0.4 });
  }

  onLand(e) {
    if (!this.running) return;
    const sp = Math.abs(e?.speed ?? 5); const k = Math.min(1.4, sp / 8);
    this.play('land', { volume: 0.4 + k * 0.7 });
    this.play('step_' + this._lastSurface, { volume: 0.6 + k * 0.5, delay: 0.01 });
  }

  onDamaged(e) {
    if (!this.running) return;
    const a = Math.min(1, (e?.amount ?? 20) / 40);
    this.play('hurt', { volume: 0.6 + a * 0.5, priority: true });
    if (e?.fromPos) this.play('impact_flesh', { position: _v.copy(this._listenerPos()).lerp(e.fromPos, 0.02), volume: 0.5 });
    this.muffle = Math.min(1, this.muffle + 0.35 + a * 0.5);
  }

  explosion(pos, radius = 6) {
    if (!this.running || !pos?.isVector3) return;
    const dist = this._listenerPos().distanceTo(pos);
    const far = dist > 70;
    this.play(far ? 'explosion_far' : 'explosion', { position: pos, delay: dist / SOUND_SPEED, lowpass: far ? 3000 : Math.max(2500, 20000 * Math.exp(-dist / 60)), priority: true, send: 0.3 * (1 + this.indoor) });
    const near = Math.max(0, 1 - dist / (radius * 2.2));
    if (near > 0.15) {
      this.play('tinnitus', { delay: dist / SOUND_SPEED + 0.05, volume: near, priority: true });
      this.duck = Math.max(this.duck, near * 0.85); this.muffle = Math.max(this.muffle, near);
    }
  }

  /* ------------------------------------------------------------------ ambience */
  _startAmbience() {
    if (this._ambStarted || !this.buffers.get('amb_wind')) return;
    this._ambStarted = true;
    this.ambWind = this.play('amb_wind', { loop: true, volume: 1, bus: 'amb', pitchVar: 0 });
    // spatialized gusts around the plaza + distant city hum
    this.play('amb_wind', { loop: true, volume: 0.6, position: new THREE.Vector3(-70, 12, -40), ref: 40, offset: 5, pitchVar: 0.05 });
    this.play('amb_wind', { loop: true, volume: 0.6, position: new THREE.Vector3(80, 15, 50), ref: 40, offset: 9, pitchVar: 0.05 });
    this.play('amb_hum', { loop: true, volume: 1, position: new THREE.Vector3(-260, 30, -320), ref: 300, rolloff: 0.5, pitchVar: 0 });
    this.play('amb_hum', { loop: true, volume: 0.6, bus: 'amb', pitchVar: 0, offset: 4 });
  }

  _ambientEvent() {
    const L = this._listenerPos(); const r = Math.random();
    const dirPos = (dmin, dmax, h) => { const a = Math.random() * Math.PI * 2, d = dmin + Math.random() * (dmax - dmin); return new THREE.Vector3(L.x + Math.cos(a) * d, h, L.z + Math.sin(a) * d); };
    if (r < 0.4) { // distant firefight burst
      const p = dirPos(140, 420, 2); const n = 2 + Math.floor(Math.random() * 7); const rpm = 0.08 + Math.random() * 0.05;
      const dist = p.distanceTo(L); const lp = Math.max(900, 6000 * Math.exp(-dist / 250));
      for (let i = 0; i < n; i++) this.play('distant_rifle', { position: p, delay: i * rpm * (0.9 + Math.random() * 0.2), volume: 0.55, lowpass: lp, send: 0.4, bus: 'amb' });
      if (Math.random() < 0.4) { const p2 = dirPos(150, 400, 2); for (let i = 0; i < 3; i++) this.play('distant_rifle', { position: p2, delay: 0.6 + i * 0.25, volume: 0.4, lowpass: lp * 0.8, send: 0.4, bus: 'amb' }); }
    } else if (r < 0.52) { // distant explosion / artillery
      this.play('explosion_far', { position: dirPos(250, 600, 5), volume: 0.6 + Math.random() * 0.3, lowpass: 1500, send: 0.35, bus: 'amb' });
    } else if (r < 0.78) {
      this.play('bird', { position: dirPos(15, 45, 6 + Math.random() * 8), volume: 0.7 + Math.random() * 0.4, bus: 'amb' });
    } else {
      this.play('crow', { position: dirPos(30, 90, 12 + Math.random() * 15), volume: 0.8, send: 0.15, bus: 'amb' });
    }
  }

  /* ------------------------------------------------------------------ update */
  update(dt) {
    if (!this.enabled || !this.ctx) return;
    const c = this.ctx; const cam = this.game.camera;
    // listener follows the camera
    cam.updateMatrixWorld();
    const p = cam.getWorldPosition(_v); cam.getWorldDirection(_fwd); _up.set(0, 1, 0).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    const L = c.listener; const t = c.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.01); L.positionY.setTargetAtTime(p.y, t, 0.01); L.positionZ.setTargetAtTime(p.z, t, 0.01);
      L.forwardX.setTargetAtTime(_fwd.x, t, 0.01); L.forwardY.setTargetAtTime(_fwd.y, t, 0.01); L.forwardZ.setTargetAtTime(_fwd.z, t, 0.01);
      L.upX.setTargetAtTime(_up.x, t, 0.01); L.upY.setTargetAtTime(_up.y, t, 0.01); L.upZ.setTargetAtTime(_up.z, t, 0.01);
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(_fwd.x, _fwd.y, _fwd.z, _up.x, _up.y, _up.z); }

    if (!this.running) return;
    if (!this._ambStarted) this._startAmbience();

    // indoor / outdoor probe (ceiling + walls around the listener)
    this._indoorT -= dt;
    if (this._indoorT <= 0 && this.game.collision?.raycast) {
      this._indoorT = 0.3;
      try {
        let enclosed = 0; const o = p.clone();
        const up = this.game.collision.raycast(o, _v2.set(0, 1, 0), 25); if (up && up.distance < 12) enclosed += 0.55;
        let walls = 0; for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; const h = this.game.collision.raycast(o, _v2.set(Math.cos(a), 0.1, Math.sin(a)).normalize(), 14); if (h && h.distance < 10) walls++; }
        enclosed += walls / 6 * 0.45;
        this._indoorTarget = enclosed > 0.75 ? 1 : enclosed > 0.5 ? 0.5 : 0;
      } catch { this._indoorTarget = 0; }
    }
    this.indoor += ((this._indoorTarget || 0) - this.indoor) * Math.min(1, dt * 2);
    this.revOutGain.gain.setTargetAtTime(1 - this.indoor, t, 0.1);
    this.revInGain.gain.setTargetAtTime(this.indoor * 1.2, t, 0.1);
    if (this.ambWind) this.ambWind.gain.gain.setTargetAtTime((DEF.amb_wind.vol) * (1 - this.indoor * 0.7), t, 0.3);

    // player health: low-pass muffling + heartbeat
    const hp = this.game.player?.health ?? 100;
    const low = Math.max(0, Math.min(1, (45 - hp) / 35));
    this.muffle = Math.max(0, this.muffle - dt * 0.9);
    const m = Math.max(low * 0.75, this.muffle);
    const cutoff = 20000 * Math.pow(600 / 20000, m);
    this.hurtLP.frequency.setTargetAtTime(cutoff, t, 0.04);
    this.duck = Math.max(0, this.duck - dt * 0.3);
    this.duckGain.gain.setTargetAtTime(1 - this.duck, t, 0.05);
    if (hp > 0 && hp < 45) {
      this._hb -= dt;
      if (this._hb <= 0) { const bpm = 70 + low * 60; this._hb = 60 / bpm; this.play('heartbeat', { volume: 0.4 + low * 0.7 }); }
    } else this._hb = 0;

    // ambience one-shots
    this._ambT -= dt;
    if (this._ambT <= 0) { this._ambT = 3 + Math.random() * 9; this._ambientEvent(); }
  }
}
