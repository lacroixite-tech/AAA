/**
 * Small synthesis toolkit used by SoundBank to build OfflineAudioContext graphs.
 * Everything is procedural + seeded so baked sounds are deterministic per variant.
 * Owner: audio agent.
 */

export function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rr = (r, a, b) => a + (b - a) * r();
export const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Raw noise sample arrays. */
export function noiseData(n, color, r) {
  const d = new Float32Array(n);
  if (color === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = r() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
  } else if (color === 'brown') {
    let last = 0;
    for (let i = 0; i < n; i++) { last = (last + 0.02 * (r() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  } else {
    for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
  }
  return d;
}

export function noiseBuffer(ctx, color = 'white') {
  ctx.__noise ||= {};
  if (!ctx.__noise[color]) {
    const n = Math.floor(ctx.sampleRate * 2.5);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    b.copyToChannel(noiseData(n, color, rng32(hashStr(color) ^ 0x9e3779b9)), 0);
    ctx.__noise[color] = b;
  }
  return ctx.__noise[color];
}

/** Envelope gain: linear attack `a`, hold, then exponential decay with time-constant `tau`. */
export function envGain(ctx, t0, e = {}) {
  const { a = 0.001, hold = 0, tau = 0.05, peak = 1 } = e;
  const g = ctx.createGain(); const p = g.gain;
  p.setValueAtTime(0, 0);
  p.setValueAtTime(0, t0);
  p.linearRampToValueAtTime(peak, t0 + Math.max(a, 1e-5));
  if (hold > 0) p.setValueAtTime(peak, t0 + a + hold);
  p.setTargetAtTime(0, t0 + a + hold, tau);
  return g;
}
const envEnd = (t0, e = {}) => t0 + (e.a || 0.001) + (e.hold || 0) + (e.tau || 0.05) * 9;

/** Biquad from spec: [type, f, Q, gain] or {type, f, Q, gain, to, tau}. */
export function filt(ctx, spec, t0 = 0) {
  const s = Array.isArray(spec) ? { type: spec[0], f: spec[1], Q: spec[2], gain: spec[3] } : spec;
  const b = ctx.createBiquadFilter();
  b.type = s.type; b.frequency.setValueAtTime(s.f, 0);
  if (s.Q != null) b.Q.value = s.Q;
  if (s.gain != null) b.gain.value = s.gain;
  if (s.to != null) b.frequency.setTargetAtTime(s.to, t0 + (s.delay || 0), s.tau || 0.1);
  return b;
}
function chainFilters(ctx, node, specs, t0) {
  for (const sp of specs || []) { const b = filt(ctx, sp, t0); node.connect(b); node = b; }
  return node;
}

/** Filtered noise burst. */
export function noise(B, o) {
  const { ctx, r } = B; const t0 = o.t0 ?? 0;
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, o.color || 'white'); src.loop = true;
  if (o.rate) src.playbackRate.value = o.rate;
  const node = chainFilters(ctx, src, o.filters, t0);
  const g = envGain(ctx, t0, { ...o.env, peak: (o.gain ?? 1) * (o.env?.peak ?? 1) });
  node.connect(g); g.connect(o.out || B.out);
  src.start(t0, r() * 2); src.stop(Math.min(envEnd(t0, o.env), B.dur));
  return g;
}

/** Oscillator with optional pitch glide (f0 -> f1 with time-constant glide). */
export function tone(B, o) {
  const { ctx } = B; const t0 = o.t0 ?? 0;
  const osc = ctx.createOscillator(); osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.f0, 0);
  if (o.f1 != null) osc.frequency.setTargetAtTime(o.f1, t0, o.glide || 0.03);
  if (o.vib) { const l = ctx.createOscillator(); l.frequency.value = o.vib[0]; const lg = ctx.createGain(); lg.gain.value = o.vib[1]; l.connect(lg); lg.connect(osc.frequency); l.start(t0); l.stop(Math.min(envEnd(t0, o.env), B.dur)); }
  const node = chainFilters(ctx, osc, o.filters, t0);
  const g = envGain(ctx, t0, { ...o.env, peak: (o.gain ?? 1) * (o.env?.peak ?? 1) });
  node.connect(g); g.connect(o.out || B.out);
  osc.start(t0); osc.stop(Math.min(envEnd(t0, o.env), B.dur));
  return g;
}

/** Bank of decaying sine partials (metal / brass / wood resonances). modes: [[freq, amp, tau], ...] */
export function modal(B, o) {
  const t0 = o.t0 ?? 0; const g = o.gain ?? 1;
  for (const [f, amp, tau] of o.modes) {
    if (f >= B.ctx.sampleRate * 0.45) continue;
    tone(B, { t0, f0: f * (o.pitch || 1), env: { a: o.a ?? 0.0004, tau }, gain: amp * g, out: o.out });
  }
  if (o.click) noise(B, { t0, filters: [['highpass', o.clickHP || 2500, 0.7]], env: { a: 0.0002, tau: o.click }, gain: (o.clickGain ?? 0.5) * g, out: o.out });
}

/** Play a raw Float32Array into the graph. */
export function samples(B, data, t0 = 0, gain = 1, filters, out) {
  const { ctx } = B;
  const buf = ctx.createBuffer(1, data.length, ctx.sampleRate); buf.copyToChannel(data, 0);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const node = chainFilters(ctx, src, filters, t0);
  const g = ctx.createGain(); g.gain.value = gain; node.connect(g); g.connect(out || B.out);
  src.start(t0);
}

/** N-wave: the pressure signature of a supersonic crack / muzzle blast. */
export function nwave(sr, ms, rise = 0.00004) {
  const n = Math.max(4, Math.floor(sr * ms / 1000)); const nr = Math.max(1, Math.floor(sr * rise));
  const d = new Float32Array(n + nr * 2);
  for (let i = 0; i < nr; i++) d[i] = i / nr;
  for (let i = 0; i < n; i++) d[nr + i] = 1 - 2 * (i / n);
  for (let i = 0; i < nr; i++) d[nr + n + i] = -1 + i / nr;
  return d;
}

/** Scatter of tiny filtered clicks — debris, grit, gravel crunch. */
export function grit(B, o) {
  const { r } = B; const t0 = o.t0 ?? 0;
  for (let i = 0; i < o.count; i++) {
    const u = Math.pow(r(), o.skew ?? 1.6);
    const t = t0 + u * o.span;
    const amp = (o.gain ?? 0.2) * rr(r, 0.3, 1) * (o.fade === false ? 1 : 1 - u * 0.8);
    noise(B, { t0: t, color: o.color || 'white', filters: [['bandpass', (o.f || 3000) * rr(r, 0.6, 1.6), o.Q ?? 1.5], ...(o.extra || [])], env: { a: 0.0003, tau: rr(r, o.tauMin ?? 0.0015, o.tauMax ?? 0.006) }, gain: amp, out: o.out });
  }
}

export function shaper(ctx, drive = 2) {
  const ws = ctx.createWaveShaper(); const n = 2048; const c = new Float32Array(n); const k = Math.tanh(drive);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * drive) / k; }
  ws.curve = c; ws.oversample = '4x'; return ws;
}

