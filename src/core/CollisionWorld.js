import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

/**
 * Static world collision. Any mesh added to the scene with
 *   mesh.userData.collider = true
 *   mesh.userData.surface = 'concrete' | 'metal' | 'wood' | 'dirt' | 'glass' | ...
 * is baked into one BVH when build() runs (after Level construction).
 * Dynamic hittables (enemies) register via addDynamic(object3D) — each needs
 * userData.hittable = true and a raycastable mesh hierarchy.
 */
export class CollisionWorld {
  constructor(game) {
    this.game = game;
    this.dynamic = new Set();
    this.bvh = null;
    this.mesh = null;
    this.surfaceByTri = null;
  }

  build() {
    const geos = []; const surfaces = [];
    this.game.scene.updateMatrixWorld(true);
    this.game.scene.traverse((o) => {
      if (!o.isMesh || !o.userData.collider) return;
      let g = o.geometry.clone();
      g = g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
      g.applyMatrix4(o.matrixWorld);
      geos.push(g);
      surfaces.push({ count: g.attributes.position.count / 3, surface: o.userData.surface || 'concrete' });
    });
    if (!geos.length) return;
    const merged = mergeGeometries(geos, false);
    this.surfaceByTri = new Uint8Array(merged.attributes.position.count / 3);
    this.surfaceNames = [];
    let t = 0;
    for (const s of surfaces) {
      let id = this.surfaceNames.indexOf(s.surface); if (id < 0) { id = this.surfaceNames.length; this.surfaceNames.push(s.surface); }
      this.surfaceByTri.fill(id, t, t + s.count); t += s.count;
    }
    this.bvh = new MeshBVH(merged);
    merged.boundsTree = this.bvh;
    this.mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial());
    this.geometry = merged;
  }

  /** Surface name for a BVH faceIndex (MeshBVH reorders the index buffer, so map back to the original triangle). */
  surfaceAt(faceIndex) {
    const idx = this.geometry?.index;
    const tri = idx ? Math.floor(idx.getX(faceIndex * 3) / 3) : faceIndex;
    return this.surfaceNames[this.surfaceByTri[tri]];
  }

  addDynamic(obj) { this.dynamic.add(obj); }
  removeDynamic(obj) { this.dynamic.delete(obj); }

  /** Raycast against world + dynamic hittables. Returns nearest hit or null. */
  raycast(origin, dir, far = 1000, { ignore = null, dynamic = true } = {}) {
    const ray = new THREE.Ray(origin, dir);
    let best = null;
    if (this.bvh) {
      const h = this.bvh.raycastFirst(ray, THREE.DoubleSide);
      if (h && h.distance <= far) {
        best = { point: h.point, normal: h.face.normal.clone(), distance: h.distance, surface: this.surfaceAt(h.faceIndex), object: null };
      }
    }
    if (dynamic && this.dynamic.size) {
      const rc = new THREE.Raycaster(origin, dir, 0, best ? best.distance : far);
      for (const obj of this.dynamic) {
        if (obj === ignore || !obj.visible) continue;
        const hits = rc.intersectObject(obj, true);
        for (const h of hits) {
          if (!h.object.userData.hitbox && !h.object.isMesh) continue;
          if (!best || h.distance < best.distance) {
            const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : dir.clone().negate();
            best = { point: h.point, normal: n, distance: h.distance, surface: 'flesh', object: obj, part: h.object.userData.part || 'body' };
          }
          break;
        }
      }
    }
    return best;
  }

  /**
   * Resolve a capsule (segment start/end + radius) against static world.
   * Mutates segment in place and returns the total push vector.
   */
  resolveCapsule(segStart, segEnd, radius) {
    const push = new THREE.Vector3();
    if (!this.bvh) return push;
    const box = new THREE.Box3().setFromPoints([segStart, segEnd]).expandByScalar(radius);
    const line = new THREE.Line3(segStart.clone(), segEnd.clone());
    const triPoint = new THREE.Vector3(), capPoint = new THREE.Vector3();
    this.bvh.shapecast({
      intersectsBounds: (b) => b.intersectsBox(box),
      intersectsTriangle: (tri) => {
        const dist = tri.closestPointToSegment(line, triPoint, capPoint);
        if (dist < radius) {
          const depth = radius - dist;
          const dir = capPoint.sub(triPoint).normalize();
          line.start.addScaledVector(dir, depth);
          line.end.addScaledVector(dir, depth);
        }
      },
    });
    push.subVectors(line.start, segStart);
    segStart.copy(line.start); segEnd.copy(line.end);
    return push;
  }
}
