import * as THREE from 'three';
import { mulberry32 } from './rng.js';

/**
 * Instanced rigid "debris" bodies (concrete chunks, wood splinters, glass shards, brass shells).
 * Point-mass physics with tumbling rotation, bouncing off the static collision BVH.
 * One InstancedMesh per kind (4 draw calls total).
 */
const _ray = new THREE.Ray(); const _v = new THREE.Vector3(); const _n = new THREE.Vector3();
const _q = new THREE.Quaternion(); const _m = new THREE.Matrix4(); const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0); const _ax = new THREE.Vector3();

function chunkGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 0); const r = mulberry32(3);
  const pos = g.attributes.position; const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!map.has(key)) map.set(key, 0.6 + r() * 0.6);
    const s = map.get(key); pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 0.7, pos.getZ(i) * s);
  }
  g.computeVertexNormals(); return g;
}
function shardGeometry() {
  const g = new THREE.BufferGeometry();
  const v = [0, 0, 1, 0.8, 0, -0.6, -0.7, 0, -0.5];
  const t = 0.04; const P = [];
  const tri = (a, b, c) => P.push(...a, ...b, ...c);
  const A = [v[0], t, v[2]], B = [v[3], t, v[5]], C = [v[6], t, v[8]], A2 = [v[0], -t, v[2]], B2 = [v[3], -t, v[5]], C2 = [v[6], -t, v[8]];
  tri(A, B, C); tri(A2, C2, B2); tri(A, A2, B2); tri(A, B2, B); tri(B, B2, C2); tri(B, C2, C); tri(C, C2, A2); tri(C, A2, A);
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); return g;
}
function shellGeometry() {
  // 5.56 NATO-ish case, meters (slightly oversized for readability like in games); axis = +Y, mouth at top
  const k = 1.25;
  const pts = [[0, 0], [0.0047, 0], [0.0048, 0.0008], [0.0041, 0.0014], [0.0041, 0.0028], [0.0048, 0.0034], [0.0047, 0.036],
    [0.0032, 0.0405], [0.0031, 0.0455], [0.0027, 0.0455], [0.0027, 0.041]].map(([x, y]) => new THREE.Vector2(x * k, (y - 0.0225) * k));
  const g = new THREE.LatheGeometry(pts, 10); g.computeVertexNormals(); return g;
}

