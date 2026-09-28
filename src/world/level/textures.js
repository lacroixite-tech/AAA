import * as THREE from 'three';
import { rng } from './geom.js';

/** Procedural canvas textures owned by the level (decals, signage, alpha cards). */
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, { srgb = true, repeat = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso; t.needsUpdate = true;
  return t;
}

function noiseBlob(ctx, cx, cy, r, r0, alpha, color, n = 60) {
  for (let i = 0; i < n; i++) {
    const a = r0() * Math.PI * 2, d = Math.sqrt(r0()) * r * 0.8;
    const rr = r * (0.15 + r0() * 0.35);
    const g = ctx.createRadialGradient(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0, cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr);
    g.addColorStop(0, `rgba(${color},${alpha})`); g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr, 0, Math.PI * 2); ctx.fill();
  }
}

const cache = new Map();
function memo(k, f) { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); }

/** Worn paint mask for road markings (white on transparent, streaky wear). */
export function paintWear() {
  return memo('paint', () => {
    const [c, x] = canvas(256, 256); const r = rng(11);
    x.fillStyle = '#fff'; x.fillRect(0, 0, 256, 256);
    x.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 900; i++) {
      x.globalAlpha = r() * 0.5; x.fillStyle = '#000';
      const w = 2 + r() * 30, h = 1 + r() * 4;
      x.fillRect(r() * 256, r() * 256, w, h);
    }
    for (let i = 0; i < 40; i++) { x.globalAlpha = 0.25 + r() * 0.5; x.beginPath(); x.arc(r() * 256, r() * 256, 4 + r() * 22, 0, 7); x.fill(); }
    return tex(c, { srgb: false, repeat: true });
  });
}

/** Generic soft grime / stain alpha blob. */
export function stainTex(seed = 3) {
  return memo('stain' + seed, () => {
    const [c, x] = canvas(256, 256); const r = rng(seed);
    noiseBlob(x, 128, 128, 110, r, 0.22, '255,255,255', 70);
    for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(255,255,255,${r() * 0.2})`; const a = r() * 7, d = r() * 100; x.fillRect(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 2, 2); }
    return tex(c, { srgb: false });
  });
}

/** Vertical streak grime (water leaks under sills / roofs). alpha in red channel. */
export function streakTex(seed = 5) {
  return memo('streak' + seed, () => {
    const [c, x] = canvas(128, 256); const r = rng(seed);
    for (let i = 0; i < 70; i++) {
      const sx = 10 + r() * 108, w = 1 + r() * 7, len = 40 + r() * 216;
      const g = x.createLinearGradient(0, 0, 0, len);
      const a = 0.08 + r() * 0.3;
      g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(sx, 0, w, len);
    }
    const g = x.createLinearGradient(0, 0, 0, 40); g.addColorStop(0, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 40);
    // soften horizontal edges
    x.globalCompositeOperation = 'destination-in';
    const h = x.createLinearGradient(0, 0, 128, 0); h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(0.15, 'rgba(0,0,0,1)'); h.addColorStop(0.85, 'rgba(0,0,0,1)'); h.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = h; x.fillRect(0, 0, 128, 256);
    return tex(c, { srgb: false });
  });
}

/** Burn / soot scorch around blown windows: alpha, stronger at bottom-center, fading up in plumes. */
export function sootTex() {
  return memo('soot', () => {
    const [c, x] = canvas(256, 256); const r = rng(77);
    for (let i = 0; i < 120; i++) {
      const px = 128 + (r() - 0.5) * 140 * (1 - i / 160), py = 220 - r() * 210 * (i / 120) - 10;
      const rad = 20 + r() * 50;
      const g = x.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, `rgba(255,255,255,${0.12 + r() * 0.12})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, 7); x.fill();
    }
    return tex(c, { srgb: false });
  });
}

/** Puddle alpha mask with irregular edge. */
export function puddleTex(seed = 9) {
  return memo('puddle' + seed, () => {
    const [c, x] = canvas(256, 256); const r = rng(seed);
    x.fillStyle = '#000'; x.fillRect(0, 0, 256, 256);
    x.filter = 'blur(6px)';
    for (let i = 0; i < 14; i++) {
      x.fillStyle = '#fff'; x.beginPath();
      x.ellipse(128 + (r() - 0.5) * 120, 128 + (r() - 0.5) * 90, 25 + r() * 45, 18 + r() * 35, r() * 3, 0, 7); x.fill();
    }
    x.filter = 'none';
    return tex(c, { srgb: false });
  });
}

/** Chain-link fence alpha texture (1 tile = 0.5m). */
export function chainlinkTex() {
  return memo('chain', () => {
    const [c, x] = canvas(128, 128);
    x.strokeStyle = '#fff'; x.lineWidth = 5; x.lineCap = 'round';
    const s = 64;
    for (let i = -2; i < 4; i++) {
      x.beginPath(); for (let j = 0; j <= 4; j++) { const yy = j * 32; const xx = i * s + (j % 2 ? 32 : 0); j ? x.lineTo(xx, yy) : x.moveTo(xx, yy); } x.stroke();
    }
    return tex(c, { srgb: false, repeat: true });
  });
}

