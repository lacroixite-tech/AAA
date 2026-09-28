import * as THREE from 'three';

// Lighting/post review poses. Sun: azimuth 200deg (ahead-left when looking down -Z), elevation ~14.5deg.
// When the level is still sparse, a few test props are added so shadow contact/penumbra can be judged.
function testProps(game) {
  if (game.__lightingProps) return;
  game.__lightingProps = true;
  let n = 0; game.scene.traverse((o) => { if (o.isMesh) n++; });
  if (n > 60) return; // real level present
  const m = game.materials;
  const g = new THREE.Group(); g.name = 'lightingTestProps'; g.position.set(36, 0, 0);
  const add = (geo, mat, x, y, z, ry = 0) => {
    const mesh = new THREE.Mesh(geo, m.get(mat)); mesh.position.set(x, y, z); mesh.rotation.y = ry;
    mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh;
  };
  add(new THREE.BoxGeometry(1, 1, 1), 'wood', 2, 0.5, 8, 0.4);
  add(new THREE.BoxGeometry(0.8, 0.8, 0.8), 'wood', 2.3, 1.4, 8.1, 0.1);
  for (let i = 0; i < 6; i++) {
    const s = add(new THREE.CapsuleGeometry(0.2, 0.55, 4, 10), 'dirt', -3 + i * 0.62, 0.2 + (i % 2) * 0.0, 8);
    s.rotation.z = Math.PI / 2; s.scale.set(1, 1, 1.4);
  }
  for (let i = 0; i < 5; i++) { const s = add(new THREE.CapsuleGeometry(0.2, 0.55, 4, 10), 'dirt', -2.7 + i * 0.62, 0.58, 8); s.rotation.z = Math.PI / 2; s.scale.set(1, 1, 1.4); }
  add(new THREE.CylinderGeometry(0.1, 0.14, 9, 10), 'wood', 4.5, 4.5, 3);
  add(new THREE.BoxGeometry(1.8, 0.1, 0.12), 'wood', 4.5, 8.3, 3);
  // car-ish
  add(new THREE.BoxGeometry(1.8, 0.75, 4.3), 'metal', -5, 0.62, 2, 0.3);
  add(new THREE.BoxGeometry(1.6, 0.6, 2.2), 'metal', -5.1, 1.3, 2.2, 0.3);
  // a facade with recessed windows
  const wall = add(new THREE.BoxGeometry(12, 9, 0.5), 'brick', 9, 4.5, 6, -Math.PI / 2);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    add(new THREE.BoxGeometry(1.4, 0.12, 0.35), 'concrete', 8.6, 1.8 + j * 3.2, 2 + i * 3.8, -Math.PI / 2);
  }
  wall.name = 'testFacade';
  game.scene.add(g);
}

export default {
  light_golden: { pos: [0, 1.65, 22], yaw: 0.349, pitch: 0.06, setup: (g) => testProps(g) },
  light_away: { pos: [-3, 1.65, -28], yaw: 0.349 + Math.PI, pitch: -0.04, setup: (g) => testProps(g) },
  light_shadow_detail: { pos: [30.5, 1.55, 10.2], yaw: -1.35, pitch: -0.38, setup: (g) => testProps(g) },
  light_ao: { pos: [30.5, 1.55, 10.2], yaw: -1.35, pitch: -0.38, setup: (g) => { testProps(g); g.post.debugView = 'ao'; } },
  light_sky: { pos: [0, 1.65, 22], yaw: 0.349 + 1.2, pitch: 0.35, setup: (g) => testProps(g) },
};