/** Smooth random control curve (cosine-interpolated points), for setValueCurveAtTime. */
export function smoothCurve(r, points, min, max, len = 512) {
  const p = Array.from({ length: points }, () => rr(r, min, max));
  p[points - 1] = p[0];
  const c = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const x = (i / (len - 1)) * (points - 1); const k = Math.min(points - 2, Math.floor(x)); const f = x - k;
    const m = (1 - Math.cos(f * Math.PI)) / 2; c[i] = p[k] * (1 - m) + p[k + 1] * m;
  }
  return c;
}

/* ---------------- post-processing on rendered AudioBuffers ---------------- */
export function normalize(buf, peak = 0.95) {
  let m = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > m) m = a; } }
  if (m < 1e-9) return buf;
  const k = peak / m;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
  return buf;
}
export function fadeEdges(buf, fadeOut = 0.03) {
  const n = Math.floor(buf.sampleRate * fadeOut);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); const L = d.length; for (let i = 0; i < n && i < L; i++) d[L - 1 - i] *= i / n; }
  return buf;
}
/** Make a seamless loop: crossfade the last `xf` seconds into the start, return a shorter buffer. */
export function loopify(ctx, buf, xf = 2) {
  const sr = buf.sampleRate; const n = Math.floor(xf * sr); const L = buf.length - n;
  const out = ctx.createBuffer(buf.numberOfChannels, L, sr);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const s = buf.getChannelData(c); const d = out.getChannelData(c);
    for (let i = 0; i < L; i++) d[i] = s[i];
    for (let i = 0; i < n; i++) { const a = Math.sqrt(i / n), b = Math.sqrt(1 - i / n); d[i] = s[i] * a + s[L + i] * b; }
  }
  return out;
}

