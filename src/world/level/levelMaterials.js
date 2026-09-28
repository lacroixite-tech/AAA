import * as THREE from 'three';
import * as T from './textures.js';

/** Level-owned special materials (decals, alpha cards, signage). Registered on the Batch by name. */
export function registerLevelMaterials(batch) {
  const decal = (color, alphaMap, extra = {}) => new THREE.MeshStandardMaterial({
    color, alphaMap, transparent: true, depthWrite: false, roughness: 1, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, ...extra,
  });
  const R = (n, m) => batch.register(n, m);
  R('decal_streak', decal(0x17130f, T.streakTex(5), { opacity: 0.85 }));
  R('decal_streak_rust', decal(0x4a2412, T.streakTex(6), { opacity: 0.7 }));
  R('decal_soot', decal(0x080706, T.sootTex(), { opacity: 0.95 }));
  R('decal_stain', decal(0x14120f, T.stainTex(3), { opacity: 0.75 }));
  R('decal_oil', decal(0x050505, T.stainTex(4), { roughness: 0.3, opacity: 0.8 }));
  R('decal_dirt', decal(0x3a3024, T.stainTex(7), { opacity: 1 }));
  R('pavers', decal(0x2a2622, T.paverTex(), { opacity: 0.85 }));
  R('paint_white', decal(0xc9c6bb, T.paintWear(), { opacity: 0.8, roughness: 0.8 }));
  R('paint_yellow', decal(0xb8962e, T.paintWear(), { opacity: 0.75, roughness: 0.8 }));
  R('puddle', new THREE.MeshStandardMaterial({
    color: 0x030405, roughness: 0.04, metalness: 0.0, alphaMap: T.puddleTex(9), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, envMapIntensity: 0.9,
  }));
  for (let i = 0; i < 6; i++) R('curtain' + i, new THREE.MeshStandardMaterial({ map: T.curtainTex(i), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95 }));
  for (let i = 0; i < T.SIGN_COUNT; i++) R('sign' + i, new THREE.MeshStandardMaterial({ map: T.signTex(i), roughness: 0.7, metalness: 0.1 }));
  R('poster', new THREE.MeshStandardMaterial({ map: T.posterTex(), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, transparent: true, depthWrite: false }));
  R('graffiti', new THREE.MeshStandardMaterial({ map: T.graffitiTex(), transparent: true, depthWrite: false, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  R('chainlink', new THREE.MeshStandardMaterial({ color: 0x8a8c88, alphaMap: T.chainlinkTex(), alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.7, roughness: 0.5 }));
  R('wiregrid', new THREE.MeshStandardMaterial({ color: 0x6a6a62, alphaMap: T.gridTex(), alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.6 }));
  R('grass_card', new THREE.MeshStandardMaterial({ map: T.grassTex(false), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9 }));
  R('grass_dry', new THREE.MeshStandardMaterial({ map: T.grassTex(true), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9 }));
  R('leaf_card', new THREE.MeshStandardMaterial({ map: T.leafTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 }));
  for (const [i, c] of [0x3a4a3a, 0x5a3a2a, 0x2e3440].entries()) R('railing' + i, new THREE.MeshStandardMaterial({ color: c, map: T.railingTex(), alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.55 }));
  R('void', new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 1 }));
  R('backdrop', new THREE.MeshStandardMaterial({ color: 0x8a8278, map: T.backdropWindowTex(), roughness: 1 }));
  R('backdrop_plain', new THREE.MeshStandardMaterial({ color: 0x6e6862, roughness: 1 }));
  R('lamp_glass', new THREE.MeshStandardMaterial({ color: 0xd8d0b8, roughness: 0.3, emissive: 0x000000 }));
}
