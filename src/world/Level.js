import * as THREE from 'three';
import { Batch, proxyBox, rng } from './level/geom.js';
import { registerLevelMaterials } from './level/levelMaterials.js';
import { buildLayout } from './level/layout.js';
import { buildNav } from './level/nav.js';

/**
 * Map geometry: "Operation Nightfall" — an industrial-town intersection (~120x120 m playable).
 * Static geometry is merged per material (Batch), repeats (grass, leaves, debris) are InstancedMesh.
 * Exposes playerSpawn, enemySpawns, coverPoints [{position, facing, height}], navPoints {points, links}.
 * Axis convention: north = -Z. Player side south (+Z), enemy side north (-Z).
 */
export class Level {
  constructor(game) {
    this.game = game;
    const root = new THREE.Group(); root.name = 'level'; game.scene.add(root);
    this.root = root;
    const batch = new Batch(game); registerLevelMaterials(batch);
    const inst = new Map();
    const ctx = this.ctx = {
      game, batch, root,
      footprints: [], obbs: [], segments: [], covers: [], navExtra: [], facades: [],
      addFootprint: (x0, x1, z0, z1, h) => ctx.footprints.push({ x0, x1, z0, z1, h }),
      addObb: (x, z, hw, hd, yaw, h, cover = h > 0.6 && h < 1.6) => {
        ctx.obbs.push({ x, z, hw, hd, yaw, h });
        if (cover) {
          const c = Math.cos(yaw), s = Math.sin(yaw);
          // local x axis in world = (c, 0, -s); local z = (s, 0, c)
          const ax = new THREE.Vector3(c, 0, -s), az = new THREE.Vector3(s, 0, c);
          for (const sg of [-1, 1]) {
            const n = az.clone().multiplyScalar(sg);
            const nAlong = Math.max(1, Math.round(hw * 2 / 2.2));
            for (let k = 0; k < nAlong; k++) {
              const t = nAlong === 1 ? 0 : (k / (nAlong - 1) - 0.5) * (hw * 2 - 0.8);
              const p = new THREE.Vector3(x, 0, z).addScaledVector(ax, t).addScaledVector(n, hd + 0.55);
              ctx.covers.push({ position: p, facing: n.clone().negate(), height: 'low' });
            }
          }
        }
      },
      addSegment: (a, b, h) => ctx.segments.push({ a, b, h }),
      addCover: (position, facing, height = 'low') => ctx.covers.push({ position, facing: facing.clone().normalize(), height }),
      addNavElevated: (chains) => ctx.navExtra.push(...chains),
      proxy: (w, h, d, m, surface) => proxyBox(root, w, h, d, m, surface),
      ramp: (w, len, m) => proxyBox(root, w, 0.12, len, m, 'concrete'),
      inst: (kind, m) => { if (!inst.has(kind)) inst.set(kind, []); inst.get(kind).push(m); },
    };

    const t0 = performance.now();
    const out = buildLayout(ctx);
    const t1 = performance.now();
    batch.build(root);
    this._buildInstances(inst, batch);

    this.playerSpawn = out.playerSpawn;
    this.enemySpawns = out.enemySpawns;
    this.coverPoints = ctx.covers.filter((c) => !this._blocked(c.position.x, c.position.z, 0.3));
    this.navPoints = buildNav(ctx, this);
    this.bounds = { minX: -60, maxX: 60, minZ: -64, maxZ: 64 };
    this.stats = { meshes: batch.meshes.length, instanced: inst.size };
    let tris = 0; root.traverse((o) => { if (o.isMesh && o.visible && o.geometry.index) tris += o.geometry.index.count / 3 * (o.count || 1); });
    console.log(`[level] layout ${(t1 - t0) | 0}ms merge ${(performance.now() - t1) | 0}ms meshes ${this.stats.meshes} tris ${(tris / 1000) | 0}k nav ${this.navPoints.points.length}/${this.navPoints.links.length} cover ${this.coverPoints.length}`);
  }

  /** true if 2D point is inside a building footprint / obstacle (inflated by pad). */
  _blocked(x, z, pad = 0.4) {
    const c = this.ctx;
    for (const f of c.footprints) if (x > f.x0 - pad && x < f.x1 + pad && z > f.z0 - pad && z < f.z1 + pad) return true;
    for (const o of c.obbs) {
      const dx = x - o.x, dz = z - o.z, cs = Math.cos(o.yaw), sn = Math.sin(o.yaw);
      const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
      if (Math.abs(lx) < o.hw + pad && Math.abs(lz) < o.hd + pad) return true;
    }
    for (const s of c.segments) {
      const ax = s.a[0], az = s.a[1], bx = s.b[0], bz = s.b[1];
      const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
      if (Math.hypot(ax + vx * t - x, az + vz * t - z) < pad + 0.15) return true;
    }
    return false;
  }

  _buildInstances(inst, batch) {
    const make = (kind, geo, material, { shadow = false } = {}) => {
      const list = inst.get(kind); if (!list || !list.length) return;
      const im = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true; im.castShadow = shadow; im.receiveShadow = true;
      im.computeBoundingSphere(); im.name = 'lvl:inst:' + kind;
      this.root.add(im);
    };
    // crossed grass tuft
    const tuft = (() => {
      const a = new THREE.PlaneGeometry(0.9, 0.55); a.translate(0, 0.27, 0);
      const b = a.clone().rotateY(Math.PI / 3), c = a.clone().rotateY(-Math.PI / 3);
      const g = mergeSimple([a, b, c]);
      // bend normals upward for softer lighting
      const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 1, n.getZ(i) * 0.3);
      g.normalizeNormals?.(); return g;
    })();
    make('grass', tuft, batch.material('grass_card'));
    make('grassDry', tuft, batch.material('grass_dry'));
    const leaf = new THREE.PlaneGeometry(1.4, 1.4);
    make('leaf', leaf, batch.material('leaf_card'), { shadow: true });
    const deb = new THREE.DodecahedronGeometry(0.1, 0); deb.scale(1, 0.55, 1);
    make('debris', deb, batch.material('rubble'));
    const brick = new THREE.BoxGeometry(0.25, 0.065, 0.12);
    make('brick', brick, batch.material('brick'));
    const paper = new THREE.PlaneGeometry(0.25, 0.3); paper.rotateX(-Math.PI / 2); paper.translate(0, 0.01, 0);
    make('paper', paper, batch.material('plaster', 0xe0dcd0));
    const casing = new THREE.CylinderGeometry(0.006, 0.006, 0.045, 5); casing.rotateZ(Math.PI / 2);
    make('casing', casing, batch.material('metal_bare', 0xc8a050));
  }
}

function mergeSimple(geos) {
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = [];
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2);
    for (const i of g.index.array) idx.push(i + o);
    o += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); return g;
}
