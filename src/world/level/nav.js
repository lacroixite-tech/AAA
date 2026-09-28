import * as THREE from 'three';

/** Build a walkable waypoint graph {points:[Vector3], links:[[i,j]], neighbors:[[j...]]}. */
export function buildNav(ctx, level) {
  const S = 3, pts = [], links = [], grid = new Map();
  const hAt = ctx.heightAt || (() => 0);
  for (let x = -57; x <= 57; x += S) for (let z = -61; z <= 61; z += S) {
    if (level._blocked(x, z, 0.6)) continue;
    grid.set(`${x},${z}`, pts.length); pts.push(new THREE.Vector3(x, hAt(x, z), z));
  }
  const clear = (a, b) => {
    for (let t = 0.2; t < 1; t += 0.2) if (level._blocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 0.45)) return false;
    return true;
  };
  for (const [k, i] of grid) {
    const [x, z] = k.split(',').map(Number);
    for (const [dx, dz] of [[S, 0], [0, S], [S, S], [S, -S]]) {
      const j = grid.get(`${x + dx},${z + dz}`);
      if (j != null && clear(pts[i], pts[j])) links.push([i, j]);
    }
  }
  // elevated chains (stairs/ramps/upper floors): link consecutive, attach ends to nearest ground node
  for (const chain of ctx.navExtra) {
    const ids = chain.map((p) => { pts.push(p.clone()); return pts.length - 1; });
    for (let k = 0; k < ids.length - 1; k++) links.push([ids[k], ids[k + 1]]);
    const first = pts[ids[0]]; let best = -1, bd = 1e9;
    for (const [, i] of grid) { const d = pts[i].distanceTo(first); if (d < bd && clear(pts[i], first)) { bd = d; best = i; } }
    if (best >= 0) links.push([best, ids[0]]);
  }
  const neighbors = pts.map(() => []);
  for (const [a, b] of links) { neighbors[a].push(b); neighbors[b].push(a); }
  // drop isolated nodes' dangling (keep indices stable; AI can ignore empty neighbor lists)
  return { points: pts, links, neighbors, spacing: S };
}
