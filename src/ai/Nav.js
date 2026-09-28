import * as THREE from 'three';

/**
 * Navigation graph + cover points. Uses level.navPoints / level.coverPoints when present (any of
 * Vector3 | {position|pos|p, links|neighbors?, normal|dir?}), and falls back to an auto-generated
 * grid probed against the collision BVH. A* over the graph; string-pulling done by the agent.
 */
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DOWN = V(0, -1, 0);

function toVec(p) {
  if (!p) return null;
  if (p.isVector3) return p.clone();
  if (Array.isArray(p)) return V(p[0], p[1] || 0, p[2]);
  const q = p.position || p.pos || p.p || p.point;
  if (q) return toVec(q);
  if (typeof p.x === 'number') return V(p.x, p.y || 0, p.z);
  return null;
}

export class NavGraph {
  constructor(game) {
    this.game = game; this.col = game.collision;
    this.nodes = []; this.adj = []; this.cover = [];
    try { this.build(); } catch (e) { console.warn('[ai] nav build failed', e); }
    if (!this.nodes.length) this.buildGrid(V(0, 0, 0), 40, 4);
  }

  groundAt(x, z, yHint = 0) {
    const o = V(x, yHint + 3, z);
    const h = this.col.raycast(o, DOWN, 12, { dynamic: false });
    return h ? h.point.y : null;
  }
  clearAt(p) {
    if (!this.col.bvh) return true;
    const a = V(p.x, p.y + 0.5, p.z), b = V(p.x, p.y + 1.5, p.z);
    const push = this.col.resolveCapsule(a, b, 0.32);
    return push.lengthSq() < 1e-4;
  }
  /** line of sight between two points (static geometry only) */
  los(a, b) {
    const d = V().subVectors(b, a); const len = d.length(); if (len < 1e-3) return true;
    d.divideScalar(len);
    const h = this.col.raycast(a, d, len, { dynamic: false });
    return !h || h.distance >= len - 0.05;
  }
  walkable(a, b) {
    for (const hgt of [0.45, 1.2]) if (!this.los(V(a.x, a.y + hgt, a.z), V(b.x, b.y + hgt, b.z))) return false;
    // side clearance
    const d = V().subVectors(b, a).setY(0); const n = V(-d.z, 0, d.x).normalize().multiplyScalar(0.28);
    return this.los(V(a.x + n.x, a.y + 0.8, a.z + n.z), V(b.x + n.x, b.y + 0.8, b.z + n.z)) && this.los(V(a.x - n.x, a.y + 0.8, a.z - n.z), V(b.x - n.x, b.y + 0.8, b.z - n.z));
  }

  build() {
    const L = this.game.level || {};
    const np = L.navPoints;
    const raw = Array.isArray(np) ? np : Array.isArray(np?.points) ? np.points : [];
    if (raw.length >= 6) {
      this.nodes = raw.map(toVec).filter(Boolean);
      this.adj = this.nodes.map(() => []);
      if (np && !Array.isArray(np) && (np.neighbors || np.links)) {
        if (np.neighbors) np.neighbors.forEach((list, i) => { for (const j of list || []) if (j !== i && j < this.nodes.length) this.link(i, j); });
        else for (const [a, b] of np.links) if (a < this.nodes.length && b < this.nodes.length) this.link(a, b);
      } else if (raw.some((r) => r && (r.links || r.neighbors))) {
        raw.forEach((r, i) => { for (const j of (r.links || r.neighbors || [])) { const jj = typeof j === 'number' ? j : raw.indexOf(j); if (jj >= 0 && jj !== i) { this.link(i, jj); } } });
      } else this.autoLink(9);
    } else {
      // area guess: bounds of spawns & player spawn
      const pts = [...(L.enemySpawns || []).map(toVec), toVec(L.playerSpawn?.position)].filter(Boolean);
      const box = new THREE.Box3(); pts.forEach((p) => box.expandByPoint(p));
      if (box.isEmpty()) box.set(V(-40, 0, -40), V(40, 0, 40));
      box.expandByScalar(18);
      const c = box.getCenter(V()), sz = box.getSize(V());
      this.buildGrid(c, Math.min(90, Math.max(sz.x, sz.z) / 2), 3);
    }
    this.buildCover(L);
  }

  link(i, j) { if (!this.adj[i].includes(j)) this.adj[i].push(j); if (!this.adj[j].includes(i)) this.adj[j].push(i); }

  autoLink(maxD) {
    const n = this.nodes.length;
    for (let i = 0; i < n; i++) {
      const cand = [];
      for (let j = i + 1; j < n; j++) { const d = this.nodes[i].distanceTo(this.nodes[j]); if (d < maxD && Math.abs(this.nodes[i].y - this.nodes[j].y) < 1.2) cand.push([j, d]); }
      cand.sort((a, b) => a[1] - b[1]);
      for (const [j] of cand.slice(0, 10)) if (this.walkable(this.nodes[i], this.nodes[j])) this.link(i, j);
    }
  }