export class Debris {
  constructor(fx) {
    this.fx = fx; this.game = fx.game;
    const chunkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fb7b8, roughness: 0.04, metalness: 0.6, envMapIntensity: 1.5 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xd9a748, roughness: 0.26, metalness: 1.0, envMapIntensity: 1.3, emissive: 0x2a1a05 });
    const splinterGeo = new THREE.BoxGeometry(1, 1, 1);
    this.kinds = {
      chunk: this._make(chunkGeometry(), chunkMat, 320, true),
      splinter: this._make(splinterGeo, chunkMat, 128, true),
      shard: this._make(shardGeometry(), glassMat, 128, false),
      shell: this._make(shellGeometry(), brassMat, 96, false),
    };
  }

  _make(geo, mat, max, shadow) {
    const mesh = new THREE.InstancedMesh(geo, mat, max);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
    mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = shadow; mesh.receiveShadow = true;
    this.fx.root.add(mesh);
    const bodies = []; for (let i = 0; i < max; i++) bodies.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(), scale: new THREE.Vector3(1, 1, 1), color: new THREE.Color() });
    return { mesh, bodies, next: 0, max };
  }

  /** o: {kind, pos, vel, scale:Vector3|number, color:[r,g,b], life, rest, friction, spin, trail, gravity, event} */
  spawn(o) {
    const K = this.kinds[o.kind || 'chunk']; const R = this.fx.rand;
    // take a free slot, else recycle the oldest (ring)
    let b = null;
    for (let i = 0; i < K.max; i++) { const c = K.bodies[(K.next + i) % K.max]; if (!c.alive) { b = c; K.next = (K.next + i + 1) % K.max; break; } }
    if (!b) { b = K.bodies[K.next]; K.next = (K.next + 1) % K.max; }
    b.alive = true; b.age = 0; b.life = o.life ?? 4; b.sleep = false; b.bounces = 0;
    b.pos.copy(o.pos); b.vel.copy(o.vel);
    b.q.setFromEuler(new THREE.Euler(R() * 6.28, R() * 6.28, R() * 6.28));
    if (o.q) b.q.copy(o.q);
    const spin = o.spin ?? 20; b.w.set(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(spin * 2);
    if (o.w) b.w.copy(o.w);
    if (typeof o.scale === 'number') b.scale.setScalar(o.scale); else b.scale.copy(o.scale);
    b.radius = o.radius ?? Math.max(0.003, Math.min(b.scale.x, b.scale.y, b.scale.z) * 0.8);
    const c = o.color || [0.5, 0.5, 0.5]; b.color.setRGB(c[0], c[1], c[2]);
    b.rest = o.rest ?? 0.3; b.friction = o.friction ?? 0.6; b.gravity = o.gravity ?? 9.81; b.drag = o.drag ?? 0.15;
    b.trail = o.trail || null; b.trailT = 0; b.event = o.event || null; b.isShell = o.kind === 'shell';
    return b;
  }

  _cast(from, dir, far) {
    const col = this.game.collision;
    if (col && col.bvh) {
      _ray.origin.copy(from); _ray.direction.copy(dir);
      const h = col.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, far);
      if (h) { return { point: h.point, normal: h.face.normal, surface: (col.surfaceAt ? col.surfaceAt(h.faceIndex) : col.surfaceNames?.[col.surfaceByTri[h.faceIndex]]) || 'concrete', distance: h.distance }; }
      return null;
    }
    if (dir.y < 0 && from.y > 0) { const d = from.y / -dir.y; if (d <= far) return { point: from.clone().addScaledVector(dir, d), normal: _up, surface: 'asphalt', distance: d }; }
    return null;
  }

  update(dt, simulate) {
    for (const key in this.kinds) {
      const K = this.kinds[key]; const mesh = K.mesh; let n = 0;
      for (const b of K.bodies) {
        if (!b.alive) continue;
        if (simulate) {
          b.age += dt;
          if (b.age > b.life) { b.alive = false; continue; }
          if (!b.sleep) this._step(b, dt);
        }
        const fade = Math.min(1, (b.life - b.age) / 0.6);
        _s.copy(b.scale).multiplyScalar(Math.max(0.001, fade));
        _m.compose(b.pos, b.q, _s);
        mesh.setMatrixAt(n, _m); mesh.setColorAt(n, b.color); n++;
      }
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  _step(b, dt) {
    b.vel.y -= b.gravity * dt;
    b.vel.multiplyScalar(Math.exp(-b.drag * dt));
    const sp = b.vel.length(); const dist = sp * dt;
    if (dist > 1e-6) {
      _v.copy(b.vel).divideScalar(sp);
      const h = this._cast(b.pos, _v, dist + b.radius);
      if (h) {
        _n.copy(h.normal); if (_n.dot(_v) > 0) _n.negate();
        b.pos.copy(h.point).addScaledVector(_n, b.radius * 1.01);
        const vn = b.vel.dot(_n);
        b.vel.addScaledVector(_n, -(1 + b.rest) * vn);
        // tangential friction
        const vnn = b.vel.dot(_n); _v.copy(b.vel).addScaledVector(_n, -vnn).multiplyScalar(b.friction);
        b.vel.copy(_v).addScaledVector(_n, vnn);
        const R = this.fx.rand; b.w.multiplyScalar(0.55).add(_ax.set(R() - 0.5, R() - 0.5, R() - 0.5).multiplyScalar(Math.min(30, sp * 6)));
        b.bounces++;
        if (b.event && b.bounces <= 3 && sp > 0.6) this.game.events.emit(b.event, { position: b.pos.clone(), surface: h.surface, speed: sp });
        if (b.vel.length() < 0.35 && _n.y > 0.6) {
          b.sleep = true; b.vel.set(0, 0, 0);
          if (b.isShell) { // lie on its side: shell axis (Y) perpendicular to the surface normal
            _ax.set(0, 1, 0).applyQuaternion(b.q); _ax.addScaledVector(_n, -_ax.dot(_n)).normalize();
            if (_ax.lengthSq() < 0.5) _ax.set(1, 0, 0);
            _q.setFromUnitVectors(_up, _ax); b.q.copy(_q);
            b.pos.copy(h.point).addScaledVector(_n, 0.0058);
          }
        }
      } else b.pos.addScaledVector(b.vel, dt);
    }
    const wl = b.w.length();
    if (wl > 1e-4) { _q.setFromAxisAngle(_ax.copy(b.w).divideScalar(wl), wl * dt); b.q.premultiply(_q); }
    if (b.trail) {
      b.trailT -= dt;
      if (b.trailT <= 0 && b.age < (b.trail.duration ?? 1.2)) { b.trailT = b.trail.interval ?? 0.03; b.trail.fn(b.pos, b.vel, b.age); }
    }
  }
}
