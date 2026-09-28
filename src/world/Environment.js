import * as THREE from 'three';
/** Sky, sun, fog, IBL. Owner: lighting agent. */
export class Environment {
  constructor(game) {
    const s = game.scene;
    s.background = new THREE.Color(0x9fb4c8);
    s.fog = new THREE.Fog(0x9fb4c8, 30, 300);
    s.add(new THREE.HemisphereLight(0xbfd4ff, 0x3a3020, 0.8));
    const sun = new THREE.DirectionalLight(0xfff0dd, 3);
    sun.position.set(40, 60, 20); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 200 });
    s.add(sun); this.sun = sun;
  }
  update() {}
}
