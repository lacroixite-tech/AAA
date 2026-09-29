import * as THREE from 'three';
import { rng } from './geom.js';

/** Procedural canvas textures owned by the level (decals, signage, alpha cards). */
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, { srgb = true, repeat = false, aniso = 8, mask = false } = {}) {
  if (mask) {
    // alphaMap samples the GREEN channel: flatten the drawing onto opaque black so coverage becomes luminance
    const [m, x] = canvas(c.width, c.height); x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height); x.drawImage(c, 0, 0); c = m;
  }
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
    return tex(c, { srgb: false, repeat: true, mask: true });
  });
}

/** Generic soft grime / stain alpha blob. */
export function stainTex(seed = 3) {
  return memo('stain' + seed, () => {
    const [c, x] = canvas(256, 256); const r = rng(seed);
    noiseBlob(x, 128, 128, 110, r, 0.22, '255,255,255', 70);
    for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(255,255,255,${r() * 0.2})`; const a = r() * 7, d = r() * 100; x.fillRect(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, 2, 2); }
    return tex(c, { srgb: false, mask: true });
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
    return tex(c, { srgb: false, mask: true });
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
    return tex(c, { srgb: false, mask: true });
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
    return tex(c, { srgb: false, repeat: true, mask: true });
  });
}

/** Wire mesh grid for hesco cages. */
export function gridTex() {
  return memo('grid', () => {
    const [c, x] = canvas(64, 64);
    x.strokeStyle = '#fff'; x.lineWidth = 7; x.strokeRect(0, 0, 64, 64);
    return tex(c, { srgb: false, repeat: true, mask: true });
  });
}

/** Grass tuft card: returns {map, alpha}. Blades drawn into color (on opaque bg) + separate luminance mask. */
export function grassTex(dry = false) {
  return memo('grass' + dry, () => {
    const [c, x] = canvas(256, 256); const [cm, xm] = canvas(256, 256); const r = rng(dry ? 31 : 21);
    x.fillStyle = dry ? 'rgb(120,108,70)' : 'rgb(86,92,52)'; x.fillRect(0, 0, 256, 256);
    xm.fillStyle = '#000'; xm.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 110; i++) {
      const bx = 30 + r() * 196, h = 50 + r() * 200, lean = (r() - 0.5) * 90;
      const t = r();
      const col = dry ? [118 + t * 50, 104 + t * 40, 64 + t * 22] : [70 + t * 45, 82 + t * 40, 40 + t * 20];
      if (!dry && r() < 0.35) { col[0] += 40; col[1] += 22; col[2] += 5; }
      const w = 1.5 + r() * 2.5;
      for (const [ctx2, style] of [[x, `rgb(${col.map((v) => v | 0).join(',')})`], [xm, '#fff']]) {
        ctx2.strokeStyle = style; ctx2.lineWidth = w; ctx2.lineCap = 'round';
        ctx2.beginPath(); ctx2.moveTo(bx, 256); ctx2.quadraticCurveTo(bx + lean * 0.2, 256 - h * 0.6, bx + lean, 256 - h); ctx2.stroke();
      }
    }
    // darken the base (self-shadowing)
    const g = x.createLinearGradient(0, 150, 0, 256); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(20,18,10,0.6)');
    x.fillStyle = g; x.fillRect(0, 150, 256, 106);
    return { map: tex(c), alpha: tex(cm, { srgb: false }) };
  });
}

/** Leaf cluster card (sparse autumn foliage). */
export function leafTex() {
  return memo('leaf', () => {
    const [c, x] = canvas(256, 256); const r = rng(41);
    x.strokeStyle = 'rgb(46,38,30)'; x.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) { x.beginPath(); x.moveTo(128, 200); const a = -Math.PI / 2 + (r() - 0.5) * 2.2; x.quadraticCurveTo(128 + Math.cos(a) * 50, 200 + Math.sin(a) * 60, 128 + Math.cos(a) * 110, 190 + Math.sin(a) * 150); x.stroke(); }
    for (let k = 0; k < 9; k++) {
      const cx = 40 + r() * 176, cy = 30 + r() * 150;
      for (let i = 0; i < 22; i++) {
        const a = r() * 7, d = Math.sqrt(r()) * 26;
        const t = r();
        x.fillStyle = `rgb(${(96 + t * 70) | 0},${(88 + t * 46) | 0},${(44 + t * 22) | 0})`;
        x.save(); x.translate(cx + Math.cos(a) * d, cy + Math.sin(a) * d); x.rotate(r() * 7); x.beginPath(); x.ellipse(0, 0, 4 + r() * 3, 2 + r() * 1.5, 0, 0, 7); x.fill(); x.restore();
      }
    }
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
      x.fillStyle = i === 5 ? '#c8b89a' : `hsl(${hue},${10 + r() * 18}%,${45 + r() * 25}%)`; x.fillRect(cx + 8, cy + 8, 240, 240);
      x.fillStyle = `hsl(${(hue + 180) % 360},15%,22%)`; x.fillRect(cx + 30, cy + 40, 196, 110 * r() + 40);
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

/** Balcony railing: vertical balusters between rails (alpha in texture alpha). 1 tile = 1 m wide x 1 m tall. */
export function railingTex() {
  return memo('rail', () => {
    const [c, x] = canvas(128, 128);
    x.fillStyle = '#fff';
    x.fillRect(0, 0, 128, 9); x.fillRect(0, 112, 128, 6);
    for (let i = 0; i < 8; i++) x.fillRect(i * 16 + 6, 0, 4, 128);
    // a bent/missing baluster for irregularity
    x.clearRect(3 * 16 + 6, 60, 4, 50);
    return tex(c, { repeat: true });
  });
}

/** Paver joint lines (mask): 1 tile = 2 m, running-bond slabs 1.0 x 0.5 m with chipped corners. */
export function paverTex() {
  return memo('paver', () => {
    const [c, x] = canvas(256, 256); const r = rng(12);
    x.strokeStyle = '#fff'; x.lineWidth = 2.2;
    for (let row = 0; row < 4; row++) {
      const y = row * 64; x.beginPath(); x.moveTo(0, y); x.lineTo(256, y); x.stroke();
      for (let k = 0; k < 3; k++) { const xx = (k * 128 + (row % 2) * 64) % 256; x.beginPath(); x.moveTo(xx, y); x.lineTo(xx, y + 64); x.stroke(); }
    }
    for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.5})`; x.beginPath(); x.arc(Math.round(r() * 4) * 64 + (r() - 0.5) * 8, Math.round(r() * 4) * 64 + (r() - 0.5) * 8, 2 + r() * 6, 0, 7); x.fill(); }
    for (let i = 0; i < 12; i++) { x.strokeStyle = `rgba(255,255,255,${0.3 + r() * 0.4})`; x.lineWidth = 1; x.beginPath(); let px = r() * 256, py = r() * 256; x.moveTo(px, py); for (let k = 0; k < 5; k++) { px += (r() - 0.5) * 40; py += (r() - 0.5) * 40; x.lineTo(px, py); } x.stroke(); }
    return tex(c, { srgb: false, repeat: true, mask: true });
  });
}
