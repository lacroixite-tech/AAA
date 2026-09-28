import * as THREE from 'three';
/** Weapons + first-person viewmodel. Owner: weapons agent. Emits 'weapon:fire', 'hit'. */
export class WeaponSystem {
  constructor(game) {
    this.game = game;
    this.ammo = 30; this.reserve = 120; this.cooldown = 0;
    const vm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.5), new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6, roughness: 0.4 }));
    vm.position.set(0.15, -0.14, -0.35);
    game.camera.add(vm); this.viewmodel = vm;
  }
  update(dt) {
    const g = this.game;
    this.cooldown -= dt;
    g.player.aiming = g.input.mouse.right;
    if (g.input.mouse.left && this.cooldown <= 0 && this.ammo > 0) {
      this.cooldown = 0.08; this.ammo--;
      const origin = g.camera.getWorldPosition(new THREE.Vector3());
      const dir = g.camera.getWorldDirection(new THREE.Vector3());
      g.events.emit('weapon:fire', { origin, dir });
      const hit = g.collision.raycast(origin, dir, 500);
      if (hit) g.events.emit('hit', { ...hit, dir, damage: 30 });
    }
    if (g.input.wasPressed('KeyR')) { const n = Math.min(30 - this.ammo, this.reserve); this.ammo += n; this.reserve -= n; }
  }
}
