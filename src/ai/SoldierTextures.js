import * as THREE from 'three';
import { makeNoise, clamp, smooth, mulberry32 } from './util.js';

/**
 * Procedural textures for soldiers: camo uniforms (with fold wrinkles baked into albedo + normal),
 * cordura / MOLLE gear fabric, worn polymer/metal "hard" surfaces, knit balaclava heads.
 * All tileable, generated once and cached.
 */

const cache = new Map();
function cached(key, fn) { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); }

function dataTex(data, w, h, srgb, repeat = 1) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.repeat.set(repeat, repeat);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** height field (Float32, tileable) -> tangent-space normal map bytes */
function heightToNormal(hf, w, h, strength) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w, yp = ((y + 1) % h) * w, yc = y * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w, xp = (x + 1) % w;
      const dx = (hf[yc + xp] - hf[yc + xm]) * strength;
      const dy = (hf[yp + x] - hf[ym + x]) * strength;
      const il = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (yc + x) * 4;
      out[i] = (-dx * il * 0.5 + 0.5) * 255;
      out[i + 1] = (dy * il * 0.5 + 0.5) * 255; // DataTexture: row 0 = v 0 (no flip)
      out[i + 2] = (il * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------- uniform fabric
const UNI = 512; // uniform texture covers 0.5 m x 0.5 m (repeat set by UVs in meters x2)

/** wrinkle / fold height field shared by all uniforms (creases run around limbs = along u). */
function uniformHeight() {
  return cached('uniH', () => {
    const n = makeNoise(11), n2 = makeNoise(12), n3 = makeNoise(13);
    const hf = new Float32Array(UNI * UNI);
    const fold = new Float32Array(UNI * UNI);
    for (let y = 0; y < UNI; y++) {
      const v = y / UNI;
      for (let x = 0; x < UNI; x++) {
        const u = x / UNI;
        // warp coordinates so creases wobble
        const wu = u + (n.fbm(u, v, 4, 2) - 0.5) * 0.12;
        const wv = v + (n2.fbm(u, v, 3, 2) - 0.5) * 0.10;
        // folds: anisotropic ridged noise (stretched along u)
        let f = 0;
        const a = n3(wu * 3, wv * 14, 3) ; const b = n3(wu * 5 + 17.3, wv * 22 + 5.1, 5);
        const c = n(wu * 2 + 3.7, wv * 9, 2);
        f += (1 - Math.abs(a * 2 - 1)) ** 3 * 0.55;
        f += (1 - Math.abs(b * 2 - 1)) ** 4 * 0.3;
        f += c * 0.35;
        // large soft bulges
        f += n2.fbm(u, v, 2, 2) * 0.5;
        // ripstop grid (5 mm => 100 cells per 0.5 m)
        const gx = (u * 70) % 1, gy = (v * 70) % 1;
        const grid = (Math.min(gx, 1 - gx) < 0.06 || Math.min(gy, 1 - gy) < 0.06) ? 0.006 : 0;
        // twill weave
        const tw = ((x + y) % 4 < 2 ? 0.0015 : 0);
        hf[y * UNI + x] = f * 0.35 + grid + tw;
        fold[y * UNI + x] = f;
      }
    }
    return { hf, fold };
  });
}

export function uniformNormal() {
  return cached('uniN', () => {
    const { hf } = uniformHeight();
    return dataTex(heightToNormal(hf, UNI, UNI, 22), UNI, UNI, false);
  });
}

const CAMO = {
  multicam: {
    base: [158, 146, 112],
    layers: [
      { c: [116, 118, 84], scale: 3, th: 0.54, seed: 21, sy: 0.6 },
      { c: [120, 98, 70], scale: 4, th: 0.58, seed: 22, sy: 0.55 },
      { c: [86, 92, 62], scale: 5, th: 0.63, seed: 23, sy: 0.6 },
      { c: [70, 56, 42], scale: 5, th: 0.0, seed: 24, sy: 0.5, branch: 0.035 },
      { c: [196, 186, 150], scale: 9, th: 0.70, seed: 25, sy: 0.7 },
    ],
  },
  emr: {
    base: [132, 136, 106], pixel: 96,
    layers: [
      { c: [88, 100, 68], scale: 4, th: 0.50, seed: 31, sy: 1 },
      { c: [96, 80, 60], scale: 5, th: 0.58, seed: 32, sy: 1 },
      { c: [40, 40, 34], scale: 6, th: 0.66, seed: 33, sy: 1 },
    ],
  },
  m81: {
    base: [150, 140, 104],
    layers: [
      { c: [92, 104, 70], scale: 2, th: 0.45, seed: 41, sy: 0.8 },
      { c: [98, 76, 54], scale: 3, th: 0.57, seed: 42, sy: 0.8 },
      { c: [36, 34, 30], scale: 4, th: 0.64, seed: 43, sy: 0.7 },
    ],
  },
  black: { base: [44, 44, 46], layers: [{ c: [34, 34, 36], scale: 3, th: 0.5, seed: 51, sy: 1 }] },
  ranger: { base: [74, 78, 60], layers: [{ c: [66, 70, 54], scale: 3, th: 0.52, seed: 61, sy: 1 }] },
  tan: { base: [150, 134, 104], layers: [{ c: [138, 122, 94], scale: 3, th: 0.52, seed: 71, sy: 1 }] },
};

export function camoTexture(kind) {
  return cached('camo:' + kind, () => {
    const def = CAMO[kind] || CAMO.multicam;
    const { fold } = uniformHeight();
    const noises = def.layers.map((l) => makeNoise(l.seed));
    const dirtN = makeNoise(99), fade = makeNoise(98);
    // evaluate the (smooth) noise fields at quarter resolution, upsample bilinearly
    const F = UNI >> 1;
    const field = (fn) => { const a = new Float32Array(F * F); for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) a[y * F + x] = fn(x / F, y / F); return a; };
    const sample = (a, u, v) => {
      const fx = u * F - 0.5, fy = v * F - 0.5; const x0 = Math.floor(fx), y0 = Math.floor(fy); const tx = fx - x0, ty = fy - y0;
      const X0 = (x0 + F) % F, X1 = (x0 + 1 + F) % F, Y0 = (y0 + F) % F, Y1 = (y0 + 1 + F) % F;
      return (a[Y0 * F + X0] * (1 - tx) + a[Y0 * F + X1] * tx) * (1 - ty) + (a[Y1 * F + X0] * (1 - tx) + a[Y1 * F + X1] * tx) * ty;
    };
    const fields = def.layers.map((l, i) => def.pixel ? null : field((u, v) => noises[i].fbm(u, v * l.sy + u * 0.1, l.scale, 4, 0.55)));
    const masks = def.layers.map((l, i) => (l.branch ? field((u, v) => noises[i].fbm(u + 0.3, v, l.scale - 2, 2)) : null));
    const dirtF = field((u, v) => dirtN.fbm(u, v, 3, 3)), fadeF = field((u, v) => fade.fbm(u, v, 5, 2));
    const data = new Uint8Array(UNI * UNI * 4);
    for (let y = 0; y < UNI; y++) {
      for (let x = 0; x < UNI; x++) {
        let u = x / UNI, v = y / UNI;
        if (def.pixel) { u = Math.floor(u * def.pixel) / def.pixel; v = Math.floor(v * def.pixel) / def.pixel; }
        let r = def.base[0], g = def.base[1], b = def.base[2];
        for (let i = 0; i < def.layers.length; i++) {
          const l = def.layers[i];
          const val = def.pixel ? noises[i].fbm(u, v * l.sy + u * 0.1, l.scale, 3, 0.55) : sample(fields[i], u, v);
          let a;
          if (l.branch) a = (Math.abs(val - 0.5) < l.branch && sample(masks[i], u, v) > 0.5) ? 1 : 0;
          else a = def.pixel ? (val > l.th ? 1 : 0) : smooth(l.th - 0.008, l.th + 0.008, val);
          r += (l.c[0] - r) * a; g += (l.c[1] - g) * a; b += (l.c[2] - b) * a;
        }
        const i = y * UNI + x;
        // fold shading (darken creases), faded / dirty zones, weave
        const f = fold[i];
        const shade = 0.88 + 0.2 * clamp(f, 0, 1);
        const d = sample(dirtF, x / UNI, y / UNI);
        const fd = sample(fadeF, x / UNI, y / UNI);
        const weave = ((x + y) % 4 < 2 ? 1.012 : 0.988);
        let k = shade * weave * (0.9 + 0.2 * d);
        // sun-fade: pull toward grey-tan
        const fa = smooth(0.5, 0.8, fd) * 0.25;
        r = r + (150 - r) * fa; g = g + (142 - g) * fa; b = b + (120 - b) * fa;
        data[i * 4] = clamp(r * k, 0, 255); data[i * 4 + 1] = clamp(g * k, 0, 255); data[i * 4 + 2] = clamp(b * k, 0, 255); data[i * 4 + 3] = 255;
      }
    }
    return dataTex(data, UNI, UNI, true);
  });
}

