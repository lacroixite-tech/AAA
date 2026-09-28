import * as THREE from 'three';
import { mulberry32 } from './rng.js';

/**
 * Procedural texture atlases for the FX system (generated once at load, CPU).
 *
 * Particle atlas (4x4 tiles). Channel layout for every tile:
 *   R,G = tangent-space normal (xy, 0.5 = flat) derived from the density height field  -> fake lighting
 *   B   = intensity / detail (heat for fire, internal thickness for smoke)
 *   A   = density / coverage
 * Decal atlas (4x4 tiles): albedo+alpha, tangent normal map, ORM (G roughness, B metalness).
 */

export const P = {
  SMOKE0: 0, SMOKE1: 1, SMOKE2: 2, DUST: 3,
  STAR: 4, FLAME: 5, CORE: 6, SPARK: 7,
  GLOW: 8, FIRE: 9, GRIT: 10, BLOOD: 11,
  RING: 12, CLUMPS: 13, FLARE: 14, TRACER: 15,
};
export const D = {
  CONCRETE0: 0, CONCRETE1: 1, METAL0: 2, METAL1: 3,
  WOOD0: 4, WOOD1: 5, DIRT: 6, GLASS: 7,
  BLOOD0: 8, BLOOD1: 9, SCORCH: 10, PLASTER: 11,
  CLOTH: 12, BLOOD_DROPS: 13, BRICK: 14, SCORCH_SMALL: 15,
};

