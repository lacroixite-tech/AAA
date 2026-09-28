import * as THREE from 'three';
/**
 * Small procedural textures for the weapons/viewmodel. All tileable, generated once at load.
 *  - noise   (256², RGBA): R fine grain, G large grime blotches, B scratches, A wear breakup
 *  - detail  (256², RGBA): R stipple height, G fabric weave height, B fine grain/knurl, A cast/brushed streaks
 *  - camo    (512², RGB) : multicam-style sleeve pattern
 *  - marks   (canvas text): receiver engravings, selector markings
 */

function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

function valueNoise(size, freq, rand) {
  const L = new Float32Array(freq * freq); for (let i = 0; i < L.length; i++) L[i] = rand();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * freq, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
    const y0 = iy % freq, y1 = (iy + 1) % freq;
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * freq, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
      const x0 = ix % freq, x1 = (ix + 1) % freq;
      const a = L[y0 * freq + x0], b = L[y0 * freq + x1], c = L[y1 * freq + x0], d = L[y1 * freq + x1];
      out[y * size + x] = (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    }
  }
  return out;
}
function fbm(size, freq, oct, seed, gain = 0.5) {
  const rand = rng(seed); const out = new Float32Array(size * size); let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const n = valueNoise(size, freq << o, rand);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    tot += amp; amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
function normalize(a) { let lo = 1e9, hi = -1e9; for (const v of a) { lo = Math.min(lo, v); hi = Math.max(hi, v); } const k = 1 / (hi - lo || 1); for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) * k; return a; }

function scratches(size, count, seed) {
  const rand = rng(seed); const out = new Float32Array(size * size);
  for (let i = 0; i < count; i++) {
    let x = rand() * size, y = rand() * size; const ang = rand() * Math.PI * 2, len = 6 + rand() * rand() * 70;
    const dx = Math.cos(ang), dy = Math.sin(ang), inten = 0.35 + rand() * 0.65; let bend = (rand() - 0.5) * 0.02;
    let a = ang;
    for (let t = 0; t < len; t++) {
      a += bend; x += Math.cos(a); y += Math.sin(a);
      const px = ((Math.round(x) % size) + size) % size, py = ((Math.round(y) % size) + size) % size;
      const fade = Math.sin((t / len) * Math.PI);
      out[py * size + px] = Math.max(out[py * size + px], inten * fade);
    }
    void dx; void dy;
  }
  return out;
}

function stipple(size, seed) {
  // dense random hemispherical bumps -> injection-moulded grip stippling
  const rand = rng(seed); const out = new Float32Array(size * size);
  const n = 2600;
  for (let i = 0; i < n; i++) {
    const cx = rand() * size, cy = rand() * size, r = 1.6 + rand() * 1.8, h = 0.6 + rand() * 0.4;
    const R = Math.ceil(r);
    for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
      const d2 = (ox * ox + oy * oy) / (r * r); if (d2 >= 1) continue;
      const px = ((Math.floor(cx) + ox) % size + size) % size, py = ((Math.floor(cy) + oy) % size + size) % size;
      out[py * size + px] = Math.max(out[py * size + px], h * Math.sqrt(1 - d2));
    }
  }
  return out;
}

function weave(size) {
  // cordura-like basket weave, 32 threads per tile
  const out = new Float32Array(size * size); const T = 32, p = size / T;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const cx = Math.floor(x / p), cy = Math.floor(y / p);
    const u = (x % p) / p, v = (y % p) / p;
    const over = (cx + cy) & 1;
    const hu = Math.sin(u * Math.PI), hv = Math.sin(v * Math.PI);
    out[y * size + x] = over ? 0.55 + 0.45 * hv * (0.7 + 0.3 * hu) : 0.55 + 0.45 * hu * (0.7 + 0.3 * hv);
  }
  return out;
}

