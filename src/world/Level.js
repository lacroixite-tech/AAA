import * as THREE from 'three';
/** Map geometry. Owner: level agent. Colliders need userData.collider/surface. Provides spawn points. */
export class Level {
  constructor(game) {
    this.game = game;
    const m = game.materials;
    const add = (geo, mat, x, y, z, surface) => {
      const mesh = new THREE.Mesh(geo, m.get(mat));
      mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.collider = true; mesh.userData.surface = surface || mat;
      game.scene.add(mesh); return mesh;
    };
    add(new THREE.BoxGeometry(200, 1, 200), 'asphalt', 0, -0.5, 0);
    for (let i = 0; i < 12; i++) add(new THREE.BoxGeometry(4, 6, 4), 'concrete', (i % 4) * 14 - 21, 3, Math.floor(i / 4) * 14 - 14);
    this.playerSpawn = { position: new THREE.Vector3(0, 0, 20), yaw: 0 };
    this.enemySpawns = [new THREE.Vector3(-10, 0, -20), new THREE.Vector3(10, 0, -25), new THREE.Vector3(0, 0, -35)];
  }
}