// ---------------------------------------------------------------- gear (cordura / MOLLE)
const GEAR = 512; // covers 0.25 m

export function gearTextures(molle) {
  return cached('gear:' + molle, () => {
    const n = makeNoise(molle ? 81 : 82), n2 = makeNoise(83);
    const hf = new Float32Array(GEAR * GEAR);
    const alb = new Uint8Array(GEAR * GEAR * 4);
    const rough = new Uint8Array(GEAR * GEAR * 4);
    const mmPerPx = 250 / GEAR;
    for (let y = 0; y < GEAR; y++) {
      for (let x = 0; x < GEAR; x++) {
        const u = x / GEAR, v = y / GEAR;
        // 1000D cordura basket weave
        const wx = (x >> 1) & 1, wy = (y >> 1) & 1;
        let h = (wx ^ wy) ? 0.02 : 0.0;
        h += (n(u * 180, v * 180, 180) - 0.5) * 0.02;
        let col = 0.74 + (wx ^ wy ? 0.03 : -0.02);
        let rg = 0.86;
        if (molle) {
          const ymm = y * mmPerPx; // rows every 38 mm (1.5"), webbing 25 mm
          const rowPos = ymm % 38.0;
          const onWeb = rowPos > 4 && rowPos < 29;
          if (onWeb) {
            const e = Math.min(rowPos - 4, 29 - rowPos);
            h += 0.25 + Math.min(e, 1.5) * 0.08;
            // webbing twill: diagonal ribs
            h += (((x + y) >> 1) % 3 === 0 ? 0.03 : 0);
            col -= 0.07; rg = 0.8;
            // bar-tack stitches every 38 mm across webbing
            const xmm = x * mmPerPx; const cp = xmm % 38.0;
            if (cp < 2.2) { h += 0.06; col += 0.05; }
            // edge stitching lines
            if (Math.abs(e - 2.0) < 0.6) { h -= 0.05; col -= 0.04; }
          }
        } else {
          // occasional seams/stitch lines on plain fabric
          const s = (x * mmPerPx) % 125;
          if (s < 1.2) { h -= 0.03; col -= 0.04; }
        }
        // wear, dirt, fuzz
        const dirt = n2.fbm(u, v, 3, 3);
        col *= 0.88 + 0.22 * dirt;
        const fuzz = n(u * 60 + 3, v * 60, 60);
        col *= 0.96 + 0.08 * fuzz;
        hf[y * GEAR + x] = h;
        const c = clamp(col * 255, 0, 255);
        alb.set([c, c, c, 255], (y * GEAR + x) * 4);
        const rr = clamp((rg + (1 - dirt) * 0.1) * 255, 0, 255);
        rough.set([rr, rr, rr, 255], (y * GEAR + x) * 4);
      }
    }
    return {
      map: dataTex(alb, GEAR, GEAR, true),
      normalMap: dataTex(heightToNormal(hf, GEAR, GEAR, 10), GEAR, GEAR, false),
      roughnessMap: dataTex(rough, GEAR, GEAR, false),
    };
  });
}