/** Wire mesh grid for hesco cages. */
export function gridTex() {
  return memo('grid', () => {
    const [c, x] = canvas(64, 64);
    x.strokeStyle = '#fff'; x.lineWidth = 3; x.strokeRect(0, 0, 64, 64);
    return tex(c, { srgb: false, repeat: true });
  });
}

/** Grass tuft card: color with alpha. */
export function grassTex(dry = false) {
  return memo('grass' + dry, () => {
    const [c, x] = canvas(256, 256); const r = rng(dry ? 31 : 21);
    for (let i = 0; i < 140; i++) {
      const bx = 20 + r() * 216, h = 60 + r() * 190, lean = (r() - 0.5) * 70;
      const t = r();
      const col = dry ? [150 + t * 60, 130 + t * 50, 80 + t * 30] : [80 + t * 70, 95 + t * 60, 40 + t * 30];
      if (!dry && r() < 0.3) { col[0] += 50; col[1] += 25; }
      x.strokeStyle = `rgb(${col.map((v) => v | 0).join(',')})`; x.lineWidth = 1.5 + r() * 2.5;
      x.beginPath(); x.moveTo(bx, 256); x.quadraticCurveTo(bx + lean * 0.3, 256 - h * 0.6, bx + lean, 256 - h); x.stroke();
    }
    return tex(c);
  });
}

/** Leaf cluster card (sparse autumn foliage). */
export function leafTex() {
  return memo('leaf', () => {
    const [c, x] = canvas(256, 256); const r = rng(41);
    for (let i = 0; i < 260; i++) {
      const a = r() * 7, d = Math.sqrt(r()) * 110;
      const px = 128 + Math.cos(a) * d, py = 128 + Math.sin(a) * d * 0.8;
      const t = r();
      x.fillStyle = `rgb(${(110 + t * 90) | 0},${(90 + t * 50) | 0},${(30 + t * 20) | 0})`;
      x.save(); x.translate(px, py); x.rotate(r() * 7); x.beginPath(); x.ellipse(0, 0, 5 + r() * 5, 2.5 + r() * 2, 0, 0, 7); x.fill(); x.restore();
    }
    x.strokeStyle = 'rgb(50,40,30)'; x.lineWidth = 2;
    for (let i = 0; i < 12; i++) { x.beginPath(); x.moveTo(128, 128); const a = r() * 7; x.lineTo(128 + Math.cos(a) * 100, 128 + Math.sin(a) * 90); x.stroke(); }
    return tex(c);
  });
}

/** Curtain fabric (folds) with ragged alpha edge. */
export function curtainTex(seed) {
  return memo('curtain' + seed, () => {
    const [c, x] = canvas(128, 256); const r = rng(seed);
    const pal = [[150, 120, 90], [110, 60, 55], [170, 160, 140], [90, 100, 110], [140, 130, 80], [120, 95, 110]];
    const base = pal[seed % pal.length];
    for (let px = 0; px < 128; px++) {
      const f = 0.65 + 0.35 * Math.sin(px * 0.35 + Math.sin(px * 0.07) * 3);
      x.fillStyle = `rgb(${(base[0] * f) | 0},${(base[1] * f) | 0},${(base[2] * f) | 0})`; x.fillRect(px, 0, 1, 256);
    }
    if (seed % 3 === 0) { x.globalAlpha = 0.25; for (let i = 0; i < 40; i++) { x.fillStyle = '#fff'; x.fillRect(r() * 128, r() * 256, 6, 6); } x.globalAlpha = 1; }
    const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0.1)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 256);
    x.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 12; i++) { x.beginPath(); x.moveTo(r() * 128, 256); x.lineTo(r() * 128, 200 + r() * 56); x.lineTo(r() * 128, 256); x.fill(); }
    return tex(c);
  });
}