  buildGrid(center, half, step) {
    const nodes = [], idx = new Map();
    const N = Math.floor(half / step);
    for (let ix = -N; ix <= N; ix++) for (let iz = -N; iz <= N; iz++) {
      const x = center.x + ix * step, z = center.z + iz * step;
      const y = this.groundAt(x, z, center.y + 2);
      if (y === null || Math.abs(y - center.y) > 4) continue;
      const p = V(x, y, z);
      if (!this.clearAt(p)) continue;
      idx.set(ix + ',' + iz, nodes.length); nodes.push(p);
    }
    this.nodes = nodes; this.adj = nodes.map(() => []);
    for (const [k, i] of idx) {
      const [ix, iz] = k.split(',').map(Number);
      for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const j = idx.get((ix + dx) + ',' + (iz + dz));
        if (j !== undefined && this.walkable(nodes[i], nodes[j])) this.link(i, j);
      }
    }
  }

  buildCover(L) {
    const raw = Array.isArray(L.coverPoints) ? L.coverPoints : [];
    this.cover = [];
    for (const r of raw) {
      const p = toVec(r); if (!p) continue;
      // level convention: `facing` points from the cover spot toward the obstacle/threat; we store the away-normal
      let nrm = toVec(r.normal) || null;
      if (!nrm && (r.facing || r.dir)) nrm = toVec(r.facing || r.dir).negate();
      const low = r.low ?? (typeof r.height === 'string' ? r.height !== 'high' : r.height !== undefined ? r.height < 1.3 : undefined);
      this.cover.push(this.analyzeCover(p, nrm, low));
    }
    if (this.cover.length < 4) {
      // auto-detect: nav nodes with a solid obstacle close by at waist height
      const dirs = []; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; dirs.push(V(Math.sin(a), 0, Math.cos(a))); }
      for (const p of this.nodes) {
        for (const d of dirs) {
          const h = this.col.raycast(V(p.x, p.y + 0.7, p.z), d, 1.6, { dynamic: false });
          if (h) {
            const c = V(h.point.x, p.y, h.point.z).addScaledVector(d, -0.55);
            if (!this.clearAt(c)) continue;
            this.cover.push(this.analyzeCover(c, d.clone().negate()));
            break;
          }
        }
      }
    }
    this.cover = this.cover.filter(Boolean);
    this.cover.forEach((c) => { c.node = this.nearest(c.p); c.owner = null; });
  }

  /** cover record: position, normal (pointing away from the wall), low (can shoot over) */
  analyzeCover(p, nrm, low) {
    if (!nrm) {
      let best = null;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2; const d = V(Math.sin(a), 0, Math.cos(a));
        const h = this.col.raycast(V(p.x, p.y + 0.7, p.z), d, 2, { dynamic: false });
        if (h && (!best || h.distance < best.distance)) best = { distance: h.distance, d };
      }
      nrm = best ? best.d.clone().negate() : V(0, 0, 1);
    }
    nrm = nrm.clone().setY(0).normalize();
    if (low === undefined) {
      const h = this.col.raycast(V(p.x, p.y + 1.45, p.z), nrm.clone().negate(), 1.8, { dynamic: false });
      low = !h;
    }
    return { p: p.clone(), n: nrm, low };
  }

  nearest(p, maxD = Infinity) {
    let best = -1, bd = maxD * maxD;
    for (let i = 0; i < this.nodes.length; i++) { const d = this.nodes[i].distanceToSquared(p); if (d < bd) { bd = d; best = i; } }
    return best;
  }

  /** A* from world pos to world pos; returns array of Vector3 (excluding start). */
  path(from, to) {
    const s = this.nearest(from), g = this.nearest(to);
    if (s < 0 || g < 0) return [to.clone()];
    if (s === g) return [to.clone()];
    const N = this.nodes.length;
    const gS = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const open = [s]; gS[s] = 0;
    const f = (i) => gS[i] + this.nodes[i].distanceTo(this.nodes[g]);
    let iter = 0;
    while (open.length && iter++ < 4000) {
      let bi = 0; for (let k = 1; k < open.length; k++) if (f(open[k]) < f(open[bi])) bi = k;
      const cur = open.splice(bi, 1)[0];
      if (cur === g) break;
      closed[cur] = 1;
      for (const nb of this.adj[cur]) {
        if (closed[nb]) continue;
        const ng = gS[cur] + this.nodes[cur].distanceTo(this.nodes[nb]);
        if (ng < gS[nb]) { gS[nb] = ng; came[nb] = cur; if (!open.includes(nb)) open.push(nb); }
      }
    }
    if (came[g] < 0) return [to.clone()];
    const out = [to.clone()]; let c = came[g];
    while (c >= 0 && c !== s) { out.push(this.nodes[c].clone()); c = came[c]; }
    return out.reverse();
  }
}