/* ---------------- procedural impulse responses for ConvolverNode ---------------- */
/**
 * kind: 'outdoor' — urban street: discrete slapback echoes off facades + long dark diffuse tail.
 *       'indoor'  — room/warehouse: dense early reflections, shorter brighter tail, flutter.
 */
export function makeIR(ctx, kind = 'outdoor', seed = 7) {
  const sr = ctx.sampleRate; const r = rng32(seed);
  const cfg = kind === 'indoor'
    ? { len: 1.4, t60: 0.85, f0: 7000, f1: 1400, onset: 0.004, taps: 40, tapSpan: 0.06, tapGain: 0.5, diffuse: 0.55 }
    : { len: 2.8, t60: 2.1, f0: 5000, f1: 600, onset: 0.03, taps: 0, tapSpan: 0, tapGain: 0, diffuse: 0.32 };
  const n = Math.floor(cfg.len * sr);
  const ir = ctx.createBuffer(2, n, sr);
  const slaps = [0.031, 0.052, 0.078, 0.104, 0.142, 0.19, 0.25, 0.33, 0.42, 0.55, 0.71];
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    const tau = cfg.t60 / 6.91;
    // diffuse tail with progressive darkening
    let y = 0, y2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const fc = cfg.f1 + (cfg.f0 - cfg.f1) * Math.exp(-t / (cfg.t60 * 0.35));
      const a = 1 - Math.exp(-2 * Math.PI * fc / sr);
      y += a * ((r() * 2 - 1) - y); y2 += a * (y - y2);
      const on = Math.min(1, t / cfg.onset);
      d[i] = y2 * Math.exp(-t / tau) * on * cfg.diffuse * 2.2;
    }
    // urban slapbacks: short dark bursts, decorrelated per ear
    if (kind === 'outdoor') {
      for (const s of slaps) {
        const t = s * rr(r, 0.85, 1.18); const g = 0.95 * Math.exp(-t / 0.22) * rr(r, 0.5, 1);
        const start = Math.floor(t * sr); const bl = Math.floor(rr(r, 0.004, 0.012) * sr);
        let z = 0; const a = 1 - Math.exp(-2 * Math.PI * rr(r, 1500, 3200) / sr);
        for (let i = 0; i < bl && start + i < n; i++) { z += a * ((r() * 2 - 1) - z); d[start + i] += z * g * 2.5 * Math.exp(-i / (bl * 0.3)); }
      }
    } else {
      for (let k = 0; k < cfg.taps; k++) {
        const t = 0.002 + Math.pow(r(), 1.3) * cfg.tapSpan; const i0 = Math.floor(t * sr);
        if (i0 < n) d[i0] += (r() < 0.5 ? -1 : 1) * cfg.tapGain * Math.exp(-t / 0.05) * rr(r, 0.3, 1);
      }
      // flutter between parallel walls
      for (let k = 1; k < 14; k++) { const i0 = Math.floor((0.017 * k + ch * 0.0013) * sr); if (i0 < n) d[i0] += 0.25 * Math.exp(-k / 4); }
    }
  }
  // normalize energy so the wet level is predictable
  let e = 0; for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < n; i++) e += d[i] * d[i]; }
  const k = 1 / Math.sqrt(e / 2 + 1e-9) * 0.9;
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < n; i++) d[i] *= k; }
  return ir;
}