const SIGNS = [
  ['ПРОДУКТЫ', '#e8dcc0', '#8a2a1e'], ['АПТЕКА', '#f0f0e8', '#2a6a3a'], ['ХЛЕБ', '#2c3a52', '#e0c890'],
  ['РЕМОНТ ОБУВИ', '#d8c8a0', '#302a26'], ['КАФЕ «ВОЛНА»', '#1e3a4a', '#d8d0b0'], ['ГАСТРОНОМ', '#7a2420', '#efe0c0'],
  ['ПАРИКМАХЕРСКАЯ', '#e4e0d4', '#1f3e6a'], ['ОВОЩИ ФРУКТЫ', '#3a5a2a', '#f0e8c8'], ['СТРОЙМАТЕРИАЛЫ', '#c8a032', '#1a1a1a'],
  ['МАГАЗИН 24', '#1a2a5a', '#f0d040'], ['ПОЧТА', '#1a4a8a', '#f0f0f0'], ['СКЛАД №3', '#6a6a60', '#f0f0e0'],
];
/** Shop signage texture (weathered). Returns {map, aspect}. */
export function signTex(i) {
  return memo('sign' + i, () => {
    const [txt, bg, fg] = SIGNS[i % SIGNS.length];
    const [c, x] = canvas(1024, 160); const r = rng(100 + i);
    x.fillStyle = bg; x.fillRect(0, 0, 1024, 160);
    x.strokeStyle = fg; x.lineWidth = 6; x.strokeRect(10, 10, 1004, 140);
    x.fillStyle = fg; x.font = 'bold 96px "Arial Narrow", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(txt, 512, 84, 960);
    // weathering: fading, dirt, missing letters, rust bleed
    for (let k = 0; k < 500; k++) { x.fillStyle = `rgba(${r() < 0.5 ? '40,30,20' : '230,225,210'},${r() * 0.15})`; x.fillRect(r() * 1024, r() * 160, 2 + r() * 24, 1 + r() * 6); }
    for (let k = 0; k < 30; k++) {
      const sx = r() * 1024, g = x.createLinearGradient(0, 0, 0, 160); g.addColorStop(0, 'rgba(90,50,20,0.3)'); g.addColorStop(1, 'rgba(90,50,20,0)');
      x.fillStyle = g; x.fillRect(sx, 0, 2 + r() * 5, 60 + r() * 100);
    }
    if (r() < 0.6) { x.fillStyle = bg; x.globalAlpha = 0.85; x.fillRect(200 + r() * 600, 30, 50 + r() * 40, 110); x.globalAlpha = 1; }
    for (let k = 0; k < 6; k++) { x.fillStyle = 'rgba(20,15,10,0.9)'; x.beginPath(); x.arc(r() * 1024, r() * 160, 2 + r() * 4, 0, 7); x.fill(); } // bullet holes
    return tex(c);
  });
}
export const SIGN_COUNT = SIGNS.length;

/** Street/propaganda posters & graffiti atlas (4x2 cells). */
export function posterTex() {
  return memo('poster', () => {
    const [c, x] = canvas(1024, 512); const r = rng(55);
    const texts = ['ВЫБОРЫ', 'НЕТ ВОЙНЕ', 'ЦИРК', 'КОНЦЕРТ', 'ВНИМАНИЕ', 'МИНЫ!', 'ЛЮДИ', 'ДЕТИ'];
    for (let i = 0; i < 8; i++) {
      const cx = (i % 4) * 256, cy = Math.floor(i / 4) * 256;
      const hue = r() * 360;
      x.fillStyle = i === 5 ? '#c8b89a' : `hsl(${hue},${20 + r() * 30}%,${45 + r() * 30}%)`; x.fillRect(cx + 8, cy + 8, 240, 240);
      x.fillStyle = `hsl(${(hue + 180) % 360},30%,20%)`; x.fillRect(cx + 30, cy + 40, 196, 110 * r() + 40);
      x.fillStyle = i === 5 ? '#901010' : '#1a1a1a'; x.font = 'bold 36px Arial'; x.textAlign = 'center'; x.fillText(texts[i], cx + 128, cy + 210, 220);
      for (let k = 0; k < 60; k++) { x.fillStyle = `rgba(230,225,210,${r() * 0.4})`; x.fillRect(cx + 8 + r() * 240, cy + 8 + r() * 240, 3 + r() * 20, 2 + r() * 8); }
      x.clearRect(cx + 8 + r() * 200, cy + 150 + r() * 60, 50 + r() * 60, 40); // torn
    }
    return tex(c);
  });
}

/** Graffiti tags (alpha). */
export function graffitiTex() {
  return memo('graf', () => {
    const [c, x] = canvas(512, 256); const r = rng(66);
    const words = ['Z', 'ГРАД', 'ОПАСНО', 'ЛЮДИ', '15', '↓ ПОДВАЛ'];
    for (let i = 0; i < 6; i++) {
      x.save(); x.translate(40 + (i % 3) * 160, 70 + Math.floor(i / 3) * 128); x.rotate((r() - 0.5) * 0.2);
      x.font = `bold ${40 + r() * 24}px Arial`; x.fillStyle = r() < 0.5 ? 'rgba(20,20,20,0.85)' : 'rgba(170,30,25,0.85)';
      x.fillText(words[i], 0, 0); x.restore();
    }
    return tex(c);
  });
}

/** Distant building facade: window grid, some lit dimly, for backdrop. Returns tiled texture (1 tile = 3m x 3m). */
export function backdropWindowTex() {
  return memo('bdwin', () => {
    const [c, x] = canvas(256, 256); const r = rng(88);
    x.fillStyle = '#fff'; x.fillRect(0, 0, 256, 256);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const v = r();
      x.fillStyle = v < 0.2 ? '#050505' : v < 0.7 ? '#25272a' : '#3a3c40';
      x.fillRect(i * 128 + 30, j * 128 + 34, 68, 70);
      x.fillStyle = '#9a9a9a'; x.fillRect(i * 128 + 24, j * 128 + 104, 80, 6);
    }
    return tex(c, { repeat: true });
  });
}