// ---------------------------------------------------------------- hard surfaces (polymer, metal, paint)
export function hardTextures() {
  return cached('hard', () => {
    const S = 512; // covers 0.3 m
    const n = makeNoise(91), n2 = makeNoise(92), r = mulberry32(93);
    const alb = new Float32Array(S * S).fill(0.82);
    const rough = new Float32Array(S * S);
    const hf = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S, i = y * S + x;
      const g = n.fbm(u, v, 4, 5);
      const speck = n2(u * 128, v * 128, 128);
      alb[i] = 0.72 + 0.22 * g + (speck > 0.8 ? 0.05 : 0);
      rough[i] = 0.5 + 0.35 * (1 - g);
      hf[i] = speck * 0.04 + g * 0.05; // stipple texture
    }
    // scratches: bright thin lines
    for (let k = 0; k < 220; k++) {
      let x = r() * S, y = r() * S; const a = r() * Math.PI * 2, len = 4 + r() * 30, br = 0.03 + r() * 0.12;
      for (let t = 0; t < len; t++) {
        const xi = ((Math.floor(x) % S) + S) % S, yi = ((Math.floor(y) % S) + S) % S, i = yi * S + xi;
        alb[i] += br; rough[i] -= 0.15; hf[i] -= 0.03;
        x += Math.cos(a); y += Math.sin(a);
      }
    }
    const a8 = new Uint8Array(S * S * 4), r8 = new Uint8Array(S * S * 4);
    for (let i = 0; i < S * S; i++) {
      const c = clamp(alb[i] * 255, 0, 255), rr = clamp(rough[i] * 255, 0, 255);
      a8[i * 4] = a8[i * 4 + 1] = a8[i * 4 + 2] = c; a8[i * 4 + 3] = 255;
      r8[i * 4] = r8[i * 4 + 1] = r8[i * 4 + 2] = rr; r8[i * 4 + 3] = 255;
    }
    return { map: dataTex(a8, S, S, true), roughnessMap: dataTex(r8, S, S, false), normalMap: dataTex(heightToNormal(hf, S, S, 6), S, S, false) };
  });
}

