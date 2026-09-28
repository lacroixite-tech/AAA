import * as THREE from 'three';
/** Material library. Owner: materials agent. Provides get(name) -> THREE.Material. */
export class Materials {
  constructor(game) {
    this.game = game;
    this.lib = {
      concrete: new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.9 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.4, metalness: 0.9 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.8 }),
      dirt: new THREE.MeshStandardMaterial({ color: 0x5a4a38, roughness: 1 }),
      brick: new THREE.MeshStandardMaterial({ color: 0x7a4032, roughness: 0.9 }),
      asphalt: new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.95 }),
    };
  }
  get(name) { return this.lib[name] || this.lib.concrete; }
}