// ---------------------------------------------------------------- noise
function makeNoise(seed) {
  const r = mulberry32(seed);
  const perm = new Uint8Array(512); const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = new Float32Array(512);
  for (let i = 0; i < 256; i++) { const a = r() * Math.PI * 2; grad[i * 2] = Math.cos(a); grad[i * 2 + 1] = Math.sin(a); }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  function noise(x, y) { // gradient noise, ~[-0.7,0.7]
    const xi = Math.floor(x), yi = Math.floor(y); const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const g = (ix, iy, dx, dy) => { const h = perm[ix + perm[iy]] * 2; return grad[h] * dx + grad[h + 1] * dy; };
    const u = fade(xf), v = fade(yf);
    const a = g(X, Y, xf, yf), b = g(X + 1, Y, xf - 1, yf), c = g(X, Y + 1, xf, yf - 1), d = g(X + 1, Y + 1, xf - 1, yf - 1);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
  }
  function fbm(x, y, oct = 5, lac = 2.03, gain = 0.5) {
    let s = 0, amp = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { s += amp * noise(x * f, y * f); f *= lac; amp *= gain; }
    return s; // ~[-0.6,0.6]
  }
  function ridged(x, y, oct = 5) {
    let s = 0, amp = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { s += amp * (1 - Math.abs(noise(x * f, y * f) * 1.6)); f *= 2.1; amp *= 0.5; }
    return s;
  }
  // cellular F1 (billowy puffs)
  const cellR = mulberry32(seed + 7);
  const cellPts = new Float32Array(64 * 64 * 2); for (let i = 0; i < cellPts.length; i++) cellPts[i] = cellR();
  function worley(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y); let best = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j; const k = (((cx & 63) + (cy & 63) * 64)) * 2;
      const dx = cx + cellPts[k] - x, dy = cy + cellPts[k + 1] - y; const d = dx * dx + dy * dy; if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
  return { noise, fbm, ridged, worley };
}

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- particle atlas
export function buildParticleAtlas(tileSize = 256) {
  const N = makeNoise(9127);
  const S = tileSize, W = S * 4;
  const data = new Uint8ClampedArray(W * W * 4);
  const R = mulberry32(4242);

  // fn(u, v, r, th) -> [density a, intensity b, height h]  (u,v in [-1,1], v up)
  function tile(index, fn, { normalStrength = 3, sphere = 0.7 } = {}) {
    const tx = (index % 4) * S, ty = Math.floor(index / 4) * S;
    const A = new Float32Array(S * S), B = new Float32Array(S * S), H = new Float32Array(S * S);
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const u = ((px + 0.5) / S) * 2 - 1, v = 1 - ((py + 0.5) / S) * 2;
      const uu = u * 1.04, vv = v * 1.04; // padding
      const r = Math.hypot(uu, vv), th = Math.atan2(vv, uu);
      const o = fn(uu, vv, r, th);
      const edge = smooth(1.0, 0.94, Math.max(Math.abs(uu), Math.abs(vv))); // hard guarantee: zero at tile border
      const k = py * S + px; A[k] = clamp(o[0]) * edge; B[k] = clamp(o[1]); H[k] = o[2] !== undefined ? o[2] : A[k];
    }
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const k = py * S + px;
      const xl = H[py * S + Math.max(0, px - 1)], xr = H[py * S + Math.min(S - 1, px + 1)];
      const yu = H[Math.max(0, py - 1) * S + px], yd = H[Math.min(S - 1, py + 1) * S + px];
      const u = ((px + 0.5) / S) * 2 - 1, v = 1 - ((py + 0.5) / S) * 2;
      let nx = -(xr - xl) * normalStrength * S / 64 + u * sphere;
      let ny = -(yu - yd) * normalStrength * S / 64 + v * sphere; // v up = row up
      let nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l;
      const o = ((ty + (S - 1 - py)) * W + tx + px) * 4;
      data[o] = (nx * 0.5 + 0.5) * 255; data[o + 1] = (ny * 0.5 + 0.5) * 255; data[o + 2] = B[k] * 255; data[o + 3] = A[k] * 255;
    }
  }

  const billow = (u, v, sx, sy, oct = 5) => {
    const f = N.fbm(u * sx + sy, v * sx - sy, oct);
    const w = 1 - N.worley(u * 3.2 + sy * 2, v * 3.2 + sx);
    return f * 0.9 + w * 0.55;
  };

  // 0-2 smoke puffs: soft wide gradient, billowy internal detail (erosion in-shader makes them wispy)
  [[0, 2.3, 11.3, 1.0], [1, 2.9, 37.1, 1.0], [2, 1.8, 71.9, 1.6]].forEach(([i, sc, off, stretch]) => {
    tile(i, (u, v) => {
      const warpU = u + N.fbm(u * 1.3 + off, v * 1.3, 4) * 0.55, warpV = v + N.fbm(u * 1.3, v * 1.3 + off, 4) * 0.55;
      const rr = Math.hypot(warpU / stretch, warpV * (i === 2 ? 1.25 : 1));
      const b = billow(warpU / stretch, warpV, sc, off); // ~[-0.6, 1.1]
      const base = Math.pow(clamp(1 - rr), 1.25);
      const wisp = i === 2 ? clamp(0.5 + N.ridged(warpU * 2.5 + off, warpV * 5, 4) * 0.8 - 0.6) : 0;
      const d = clamp(base * (0.45 + b * 0.75 + wisp) * 1.35);
      return [d, clamp(0.45 + b * 0.55 + base * 0.2), base * 0.6 + b * 0.35 * base];
    }, { normalStrength: 2.2, sphere: 0.75 });
  });
  // 3 dust: grainy soft puff with speckles
  tile(3, (u, v, r) => {
    const wu = u + N.fbm(u * 1.5 + 3, v * 1.5, 3) * 0.4, wv = v + N.fbm(u * 1.5, v * 1.5 + 3, 3) * 0.4;
    const b = billow(wu, wv, 3.5, 5.5);
    const base = Math.pow(clamp(1 - Math.hypot(wu, wv)), 1.4);
    const grain = N.noise(u * 60, v * 60) * 0.5 + N.noise(u * 25 + 3, v * 25) * 0.4;
    const d = clamp(base * (0.5 + b * 0.6 + grain * 0.5) * 1.3);
    return [d, clamp(0.55 + grain * 0.6 + b * 0.2), base * 0.6 + b * 0.3 * base];
  }, { normalStrength: 2.2, sphere: 0.75 });
  // 4 flash star: irregular 5-prong star with flame texture
  {
    const prongs = 5; const lens = [], offs = [];
    for (let i = 0; i < prongs; i++) { lens.push(0.65 + R() * 0.35); offs.push((R() - 0.5) * 0.35); }
    tile(4, (u, v, r, th) => {
      let star = 0;
      for (let i = 0; i < prongs; i++) {
        const a = (i / prongs) * Math.PI * 2 + offs[i] + 0.3;
        let da = Math.atan2(Math.sin(th - a), Math.cos(th - a));
        const wobble = N.fbm(r * 3 + i * 7, i * 3.3, 3) * 0.25;
        da += wobble * r;
        const width = 0.3 * (1 - r / lens[i]) + 0.02;
        star = Math.max(star, smooth(width, width * 0.25, Math.abs(da) * (0.6 + r)) * smooth(lens[i], lens[i] * 0.55, r));
      }
      const core = Math.exp(-r * r * 9);
      const flame = 0.55 + N.fbm(r * 5 - 3, th * 1.6, 4) * 1.2 + N.ridged(u * 4, v * 4, 3) * 0.3;
      const a = clamp(Math.max(star * clamp(flame), core * 1.1));
      const b = clamp(core * 0.9 + star * (0.45 + 0.5 * (1 - r)) * clamp(flame + 0.2));
      return [a, b];
    });
  }
  // 5 flame tongue: base at u=-1, tip at u=+1
  tile(5, (u, v) => {
    const t = (u + 1) / 2;
    const n1 = N.fbm(u * 3.2 - 1.3, v * 4, 4);
    const width = 0.55 * Math.pow(1 - t, 0.55) * smooth(0.0, 0.12, t) + 0.02;
    const vv = v + n1 * 0.35 * t;
    const body = smooth(width, width * 0.2, Math.abs(vv));
    const lick = clamp(0.7 + N.fbm(u * 6, v * 6 + 4, 4) * 1.3 - t * 0.5);
    const a = clamp(body * lick * 1.2);
    const b = clamp((1 - t) * 0.8 + 0.25) * clamp(body * 1.3);
    return [a, b];
  });
  // 6 flash core: jagged hot blob
  tile(6, (u, v, r, th) => {
    const edge = 0.55 + N.fbm(Math.cos(th) * 2 + 3, Math.sin(th) * 2, 4) * 0.6;
    const a = smooth(edge, edge * 0.3, r);
    const b = clamp(Math.exp(-r * r * 5) + a * 0.3);
    return [a, b];
  });
  // 7 spark streak: head at +u, tail fades toward -u
  tile(7, (u, v) => {
    const t = (u + 1) / 2;
    const core = Math.exp(-(v * v) / (0.012 + 0.03 * t));
    const along = Math.pow(t, 1.4) * smooth(1.0, 0.85, t);
    return [clamp(core * along * 1.3), clamp(core * along * 1.1)];
  });
  // 8 glow
  tile(8, (u, v, r) => { const g = Math.exp(-r * r * 6) * 0.8 + Math.exp(-r * r * 40) * 0.6; return [clamp(g), clamp(g)]; });
  // 9 fire billow: dense detail for heat ramp
  tile(9, (u, v, r) => {
    const wu = u + N.fbm(u * 2 + 9, v * 2, 3) * 0.45, wv = v + N.fbm(u * 2, v * 2 + 9, 3) * 0.45;
    const rr = Math.hypot(wu, wv);
    const b = billow(wu, wv, 3.1, 19.7);
    const fall = 1 - smooth(0.2, 0.95, rr);
    const d = clamp((fall * 1.3 + b * 0.9 - 0.3) * fall * 1.5);
    const heat = clamp(0.35 + b * 0.9 + N.ridged(wu * 5, wv * 5, 4) * 0.35 - rr * 0.35);
    return [smooth(0.02, 0.7, d), heat, d];
  });
  // 10 grit spray: cluster of chips/specks
  {
    const specks = []; for (let i = 0; i < 90; i++) { const a = R() * Math.PI * 2, rr = Math.pow(R(), 0.7) * 0.85; specks.push([Math.cos(a) * rr, Math.sin(a) * rr, 0.012 + R() * R() * 0.05]); }
    tile(10, (u, v) => {
      let a = 0; for (const s of specks) { const d = Math.hypot(u - s[0], v - s[1]); if (d < s[2]) a = Math.max(a, smooth(s[2], s[2] * 0.4, d)); }
      return [a, 0.5 + R() * 0.2];
    }, { sphere: 0.1 });
  }
  // 11 blood mist: irregular mist with droplets
  {
    const drops = []; for (let i = 0; i < 40; i++) { const a = R() * Math.PI * 2, rr = 0.2 + R() * 0.7; drops.push([Math.cos(a) * rr, Math.sin(a) * rr, 0.015 + R() * 0.04]); }
    tile(11, (u, v, r) => {
      const b = billow(u, v, 3, 3.3);
      const fall = 1 - smooth(0.1, 0.8, r);
      let d = clamp((fall + b * 0.7 - 0.35) * fall * 1.6);
      for (const s of drops) { const dd = Math.hypot(u - s[0], v - s[1]); if (dd < s[2]) d = Math.max(d, smooth(s[2], s[2] * 0.5, dd)); }
      return [d, clamp(0.5 + b)];
    });
  }
  // 12 shockwave ring
  tile(12, (u, v, r, th) => {
    const n = N.fbm(Math.cos(th) * 3, Math.sin(th) * 3, 4);
    const ring = smooth(0.62, 0.84, r + n * 0.08) * smooth(0.98, 0.86, r + n * 0.05);
    return [clamp(ring * (0.6 + n * 1.2)), 0.7];
  });
  // 13 dirt clumps
  {
    const cl = []; for (let i = 0; i < 26; i++) { const a = R() * Math.PI * 2, rr = Math.pow(R(), 0.8) * 0.75; cl.push([Math.cos(a) * rr, Math.sin(a) * rr, 0.04 + R() * 0.12]); }
    tile(13, (u, v) => {
      let a = 0;
      for (const s of cl) { const d = Math.hypot(u - s[0], v - s[1]) + N.fbm(u * 9 + s[0] * 10, v * 9, 3) * s[2] * 0.9; if (d < s[2]) a = Math.max(a, smooth(s[2], s[2] * 0.55, d)); }
      return [a, 0.5];
    }, { normalStrength: 6, sphere: 0.2 });
  }
  // 14 flare: 4-point glint
  tile(14, (u, v, r) => {
    const cross = Math.exp(-Math.abs(u) * 26) * Math.exp(-v * v * 2.5) + Math.exp(-Math.abs(v) * 26) * Math.exp(-u * u * 2.5);
    const g = Math.exp(-r * r * 14) * 0.9 + cross * 0.8;
    return [clamp(g), clamp(g)];
  });
  // 15 tracer: long bright core, head brighter
  tile(15, (u, v) => {
    const t = (u + 1) / 2;
    const core = Math.exp(-v * v / 0.004) + Math.exp(-v * v / 0.06) * 0.35;
    const along = smooth(0, 0.35, t) * smooth(1, 0.94, t) * (0.35 + 0.65 * t);
    return [clamp(core * along), clamp(core * along)];
  });

  const tex = new THREE.DataTexture(new Uint8Array(data.buffer), W, W, THREE.RGBAFormat);
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.flipY = false; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- decal atlas
export function buildDecalAtlas(tileSize = 256) {
  const N = makeNoise(5531);
  const S = tileSize, W = S * 4;
  const alb = new Uint8Array(W * W * 4), nrm = new Uint8Array(W * W * 4), orm = new Uint8Array(W * W * 4);
  const R = mulberry32(777);

  // fn(u,v,r,th) -> {c:[r,g,b], a, h, rough, metal}
  function tile(index, fn, bump = 4) {
    const tx = (index % 4) * S, ty = Math.floor(index / 4) * S;
    const H = new Float32Array(S * S);
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const u = (((px + 0.5) / S) * 2 - 1) * 1.05, v = (1 - ((py + 0.5) / S) * 2) * 1.05;
      const r = Math.hypot(u, v), th = Math.atan2(v, u);
      const o = fn(u, v, r, th);
      const edge = smooth(1.0, 0.93, Math.max(Math.abs(u), Math.abs(v)));
      const k = py * S + px; H[k] = o.h || 0;
      const i = ((ty + (S - 1 - py)) * W + tx + px) * 4;
      alb[i] = clamp(o.c[0]) * 255; alb[i + 1] = clamp(o.c[1]) * 255; alb[i + 2] = clamp(o.c[2]) * 255; alb[i + 3] = clamp(o.a * edge) * 255;
      orm[i] = 255; orm[i + 1] = clamp(o.rough ?? 0.9) * 255; orm[i + 2] = clamp(o.metal ?? 0) * 255; orm[i + 3] = 255;
    }
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const xl = H[py * S + Math.max(0, px - 1)], xr = H[py * S + Math.min(S - 1, px + 1)];
      const yu = H[Math.max(0, py - 1) * S + px], yd = H[Math.min(S - 1, py + 1) * S + px];
      let nx = -(xr - xl) * bump, ny = -(yu - yd) * bump, nz = 1; const l = Math.hypot(nx, ny, nz);
      const i = ((ty + (S - 1 - py)) * W + tx + px) * 4;
      nrm[i] = (nx / l * 0.5 + 0.5) * 255; nrm[i + 1] = (ny / l * 0.5 + 0.5) * 255; nrm[i + 2] = (nz / l * 0.5 + 0.5) * 255; nrm[i + 3] = 255;
    }
  }

  const cracks = (seed, count, len) => {
    const rr = mulberry32(seed); const out = [];
    for (let i = 0; i < count; i++) out.push({ a: rr() * Math.PI * 2, l: len * (0.5 + rr() * 0.6), w: 0.008 + rr() * 0.012, s: rr() * 100 });
    return out;
  };
  const crackMask = (cs, r, th, r0) => {
    let m = 0;
    for (const c of cs) {
      if (r < r0 || r > c.l) continue;
      const wig = N.fbm(r * 6 + c.s, c.s, 3) * 0.35;
      const da = Math.abs(Math.atan2(Math.sin(th - c.a - wig), Math.cos(th - c.a - wig))) * r;
      const w = c.w * (1 - (r - r0) / (c.l - r0) * 0.8);
      m = Math.max(m, smooth(w, w * 0.2, da));
    }
    return m;
  };

  // concrete bullet holes
  const concreteHole = (seed, base, tint) => {
    const cs = cracks(seed, 5, 0.85);
    return (u, v, r, th) => {
      const jag = N.fbm(Math.cos(th) * 2.5 + seed, Math.sin(th) * 2.5, 4);
      const rh = 0.08 + jag * 0.03, rc = 0.34 + jag * 0.22, rs = 0.85 + jag * 0.1;
      const chip = N.fbm(u * 14 + seed, v * 14, 4);
      const grain = N.noise(u * 70, v * 70);
      let h = 0, c, a;
      const crater = smooth(rc, rc - 0.04, r);
      const hole = smooth(rh + 0.02, rh - 0.02, r);
      const depth = Math.pow(clamp(1 - r / rc), 0.8);
      h = -crater * (depth * 0.55 + chip * 0.25) - hole * 0.6;
      const fresh = [base[0] + chip * 0.15 + grain * 0.06, base[1] + chip * 0.15 + grain * 0.06, base[2] + chip * 0.14 + grain * 0.06];
      const inner = mix(1, 0.45, depth); // darker deeper (AO)
      c = [fresh[0] * inner, fresh[1] * inner, fresh[2] * inner];
      c = c.map((x) => mix(x, 0.035, hole));
      const soot = (1 - smooth(rc, rs, r)) * (1 - crater) * clamp(0.55 + N.fbm(u * 5 + seed, v * 5, 4) * 1.3);
      const ck = crackMask(cs, r, th, rc * 0.8) * (1 - crater);
      a = Math.max(crater, soot * 0.7, ck * 0.85);
      if (crater < 1) {
        const sc = [tint[0] * 0.5, tint[1] * 0.5, tint[2] * 0.5];
        const cc = crater > 0 ? c : sc;
        c = ck > soot * 0.7 ? [0.08, 0.08, 0.08] : cc;
        if (crater > 0) c = c.map((x, i) => mix(ck > 0.3 ? 0.08 : sc[i], x, crater));
        h += -ck * 0.2;
      }
      // scattered chips outside crater
      const spk = smooth(0.35, 0.5, N.noise(u * 40 + seed, v * 40)) * (1 - smooth(rc, rc + 0.3, r)) * (1 - crater);
      if (spk > 0.01) { a = Math.max(a, spk * 0.8); c = c.map((x, i) => mix(x, fresh[i] * 0.9, spk)); h -= spk * 0.1; }
      return { c, a, h, rough: 0.95 };
    };
  };
  tile(D.CONCRETE0, concreteHole(1, [0.6, 0.58, 0.55], [0.22, 0.21, 0.2]), 5);
  tile(D.CONCRETE1, concreteHole(2, [0.64, 0.62, 0.58], [0.2, 0.2, 0.19]), 5);
  tile(D.PLASTER, concreteHole(3, [0.86, 0.84, 0.8], [0.3, 0.29, 0.27]), 5);
  tile(D.BRICK, concreteHole(4, [0.62, 0.36, 0.27], [0.2, 0.14, 0.12]), 5);

  // metal bullet holes: dark hole, petal rim, bare-metal chipped paint ring, faint soot
  const metalHole = (seed) => (u, v, r, th) => {
    const jag = N.fbm(Math.cos(th) * 3 + seed, Math.sin(th) * 3, 3);
    const rh = 0.13 + jag * 0.015, rr = 0.2 + jag * 0.03, rp = 0.36 + jag * 0.22;
    const hole = smooth(rh + 0.01, rh - 0.01, r);
    const rim = smooth(rh - 0.01, rh + 0.02, r) * smooth(rr + 0.02, rr - 0.02, r);
    const petals = 0.5 + 0.5 * Math.cos(th * 7 + jag * 4);
    const bare = smooth(rp + 0.02, rp - 0.02, r) * (1 - hole);
    const scratch = smooth(0.3, 0.6, N.ridged(u * 6 + seed, v * 60, 3)) * 0.4;
    const soot = (1 - smooth(rp, 0.9, r)) * clamp(0.5 + N.fbm(u * 4 + seed, v * 4, 3) * 1.4) * (1 - bare);
    let c = [0.62 + scratch * 0.2, 0.61 + scratch * 0.2, 0.6 + scratch * 0.2].map((x) => x * (0.75 + 0.25 * rim + 0.2 * N.noise(u * 50, v * 50)));
    c = c.map((x) => mix(x, 0.02, hole));
    if (bare < 0.5) c = [0.12, 0.11, 0.1];
    const a = Math.max(hole, bare, soot * 0.55);
    const h = rim * (0.5 + petals * 0.4) - hole * 0.8 - bare * 0.05;
    return { c, a, h, rough: mix(0.8, 0.28, bare) * (1 - hole) + hole * 0.9, metal: bare * (1 - hole) };
  };
  tile(D.METAL0, metalHole(11), 6);
  tile(D.METAL1, metalHole(12), 6);

  // wood: elongated torn hole with bright splintered fibers along the grain (v)
  const woodHole = (seed) => (u, v) => {
    const vv = v * 0.6, rr = Math.hypot(u, vv);
    const jag = N.fbm(u * 6 + seed, v * 1.5, 4);
    const hole = smooth(0.11 + jag * 0.05, 0.07, rr);
    const torn = smooth(0.42 + jag * 0.25, 0.25, rr + Math.abs(N.fbm(u * 30 + seed, v * 2, 3)) * 0.3);
    const fibers = 0.5 + 0.5 * N.fbm(u * 45 + seed, v * 3, 3);
    let c = [0.72 * fibers + 0.18, 0.54 * fibers + 0.12, 0.34 * fibers + 0.07];
    const inner = 1 - smooth(0.5, 0, rr) * 0.5; c = c.map((x) => x * inner);
    c = c.map((x) => mix(x, 0.03, hole));
    const h = -torn * 0.3 + (fibers - 0.5) * torn * 0.4 - hole * 0.6;
    return { c, a: Math.max(hole, torn), h, rough: 0.85 };
  };
  tile(D.WOOD0, woodHole(21), 5);
  tile(D.WOOD1, woodHole(22), 5);

  // dirt: soft dark crater
  tile(D.DIRT, (u, v, r, th) => {
    const jag = N.fbm(Math.cos(th) * 2 + 5, Math.sin(th) * 2, 4);
    const cr = smooth(0.55 + jag * 0.3, 0.1, r);
    const crumbs = smooth(0.3, 0.55, N.noise(u * 22, v * 22)) * (1 - smooth(0.4, 0.95, r));
    const d = mix(0.2, 0.06, cr);
    return { c: [d * 1.05, d * 0.9, d * 0.72], a: Math.max(cr * 0.95, crumbs * 0.8), h: -cr * 0.5 + crumbs * 0.2, rough: 0.98 };
  }, 4);

  // glass: radial + concentric cracks, crushed center
  {
    const cs = cracks(31, 13, 1.0);
    tile(D.GLASS, (u, v, r, th) => {
      const rad = crackMask(cs, r, th, 0.05);
      const ringR = [0.22, 0.38, 0.55]; let conc = 0;
      for (const rr of ringR) { const w = 0.01; const d = Math.abs(r - rr - N.fbm(th * 2, rr * 10, 2) * 0.05); conc = Math.max(conc, smooth(w, 0, d) * smooth(0.3, 0.7, N.noise(th * 5 + rr * 9, rr))); }
      const center = smooth(0.14, 0.05, r);
      const crush = smooth(0.2, 0.1, r) * (0.5 + N.noise(u * 40, v * 40));
      const m = Math.max(rad, conc * 0.8, crush * 0.8);
      const c = center > 0.5 ? [0.05, 0.05, 0.05] : [0.85, 0.88, 0.9];
      return { c, a: Math.max(m * 0.9, center), h: m * 0.4, rough: 0.15 };
    }, 3);
  }

  // blood splats
  const bloodSplat = (seed, directional) => {
    const rr = mulberry32(seed); const drops = [];
    for (let i = 0; i < 45; i++) {
      const a = directional ? (rr() - 0.5) * 1.2 : rr() * Math.PI * 2; const d = 0.25 + Math.pow(rr(), 0.6) * 0.7;
      drops.push([Math.cos(a) * d - (directional ? 0.5 : 0), Math.sin(a) * d * (directional ? 0.6 : 1), 0.012 + rr() * rr() * 0.07, a]);
    }
    return (u, v, r) => {
      const uu = directional ? u + 0.5 : u;
      const rb = Math.hypot(uu * (directional ? 0.75 : 1), v) + N.fbm(u * 4 + seed, v * 4, 4) * 0.35;
      let m = smooth(directional ? 0.32 : 0.42, directional ? 0.22 : 0.3, rb);
      for (const d of drops) {
        const du = u - d[0], dv = v - d[1];
        const ca = Math.cos(d[3]), sa = Math.sin(d[3]);
        const lu = du * ca + dv * sa, lv = -du * sa + dv * ca;
        const dd = Math.hypot(lu * (directional ? 0.45 : 0.8), lv);
        m = Math.max(m, smooth(d[2], d[2] * 0.6, dd));
      }
      const thick = smooth(0, 1, m) * (0.6 + N.fbm(u * 8, v * 8, 3));
      const c = [mix(0.32, 0.16, thick), mix(0.02, 0.008, thick), mix(0.02, 0.01, thick)];
      return { c, a: m * 0.95, h: m * 0.25 * thick, rough: 0.22 };
    };
  };
  tile(D.BLOOD0, bloodSplat(41, false), 3);
  tile(D.BLOOD1, bloodSplat(42, true), 3);
  tile(D.BLOOD_DROPS, (u, v) => {
    let m = 0; const rr = mulberry32(55);
    for (let i = 0; i < 20; i++) { const x = rr() * 1.6 - 0.8, y = rr() * 1.6 - 0.8, s = 0.02 + rr() * 0.07; m = Math.max(m, smooth(s, s * 0.6, Math.hypot(u - x, v - y) + N.noise(u * 20, v * 20) * s * 0.4)); }
    return { c: [0.26, 0.015, 0.012], a: m, h: m * 0.3, rough: 0.2 };
  }, 3);

  // scorch: charred center, radial soot streaks, broken edge
  const scorch = (seed, small) => (u, v, r, th) => {
    const streak = N.fbm(Math.cos(th) * 1 + seed, th * 3 + seed, 4) + N.ridged(th * 6 + seed, r * 2, 3) * 0.25;
    const outer = small ? 0.75 : 0.9;
    const soot = smooth(outer + streak * 0.25, 0.1, r + N.fbm(u * 5 + seed, v * 5, 4) * 0.2);
    const core = smooth(0.45, 0.05, r + N.fbm(u * 8, v * 8, 3) * 0.15);
    const flecks = smooth(0.4, 0.62, N.noise(u * 30 + seed, v * 30)) * smooth(1.0, 0.5, r) * 0.7;
    const d = mix(0.13, 0.02, core);
    const a = Math.max(soot * 0.92, flecks);
    return { c: [d, d * 0.95, d * 0.9], a, h: -core * 0.25 + N.fbm(u * 20, v * 20, 3) * core * 0.4, rough: 0.97 };
  };
  tile(D.SCORCH, scorch(61, false), 4);
  tile(D.SCORCH_SMALL, scorch(62, true), 4);

  // cloth / sandbag: frayed dark hole
  tile(D.CLOTH, (u, v, r, th) => {
    const jag = N.fbm(Math.cos(th) * 3, Math.sin(th) * 3, 4);
    const hole = smooth(0.2 + jag * 0.1, 0.12, r);
    const fray = smooth(0.4 + jag * 0.2, 0.15, r) * smooth(0.2, 0.6, Math.abs(Math.sin(th * 14 + N.noise(r * 10, th) * 3)));
    const c = hole > 0.5 ? [0.04, 0.035, 0.03] : [0.55, 0.5, 0.4];
    return { c, a: Math.max(hole, fray * 0.8), h: -hole * 0.5 + fray * 0.2, rough: 0.95 };
  }, 4);

  const mk = (arr, cs) => {
    const t = new THREE.DataTexture(arr, W, W, THREE.RGBAFormat);
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.anisotropy = 4; t.colorSpace = cs; t.needsUpdate = true; return t;
  };
  return { map: mk(alb, THREE.SRGBColorSpace), normalMap: mk(nrm, THREE.NoColorSpace), ormMap: mk(orm, THREE.NoColorSpace) };
}