// ---------------------------------------------------------------- head: knit balaclava with eye opening
/**
 * Head uses SphereGeometry UVs: u around (0.25 = face front), v up (1 = top).
 * opts: { knit:[r,g,b], skin:[r,g,b], open: bool (eye opening) }
 */
export function headTextures(key, opts) {
  return cached('head:' + key, () => {
    const W = 1024, H = 512;
    const n = makeNoise(101), n2 = makeNoise(102);
    const alb = new Uint8Array(W * H * 4);
    const hf = new Float32Array(W * H);
    const rough = new Uint8Array(W * H * 4);
    const [kr, kg, kb] = opts.knit, [sr, sg, sb] = opts.skin;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H, i = y * W + x;
      // knit: columns of V stitches (~2.5 mm). head circumference ~0.58 m => ~230 columns
      const cx = u * 230, cy = v * 150 * 2;
      const fx = cx % 1, fy = cy % 1;
      const vshape = Math.abs(fx - 0.5) * 2; // 0 center .. 1 edge
      const loop = Math.sin((fy + vshape * 0.5) * Math.PI * 2) * 0.5 + 0.5;
      let h = (1 - vshape) * 0.6 * loop + 0.2 * n(u * 40, v * 20, 40);
      let col = 0.93 + 0.1 * loop * (1 - vshape * 0.5);
      const fuzz = n2(u * 32, v * 32, 32);
      col *= 0.9 + 0.2 * fuzz;
      // fabric creases & cavity shading on the face (balaclava drapes over nose, mouth, chin and bunches at the neck)
      const segD = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(u - ax - dx * t, (v - ay - dy * t)); };
      let crease = 0;
      for (const sgn of [-1, 1]) {
        crease += Math.exp(-((segD(0.25 + sgn * 0.03, 0.44, 0.25 + sgn * 0.05, 0.37) / 0.012) ** 2)) * 0.35; // nasolabial
        crease += Math.exp(-((segD(0.25 + sgn * 0.07, 0.46, 0.25 + sgn * 0.1, 0.4) / 0.014) ** 2)) * 0.2; // cheek fold
      }
      crease += Math.exp(-((segD(0.235, 0.31, 0.265, 0.31) / 0.006) ** 2)) * 0.5; // chin crease
      const neck = smooth(0.26, 0.12, v) * (0.5 + 0.5 * Math.sin(v * 160 + Math.sin(u * 40) * 2)) ** 3;
      crease += neck * 0.6;
      const cav = Math.exp(-(((u - 0.25) / 0.02) ** 2) - (((v - 0.435) / 0.012) ** 2)) * 0.5 // under nose
        + Math.exp(-(((u - 0.25) / 0.03) ** 2) - (((v - 0.39) / 0.008) ** 2)) * 0.35; // mouth line
      col *= 1 - 0.35 * Math.min(1, crease) - cav;
      h -= crease * 1.2;
      let r = kr * col, g = kg * col, b = kb * col, rg = 0.95;
      // eye opening (rounded band across both eyes)
      if (opts.open) {
        const du = (u - 0.25) / 0.1, dv = (v - 0.52) / 0.06;
        const d = Math.pow(Math.pow(Math.abs(du), 4) + Math.pow(Math.abs(dv), 4), 0.25);
        if (d < 1.12) {
          const e = smooth(1.12, 0.96, d); // 1 inside skin
          const rim = smooth(0.9, 1.0, d) * (1 - smooth(1.0, 1.12, d));
          const sk = 0.82 + 0.18 * n2.fbm(u * 3, v * 3, 12, 3);
          const ex = Math.abs(u - 0.25) - 0.058, ey = v - 0.518;
          // sockets / under-brow shadow
          const sock = Math.exp(-((ex / 0.04) ** 2) - ((ey / 0.03) ** 2));
          const skinK = sk * (1 - 0.4 * sock) * (0.7 + 0.3 * smooth(0.49, 0.55, v)) * (1 - 0.35 * smooth(0.53, 0.555, v));
          r = r * (1 - e) + sr * skinK * e; g = g * (1 - e) + sg * skinK * e; b = b * (1 - e) + sb * skinK * e;
          const ed = Math.hypot(ex / 0.026, ey / 0.016);
          if (ed < 1) { const irisD = Math.hypot(ex / 0.011, ey / 0.016); const iris = irisD < 0.9; const k2 = 1 - 0.5 * smooth(0.6, 1, ed); r = (iris ? 48 : 175) * k2; g = (iris ? 38 : 160) * k2; b = (iris ? 30 : 150) * k2; if (irisD < 0.35) { r = g = b = 10; } rg = 0.15; }
          h = h * (1 - e) - rim * 0.8;
          rg = e > 0.5 && rg > 0.3 ? 0.55 : rg;
        }
      }
      alb[i * 4] = clamp(r, 0, 255); alb[i * 4 + 1] = clamp(g, 0, 255); alb[i * 4 + 2] = clamp(b, 0, 255); alb[i * 4 + 3] = 255;
      rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = rg * 255; rough[i * 4 + 3] = 255;
      hf[i] = h;
    }
    return { map: dataTex(alb, W, H, true), normalMap: dataTex(heightToNormal(hf, W, H, 1.6), W, H, false), roughnessMap: dataTex(rough, W, H, false) };
  });
}
