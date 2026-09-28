import * as THREE from 'three';
/** Enemy soldiers. Owner: ai agent. Listens to 'hit' where hit.object is an enemy root. */
export class EnemyManager {
  constructor(game) {
    this.game = game; this.enemies = [];
    for (const p of game.level.enemySpawns) {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1), new THREE.MeshStandardMaterial({ color: 0x4a5a3a }));
      m.position.copy(p).add(new THREE.Vector3(0, 0.9, 0)); m.castShadow = true;
      m.userData.hittable = true; m.userData.health = 100;
      game.scene.add(m); game.collision.addDynamic(m); this.enemies.push(m);
    }
    game.events.on('hit', (h) => { if (h.object && this.enemies.includes(h.object)) { h.object.userData.health -= h.damage; if (h.object.userData.health <= 0) { h.object.visible = false; game.events.emit('enemy:killed', { enemy: h.object }); } } });
  }
  update() {}
}
