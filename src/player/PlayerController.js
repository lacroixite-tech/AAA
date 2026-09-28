import * as THREE from 'three';
/**
 * First-person movement. Owner: player agent.
 * Public state read by others: position (feet), velocity, yaw, pitch, onGround,
 * sprinting, crouching, aiming (ADS, set by weapons), health, eyeHeight, moveSpeed01.
 */
export class PlayerController {
  constructor(game) {
    this.game = game;
    const sp = game.level.playerSpawn;
    this.position = sp.position.clone();
    this.velocity = new THREE.Vector3();
    this.yaw = sp.yaw; this.pitch = 0;
    this.radius = 0.35; this.height = 1.8; this.eyeHeight = 1.65;
    this.onGround = false; this.sprinting = false; this.crouching = false; this.aiming = false;
    this.health = 100; this.moveSpeed01 = 0;
  }
  update(dt) {
    const g = this.game, inp = g.input;
    const sens = 0.0022 * (this.aiming ? 0.6 : 1);
    this.yaw -= inp.mouse.dx * sens; this.pitch -= inp.mouse.dy * sens;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    const f = (inp.down('KeyW') ? 1 : 0) - (inp.down('KeyS') ? 1 : 0);
    const r = (inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0);
    this.sprinting = inp.down('ShiftLeft') && f > 0 && !this.aiming;
    const speed = this.sprinting ? 7 : this.aiming ? 2.8 : 4.6;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = fwd.multiplyScalar(f).add(right.multiplyScalar(r));
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
    const accel = this.onGround ? 12 : 2;
    this.velocity.x += (wish.x - this.velocity.x) * Math.min(1, accel * dt);
    this.velocity.z += (wish.z - this.velocity.z) * Math.min(1, accel * dt);
    this.velocity.y -= 20 * dt;
    if (this.onGround && inp.wasPressed('Space')) this.velocity.y = 6.5;
    this.position.addScaledVector(this.velocity, dt);
    const a = this.position.clone().add(new THREE.Vector3(0, this.radius, 0));
    const b = this.position.clone().add(new THREE.Vector3(0, this.height - this.radius, 0));
    const push = g.collision.resolveCapsule(a, b, this.radius);
    this.position.add(push);
    this.onGround = push.y > 0.001 && push.y > Math.abs(push.x) + Math.abs(push.z) - 0.001;
    if (this.onGround && this.velocity.y < 0) this.velocity.y = 0;
    this.moveSpeed01 = Math.min(1, Math.hypot(this.velocity.x, this.velocity.z) / 7);
    const cam = g.camera;
    cam.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
