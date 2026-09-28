/**
 * Bakes a top-down tactical minimap from the static collision geometry (once, at load).
 * Software-rasterizes every collision triangle into a max-height grid, then shades it like a
 * CoD minimap: dark streets, mid-grey low cover, lighter structures with crisp bright outlines.
 */
export function bakeMinimap(game) {
  const geo = game.collision?.geometry;
  if (!geo) return null;
  const pos = geo.attributes.position.array;
  const spawn = game.level?.playerSpawn?.position;
  const groundY = spawn ? spawn.y : 0;
  const cellsPerM = 4;
  const HALF = 130; // clamp map extent around origin/spawn (m)
  const cx = 0, cz = 0;

  // bounds from geometry (ignoring huge ground slabs)
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (y < groundY + 0.3) continue;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (!isFinite(minX)) { minX = -50; maxX = 50; minZ = -50; maxZ = 50; }
  minX = Math.max(minX - 20, cx - HALF); maxX = Math.min(maxX + 20, cx + HALF);
  minZ = Math.max(minZ - 20, cz - HALF); maxZ = Math.min(maxZ + 20, cz + HALF);
  const W = Math.ceil((maxX - minX) * cellsPerM), H = Math.ceil((maxZ - minZ) * cellsPerM);
  const hmap = new Float32Array(W * H).fill(-1e9);
  const wall = new Uint8Array(W * H);

  const put = (gx, gz, y, isWall) => {
    if (gx < 0 || gz < 0 || gx >= W || gz >= H) return;
    const k = gz * W + gx;
    if (y > hmap[k]) hmap[k] = y;
    if (isWall) wall[k] = 1;
  };
  const line = (x0, z0, x1, z1, y) => {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0))) + 1;
    for (let s = 0; s <= n; s++) { const t = s / n; put(Math.floor(x0 + (x1 - x0) * t), Math.floor(z0 + (z1 - z0) * t), y, true); }
  };

  for (let i = 0; i < pos.length; i += 9) {
    const ax = (pos[i] - minX) * cellsPerM, ay = pos[i + 1], az = (pos[i + 2] - minZ) * cellsPerM;
    const bx = (pos[i + 3] - minX) * cellsPerM, by = pos[i + 4], bz = (pos[i + 5] - minZ) * cellsPerM;
    const qx = (pos[i + 6] - minX) * cellsPerM, qy = pos[i + 7], qz = (pos[i + 8] - minZ) * cellsPerM;
    const top = Math.max(ay, by, qy);
    if (top > groundY + 12) { /* tall roofs still count */ }
    const area = (bx - ax) * (qz - az) - (qx - ax) * (bz - az);
    // edge length (in cells) to detect vertical faces
    const e1 = Math.hypot(bx - ax, by - ay, bz - az);
    const vertical = Math.abs(area) < 0.08 * Math.max(1, e1);
    if (vertical) {
      if (top < groundY + 0.25) continue;
      line(ax, az, bx, bz, top); line(bx, bz, qx, qz, top); line(qx, qz, ax, az, top);
      continue;
    }
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, qx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, qx)));
    const z0 = Math.max(0, Math.floor(Math.min(az, bz, qz))), z1 = Math.min(H - 1, Math.ceil(Math.max(az, bz, qz)));
    if (x1 < x0 || z1 < z0) continue;
    const inv = 1 / area;
    for (let gz = z0; gz <= z1; gz++) {
      const pz = gz + 0.5;
      for (let gx = x0; gx <= x1; gx++) {
        const px = gx + 0.5;
        const w0 = ((bx - px) * (qz - pz) - (qx - px) * (bz - pz)) * inv;
        const w1 = ((qx - px) * (az - pz) - (ax - px) * (qz - pz)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
        const y = w0 * ay + w1 * by + w2 * qy;
        const k = gz * W + gx;
        if (y > hmap[k]) hmap[k] = y;
      }
    }
  }

  // classify
  const cls = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) {
    const h = hmap[k] - groundY;
    cls[k] = h < -1e8 ? 0 : h < 0.35 ? 1 : h < 1.4 ? 2 : h < 2.6 ? 3 : 4;
  }
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const pal = [
    [0, 0, 0, 0],
    [58, 64, 66, 70], // ground / street
    [120, 126, 128, 150], // low cover
    [150, 156, 158, 175], // mid walls / cars
    [104, 110, 114, 215], // structures
  ];
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const k = z * W + x, c = cls[k];
      let col = pal[c];
      let r = col[0], gg = col[1], b = col[2], a = col[3];
      if (c >= 2) {
        // outline where neighbour class is lower
        let edge = false;
        for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + ox, zz = z + oz;
          if (xx < 0 || zz < 0 || xx >= W || zz >= H) continue;
          if (cls[zz * W + xx] < c && (c === 4 || cls[zz * W + xx] <= 1)) { edge = true; break; }
        }
        if (edge) { r = 222; gg = 226; b = 224; a = c === 4 ? 240 : 200; }
        else if (c === 4) {
          // subtle height shading on roofs
          const hh = Math.min(1, (hmap[k] - groundY - 2.6) / 14);
          r += hh * 26; gg += hh * 26; b += hh * 26;
          if (((x + z) & 7) === 0) { r += 8; gg += 8; b += 8; } // hatch
        }
      } else if (c === 1) {
        // road puddle-ish noise for texture
        const n = ((x * 73856093) ^ (z * 19349663)) & 15;
        r += n * 0.4; gg += n * 0.4; b += n * 0.4;
      }
      const o = k * 4;
      d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, minX, minZ, cellsPerM, W, H };
}
