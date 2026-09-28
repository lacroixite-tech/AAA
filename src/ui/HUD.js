import * as THREE from 'three';
import { HUD_CSS } from './hudStyles.js';
import { bakeMinimap } from './minimap.js';
import { ICONS } from './icons.js';

/**
 * HUD overlay (DOM/CSS). Owner: ui agent.
 * Reads player/weapons/enemies defensively. Emits 'ui:hitmarker' {kill, headshot} (audio tick hook).
 * Public: score, setObjective(text, sub), showBanner(title, sub), forceVisible, forceMenu,
 *         flashHitmarker(kill), addDamageIndicator(fromPos), settings {sensitivity, hfov}.
 */
const FOV_REF_ASPECT = 16 / 9;
const vToH = (v) => THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(v) / 2) * FOV_REF_ASPECT));
const hToV = (h) => THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(h) / 2) / FOV_REF_ASPECT));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pad2 = (n) => String(Math.max(0, n | 0)).padStart(2, '0');

const CARDINALS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const DEATH_TIPS = [
  'Double-tap SHIFT to tactical sprint. Crouch while sprinting to slide into cover.',
  'Your health regenerates when you avoid taking fire. Break line of sight.',
  'Press SPACE near waist-high cover to vault over it.',
  'Red markers on the minimap show hostiles who are firing.',
];

