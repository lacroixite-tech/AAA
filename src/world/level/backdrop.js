import * as THREE from 'three';
import { box, cyl, mat, rng } from './geom.js';

/** Distant skyline silhouettes beyond the playable space (non-colliding, cheap). */
export function buildBackdrop(ctx) {
  const B = ctx.batch; const r = rng(404);
  const no = { collider: false, shadow: false, uvScale: 1 / 3 };
  const inside = (x, z, m) => Math.abs(x) < 72 + m && Math.abs(z) < 72 + m;
  const streetClear = (x, z, w, d) => (Math.abs(x) < 14 + w / 2) || (Math.abs(z) < 14 + d / 2);
  const blocks = [];
  // ring of mid/far blocks
  for (let i = 0; i < 170; i++) {
    const a = r() * Math.PI * 2, d = 105 + Math.pow(r(), 1.4) * 330;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const tall = r() < 0.22 && d > 170;
    const w = tall ? 14 + r() * 10 : 16 + r() * 40, dd = tall ? 12 + r() * 6 : 10 + r() * 6;
    const h = tall ? 27 + r.int(0, 3) * 6 : 9 + r.int(0, 3) * 3;
    const rot = r() < 0.5 ? 0 : Math.PI / 2;
    const [ww, wd] = rot ? [dd, w] : [w, dd];
    if (inside(x, z, Math.max(ww, wd) / 2)) continue;
    if (streetClear(x, z, ww, wd) && d < 260) continue;
    blocks.push([x, z, ww, wd, h]);
  }
  // blocks framing the far ends of the main streets (so vistas terminate)
  blocks.push([0, -270, 70, 16, 24], [0, 280, 60, 14, 18], [-265, 0, 14, 60, 21], [270, 0, 14, 70, 27]);
  for (const [x, z, w, d, h] of blocks) {
    const tint = r.pick([0xffffff, 0xe8dcc8, 0xd0d4d8, 0xc8b8a0, 0xb8aca0]);
    B.add(box(w, h, d), 'backdrop', mat(x, h / 2, z), { ...no, tint, vo: 0.1 });
    B.add(box(w + 0.6, 0.6, d + 0.6), 'backdrop_plain', mat(x, h + 0.3, z), { ...no });
    if (r() < 0.35) B.add(box(3, 2.5, 3), 'backdrop_plain', mat(x + (r() - 0.5) * w * 0.6, h + 1.25, z), no);
    if (r() < 0.25 && h < 16) { // pitched roof
      const alongX = w > d; const sh = new THREE.Shape(); const W = alongX ? d : w;
      sh.moveTo(-W / 2 - 0.3, 0); sh.lineTo(W / 2 + 0.3, 0); sh.lineTo(0, W * 0.3); sh.closePath();
      const g = new THREE.ExtrudeGeometry(sh, { depth: (alongX ? w : d) + 0.6, bevelEnabled: false }); g.translate(0, 0, -((alongX ? w : d) + 0.6) / 2);
      B.add(g, 'roof_tiles', mat(x, h, z, 0, alongX ? Math.PI / 2 : 0, 0), no);
    }
  }
  // industrial: chimneys, water tower, cranes, silos
  const stacks = [[-150, -210, 55], [-175, -190, 48], [190, -160, 40], [230, 160, 62], [-210, 170, 45]];
  for (const [x, z, h] of stacks) {
    B.add(cyl(1.6, 2.6, h, 16), 'brick', mat(x, h / 2, z), no);
    for (let y = h - 8; y > h - 20; y -= 6) B.add(cyl(1.75, 1.75, 1.2, 16), 'concrete', mat(x, y, z), { ...no, tint: 0xd8d0c8 });
  }
  B.add(cyl(0.8, 1.2, 28, 10), 'concrete', mat(160, 14, 150), no);
  B.add(cyl(6, 5, 7, 16), 'metal_rusty', mat(160, 31, 150), no);
  B.add(new THREE.ConeGeometry(6.4, 3, 16), 'metal_rusty', mat(160, 36, 150), no);
  for (const [x, z] of [[-120, 190], [-110, 196], [-100, 190]]) { B.add(cyl(5, 5, 22, 16), 'concrete', mat(x, 11, z), { ...no, tint: 0xc8c0b8 }); B.add(new THREE.ConeGeometry(5.2, 3, 16), 'metal_rusty', mat(x, 23.5, z), no); }
  const crane = (x, z, h, rot) => {
    for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) B.add(box(0.25, h, 0.25), 'metal_painted', mat(x + dx, h / 2, z + dz), { ...no, tint: 0xd0a030 });
    for (let y = 2; y < h; y += 2.2) B.add(box(1.8, 0.12, 1.8), 'metal_painted', mat(x, y, z), { ...no, tint: 0xd0a030 });
    B.add(box(34, 1.2, 1.2), 'metal_painted', mat(x + Math.cos(rot) * 10, h + 1, z - Math.sin(rot) * 10, 0, rot, 0), { ...no, tint: 0xd0a030 });
    B.add(cyl(0.03, 0.03, 12, 3), 'metal_bare', mat(x + Math.cos(rot) * 20, h - 5, z - Math.sin(rot) * 20), no);
  };
  crane(-190, -120, 42, 0.6); crane(140, -230, 38, 2.2);
  // orthodox church with onion domes (east)
  const cx = 205, cz = -95;
  B.add(box(16, 12, 24), 'plaster', mat(cx, 6, cz), { ...no, tint: 0xf0e8d8 });
  B.add(cyl(4, 4, 8, 16), 'plaster', mat(cx, 16, cz), { ...no, tint: 0xf0e8d8 });
  const dome = new THREE.SphereGeometry(4.3, 16, 10); dome.scale(1, 1.3, 1);
  B.add(dome, 'metal_painted', mat(cx, 22, cz), { ...no, tint: 0x3a6a4a });
  B.add(new THREE.ConeGeometry(1.2, 4, 12), 'metal_painted', mat(cx, 28, cz), { ...no, tint: 0x3a6a4a });
  B.add(box(0.2, 3, 0.2), 'metal_painted', mat(cx, 31, cz), { ...no, tint: 0xc8a040 });
  B.add(box(1.4, 0.2, 0.2), 'metal_painted', mat(cx, 31.6, cz), { ...no, tint: 0xc8a040 });
  B.add(box(6, 22, 6), 'plaster', mat(cx, 11, cz + 14), { ...no, tint: 0xf0e8d8 });
  B.add(new THREE.ConeGeometry(4, 10, 8), 'metal_painted', mat(cx, 27, cz + 14), { ...no, tint: 0x3a6a4a });
  // distant tree lines
  for (let i = 0; i < 160; i++) {
    const a = r() * Math.PI * 2, d = 120 + r() * 250; const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (inside(x, z, 6) || (Math.abs(x) < 16 || Math.abs(z) < 16)) continue;
    const h = 4 + r() * 5; const g = new THREE.IcosahedronGeometry(1, 1); g.scale(h * 0.6, h * 0.32, h * 0.6);
    B.add(g, 'backdrop_plain', mat(x, h * 0.18, z, 0, r() * 6, 0), { ...no, tint: r.pick([0x6a6a50, 0x7a6a48, 0x5a5a48]) });
  }
  // distant power pylons line
  for (let k = 0; k < 7; k++) {
    const x = -300 + k * 90, z = -330 + k * 12;
    const h = 30;
    for (const s of [-1, 1]) B.add(box(0.4, h, 0.4), 'metal_bare', mat(x + s * 2, h / 2, z, 0, 0, -s * 0.06), no);
    B.add(box(14, 0.4, 0.4), 'metal_bare', mat(x, h - 4, z), no);
    B.add(box(9, 0.4, 0.4), 'metal_bare', mat(x, h, z), no);
    if (k < 6) for (const dx of [-6, 6]) {
      const a = new THREE.Vector3(x + dx, h - 4.5, z), b = new THREE.Vector3(x + 90 + dx, h - 4.5, z + 12);
      const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; const p = a.clone().lerp(b, t); p.y -= 6 * 4 * t * (1 - t); pts.push(p); }
      B.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.06, 3), 'rubber', null, { collider: false, shadow: false });
    }
  }
}
