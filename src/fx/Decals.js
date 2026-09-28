import * as THREE from 'three';

/**
 * Projected decal quads (bullet holes, blood, scorch) as ONE InstancedMesh with a per-instance atlas tile.
 * PBR: albedo+alpha, tangent-space normal map, roughness/metalness map; receives shadows.
 * Ring-buffer pool (oldest recycled). Corners are validated against the collision BVH so holes don't
 * hang over edges.
 */
const _q = new THREE.Quaternion(); const _q2 = new THREE.Quaternion(); const _m = new THREE.Matrix4();
const _z = new THREE.Vector3(0, 0, 1); const _s = new THREE.Vector3(); const _p = new THREE.Vector3();
const _t = new THREE.Vector3(); const _b = new THREE.Vector3(); const _ray = new THREE.Ray();

export class Decals {
  constructor(fx, tex, max = 256) {
    this.fx = fx; this.game = fx.game; this.max = max; this.next = 0; this.count = 0;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.aTile = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); // col,row,alpha
    this.aTile.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aTile', this.aTile);
    const mat = new THREE.MeshStandardMaterial({
      map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.ormMap, metalnessMap: tex.ormMap,
      roughness: 1, metalness: 1, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, normalScale: new THREE.Vector2(1.6, 1.6),
    });
    mat.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aTile;\nvarying float vDecalA;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          vec2 tUv = (aTile.xy + uv) * 0.25; vDecalA = aTile.z;
          #ifdef USE_MAP
          vMapUv = tUv;
          #endif
          #ifdef USE_NORMALMAP
          vNormalMapUv = tUv;
          #endif
          #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = tUv;
          #endif
          #ifdef USE_METALNESSMAP
          vMetalnessMapUv = tUv;
          #endif`);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vDecalA;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.a *= vDecalA;');
    };
    mat.customProgramCacheKey = () => 'fx-decal';
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.mesh.renderOrder = 5;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fx.root.add(this.mesh);
    this.ages = new Float32Array(max); this.lifes = new Float32Array(max).fill(1e9);
  }

  _hits(point, normal, dist) {
    const col = this.game.collision; if (!col?.bvh) return true;
    _ray.origin.copy(point).addScaledVector(normal, 0.04); _ray.direction.copy(normal).negate();
    const h = col.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, 0.04 + dist);
    return !!h && Math.abs(h.face.normal.dot(normal)) > 0.8;
  }

  /** Place a decal. tile: atlas index 0..15, size in meters. Returns false if it doesn't fit. */
  add(point, normal, tile, size, { rot = null, check = true, stretch = 1, life = 1e9, offset = 0.002 } = {}) {
    const R = this.fx.rand;
    const angle = rot ?? R() * Math.PI * 2;
    _q.setFromUnitVectors(_z, normal); _q2.setFromAxisAngle(normal, angle); _q.premultiply(_q2);
    if (check && size < 1.5) {
      _t.set(1, 0, 0).applyQuaternion(_q); _b.set(0, 1, 0).applyQuaternion(_q);
      let ok = true;
      for (const [a, b] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        _p.copy(point).addScaledVector(_t, a * size * 0.42).addScaledVector(_b, b * size * 0.42 * stretch);
        if (!this._hits(_p, normal, 0.05)) { ok = false; break; }
      }
      if (!ok) { size *= 0.45; if (size < 0.02) return false; }
    }
    const i = this.next; this.next = (this.next + 1) % this.max; this.count = Math.min(this.max, this.count + 1);
    _p.copy(point).addScaledVector(normal, offset + i * 0.000004);
    _s.set(size, size * stretch, 1);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    this.aTile.setXYZ(i, tile % 4, Math.floor(tile / 4), 1);
    this.ages[i] = 0; this.lifes[i] = life;
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true; this.aTile.needsUpdate = true;
    return true;
  }

  update(dt) {
    // fade decals with a finite life (blood drips etc.)
    let dirty = false;
    for (let i = 0; i < this.count; i++) {
      if (this.lifes[i] > 1e8) continue;
      this.ages[i] += dt; const a = Math.max(0, Math.min(1, (this.lifes[i] - this.ages[i]) / 2));
      this.aTile.setZ(i, a); dirty = true;
    }
    if (dirty) this.aTile.needsUpdate = true;
  }
}