function toTex(size, chans, { srgb = false, repeat = true } = {}) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) for (let c = 0; c < 4; c++) {
    const src = chans[c]; data[i * 4 + c] = src ? Math.max(0, Math.min(255, Math.round(src[i] * 255))) : 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function camo(size) {
  // Multicam-style: tan base, olive/brown blobs, dark branches, cream flecks.
  const base = [0.62, 0.55, 0.42];
  const layers = [
    { n: normalize(fbm(size, 4, 5, 11)), th: 0.55, c: [0.43, 0.42, 0.29] },
    { n: normalize(fbm(size, 4, 5, 23)), th: 0.60, c: [0.44, 0.33, 0.22] },
    { n: normalize(fbm(size, 8, 4, 37)), th: 0.68, c: [0.30, 0.31, 0.21] },
    { n: normalize(fbm(size, 8, 4, 51)), th: 0.72, c: [0.76, 0.71, 0.56] },
    { n: normalize(fbm(size, 16, 3, 61)), th: 0.74, c: [0.22, 0.18, 0.13] },
  ];
  const grain = fbm(size, 64, 2, 71);
  const R = new Float32Array(size * size), G = new Float32Array(size * size), B = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    let c = base;
    for (const L of layers) if (L.n[i] > L.th) c = L.c;
    const g = 0.88 + grain[i] * 0.24;
    R[i] = c[0] * g; G[i] = c[1] * g; B[i] = c[2] * g;
  }
  return toTex(size, [R, G, B, null], { srgb: true });
}

function markings() {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256;
  const c = cv.getContext('2d');
  c.fillStyle = '#000'; c.fillRect(0, 0, 1024, 256);
  c.fillStyle = '#fff'; c.textBaseline = 'middle';
  // row 0: receiver roll mark
  c.font = 'bold 44px Arial, Helvetica, sans-serif';
  c.fillText('M4A1 CARBINE', 20, 36); c.font = 'bold 30px Arial, Helvetica, sans-serif';
  c.fillText('CAL 5.56 MM  ·  SER W-117734', 20, 86);
  // row 1: selector marks
  c.font = 'bold 40px Arial, Helvetica, sans-serif';
  c.fillText('SAFE', 540, 36); c.fillText('SEMI', 700, 36); c.fillText('AUTO', 860, 36);
  // row 2: rail numbers
  c.font = 'bold 34px Arial, Helvetica, sans-serif';
  for (let i = 0; i < 24; i++) c.fillText(String(i + 1), 8 + i * 42, 160);
  // row 3: optic brand + small text
  c.font = 'bold 40px Arial, Helvetica, sans-serif';
  c.fillText('HOLO', 20, 220); c.font = '28px Arial, Helvetica, sans-serif';
  c.fillText('EXPS-3  NV', 150, 222); c.fillText('▲  ▼', 420, 220);
  const t = new THREE.CanvasTexture(cv); t.anisotropy = 4; t.colorSpace = THREE.NoColorSpace;
  return t;
}

let cache = null;
export function weaponTextures() {
  if (cache) return cache;
  const S = 256;
  const fine = normalize(fbm(S, 16, 4, 3));
  const grime = normalize(fbm(S, 4, 5, 7));
  const scr = scratches(S, 140, 9);
  const wearN = normalize(fbm(S, 8, 5, 13, 0.6));
  const noise = toTex(S, [fine, grime, scr, wearN]);

  const st = stipple(S, 17);
  const wv = weave(S);
  const grain = normalize(fbm(S, 64, 2, 19));
  const streak = new Float32Array(S * S);
  { const rand = rng(29); const rows = new Float32Array(S); for (let y = 0; y < S; y++) rows[y] = rand(); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) streak[y * S + x] = rows[y] * 0.7 + grain[y * S + x] * 0.3; }
  const detail = toTex(S, [st, wv, grain, streak]);

  cache = { noise, detail, camo: camo(512), marks: markings() };
  return cache;
}
