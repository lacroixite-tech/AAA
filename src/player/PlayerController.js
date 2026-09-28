import * as THREE from 'three';

/**
 * First-person movement + camera. Owner: player agent.
 *
 * Public state (read by others): position (feet), velocity, yaw, pitch, onGround, sprinting,
 * tacSprinting, crouching, prone, sliding, mantling, aiming (written by weapons), health, maxHealth,
 * eyeHeight, moveSpeed01, dead, stance ('stand'|'crouch'|'prone').
 *
 * Hooks for weapons: recoilPitch / recoilYaw (radians, added to the camera every frame — weapons
 * owns & decays them), cameraShake(intensity 0..1), sensitivity multiplier. Camera fov is owned by
 * weapons (baseFov * fovMultiplier); the HUD settings menu writes weapons.baseFov.
 *
 * Events emitted: player:footstep {surface, intensity}, player:jump, player:land {speed},
 * player:damaged {amount, fromPos}, player:died, player:respawn, player:slide, player:mantle {height}.
 */

const STANCES = {
  stand: { height: 1.8, eye: 1.64, speed: 4.7, radius: 0.34 },
  crouch: { height: 1.22, eye: 1.06, speed: 2.6, radius: 0.34 },
  prone: { height: 0.72, eye: 0.42, speed: 1.05, radius: 0.3 },
};
const SLIDE_EYE = 0.86;
const SPRINT_SPEED = 6.9;
const TAC_SPEED = 8.6;
const TAC_DURATION = 3.4;
const ADS_MULT = 0.58;
const GRAVITY = 21;
const JUMP_VEL = 6.2;
const STEP_HEIGHT = 0.45;
const SNAP_DOWN = 0.38;
const COYOTE = 0.12;
const JUMP_BUFFER = 0.12;
const GROUND_FRICTION = 7.5;
const GROUND_ACCEL = 11;
const AIR_ACCEL = 1.8;
const SLIDE_TIME = 0.95;
const SLIDE_BOOST = 9.4;
const REGEN_DELAY = 4.2;
const REGEN_RATE = 42;
const RESPAWN_TIME = 4.5;

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _o = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0), UPV = new THREE.Vector3(0, 1, 0);
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
const smooth = (t) => t * t * (3 - 2 * t);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class PlayerController {
  constructor(game) {
    this.game = game;
    const sp = game.level.playerSpawn;
    this.position = sp.position.clone();
    this.velocity = new THREE.Vector3();
    this.yaw = sp.yaw; this.pitch = 0;
    this.radius = STANCES.stand.radius; this.height = STANCES.stand.height; this.eyeHeight = STANCES.stand.eye;
    this.stance = 'stand';
    this.onGround = false; this.sprinting = false; this.tacSprinting = false; this.crouching = false; this.prone = false;
    this.sliding = false; this.mantling = false; this.aiming = false; this.leaning = 0;
    this.maxHealth = 100; this.health = 100; this.moveSpeed01 = 0; this.dead = false; this.respawnIn = 0;
    this.lastDamageTime = -99; this.spawnTime = 0; this.deaths = 0;

    // hooks
    this.recoilPitch = 0; this.recoilYaw = 0;
    this.sensitivity = 1; this.baseFov = game.camera.fov;
    this.groundSurface = 'concrete'; this.groundNormal = new THREE.Vector3(0, 1, 0);

    // internal
    this._coyote = 0; this._jumpBuf = 0; this._lastShiftTap = -9; this._tacTime = 0; this._tacCooldown = 0;
    this._slideT = 0; this._crouchHeld = false; this._wantCrouchToggle = false;
    this._airTime = 0; this._fallStartY = this.position.y; this._prevVy = 0;
    this._mantle = null;
    // camera filters
    this._eye = this.eyeHeight; this._stepOff = 0; this._bobPhase = 0; this._bobBlend = 0; this._stepIndex = 0;
    this._landY = 0; this._landV = 0; this._roll = 0; this._slideTilt = 0; this._lean = 0; this._trauma = 0;
    this._pitchKick = 0; this._pitchKickV = 0; this._deathT = 0; this._sprintBlend = 0;
    this._lastFov = -1;

    this._rayHits = [];
    game.events.on('weapon:fire', () => { if (this.sprinting) this._stopSprint(); });
    this.snapToGround();
  }

  /* ------------------------------------------------------------------ public API */

  cameraShake(intensity = 0.3) { this._trauma = Math.min(1, this._trauma + intensity); }

  damage(amount, fromPos) {
    if (this.dead || amount <= 0) return;
    if (this.game.time - this.spawnTime < 1.2) return; // spawn protection
    this.health = Math.max(0, this.health - amount);
    this.lastDamageTime = this.game.time;
    this.cameraShake(0.18 + Math.min(0.4, amount / 90));
    this._pitchKickV += 0.6 + amount * 0.02;
    this.game.events.emit('player:damaged', { amount, fromPos: fromPos ? fromPos.clone?.() ?? fromPos : null });
    if (this.health <= 0) this._die();
  }

  respawn() {
    const sp = this.game.level.playerSpawn;
    this.position.copy(sp.position); this.velocity.set(0, 0, 0);
    this.yaw = sp.yaw; this.pitch = 0;
    this.health = this.maxHealth; this.dead = false; this._deathT = 0;
    this._setStance('stand', true); this.sliding = false; this._mantle = null; this.mantling = false;
    this._trauma = 0; this.spawnTime = this.game.time;
    this.snapToGround();
    this.game.events.emit('player:respawn', {});
  }

  snapToGround() {
    _o.set(this.position.x, this.position.y + 1.5, this.position.z);
    const h = this.game.collision.raycast(_o, DOWN, 20, { dynamic: false });
    if (h) { this.position.y = h.point.y; this.onGround = true; this.groundSurface = h.surface || 'concrete'; }
  }

  /* ------------------------------------------------------------------ update */

  update(dt) {
    const g = this.game, inp = g.input;
    const active = inp.locked && !this.dead;
    this.radius = STANCES[this.stance].radius;

    // regen
    if (!this.dead && this.health < this.maxHealth && g.time - this.lastDamageTime > REGEN_DELAY) {
      this.health = Math.min(this.maxHealth, this.health + REGEN_RATE * dt);
    }

    if (this.dead) { this._updateDeath(dt); this.applyCamera(dt); return; }
    if (this._shotPose) { this.poseForShot(this._shotPose); return; }

    // ---- look
    if (active) {
      const sens = 0.0022 * this.sensitivity * (this.aiming ? 0.62 : 1);
      this.yaw -= inp.mouse.dx * sens;
      this.pitch -= inp.mouse.dy * sens;
      this.pitch = clamp(this.pitch, -1.52, 1.52);
      if (this.stance === 'prone') this.pitch = clamp(this.pitch, -0.55, 1.2);
    }

    const key = (c) => active && inp.down(c);
    const pressed = (c) => active && inp.wasPressed(c);
    const f = (key('KeyW') ? 1 : 0) - (key('KeyS') ? 1 : 0);
    const r = (key('KeyD') ? 1 : 0) - (key('KeyA') ? 1 : 0);

    if (this._mantle) { this._updateMantle(dt); this._post(dt, f, r); return; }

    // ---- stance input
    if (pressed('KeyC') || pressed('ControlLeft')) {
      const horiz = Math.hypot(this.velocity.x, this.velocity.z);
      if (this.sprinting && this.onGround && horiz > 5.0 && this.stance === 'stand') this._startSlide();
      else if (inp.wasPressed('KeyC')) this._setStance(this.stance === 'crouch' ? 'stand' : 'crouch');
    }
    const ctrl = key('ControlLeft');
    if (ctrl && !this._crouchHeld && !this.sliding && this.stance === 'stand') this._setStance('crouch');
    if (!ctrl && this._crouchHeld && this.stance === 'crouch' && !this.sliding) this._setStance('stand');
    this._crouchHeld = ctrl;
    if (pressed('KeyZ')) this._setStance(this.stance === 'prone' ? 'crouch' : 'prone');

    // ---- sprint (CoD: tap shift to sprint, double-tap for tactical sprint)
    const shiftTap = pressed('ShiftLeft') || pressed('ShiftRight');
    const canSprint = f > 0 && !this.aiming && !this.sliding && this.onGround !== null;
    this._tacCooldown = Math.max(0, this._tacCooldown - dt);
    if (shiftTap && f > 0) {
      if (g.time - this._lastShiftTap < 0.32 && this._tacCooldown <= 0 && this.sprinting) {
        this.tacSprinting = true; this._tacTime = TAC_DURATION;
      }
      this._lastShiftTap = g.time;
      if (this.stance !== 'stand' && !this.sliding) this._setStance('stand');
      this.sprinting = true;
    }
    if (key('ShiftLeft') && f > 0 && !this.sprinting && this.stance === 'stand') this.sprinting = true;
    if (!canSprint || f <= 0) this._stopSprint();
    if (this.tacSprinting) {
      this._tacTime -= dt;
      if (this._tacTime <= 0) { this.tacSprinting = false; this._tacCooldown = 2.5; }
    }

    // ---- jump (buffer + coyote)
    this._jumpBuf = pressed('Space') ? JUMP_BUFFER : Math.max(0, this._jumpBuf - dt);
    this._coyote = this.onGround ? COYOTE : Math.max(0, this._coyote - dt);
    if (this._jumpBuf > 0) {
      if (this._tryMantle(true)) { this._jumpBuf = 0; this._post(dt, f, r); return; }
      if (this.stance === 'prone') { this._setStance('crouch'); this._jumpBuf = 0; }
      else if (this.stance === 'crouch' && !this.sliding) { this._setStance('stand'); this._jumpBuf = 0; }
      else if (this._coyote > 0 && this._canStand()) {
        if (this.sliding) this._endSlide(true);
        this.velocity.y = JUMP_VEL;
        this.onGround = false; this._coyote = 0; this._jumpBuf = 0;
        this._fallStartY = this.position.y;
        g.events.emit('player:jump', {});
      }
    }
    // auto-mantle while airborne holding forward + space held
    if (!this.onGround && f > 0 && key('Space') && this.velocity.y < 2.5 && this._tryMantle(false)) { this._post(dt, f, r); return; }

    // ---- wish velocity
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = -sy * f + cy * r, wz = -cy * f - sy * r;
    const wl = Math.hypot(wx, wz); if (wl > 0) { wx /= wl; wz /= wl; }
    let wishSpeed = STANCES[this.stance].speed;
    if (this.sprinting) wishSpeed = this.tacSprinting ? TAC_SPEED : SPRINT_SPEED;
    if (this.sprinting && f > 0 && r !== 0) wishSpeed *= 0.92;
    if (f < 0 && !this.sprinting) wishSpeed *= 0.85; // backpedal slower
    if (this.aiming) wishSpeed *= ADS_MULT;
    if (wl === 0) wishSpeed = 0;

    // ---- slide
    if (this.sliding) {
      this._slideT += dt;
      const sp = Math.hypot(this.velocity.x, this.velocity.z);
      const fr = this._slideT < SLIDE_TIME * 0.55 ? 1.3 : 4.5;
      const ns = Math.max(0, sp - fr * dt * Math.max(sp, 2));
      if (sp > 0) { this.velocity.x *= ns / sp; this.velocity.z *= ns / sp; }
      // slight steering
      if (wl > 0 && sp > 0.1) {
        const tx = wx * ns, tz = wz * ns;
        this.velocity.x = damp(this.velocity.x, tx, 1.2, dt); this.velocity.z = damp(this.velocity.z, tz, 1.2, dt);
      }
      if (this._slideT > SLIDE_TIME || ns < 2.4 || !this.onGround && this._airTime > 0.25) this._endSlide(false);
    } else if (this.onGround) {
      // friction
      const sp = Math.hypot(this.velocity.x, this.velocity.z);
      if (sp > 0) {
        const drop = Math.max(sp, 1.8) * GROUND_FRICTION * dt;
        const ns = Math.max(0, sp - drop);
        this.velocity.x *= ns / sp; this.velocity.z *= ns / sp;
      }
      this._accelerate(wx, wz, wishSpeed, GROUND_ACCEL, dt);
    } else {
      this._accelerate(wx, wz, Math.max(wishSpeed, 1.0), AIR_ACCEL, dt);
    }

    // ---- gravity
    if (!this.onGround) this.velocity.y -= GRAVITY * dt;
    else if (this.velocity.y < 0) this.velocity.y = 0;
    this._prevVy = this.velocity.y;

    // ---- move with sub-steps
    const mx = this.velocity.x * dt, my = this.velocity.y * dt, mz = this.velocity.z * dt;
    const n = Math.max(1, Math.ceil(Math.hypot(mx, my, mz) / 0.2));
    for (let i = 0; i < n; i++) {
      this.position.x += mx / n; this.position.y += my / n; this.position.z += mz / n;
      this._collide();
    }
    this._groundCheck(dt);

    // ---- lean (Q/E) — only when standing/crouched and not sprinting
    let leanT = 0;
    if (!this.sprinting && !this.sliding && this.stance !== 'prone') leanT = (key('KeyE') ? 1 : 0) - (key('KeyQ') ? 1 : 0);
    if (leanT !== 0) {
      _v.set(Math.cos(this.yaw) * leanT, 0, -Math.sin(this.yaw) * leanT);
      _o.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
      const h = g.collision.raycast(_o, _v, 0.6, { dynamic: false });
      if (h) leanT *= clamp((h.distance - 0.15) / 0.45, 0, 1);
    }
    this.leaning = damp(this.leaning, leanT, 9, dt);

    this._post(dt, f, r);
  }

  /* ------------------------------------------------------------------ movement helpers */

  _accelerate(wx, wz, wishSpeed, accel, dt) {
    const cur = this.velocity.x * wx + this.velocity.z * wz;
    const add = wishSpeed - cur;
    if (add <= 0) return;
    const a = Math.min(add, accel * Math.max(wishSpeed, 1) * dt);
    this.velocity.x += wx * a; this.velocity.z += wz * a;
  }

  _stepOffset() { return Math.min(STEP_HEIGHT, this.height - 2 * this.radius - 0.02); }

  _collide() {
    const g = this.game, r = this.radius;
    const so = Math.max(0.02, this._stepOffset());
    const a = _v.set(this.position.x, this.position.y + so + r, this.position.z);
    const b = _v2.set(this.position.x, this.position.y + Math.max(so + r, this.height - r), this.position.z);
    const push = g.collision.resolveCapsule(a, b, r);
    if (push.lengthSq() < 1e-10) return;
    this.position.x += push.x; this.position.z += push.z;
    if (push.y < -1e-4) { this.position.y += push.y; if (this.velocity.y > 0) this.velocity.y = 0; }
    else if (!this.onGround && push.y > 0) this.position.y += push.y;
    const hl = Math.hypot(push.x, push.z);
    if (hl > 1e-5) {
      const nx = push.x / hl, nz = push.z / hl;
      const vn = this.velocity.x * nx + this.velocity.z * nz;
      if (vn < 0) { this.velocity.x -= nx * vn; this.velocity.z -= nz * vn; }
    }
  }

  _groundCheck(dt) {
    const g = this.game;
    const was = this.onGround;
    const so = Math.max(0.05, this._stepOffset());
    const rising = this.velocity.y > 0.5;
    const far = so + 0.05 + (was && !rising ? SNAP_DOWN : 0.04 + Math.max(0, -this.velocity.y * dt));
    const off = this.radius * 0.72;
    const offs = [[0, 0], [off, 0], [-off, 0], [0, off], [0, -off]];
    let best = null, bestY = -Infinity, centerY = -Infinity;
    for (let i = 0; i < offs.length; i++) {
      _o.set(this.position.x + offs[i][0], this.position.y + so + 0.05, this.position.z + offs[i][1]);
      const h = g.collision.raycast(_o, DOWN, far, { dynamic: false });
      if (!h || Math.abs(h.normal.y) < 0.62) continue;
      if (i === 0) centerY = h.point.y;
      if (h.point.y > bestY) { bestY = h.point.y; best = h; }
    }
    if (best && !rising) {
      const delta = bestY - this.position.y;
      if (delta > 0.04 && was) this._stepOff -= delta; // smooth step-up on camera
      else if (delta < -0.04 && was) this._stepOff -= delta * 0.6;
      if (!was) {
        const speed = Math.max(0, -this._prevVy);
        this._onLand(speed);
      }
      this.position.y = bestY;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.onGround = true;
      this.groundSurface = best.surface || 'concrete';
      this.groundNormal.copy(best.normal); if (this.groundNormal.y < 0) this.groundNormal.negate();
      this._airTime = 0;
    } else {
      if (was) this._fallStartY = this.position.y;
      this.onGround = false;
      this._airTime += dt;
    }
    void centerY;
  }

  _onLand(speed) {
    const g = this.game;
    if (speed > 2.5) {
      this._landV -= Math.min(2.2, speed * 0.16);
      this._pitchKickV -= Math.min(1.6, speed * 0.09);
      if (speed > 9) this.cameraShake(Math.min(0.5, (speed - 9) * 0.08));
    }
    g.events.emit('player:land', { speed });
    if (speed > 3) g.events.emit('player:footstep', { surface: this.groundSurface, intensity: Math.min(1.5, 0.6 + speed * 0.08) });
    const fall = this._fallStartY - this.position.y;
    if (fall > 5.5) this.damage((fall - 5.5) * 22, null);
  }

  _canStand(target = 'stand') {
    const need = STANCES[target].height;
    if (need <= this.height + 0.01) return true;
    _o.set(this.position.x, this.position.y + this.height - 0.1, this.position.z);
    const h = this.game.collision.raycast(_o, UPV, need - this.height + 0.15, { dynamic: false });
    return !h;
  }

  _setStance(s, force = false) {
    if (s === this.stance) return;
    if (!force && STANCES[s].height > this.height && !this._canStand(s)) return;
    this.stance = s;
    const st = STANCES[s];
    this.height = st.height; this.radius = st.radius;
    this.crouching = s === 'crouch'; this.prone = s === 'prone';
    if (s !== 'stand') this._stopSprint();
  }

  _stopSprint() { this.sprinting = false; if (this.tacSprinting) { this.tacSprinting = false; this._tacCooldown = 1.5; } }

  _startSlide() {
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    const k = Math.max(sp, SLIDE_BOOST) / Math.max(sp, 0.01);
    this.velocity.x *= k; this.velocity.z *= k;
    this.sliding = true; this._slideT = 0;
    this._slideDir = Math.sign(Math.sin(this.game.time * 13.7)) || 1; // subtle variation in tilt side
    this._slideDir = 1;
    this._setStance('crouch', true);
    this._stopSprint();
    this.cameraShake(0.08);
    this.game.events.emit('player:slide', {});
    this.game.events.emit('player:footstep', { surface: this.groundSurface, intensity: 1.2 });
  }

  _endSlide(jumping) {
    this.sliding = false;
    if (jumping && this._canStand()) this._setStance('stand');
  }

  /* ------------------------------------------------------------------ mantle / vault */

  _tryMantle(fromJump) {
    const g = this.game, col = g.collision;
    if (this.stance === 'prone') return false;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    _v.set(fx, 0, fz);
    let wallDist = Infinity;
    for (const h of [0.4, 0.75, 1.05, 1.4]) {
      _o.set(this.position.x, this.position.y + h, this.position.z);
      const hit = col.raycast(_o, _v, this.radius + 0.6, { dynamic: false });
      if (hit && Math.abs(hit.normal.y) < 0.35) wallDist = Math.min(wallDist, hit.distance);
    }
    if (wallDist === Infinity) return false;
    // find top
    const probe = wallDist + 0.3;
    _o.set(this.position.x + fx * probe, this.position.y + 2.2, this.position.z + fz * probe);
    const top = col.raycast(_o, DOWN, 2.2, { dynamic: false });
    if (!top || Math.abs(top.normal.y) < 0.7) return false;
    const ledge = top.point.y - this.position.y;
    const minH = fromJump ? 0.42 : 0.3;
    if (ledge < minH || ledge > 1.9) return false;
    // clearance above the ledge
    _o.copy(top.point); _o.y += 0.05;
    if (col.raycast(_o, UPV, 1.25, { dynamic: false })) return false;
    // path clear at head height over the ledge
    _o.set(this.position.x, top.point.y + 0.35, this.position.z);
    const blk = col.raycast(_o, _v, probe + 0.3, { dynamic: false });
    if (blk) return false;

    const start = this.position.clone();
    let end, vault = false;
    if (ledge < 1.15) {
      // vault if the obstacle is thin: look for ground beyond
      const beyond = wallDist + 1.1;
      _o.set(this.position.x + fx * beyond, top.point.y + 0.3, this.position.z + fz * beyond);
      const land = col.raycast(_o, DOWN, 3, { dynamic: false });
      _o2.set(this.position.x + fx * (wallDist + 0.05), top.point.y + 0.3, this.position.z + fz * (wallDist + 0.05));
      const across = col.raycast(_o2, _v, 1.05, { dynamic: false });
      if (land && land.point.y < top.point.y - 0.35 && !across) {
        vault = true;
        end = new THREE.Vector3(this.position.x + fx * (beyond + 0.2), land.point.y, this.position.z + fz * (beyond + 0.2));
      }
    }
    if (!end) end = new THREE.Vector3(this.position.x + fx * (wallDist + this.radius + 0.12), top.point.y, this.position.z + fz * (wallDist + this.radius + 0.12));
    const dur = vault ? 0.5 : 0.32 + ledge * 0.28;
    this._mantle = { start, end, topY: top.point.y, t: 0, dur, vault, ledge };
    this.mantling = true; this.sliding = false; this._stopSprint();
    this.velocity.set(0, 0, 0);
    this.onGround = false;
    g.events.emit('player:mantle', { height: ledge, vault });
    return true;
  }

  _updateMantle(dt) {
    const m = this._mantle;
    m.t += dt / m.dur;
    const t = Math.min(1, m.t);
    const p = this.position;
    if (m.vault) {
      // arc over the obstacle
      const hx = smooth(t);
      p.x = m.start.x + (m.end.x - m.start.x) * hx;
      p.z = m.start.z + (m.end.z - m.start.z) * hx;
      const peak = m.topY + 0.18;
      const y0 = m.start.y, y1 = m.end.y;
      const a = t < 0.45 ? smooth(t / 0.45) : 1 - smooth((t - 0.45) / 0.55);
      p.y = t < 0.45 ? y0 + (peak - y0) * a : y1 + (peak - y1) * a;
    } else {
      const ty = smooth(clamp(t / 0.7, 0, 1));
      const tx = smooth(clamp((t - 0.35) / 0.65, 0, 1));
      p.y = m.start.y + (m.topY + 0.02 - m.start.y) * ty;
      p.x = m.start.x + (m.end.x - m.start.x) * tx;
      p.z = m.start.z + (m.end.z - m.start.z) * tx;
    }
    if (m.t >= 1) {
      this._mantle = null; this.mantling = false;
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      if (m.vault) { this.velocity.set(fx * 4.5, -1, fz * 4.5); this.onGround = false; this._prevVy = -3; }
      else { this.velocity.set(fx * 1.5, 0, fz * 1.5); this.onGround = true; }
      this._collide();
      this._groundCheck(dt);
      this._landV -= 0.5;
    }
  }

  /* ------------------------------------------------------------------ camera */

  _post(dt, f, r) {
    const g = this.game;
    // eye height smoothing
    const eyeTarget = this.sliding ? SLIDE_EYE : STANCES[this.stance].eye;
    this._eye = damp(this._eye, eyeTarget, this.sliding ? 12 : 9, dt);
    this.eyeHeight = this._eye;
    this._stepOff = damp(this._stepOff, 0, 14, dt);

    // head bob / footsteps
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    this.moveSpeed01 = Math.min(1, hs / SPRINT_SPEED);
    const grounded = this.onGround && !this.sliding && !this._mantle;
    this._bobBlend = damp(this._bobBlend, grounded ? clamp(hs / 3.5, 0, 1) : 0, 8, dt);
    this._sprintBlend = damp(this._sprintBlend, this.sprinting ? (this.tacSprinting ? 1.4 : 1) : 0, 6, dt);
    if (grounded && hs > 0.4) {
      const stride = this.stance === 'prone' ? 0.9 : this.stance === 'crouch' ? 1.25 : this.tacSprinting ? 2.55 : this.sprinting ? 2.3 : 1.85;
      this._bobPhase += (hs * dt / stride) * Math.PI;
      const idx = Math.floor(this._bobPhase / Math.PI);
      if (idx !== this._stepIndex) {
        this._stepIndex = idx;
        const inten = this.stance === 'prone' ? 0.15 : this.stance === 'crouch' ? 0.35 : this.aiming ? 0.45 : this.tacSprinting ? 1.2 : this.sprinting ? 1.0 : 0.7;
        g.events.emit('player:footstep', { surface: this.groundSurface, intensity: inten });
      }
    }

    // landing spring
    const k = 170, c = 15;
    this._landV += (-k * this._landY - c * this._landV) * dt;
    this._landY += this._landV * dt;
    this._pitchKickV += (-120 * this._pitchKick - 13 * this._pitchKickV) * dt;
    this._pitchKick += this._pitchKickV * dt;

    // strafe roll
    const rightVel = this.velocity.x * Math.cos(this.yaw) - this.velocity.z * Math.sin(this.yaw);
    this._roll = damp(this._roll, clamp(-rightVel * 0.0055, -0.035, 0.035), 7, dt);
    this._slideTilt = damp(this._slideTilt, this.sliding ? 1 : 0, this.sliding ? 7 : 5, dt);
    this._lean = this.leaning;
    this._trauma = Math.max(0, this._trauma - dt * 1.4);

    this.applyCamera(dt);
  }

  /** Writes camera transform from current state + filters. Safe to call from shot setups. */
  applyCamera() {
    const g = this.game, cam = g.camera, t = g.time;
    const ads = g.weapons?.adsAmount ?? (this.aiming ? 1 : 0);
    const bobScale = this._bobBlend * (1 - 0.8 * ads) * (this.stance === 'crouch' ? 0.65 : this.stance === 'prone' ? 0.5 : 1);
    const sb = 1 + this._sprintBlend * 0.9;
    const ph = this._bobPhase;
    const bobV = (Math.abs(Math.sin(ph)) - 0.5) * 0.034 * sb * bobScale;
    const bobL = Math.sin(ph) * 0.022 * sb * bobScale;
    const bobRoll = Math.sin(ph) * 0.006 * sb * bobScale;
    const bobPitch = (Math.abs(Math.cos(ph)) - 0.5) * 0.006 * sb * bobScale;

    // shake (noise-ish)
    const tr = this._trauma * this._trauma;
    const n1 = Math.sin(t * 37.1) * 0.6 + Math.sin(t * 61.7 + 1.3) * 0.4;
    const n2 = Math.sin(t * 41.3 + 2.1) * 0.6 + Math.sin(t * 73.9 + 0.4) * 0.4;
    const n3 = Math.sin(t * 29.3 + 4.2) * 0.6 + Math.sin(t * 57.1 + 3.3) * 0.4;

    const cyw = Math.cos(this.yaw), syw = Math.sin(this.yaw);
    const lat = bobL + this._lean * 0.38;
    let eye = this._eye + this._stepOff + this._landY * 0.12 + bobV;
    let deathRoll = 0;
    if (this.dead) {
      const d = smooth(clamp(this._deathT / 0.9, 0, 1));
      eye = this._eye * (1 - d) + 0.25 * d;
      deathRoll = d * 1.1;
    }
    cam.position.set(this.position.x + cyw * lat, this.position.y + eye, this.position.z - syw * lat);

    let pitch = this.pitch + this.recoilPitch + bobPitch + this._pitchKick * 0.04 + tr * n1 * 0.035;
    const yaw = this.yaw + this.recoilYaw + tr * n2 * 0.03;
    let roll = this._roll + bobRoll + this._slideTilt * 0.13 * (this._slideDir || 1) - this._lean * 0.16 + tr * n3 * 0.05 + deathRoll;
    if (this._mantle) {
      const m = this._mantle, s = Math.sin(Math.min(1, m.t) * Math.PI);
      pitch += (m.vault ? -0.06 : -0.12) * s; roll += (m.vault ? 0.1 : 0.05) * s;
    }
    if (this.dead) pitch = pitch * (1 - Math.min(1, this._deathT)) - 0.3 * Math.min(1, this._deathT);
    cam.rotation.set(clamp(pitch, -1.56, 1.56), yaw, roll, 'YXZ');
  }

  /* ------------------------------------------------------------------ death */

  _die() {
    this.dead = true; this._deathT = 0; this.respawnIn = RESPAWN_TIME; this.deaths++;
    this.sliding = false; this._mantle = null; this.mantling = false; this._stopSprint();
    this.velocity.set(0, 0, 0);
    this.game.events.emit('player:died', {});
  }

  _updateDeath(dt) {
    this._deathT += dt;
    this.respawnIn = Math.max(0, RESPAWN_TIME - this._deathT);
    this._trauma = Math.max(0, this._trauma - dt);
    if (this.respawnIn <= 0 || (this._deathT > 1.5 && this.game.input.mouse.leftPressed)) this.respawn();
  }

  /** Deterministic pose for screenshot shots. state: 'slide'|'stand'|'crouch'|'prone'. */
  poseForShot(pose) {
    const { feet, yaw, pitch = 0, state = 'stand', lean = 0, bob = 0 } = pose;
    this._shotPose = pose;
    this.position.set(feet[0], feet[1], feet[2]); this.velocity.set(0, 0, 0);
    this.yaw = yaw; this.pitch = pitch;
    this.sliding = state === 'slide';
    const st = state === 'slide' ? 'crouch' : state;
    this._setStance(st, true);
    this._eye = this.sliding ? SLIDE_EYE : STANCES[st].eye; this.eyeHeight = this._eye;
    this._slideTilt = this.sliding ? 1 : 0; this._slideDir = 1;
    this._stepOff = 0; this._landY = 0; this._pitchKick = 0; this._trauma = 0; this._roll = this.sliding ? -0.02 : 0;
    this._lean = this.leaning = lean;
    this._bobBlend = bob; this._bobPhase = Math.PI * 0.5;
    this.applyCamera();
  }
}

const _o2 = new THREE.Vector3();