export class HUD {
  constructor(game) {
    this.game = game;
    this.score = 0; this.kills = 0;
    this.forceVisible = false; this.forceMenu = false;
    this.objective = { text: 'Clear the Kovalenko intersection', sub: '' };
    this._bloom = 0; this._hm = { t: 9, kill: false }; this._dmg = []; this._pings = []; this._popups = [];
    this._lastFire = -9; this._lowAmmoT = 0; this._menuOpen = null; this._started = false;
    this._lastHealth = 100; this._vig = 0; this._hitFlash = 0;
    this.settings = this._loadSettings();

    const style = document.createElement('style'); style.textContent = HUD_CSS; document.head.appendChild(style);
    const root = document.getElementById('ui-root') || document.body.appendChild(document.createElement('div'));
    root.innerHTML = this._markup();
    this.root = root;
    const $ = (s) => root.querySelector(s);
    this.el = {
      hud: $('.hud'), vig: $('.vig'), blood: $('.blood'), xh: $('.xh'), xl: [...root.querySelectorAll('.xh i')],
      hm: $('.hm'), ring: $('.dmg-ring'), strip: $('.cmp-strip'), bearing: $('.cmp-bearing b'), cmpPings: $('.cmp-pings'),
      mm: $('.mm canvas'), mmN: $('.mm-n'), obj: $('.obj-text'), objSub: $('.obj-sub'),
      wName: $('.w-name'), wNote: $('.w-note'), wMag: $('.w-mag'), wRes: $('.w-res'), wMode: $('.w-mode'), wBar: $('.w-bar'),
      lethal: $('.eq-lethal b'), tactical: $('.eq-tactical b'), prompt: $('.prompt'), popups: $('.popups'),
      feed: $('.feed'), wave: $('.wv-num'), hostiles: $('.wv-host b'), scoreEl: $('.wv-score b'),
      banner: $('.banner'), death: $('.death'), deathT: $('.death-t'), deathTip: $('.death-tip'),
      menu: $('.menu'), deploy: $('.m-deploy'), deployLabel: $('.m-deploy span'), sens: $('#set-sens'), fov: $('#set-fov'),
      sensV: $('#set-sens-v'), fovV: $('#set-fov-v'), health: $('.hp i'), hp: $('.hp'),
    };
    this._buildCompass();
    this._applySettings();

    // minimap
    this.map = null;
    try { this.map = bakeMinimap(game); } catch (e) { console.warn('minimap bake failed', e); }
    this._mmCtx = this.el.mm.getContext('2d');

    this._bindEvents();
    this._bindMenu();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  /* ------------------------------------------------------------------ markup */

  _markup() {
    const kb = (k, a) => `<div class="kb"><kbd>${k}</kbd><span>${a}</span></div>`;
    return `
<div class="vig"></div><div class="blood"></div>
<div class="hud">
  <div class="mm-wrap">
    <div class="mm"><canvas></canvas><div class="mm-ring"></div><div class="mm-n">N</div></div>
    <div class="obj">
      <div class="obj-head"><span class="obj-dia"></span>OBJECTIVE</div>
      <div class="obj-text"></div><div class="obj-sub"></div>
    </div>
  </div>
  <div class="cmp"><div class="cmp-view"><div class="cmp-strip"></div><div class="cmp-pings"></div></div>
    <div class="cmp-mark"></div><div class="cmp-bearing"><b>000</b></div></div>
  <div class="xh"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><em></em></div>
  <div class="hm"><i></i><i></i><i></i><i></i></div>
  <div class="dmg-ring"></div>
  <div class="popups"></div>
  <div class="prompt"></div>
  <div class="banner"><small></small><b></b></div>
  <div class="feed"></div>
  <div class="wv">
    <div class="wv-l"><small>WAVE</small><b class="wv-num">01</b></div>
    <div class="wv-r"><div class="wv-host">HOSTILES <b>--</b></div><div class="wv-score">SCORE <b>0</b></div></div>
  </div>
  <div class="loadout">
    <div class="eq">
      <div class="eq-lethal">${ICONS.frag}<b>2</b></div>
      <div class="eq-tactical">${ICONS.flash}<b>2</b></div>
    </div>
    <div class="ammo">
      <div class="w-note"></div>
      <div class="w-top"><span class="w-name">M4A1</span><span class="w-mode"></span></div>
      <div class="w-count"><span class="w-mag">30</span><span class="w-res">120</span></div>
      <div class="w-bar"></div>
      <div class="hp"><i></i></div>
    </div>
  </div>
</div>
<div class="death"><div class="death-in"><small>MISSION STATUS</small><h1>KILLED IN ACTION</h1>
  <div class="death-line"></div><p class="death-tip"></p><div class="death-t"></div></div></div>
<div class="menu">
  <div class="m-bg"></div><div class="m-grain"></div>
  <div class="m-left">
    <div class="m-tag"><span></span>CAMPAIGN &nbsp;/&nbsp; MISSION 07</div>
    <h1 class="m-title"><small>OPERATION</small>NIGHTFALL</h1>
    <div class="m-loc"><span>KOVALENKO DISTRICT</span><span>17:42 LOCAL</span><span>50.4471&deg;N 30.5216&deg;E</span></div>
    <p class="m-brief">Hostile forces have dug in around the Kovalenko intersection. Push through the plaza,
      clear the apartment blocks and hold the crossroads until the relief column arrives.</p>
    <button class="m-deploy"><span>DEPLOY</span><em>CLICK TO ENTER</em></button>
    <div class="m-hint">Press <kbd>ESC</kbd> at any time to pause</div>
  </div>
  <div class="m-right">
    <section><h3>CONTROLS</h3><div class="kbs">
      ${kb('W A S D', 'Move')}${kb('MOUSE', 'Look / Aim')}${kb('LMB', 'Fire')}${kb('RMB', 'Aim down sights')}
      ${kb('SHIFT', 'Sprint (double-tap: tactical)')}${kb('C / CTRL', 'Crouch · Slide while sprinting')}
      ${kb('Z', 'Prone')}${kb('SPACE', 'Jump · Mantle · Vault')}${kb('R', 'Reload')}${kb('Q / E', 'Lean')}
      ${kb('G', 'Lethal')}${kb('ESC', 'Pause')}
    </div></section>
    <section><h3>SETTINGS</h3>
      <label class="sl"><span>MOUSE SENSITIVITY</span><input id="set-sens" type="range" min="0.2" max="3" step="0.05"><b id="set-sens-v"></b></label>
      <label class="sl"><span>FIELD OF VIEW</span><input id="set-fov" type="range" min="80" max="120" step="1"><b id="set-fov-v"></b></label>
    </section>
  </div>
  <div class="m-foot"><span>OPERATION NIGHTFALL</span><span class="m-build">BUILD 0.9.186 — THREE.JS r186</span></div>
</div>`;
  }

  _buildCompass() {
    this.ppd = 3.1; // px per degree (in u units)
    let html = '';
    for (let d = -360; d <= 720; d += 5) {
      const b = ((d % 360) + 360) % 360;
      const x = (d + 360) * this.ppd;
      if (CARDINALS[b] !== undefined) html += `<span class="c-lbl ${b % 90 === 0 ? 'major' : ''}" style="left:calc(${x}*var(--u))">${CARDINALS[b]}</span>`;
      else if (b % 15 === 0) html += `<span class="c-num" style="left:calc(${x}*var(--u))">${b}</span>`;
      html += `<i class="${b % 15 === 0 ? 'l' : ''}" style="left:calc(${x}*var(--u))"></i>`;
    }
    this.el.strip.innerHTML = html;
  }

  /* ------------------------------------------------------------------ events */

  _bindEvents() {
    const ev = this.game.events;
    ev.on('weapon:fire', () => { this._bloom = Math.min(1.4, this._bloom + 0.28); this._lastFire = this.game.time; });
    ev.on('enemy:hit', (h) => { this._sawEnemyHit = true; if (!h?.killed) this.flashHitmarker(false, h?.part === 'head'); });
    ev.on('hit', (h) => {
      if (!h || this._sawEnemyHit) return;
      const enemyHit = h.object && (h.surface === 'flesh' || h.object.userData?.hittable || h.object.userData?.enemy);
      if (enemyHit && this.game.time - this._lastFire < 0.6) this.flashHitmarker(false, h.part === 'head');
    });
    ev.on('enemy:killed', (e) => {
      const hs = !!e?.headshot;
      this.flashHitmarker(true, hs);
      this.kills++;
      const pts = hs ? 150 : 100;
      this.score += pts;
      this._popup(pts, hs ? 'HEADSHOT' : 'KILL');
      const w = this.game.weapons?.current?.name || 'M4A1';
      const name = e?.enemy?.userData?.name || e?.enemy?.name || this._enemyName();
      this._feed(`<span class="you">YOU</span><span class="wpn">${w}${hs ? ' <em>' + ICONS.skull + '</em>' : ''}</span><span class="foe">${name}</span>`);
    });
    ev.on('enemy:fire', (e) => {
      const p = e?.origin || e?.enemy?.position || e?.enemy?.root?.position;
      if (!p) return;
      const key = e.enemy || p;
      const ex = this._pings.find((q) => q.key === key);
      if (ex) { ex.pos.copy(p); ex.t = this.game.time; } else this._pings.push({ key, pos: p.clone(), t: this.game.time });
      if (this._pings.length > 24) this._pings.shift();
    });
    ev.on('player:damaged', (d) => { if (d?.fromPos) this.addDamageIndicator(d.fromPos); this._hitFlash = 1; });
    ev.on('wave:start', (d) => { const n = d?.wave ?? d; this.showBanner(`WAVE ${pad2(n)}`, 'HOSTILE REINFORCEMENTS INBOUND'); });
    ev.on('wave:complete', (d) => this.showBanner('WAVE CLEARED', `+${d?.bonus ?? 500} WAVE BONUS`));
    const MODE = { auto: 'FULL AUTO', full: 'FULL AUTO', semi: 'SEMI-AUTO', burst: 'BURST' };
    ev.on('weapon:mode', (d) => this._note(MODE[String(d?.fireMode).toLowerCase()] || String(d?.fireMode || '').toUpperCase()));
    ev.on('weapon:switch', (d) => this._note(String(d?.weapon || '').toUpperCase()));
    ev.on('objective', (o) => this.setObjective(o?.text ?? o, o?.sub));
    ev.on('player:died', () => { this.el.deathTip.textContent = DEATH_TIPS[(this.game.player?.deaths ?? 0) % DEATH_TIPS.length]; });
  }

  _enemyName() {
    const n = ['OPFOR RIFLEMAN', 'OPFOR GUNNER', 'OPFOR SCOUT', 'OPFOR SQUAD LEAD', 'OPFOR MARKSMAN'];
    return n[(this.kills * 7 + 3) % n.length];
  }

  _bindMenu() {
    const e = this.el;
    e.deploy.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this._started = true;
      this.game.renderer.domElement.requestPointerLock?.();
      this.game.audio?.resume?.();
    });
    e.menu.querySelector('.m-bg').addEventListener('click', () => e.deploy.click());
    e.sens.addEventListener('input', () => { this.settings.sensitivity = +e.sens.value; this._applySettings(); this._saveSettings(); });
    e.fov.addEventListener('input', () => { this.settings.hfov = +e.fov.value; this._applySettings(); this._saveSettings(); });
  }

  _loadSettings() {
    const def = { sensitivity: 1, hfov: Math.round(vToH(this.game.camera.fov)) };
    try { return { ...def, ...JSON.parse(localStorage.getItem('nightfall.settings') || '{}') }; } catch { return def; }
  }
  _saveSettings() { try { localStorage.setItem('nightfall.settings', JSON.stringify(this.settings)); } catch { /* ignore */ } }
  _applySettings() {
    const s = this.settings, e = this.el, p = this.game.player;
    e.sens.value = s.sensitivity; e.fov.value = s.hfov;
    e.sensV.textContent = s.sensitivity.toFixed(2); e.fovV.textContent = `${s.hfov}°`;
    const vf = hToV(s.hfov);
    if (p) { p.sensitivity = s.sensitivity; p.baseFov = vf; }
    // weapons owns the final camera fov (baseFov * fovMultiplier); feed it the base value.
    if (this.game.weapons && 'baseFov' in this.game.weapons) this.game.weapons.baseFov = vf;
    else { this.game.camera.fov = vf; this.game.camera.updateProjectionMatrix(); }
    this.game.settings = s;
  }

  /* ------------------------------------------------------------------ public helpers */

  setObjective(text, sub = '') { this.objective = { text: text || '', sub: sub || '' }; }

  showBanner(title, sub = '') {
    const b = this.el.banner;
    b.querySelector('b').textContent = title; b.querySelector('small').textContent = sub;
    b.classList.remove('on'); void b.offsetWidth; b.classList.add('on');
  }

  flashHitmarker(kill = false, headshot = false) {
    this._hm.kill = kill || (this._hm.kill && this._hm.t < 0.1); this._hm.t = 0;
    const el = this.el.hm;
    el.classList.toggle('kill', !!this._hm.kill);
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    this.game.events.emit('ui:hitmarker', { kill, headshot });
  }

  addDamageIndicator(fromPos) {
    const d = document.createElement('div');
    d.className = 'dmg';
    d.innerHTML = `<svg viewBox="-100 -100 200 200">
      <path d="${arcPath(0, 86, 30)}" fill="none" stroke="rgba(255,30,18,.22)" stroke-width="9"/>
      <path d="${arcPath(0, 86, 22)}" fill="none" stroke="rgba(255,30,18,.45)" stroke-width="10"/>
      <path d="${arcPath(0, 86, 14)}" fill="none" stroke="rgba(255,36,22,.95)" stroke-width="11"/>
      <path d="${arcPath(0, 78.5, 9)}" fill="none" stroke="rgba(255,120,100,.6)" stroke-width="1.6"/></svg>`;
    this.el.ring.appendChild(d);
    this._dmg.push({ el: d, pos: fromPos.clone ? fromPos.clone() : new THREE.Vector3(fromPos.x, fromPos.y, fromPos.z), t: 0 });
    if (this._dmg.length > 6) { const o = this._dmg.shift(); o.el.remove(); }
  }

  _note(text) {
    const n = this.el.wNote; n.textContent = text;
    n.classList.remove('on'); void n.offsetWidth; n.classList.add('on');
  }

  _popup(pts, label) {
    const d = document.createElement('div');
    d.className = 'pop'; d.innerHTML = `<b>+${pts}</b><span>${label}</span>`;
    this.el.popups.prepend(d);
    this._popups.push({ el: d, t: 0 });
    while (this._popups.length > 4) this._popups.shift().el.remove();
  }

  _feed(html) {
    const d = document.createElement('div'); d.className = 'kf'; d.innerHTML = html;
    this.el.feed.appendChild(d);
    this._feedItems = this._feedItems || [];
    this._feedItems.push({ el: d, t: 0 });
    while (this._feedItems.length > 5) this._feedItems.shift().el.remove();
  }

  resize() {
    const u = Math.max(0.7, Math.min(innerWidth / 1920, innerHeight / 1080));
    document.documentElement.style.setProperty('--u', `${u}px`);
    this.u = u;
    const px = Math.round(236 * u * Math.min(devicePixelRatio || 1, 2));
    this.el.mm.width = this.el.mm.height = px;
  }

  get visible() {
    const g = this.game;
    if (!g.shotName) return true;
    return this.forceVisible || g.params?.get('hud') === '1';
  }

  /* ------------------------------------------------------------------ update */

  update(dt) {
    const g = this.game, e = this.el, p = g.player, t = g.time;
    const vis = this.visible;
    e.hud.style.display = vis ? '' : 'none';

    // menu / death overlay
    const menuOpen = this.forceMenu || (!g.shotName && !g.input.locked);
    if (menuOpen !== this._menuOpen) {
      this._menuOpen = menuOpen;
      e.menu.classList.toggle('on', menuOpen);
      e.deployLabel.textContent = this._started ? 'RESUME' : 'DEPLOY';
      e.hud.classList.toggle('dim', menuOpen);
    }
    const dead = !!p?.dead;
    e.death.classList.toggle('on', dead && vis);
    e.hud.classList.toggle('dead', dead);
    if (dead) e.deathT.textContent = p.respawnIn > 0.05 ? `REDEPLOYING IN ${Math.ceil(p.respawnIn)}` : 'REDEPLOYING';

    // vignette / damage
    const hp01 = p ? clamp(p.health / (p.maxHealth || 100), 0, 1) : 1;
    const dmgT = clamp(1 - hp01, 0, 1);
    this._hitFlash = Math.max(0, this._hitFlash - dt * 2.2);
    this._vig = dmgT;
    const vigA = Math.min(1, Math.pow(clamp((dmgT - 0.18) / 0.82, 0, 1), 1.1) * 1.1 + this._hitFlash * 0.3);
    e.vig.style.opacity = (vis || dead) ? vigA.toFixed(3) : 0;
    e.blood.style.opacity = (vis ? clamp((dmgT - 0.35) * 1.6, 0, 1) * (0.85 + 0.15 * Math.sin(t * 6)) : 0).toFixed(3);
    g.post?.setDamage?.(Math.min(1, dmgT * 1.1 + this._hitFlash * 0.2));
    if (!vis) return;

    const w = g.weapons, cur = w?.current;
    const ads = w?.adsAmount ?? (p?.aiming ? 1 : 0);

    // crosshair
    this._bloom = Math.max(0, this._bloom - dt * 2.4);
    const move = p ? p.moveSpeed01 : 0;
    let gap = 7 + move * 16 + (p && !p.onGround ? 18 : 0) + this._bloom * 14 + (p?.crouching ? -2 : 0);
    if (typeof w?.spread === 'number' && g.camera) {
      gap = Math.max(gap * 0.5, Math.tan(w.spread) / Math.tan(THREE.MathUtils.degToRad(g.camera.fov) / 2) * (innerHeight / 2) / this.u);
    }
    this._gap = (this._gap ?? gap) + (gap - (this._gap ?? gap)) * Math.min(1, dt * 18);
    const hideX = ads > 0.35 || p?.sprinting || p?.sliding || p?.mantling || dead || w?.reloading && false;
    e.xh.style.opacity = hideX ? 0 : (1 - ads * 2).toFixed(2);
    e.xh.style.setProperty('--gap', this._gap.toFixed(2));

    // hitmarker
    this._hm.t += dt;
    e.hm.style.opacity = this._hm.t < 0.28 ? 1 : Math.max(0, 1 - (this._hm.t - 0.28) / 0.18);

    // damage indicators
    const bearing = p ? ((-p.yaw * 180 / Math.PI) % 360 + 360) % 360 : 0;
    for (let i = this._dmg.length - 1; i >= 0; i--) {
      const d = this._dmg[i]; d.t += dt;
      const dx = d.pos.x - p.position.x, dz = d.pos.z - p.position.z;
      const b = Math.atan2(dx, -dz) * 180 / Math.PI;
      d.el.style.transform = `rotate(${(b - bearing).toFixed(1)}deg)`;
      d.el.style.opacity = d.t < 0.9 ? 1 : Math.max(0, 1 - (d.t - 0.9) / 0.9);
      if (d.t > 1.8) { d.el.remove(); this._dmg.splice(i, 1); }
    }

    // killfeed
    if (this._feedItems) for (let i = this._feedItems.length - 1; i >= 0; i--) {
      const q = this._feedItems[i]; q.t += dt;
      if (q.t > 5.2) q.el.classList.add('out');
      if (q.t > 5.8) { q.el.remove(); this._feedItems.splice(i, 1); }
    }

    // popups
    for (let i = this._popups.length - 1; i >= 0; i--) {
      const q = this._popups[i]; q.t += dt;
      if (q.t > 2.2) { q.el.classList.add('out'); }
      if (q.t > 2.6) { q.el.remove(); this._popups.splice(i, 1); }
    }

    // compass
    const cw = 560;
    const off = -(bearing + 360) * this.ppd + cw / 2;
    e.strip.style.transform = `translateX(calc(${off.toFixed(2)}*var(--u)))`;
    e.bearing.textContent = String(Math.round(bearing) % 360).padStart(3, '0');
    this._drawCompassPings(bearing, t);

    // minimap
    this._drawMinimap(p, t);

    // objective / wave
    const alive = this._aliveCount();
    const wave = g.enemies?.wave ?? g.enemies?.waveNumber ?? 1;
    e.wave.textContent = pad2(wave);
    e.hostiles.textContent = alive == null ? '--' : pad2(alive);
    e.scoreEl.textContent = (g.enemies?.score ?? this.score).toLocaleString('en-US');
    const objText = this.objective.text;
    if (e.obj.textContent !== objText) e.obj.textContent = objText;
    const sub = this.objective.sub || (alive != null ? `Eliminate hostiles  [${alive}]` : '');
    if (e.objSub.textContent !== sub) e.objSub.textContent = sub;

    // ammo
    const name = cur?.name ?? w?.name ?? 'M4A1';
    const mag = cur?.ammo ?? w?.ammo ?? 0;
    const magSize = cur?.magSize ?? w?.magSize ?? 30;
    const reserve = cur?.reserve ?? w?.reserve ?? 0;
    const mode = (cur?.fireMode ?? w?.fireMode ?? 'auto').toString().toLowerCase();
    if (this._wName !== name) { this._wName = name; e.wName.textContent = name.toUpperCase(); }
    e.wMag.textContent = mag;
    e.wRes.textContent = reserve;
    const low = mag <= Math.ceil(magSize * 0.25);
    e.wMag.classList.toggle('low', low);
    if (this._mode !== mode) { this._mode = mode; e.wMode.innerHTML = fireModeIcon(mode); }
    if (this._barKey !== `${mag}/${magSize}`) {
      this._barKey = `${mag}/${magSize}`;
      const n = Math.min(magSize, 60);
      const filled = Math.round(mag / magSize * n);
      let s = ''; for (let i = 0; i < n; i++) s += `<i class="${i < filled ? 'f' : ''}${low && i < filled ? ' lo' : ''}"></i>`;
      e.wBar.innerHTML = s;
    }
    const lethal = w?.lethal?.count ?? w?.grenades ?? w?.equipment?.lethal ?? 2;
    const tactical = w?.tactical?.count ?? w?.flashbangs ?? w?.equipment?.tactical ?? 1;
    e.lethal.textContent = lethal; e.tactical.textContent = tactical;
    e.lethal.parentElement.classList.toggle('empty', !lethal);
    e.tactical.parentElement.classList.toggle('empty', !tactical);
    e.hp.style.setProperty('--hp', hp01.toFixed(3));
    e.hp.classList.toggle('low', hp01 < 0.4);

    // prompt
    let prompt = '';
    if (w?.reloading) prompt = '<span class="rl">RELOADING</span>';
    else if (mag === 0 && reserve === 0) prompt = '<span class="no">NO AMMO</span>';
    else if (low) prompt = `<kbd>R</kbd><span>${mag === 0 ? 'RELOAD' : 'RELOAD'}</span>`;
    if (prompt !== this._prompt) { this._prompt = prompt; e.prompt.innerHTML = prompt; e.prompt.className = `prompt ${mag === 0 && !w?.reloading ? 'urgent' : ''}`; }
  }

  _aliveCount() {
    const em = this.game.enemies;
    if (!em) return null;
    if (typeof em.alive === 'number') return em.alive + (em.waveRemaining > 0 ? em.waveRemaining : 0);
    if (typeof em.aliveCount === 'number') return em.aliveCount;
    if (typeof em.aliveCount === 'function') return em.aliveCount();
    const arr = em.enemies || em.list || em.agents;
    if (!Array.isArray(arr)) return null;
    let n = 0;
    for (const x of arr) {
      if (x.dead === true || x.alive === false || x.visible === false) continue;
      const hp = x.health ?? x.userData?.health ?? 1;
      if (hp > 0) n++;
    }
    return n;
  }

  _drawCompassPings(bearing, t) {
    const p = this.game.player; if (!p) return;
    let html = '';
    for (const q of this._pings) {
      const age = t - q.t; if (age > 2.5) continue;
      const b = Math.atan2(q.pos.x - p.position.x, -(q.pos.z - p.position.z)) * 180 / Math.PI;
      let rel = ((b - bearing + 540) % 360) - 180;
      if (Math.abs(rel) > 88) continue;
      html += `<i style="left:calc(${(280 + rel * this.ppd).toFixed(1)}*var(--u));opacity:${Math.min(1, 2.5 - age).toFixed(2)}"></i>`;
    }
    if (html !== this._pingHtml) { this._pingHtml = html; this.el.cmpPings.innerHTML = html; }
  }

  _drawMinimap(p, t) {
    const c = this.el.mm, ctx = this._mmCtx, W = c.width, R = W / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.clip();
    const bg = ctx.createRadialGradient(R, R, 0, R, R, R);
    bg.addColorStop(0, 'rgba(30,36,38,0.78)'); bg.addColorStop(1, 'rgba(14,17,19,0.84)');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, W);
    const radiusM = 34; // world meters from center to rim
    const s = R / radiusM; // px per meter
    if (p) {
      ctx.translate(R, R); ctx.rotate(p.yaw);
      const m = this.map;
      if (m) {
        ctx.imageSmoothingEnabled = true;
        const sc = s / m.cellsPerM;
        ctx.drawImage(m.canvas, (m.minX - p.position.x) * s, (m.minZ - p.position.z) * s, m.canvas.width * sc, m.canvas.height * sc);
      }
      // grid
      ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 1;
      const gs = 10;
      const gx0 = Math.floor((p.position.x - radiusM * 1.5) / gs) * gs, gz0 = Math.floor((p.position.z - radiusM * 1.5) / gs) * gs;
      ctx.beginPath();
      for (let x = gx0; x < p.position.x + radiusM * 1.5; x += gs) { ctx.moveTo((x - p.position.x) * s, -R * 1.5); ctx.lineTo((x - p.position.x) * s, R * 1.5); }
      for (let z = gz0; z < p.position.z + radiusM * 1.5; z += gs) { ctx.moveTo(-R * 1.5, (z - p.position.z) * s); ctx.lineTo(R * 1.5, (z - p.position.z) * s); }
      ctx.stroke();
      // enemy pings
      for (const q of this._pings) {
        const age = t - q.t; if (age > 2.5) continue;
        const x = (q.pos.x - p.position.x) * s, y = (q.pos.z - p.position.z) * s;
        const a = Math.min(1, 2.5 - age);
        const d = Math.hypot(x, y), lim = R - 7 * (W / 236);
        const k = d > lim ? lim / d : 1;
        ctx.fillStyle = `rgba(255,48,36,${a})`;
        ctx.beginPath(); ctx.arc(x * k, y * k, 4.2 * (W / 236), 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `rgba(255,120,100,${a * 0.5 * (1 - (age % 0.8) / 0.8)})`; ctx.lineWidth = 1.5 * (W / 236);
        ctx.beginPath(); ctx.arc(x * k, y * k, (4 + (age % 0.8) * 14) * (W / 236), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // view cone
      const fovH = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.game.camera.fov) / 2) * this.game.camera.aspect);
      const cone = ctx.createRadialGradient(R, R, 0, R, R, R * 0.85);
      cone.addColorStop(0, 'rgba(255,255,255,0.20)'); cone.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = cone; ctx.beginPath(); ctx.moveTo(R, R);
      ctx.arc(R, R, R * 0.85, -Math.PI / 2 - fovH / 2, -Math.PI / 2 + fovH / 2); ctx.closePath(); ctx.fill();
      // player arrow
      const k = W / 236;
      ctx.translate(R, R);
      ctx.fillStyle = '#f4f1e8'; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5 * k;
      ctx.beginPath(); ctx.moveTo(0, -9 * k); ctx.lineTo(6.5 * k, 7 * k); ctx.lineTo(0, 3.5 * k); ctx.lineTo(-6.5 * k, 7 * k); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    // north marker around rim (north = -Z, rotated with the map)
    if (p) {
      const a = p.yaw - Math.PI / 2;
      this.el.mmN.style.transform = `translate(calc(${(Math.cos(a) * 101).toFixed(2)}*var(--u)), calc(${(Math.sin(a) * 101).toFixed(2)}*var(--u)))`;
    }
  }
}

function arcPath(center, r, halfDeg) {
  const a0 = THREE.MathUtils.degToRad(center - halfDeg - 90), a1 = THREE.MathUtils.degToRad(center + halfDeg - 90);
  const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r, x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function fireModeIcon(mode) {
  const b = '<i></i>';
  if (mode.startsWith('auto') || mode === 'full') return `<span class="fm">${b}${b}${b}</span>`;
  if (mode.startsWith('burst')) return `<span class="fm burst">${b}${b}${b}</span>`;
  return `<span class="fm semi">${b}</span>`;
}
