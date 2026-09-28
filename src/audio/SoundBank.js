/**
 * Procedural sound recipes, pre-rendered at load through OfflineAudioContext.
 * Each recipe bakes N seeded variants (round-robin at runtime so repeats never sound identical).
 * Owner: audio agent.
 */
import { rng32, rr, pick, hashStr, noiseBuffer, noise, tone, modal, samples, nwave, grit, shaper, smoothCurve, normalize, fadeEdges, loopify, trimStart } from './dsp.js';

export const RECIPES = {};
function def(name, o) { RECIPES[name] = { n: 1, ch: 1, peak: 0.95, ...o }; }

/* =============================== GUNSHOTS =============================== */
function gunshot(B, r, P) {
  const { ctx, sr } = B; const t0 = 0.002;
  const mix = ctx.createGain(); mix.gain.value = P.pre ?? 0.45; const sh = shaper(ctx, P.drive);
  const shelf = ctx.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 8500; shelf.gain.value = -8;
  const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 3200; pres.Q.value = 0.7; pres.gain.value = 3;
  mix.connect(sh); sh.connect(shelf); shelf.connect(pres); pres.connect(B.out);
  const o = { out: mix };
  const p = P.pitch * rr(r, 0.95, 1.05);
  // 1) muzzle-blast N-wave: the instantaneous edge (<1 ms rise), broadband crack
  samples(B, nwave(sr, rr(r, 0.35, 0.6) * P.nw), t0, P.nwGain, [['highpass', 500, 0.7]], mix);
  // 2) crack: bright shaped noise 2-8 kHz
  noise(B, { ...o, t0, filters: [['highpass', 1700 * p, 0.7], ['peaking', P.crackF * p, 0.9, 7]], env: { a: 0.0002, hold: 0.0015, tau: P.crackTau }, gain: P.crackGain });
  noise(B, { ...o, t0, filters: [['bandpass', 6500 * p, 0.7]], env: { a: 0.0002, tau: P.crackTau * 2.2 }, gain: P.crackGain * 0.35 });
  // 3) body: pitched low thump + low noise (60-200 Hz weight)
  tone(B, { ...o, t0, cos: true, f0: P.bodyF * p, f1: P.bodyF * 0.3 * p, glide: 0.03, env: { a: 0.0002, hold: P.bodyHold, tau: P.bodyTau }, gain: P.bodyGain });
  noise(B, { ...o, t0, color: 'brown', filters: [['lowpass', 260 * p, 0.9]], env: { a: 0.0008, hold: 0.004, tau: P.bodyTau * 1.2 }, gain: P.bodyGain * 1.1 });
  // 4) mid "chest" blast
  noise(B, { ...o, t0, color: 'pink', filters: [['bandpass', P.midF * p, 0.8]], env: { a: 0.0004, hold: 0.002, tau: P.midTau }, gain: P.midGain });
  // 5) mechanical action: bolt carrier / slide going back and slamming home
  const ta = t0 + rr(r, 0.026, 0.038) * P.actionT; const pa = p * rr(r, 0.93, 1.07);
  modal(B, { ...o, t0: ta, pitch: pa, modes: P.action1, gain: P.actionGain, click: 0.003, clickGain: 0.6 });
  modal(B, { ...o, t0: ta + rr(r, 0.018, 0.028) * P.actionT, pitch: pa * rr(r, 0.9, 1.1), modes: P.action2, gain: P.actionGain * 0.8, click: 0.002, clickGain: 0.5 });
  // 6) close-in short air tail (long tail layers are separate + convolver)
  noise(B, { ...o, t0: t0 + 0.004, color: 'pink', filters: [{ type: 'lowpass', f: 3000, to: 450, tau: 0.18, Q: 0.6 }], env: { a: 0.004, hold: 0.01, tau: P.tailTau }, gain: P.tailGain });
}
const RIFLE = {
  pitch: 1, drive: 1.4, nw: 1, nwGain: 2.0, crackF: 4200, crackTau: 0.014, crackGain: 2.0,
  bodyF: 175, bodyHold: 0.004, bodyTau: 0.045, bodyGain: 1.2, midF: 750, midTau: 0.03, midGain: 0.9,
  actionT: 1, actionGain: 0.16, tailTau: 0.2, tailGain: 0.24,
  action1: [[1150, 0.5, 0.02], [2900, 0.5, 0.012], [4700, 0.35, 0.009], [7300, 0.25, 0.006]],
  action2: [[1900, 0.45, 0.015], [3300, 0.35, 0.01], [6100, 0.2, 0.006]],
};
const PISTOL = {
  ...RIFLE, pitch: 1.12, drive: 1.3, nw: 0.7, nwGain: 1.7, crackF: 3200, crackTau: 0.011, crackGain: 1.8,
  bodyF: 230, bodyHold: 0.003, bodyTau: 0.035, bodyGain: 0.9, midF: 1100, midTau: 0.025, midGain: 0.8,
  actionT: 0.9, actionGain: 0.24, tailTau: 0.13, tailGain: 0.2,
  action1: [[1600, 0.5, 0.02], [2700, 0.45, 0.012], [5200, 0.3, 0.007]],
  action2: [[2100, 0.45, 0.014], [3900, 0.3, 0.008], [6600, 0.2, 0.005]],
};
const SHOTGUN = {
  ...RIFLE, pitch: 0.85, drive: 2.0, nw: 1.6, nwGain: 1, crackF: 2800, crackTau: 0.02, crackGain: 0.9,
  bodyF: 140, bodyHold: 0.012, bodyTau: 0.11, bodyGain: 1.8, midF: 600, midTau: 0.05, midGain: 0.9,
  actionT: 9, actionGain: 0.0, tailTau: 0.3, tailGain: 0.3,
};
const SNIPER = { ...RIFLE, pitch: 0.9, drive: 2.0, nw: 1.4, crackTau: 0.016, bodyF: 150, bodyHold: 0.01, bodyTau: 0.1, bodyGain: 1.8, midTau: 0.045, actionGain: 0, tailTau: 0.3, tailGain: 0.3 };
def('rifle', { n: 6, dur: 0.7, peak: 0.98, build: (B, r) => gunshot(B, r, RIFLE) });
def('pistol', { n: 6, dur: 0.55, peak: 0.98, build: (B, r) => gunshot(B, r, PISTOL) });
def('shotgun', { n: 4, dur: 0.9, peak: 0.98, build: (B, r) => gunshot(B, r, SHOTGUN) });
def('sniper', { n: 3, dur: 0.9, peak: 0.98, build: (B, r) => gunshot(B, r, SNIPER) });

/** Outdoor tail: low rumble + slapback echoes off buildings (stereo, decorrelated). */
function gunTail(B, r, T) {
  for (const out of [B.L, B.R]) {
    const o = { out };
    noise(B, { ...o, t0: 0.002, color: 'brown', filters: [['lowpass', 170, 0.8]], env: { a: 0.006, hold: 0.02, tau: T.rumble }, gain: 1.4 * T.g });
    noise(B, { ...o, t0: 0.004, color: 'pink', filters: [{ type: 'lowpass', f: 1800, to: 280, tau: 0.35, Q: 0.5 }], env: { a: 0.02, hold: 0.01, tau: T.rumble * 0.85 }, gain: 0.45 * T.g });
    for (const s of T.slaps) {
      const t = s * rr(r, 0.85, 1.2); const g = T.g * 0.5 * Math.exp(-t / T.slapDecay) * rr(r, 0.55, 1);
      noise(B, { ...o, t0: t, color: 'pink', filters: [['bandpass', rr(r, 600, 1100), 0.6], ['lowpass', 3200, 0.7]], env: { a: 0.0015, tau: rr(r, 0.018, 0.03) }, gain: g * 1.4 });
      tone(B, { ...o, t0: t, f0: 95, f1: 45, glide: 0.03, env: { a: 0.002, tau: 0.045 }, gain: g * 0.6 });
    }
  }
}
def('tail_rifle', { n: 3, ch: 2, dur: 2.4, peak: 0.9, build: (B, r) => gunTail(B, r, { g: 1, rumble: 0.34, slapDecay: 0.32, slaps: [0.06, 0.11, 0.17, 0.26, 0.37, 0.5, 0.68, 0.9] }) });
def('tail_pistol', { n: 3, ch: 2, dur: 1.6, peak: 0.8, build: (B, r) => gunTail(B, r, { g: 0.8, rumble: 0.22, slapDecay: 0.25, slaps: [0.06, 0.12, 0.19, 0.29, 0.42, 0.6] }) });
def('tail_indoor', {
  n: 3, ch: 2, dur: 1.3, peak: 0.85, build: (B, r) => {
    for (const out of [B.L, B.R]) {
      noise(B, { out, t0: 0.002, color: 'brown', filters: [['lowpass', 380, 1.2]], env: { a: 0.006, hold: 0.02, tau: 0.2 }, gain: 1.2 });
      noise(B, { out, t0: 0.003, color: 'pink', filters: [{ type: 'lowpass', f: 4000, to: 900, tau: 0.2 }], env: { a: 0.005, tau: 0.16 }, gain: 0.6 });
      for (let k = 1; k < 16; k++) noise(B, { out, t0: 0.016 * k * rr(r, 0.95, 1.05), color: 'pink', filters: [['bandpass', 1400, 0.7]], env: { a: 0.001, tau: 0.008 }, gain: 0.5 * Math.exp(-k / 5) });
    }
  },
});

/** Enemy shots at mid range (20-60 m): crack softened, body thinner, baked early echoes. */
def('enemy_rifle', {
  n: 5, dur: 1.4, peak: 0.95, build: (B, r) => {
    const t0 = 0.002; const p = rr(r, 0.94, 1.06);
    samples(B, nwave(B.sr, 0.5), t0, 1.2, [['highpass', 400, 0.7], ['lowpass', 7000, 0.7]]);
    noise(B, { t0, filters: [['bandpass', 2800 * p, 0.7]], env: { a: 0.0003, tau: 0.01 }, gain: 1.8 });
    tone(B, { t0, f0: 130 * p, f1: 50, glide: 0.03, env: { a: 0.001, hold: 0.004, tau: 0.05 }, gain: 0.9 });
    noise(B, { t0, color: 'pink', filters: [['bandpass', 800 * p, 0.8]], env: { a: 0.0005, tau: 0.04 }, gain: 0.9 });
    noise(B, { t0: 0.01, color: 'brown', filters: [['lowpass', 300, 0.7]], env: { a: 0.01, tau: 0.3 }, gain: 0.7 });
    for (const s of [0.07, 0.15, 0.24, 0.36, 0.52]) noise(B, { t0: s * rr(r, 0.85, 1.15), color: 'pink', filters: [['bandpass', 900, 0.6], ['lowpass', 2500, 0.7]], env: { a: 0.002, tau: 0.03 }, gain: 0.55 * Math.exp(-s / 0.3) });
  },
});
/** Far gunfire (80-500 m): a dull pop + rolling rumble + delayed slaps. */
def('distant_rifle', {
  n: 5, dur: 2.6, peak: 0.9, build: (B, r) => {
    const t0 = 0.002;
    noise(B, { t0, color: 'pink', filters: [['bandpass', rr(r, 500, 800), 0.7]], env: { a: 0.001, tau: 0.02 }, gain: 1 });
    noise(B, { t0, filters: [['bandpass', 1800, 1]], env: { a: 0.0005, tau: 0.006 }, gain: 0.35 });
    tone(B, { t0, f0: 85, f1: 38, glide: 0.04, env: { a: 0.002, hold: 0.005, tau: 0.07 }, gain: 0.8 });
    noise(B, { t0: 0.02, color: 'brown', filters: [['lowpass', 260, 0.7]], env: { a: 0.04, tau: 0.5 }, gain: 0.8 });
    for (const s of [0.12, 0.23, 0.38, 0.6, 0.85, 1.2]) noise(B, { t0: s * rr(r, 0.8, 1.2), color: 'pink', filters: [['lowpass', 1100, 0.7]], env: { a: 0.006, tau: 0.06 }, gain: 0.55 * Math.exp(-s / 0.5) });
  },
});

/** Bullet passing close: doppler "fwip" whiz and the supersonic snap. */
def('whiz', {
  n: 4, dur: 0.4, peak: 0.9, build: (B, r) => {
    const f = rr(r, 0.85, 1.2);
    noise(B, { t0: 0.0, filters: [{ type: 'bandpass', f: 5200 * f, to: 1100 * f, tau: 0.08, delay: 0.05, Q: 3 }], env: { a: 0.055, tau: 0.05 }, gain: 1 });
    noise(B, { t0: 0.0, filters: [{ type: 'bandpass', f: 2600 * f, to: 600 * f, tau: 0.08, delay: 0.05, Q: 2 }], env: { a: 0.06, tau: 0.06 }, gain: 0.7 });
    tone(B, { t0: 0.0, f0: 1900 * f, f1: 700 * f, glide: 0.06, env: { a: 0.05, tau: 0.04 }, gain: 0.05 });
  },
});
def('snap', {
  n: 4, dur: 0.35, peak: 0.95, build: (B, r) => {
    samples(B, nwave(B.sr, rr(r, 0.15, 0.3)), 0.001, 1, [['highpass', 1500, 0.7]]);
    noise(B, { t0: 0.001, filters: [['highpass', 3000, 0.7]], env: { a: 0.0001, tau: 0.004 }, gain: 0.9 });
    noise(B, { t0: 0.002, filters: [['bandpass', 3500, 0.8]], env: { a: 0.001, tau: 0.02 }, gain: 0.3 });
    noise(B, { t0: 0.01, color: 'pink', filters: [{ type: 'lowpass', f: 4000, to: 1200, tau: 0.08 }], env: { a: 0.01, tau: 0.06 }, gain: 0.12 });
  },
});

/* =============================== IMPACTS =============================== */
def('impact_concrete', {
  n: 4, dur: 0.6, build: (B, r) => {
    const t0 = 0.002;
    noise(B, { t0, filters: [['highpass', 1400, 0.7], ['peaking', 3500, 1, 5]], env: { a: 0.0002, tau: 0.008 }, gain: 1 });
    noise(B, { t0, color: 'pink', filters: [['bandpass', rr(r, 350, 550), 1]], env: { a: 0.0005, tau: 0.02 }, gain: 0.9 });
    tone(B, { t0, f0: 160, f1: 90, env: { a: 0.001, tau: 0.02 }, gain: 0.5 });
    grit(B, { t0: 0.01, count: 22, span: 0.35, f: 4000, Q: 1.2, gain: 0.3 });
    grit(B, { t0: 0.03, count: 10, span: 0.4, f: 1500, Q: 1, gain: 0.2, color: 'pink' });
  },
});
def('impact_metal', {
  n: 4, dur: 1.0, build: (B, r) => {
    const t0 = 0.002; const f = rr(r, 1500, 2600);
    noise(B, { t0, filters: [['highpass', 2000, 0.7]], env: { a: 0.0002, tau: 0.004 }, gain: 0.9 });
    modal(B, { t0, modes: [[f, 0.7, rr(r, 0.12, 0.25)], [f * 1.593, 0.5, 0.13], [f * 2.135, 0.45, 0.09], [f * 2.653, 0.3, 0.07], [f * 3.9, 0.2, 0.05], [f * 0.48, 0.35, 0.05]], gain: 0.6 });
    noise(B, { t0, color: 'pink', filters: [['bandpass', 700, 1.2]], env: { a: 0.0005, tau: 0.015 }, gain: 0.5 });
    grit(B, { t0: 0.005, count: 6, span: 0.1, f: 6000, Q: 3, gain: 0.15 });
  },
});
def('impact_wood', {
  n: 4, dur: 0.5, build: (B, r) => {
    const t0 = 0.002; const f = rr(r, 280, 420);
    noise(B, { t0, filters: [['bandpass', 1800, 0.8]], env: { a: 0.0003, tau: 0.008 }, gain: 0.8 });
    modal(B, { t0, modes: [[f, 0.8, 0.04], [f * 2.3, 0.5, 0.03], [f * 3.9, 0.3, 0.02], [f * 6.1, 0.15, 0.012]], gain: 0.7 });
    noise(B, { t0, color: 'pink', filters: [['bandpass', 900, 1]], env: { a: 0.0005, tau: 0.025 }, gain: 0.6 });
    grit(B, { t0: 0.004, count: 14, span: 0.12, f: 2500, Q: 2, gain: 0.22 }); // splinters
  },
});
def('impact_dirt', {
  n: 4, dur: 0.5, build: (B, r) => {
    const t0 = 0.002;
    noise(B, { t0, color: 'pink', filters: [['lowpass', 900, 0.8]], env: { a: 0.001, tau: 0.03 }, gain: 1 });
    tone(B, { t0, f0: 110, f1: 60, env: { a: 0.002, tau: 0.03 }, gain: 0.6 });
    noise(B, { t0, filters: [['bandpass', 2500, 0.7]], env: { a: 0.0005, tau: 0.006 }, gain: 0.35 });
    grit(B, { t0: 0.02, count: 26, span: 0.35, f: 2200, Q: 0.8, gain: 0.16, extra: [['lowpass', 5000, 0.7]] }); // dirt spray falling
  },
});
def('impact_flesh', {
  n: 4, dur: 0.4, build: (B, r) => {
    const t0 = 0.002;
    tone(B, { t0, f0: rr(r, 120, 150), f1: 55, glide: 0.02, env: { a: 0.001, hold: 0.004, tau: 0.04 }, gain: 1 });
    noise(B, { t0, color: 'pink', filters: [['lowpass', 900, 1]], env: { a: 0.001, tau: 0.03 }, gain: 0.9 });
    noise(B, { t0: t0 + 0.004, color: 'pink', filters: [{ type: 'bandpass', f: 1800, to: 700, tau: 0.03, Q: 2 }], env: { a: 0.003, tau: 0.03 }, gain: 0.5 }); // wet squish
    noise(B, { t0, filters: [['bandpass', 3000, 1]], env: { a: 0.0003, tau: 0.004 }, gain: 0.3 }); // cloth snap
  },
});
def('impact_glass', {
  n: 3, dur: 1.2, build: (B, r) => {
    const t0 = 0.002;
    noise(B, { t0, filters: [['highpass', 3000, 0.7]], env: { a: 0.0002, tau: 0.01 }, gain: 0.9 });
    for (let i = 0; i < 18; i++) {
      const t = t0 + Math.pow(r(), 1.5) * 0.8; const f = rr(r, 3000, 9000);
      modal(B, { t0: t, modes: [[f, 1, rr(r, 0.01, 0.05)], [f * 1.7, 0.5, 0.02]], gain: 0.35 * rr(r, 0.3, 1) * (1 - (t / 1.0) * 0.7) });
    }
  },
});

/* ============================ UI / FEEDBACK ============================ */
def('hitmarker', {
  n: 3, dur: 0.12, build: (B, r) => {
    const p = rr(r, 0.97, 1.03);
    noise(B, { t0: 0.001, filters: [['bandpass', 4200 * p, 2.5]], env: { a: 0.0002, tau: 0.006 }, gain: 1 });
    modal(B, { t0: 0.001, modes: [[1850 * p, 0.6, 0.012], [3700 * p, 0.35, 0.008], [6100 * p, 0.2, 0.004]], gain: 0.8 });
  },
});
def('hitmarker_head', {
  n: 2, dur: 0.35, build: (B, r) => {
    noise(B, { t0: 0.001, filters: [['bandpass', 4400, 2.5]], env: { a: 0.0002, tau: 0.006 }, gain: 1 });
    modal(B, { t0: 0.001, modes: [[1950, 0.6, 0.012], [3900, 0.3, 0.008]], gain: 0.8 });
    modal(B, { t0: 0.004, modes: [[2950, 0.4, 0.12], [4650, 0.25, 0.08], [7350, 0.12, 0.05]], gain: 0.5 }); // helmet ping
  },
});
def('kill', {
  n: 2, dur: 0.3, build: (B, r) => {
    noise(B, { t0: 0.001, filters: [['bandpass', 3400, 2]], env: { a: 0.0002, tau: 0.009 }, gain: 1 });
    modal(B, { t0: 0.001, modes: [[1250, 0.7, 0.03], [2500, 0.45, 0.02], [4100, 0.25, 0.01]], gain: 0.8 });
    tone(B, { t0: 0.001, f0: 190, f1: 80, glide: 0.02, env: { a: 0.001, tau: 0.035 }, gain: 0.7 });
    noise(B, { t0: 0.045, filters: [['bandpass', 3000, 2]], env: { a: 0.0002, tau: 0.006 }, gain: 0.45 });
  },
});
def('kill_head', {
  n: 2, dur: 0.6, build: (B, r) => {
    noise(B, { t0: 0.001, filters: [['bandpass', 3400, 2]], env: { a: 0.0002, tau: 0.009 }, gain: 1 });
    modal(B, { t0: 0.001, modes: [[1250, 0.7, 0.03], [2500, 0.45, 0.02]], gain: 0.8 });
    tone(B, { t0: 0.001, f0: 190, f1: 80, glide: 0.02, env: { a: 0.001, tau: 0.035 }, gain: 0.7 });
    modal(B, { t0: 0.003, modes: [[2880, 0.5, 0.22], [4560, 0.3, 0.14], [7200, 0.15, 0.08], [1430, 0.2, 0.1]], gain: 0.6 });
  },
});

/* ============================ WEAPON FOLEY ============================ */
def('shell', {
  n: 6, dur: 0.6, build: (B, r) => {
    const f = rr(r, 3500, 4800);
    const modes = [[f, 0.7, 0.06], [f * 2.76, 0.45, 0.035], [f * 5.4, 0.25, 0.02], [f * 0.62, 0.3, 0.03]];
    let t = 0.002, a = 1;
    for (let k = 0; k < 4; k++) {
      modal(B, { t0: t, pitch: rr(r, 0.97, 1.03), modes: modes.map(([m, g, tau]) => [m, g * rr(r, 0.4, 1), tau * (1 - k * 0.15)]), gain: a * 0.6, click: 0.0015, clickHP: 5000, clickGain: 0.6 });
      t += rr(r, 0.06, 0.12) * (1 - k * 0.2); a *= rr(r, 0.35, 0.6);
    }
  },
});
def('dryfire', {
  n: 3, dur: 0.15, build: (B, r) => {
    modal(B, { t0: 0.001, pitch: rr(r, 0.95, 1.05), modes: [[2600, 0.6, 0.012], [4400, 0.4, 0.008], [7800, 0.2, 0.004], [1200, 0.3, 0.01]], gain: 0.8, click: 0.002, clickHP: 3500, clickGain: 0.8 });
  },
});
def('mag_out', {
  n: 2, dur: 0.45, build: (B, r) => {
    modal(B, { t0: 0.002, modes: [[3100, 0.5, 0.01], [5200, 0.3, 0.006], [1500, 0.3, 0.012]], gain: 0.8, click: 0.002, clickGain: 0.6 }); // release button
    noise(B, { t0: 0.012, filters: [{ type: 'bandpass', f: 1800, to: 3400, tau: 0.04, Q: 2.5 }], env: { a: 0.008, hold: 0.04, tau: 0.02 }, gain: 0.25 }); // slide out
    noise(B, { t0: 0.08, color: 'pink', filters: [['bandpass', 650, 1.2]], env: { a: 0.002, tau: 0.025 }, gain: 0.6 }); // mag leaves well
    modal(B, { t0: 0.082, modes: [[980, 0.4, 0.03], [2200, 0.3, 0.015]], gain: 0.5 });
  },
});
def('mag_in', {
  n: 2, dur: 0.45, build: (B, r) => {
    noise(B, { t0: 0.002, filters: [{ type: 'bandpass', f: 2600, to: 1800, tau: 0.04, Q: 2 }], env: { a: 0.02, hold: 0.02, tau: 0.01 }, gain: 0.2 }); // scrape in
    const t = 0.06;
    modal(B, { t0: t, modes: [[1400, 0.6, 0.03], [2600, 0.5, 0.02], [4300, 0.35, 0.012], [6900, 0.2, 0.008]], gain: 0.9, click: 0.003, clickGain: 0.7 });
    tone(B, { t0: t, f0: 190, f1: 110, env: { a: 0.001, tau: 0.025 }, gain: 0.7 });
    noise(B, { t0: t, color: 'pink', filters: [['bandpass', 600, 1]], env: { a: 0.001, tau: 0.02 }, gain: 0.6 });
    modal(B, { t0: t + 0.028, modes: [[3800, 0.4, 0.008], [6200, 0.3, 0.005]], gain: 0.6, click: 0.001 }); // latch
  },
});
function boltFoley(B, r, k) {
  noise(B, { t0: 0.002, filters: [{ type: 'bandpass', f: 2400 * k, to: 4200 * k, tau: 0.05, Q: 2 }], env: { a: 0.01, hold: 0.05 * k, tau: 0.01 }, gain: 0.3 }); // pull back rattle
  grit(B, { t0: 0.005, count: 6, span: 0.06, f: 3500 * k, Q: 3, gain: 0.2, fade: false });
  modal(B, { t0: 0.07 * k, modes: [[2800 * k, 0.4, 0.01], [4900 * k, 0.25, 0.006]], gain: 0.6, click: 0.002 });
  const ts = 0.2 * k; // slam forward
  modal(B, { t0: ts, modes: [[900 / k, 0.6, 0.04], [1750 / k, 0.5, 0.03], [3100, 0.4, 0.02], [5300, 0.3, 0.012]], gain: 1, click: 0.003, clickGain: 0.8 });
  tone(B, { t0: ts, f0: 160, f1: 90, env: { a: 0.001, tau: 0.03 }, gain: 0.8 });
  noise(B, { t0: ts, color: 'pink', filters: [['bandpass', 700, 1]], env: { a: 0.001, tau: 0.03 }, gain: 0.6 });
}
def('bolt', { n: 2, dur: 0.6, build: (B, r) => boltFoley(B, r, 1) });
def('slide', { n: 2, dur: 0.45, build: (B, r) => boltFoley(B, r, 0.7) });
def('pump', {
  n: 2, dur: 0.55, build: (B, r) => {
    noise(B, { t0: 0.002, color: 'pink', filters: [['bandpass', 1200, 1.5]], env: { a: 0.01, hold: 0.05, tau: 0.01 }, gain: 0.4 });
    modal(B, { t0: 0.08, modes: [[700, 0.6, 0.04], [1600, 0.5, 0.03], [3300, 0.3, 0.012]], gain: 1, click: 0.002 });
    noise(B, { t0: 0.18, color: 'pink', filters: [['bandpass', 1400, 1.5]], env: { a: 0.01, hold: 0.04, tau: 0.01 }, gain: 0.35 });
    modal(B, { t0: 0.25, modes: [[820, 0.6, 0.04], [1900, 0.5, 0.03], [3800, 0.3, 0.012]], gain: 1, click: 0.002 });
  },
});
function rustle(B, r, t0, len, g, out) {
  noise(B, { out, t0, color: 'pink', filters: [['bandpass', rr(r, 1200, 2200), 0.5], ['highpass', 400, 0.7]], env: { a: len * 0.4, hold: len * 0.2, tau: len * 0.3 }, gain: g });
  grit(B, { out, t0, count: 8, span: len, f: 3000, Q: 0.8, gain: g * 0.25, skew: 1, fade: false });
}
function clinks(B, r, t0, count, span, g) {
  for (let i = 0; i < count; i++) {
    const f = rr(r, 1800, 5500);
    modal(B, { t0: t0 + r() * span, modes: [[f, 0.7, rr(r, 0.01, 0.035)], [f * rr(r, 1.5, 2.8), 0.3, 0.012]], gain: g * rr(r, 0.4, 1), click: 0.001, clickGain: 0.4 });
  }
}
def('cloth', { n: 3, dur: 0.6, build: (B, r) => rustle(B, r, 0.002, 0.35, 0.8) });
def('gear', { n: 4, dur: 0.35, build: (B, r) => { rustle(B, r, 0.002, 0.14, 0.5); clinks(B, r, 0.01, 4, 0.12, 0.45); noise(B, { t0: 0.01, color: 'pink', filters: [['bandpass', 400, 1]], env: { a: 0.002, tau: 0.02 }, gain: 0.35 }); } });
def('jump', { n: 2, dur: 0.45, build: (B, r) => { rustle(B, r, 0.002, 0.2, 0.9); clinks(B, r, 0.03, 3, 0.1, 0.4); } });
def('land', {
  n: 3, dur: 0.5, build: (B, r) => {
    tone(B, { t0: 0.002, f0: 85, f1: 45, glide: 0.03, env: { a: 0.002, hold: 0.01, tau: 0.06 }, gain: 1 });
    noise(B, { t0: 0.002, color: 'pink', filters: [['lowpass', 500, 0.8]], env: { a: 0.002, tau: 0.05 }, gain: 0.9 });
    noise(B, { t0: 0.002, filters: [['bandpass', 2500, 0.7]], env: { a: 0.001, tau: 0.02 }, gain: 0.2 });
    clinks(B, r, 0.03, 4, 0.1, 0.45); rustle(B, r, 0.01, 0.15, 0.4);
  },
});

/* ============================== FOOTSTEPS ============================== */
function step(B, r, kind) {
  const t0 = 0.002; const toe = rr(r, 0.03, 0.05);
  if (kind === 'concrete') {
    tone(B, { t0, f0: rr(r, 85, 105), f1: 55, env: { a: 0.002, tau: 0.02 }, gain: 0.55 });
    noise(B, { t0, color: 'pink', filters: [['bandpass', rr(r, 300, 420), 1.1]], env: { a: 0.0015, tau: 0.018 }, gain: 0.8 });
    noise(B, { t0: t0 + toe, color: 'pink', filters: [['bandpass', 600, 1]], env: { a: 0.001, tau: 0.012 }, gain: 0.4 });
    noise(B, { t0: t0 + 0.004, filters: [['bandpass', 3200, 0.7]], env: { a: 0.006, tau: 0.02 }, gain: 0.12 }); // scuff
    grit(B, { t0: t0 + 0.01, count: 5, span: 0.06, f: 5000, gain: 0.08 });
  } else if (kind === 'dirt') {
    noise(B, { t0, color: 'pink', filters: [['lowpass', 650, 0.8]], env: { a: 0.004, tau: 0.035 }, gain: 0.9 });
    tone(B, { t0, f0: 80, f1: 50, env: { a: 0.003, tau: 0.02 }, gain: 0.35 });
    grit(B, { t0: t0 + 0.003, count: 10, span: 0.08, f: 2000, Q: 0.9, gain: 0.14, extra: [['lowpass', 4000, 0.7]] });
  } else if (kind === 'gravel') {
    noise(B, { t0, color: 'pink', filters: [['lowpass', 500, 0.8]], env: { a: 0.003, tau: 0.03 }, gain: 0.7 });
    grit(B, { t0, count: 28, span: 0.13, f: 3200, Q: 1.3, gain: 0.3, skew: 1.2 });
  } else if (kind === 'metal') {
    tone(B, { t0, f0: 120, f1: 70, env: { a: 0.001, tau: 0.025 }, gain: 0.6 });
    const f = rr(r, 280, 360);
    modal(B, { t0, modes: [[f, 0.35, 0.14], [f * 1.9, 0.3, 0.1], [f * 3.05, 0.22, 0.07], [f * 4.8, 0.14, 0.05], [f * 7.3, 0.08, 0.03]], gain: 0.55, click: 0.002, clickGain: 0.25 });
    modal(B, { t0: t0 + toe, modes: [[f * 1.9, 0.2, 0.06], [f * 4.8, 0.1, 0.03]], gain: 0.4 });
  } else if (kind === 'wood') {
    const f = rr(r, 160, 210);
    modal(B, { t0, modes: [[f, 0.7, 0.05], [f * 2.3, 0.45, 0.035], [f * 4.1, 0.2, 0.02]], gain: 0.7 });
    noise(B, { t0, color: 'pink', filters: [['bandpass', 900, 1]], env: { a: 0.002, tau: 0.02 }, gain: 0.4 });
    noise(B, { t0: t0 + toe, color: 'pink', filters: [['bandpass', 1300, 1]], env: { a: 0.001, tau: 0.012 }, gain: 0.3 });
  } else if (kind === 'glass') { // rubble + glass shards crunch
    noise(B, { t0, color: 'pink', filters: [['lowpass', 600, 0.8]], env: { a: 0.002, tau: 0.025 }, gain: 0.6 });
    grit(B, { t0, count: 22, span: 0.1, f: 5500, Q: 4, gain: 0.3 });
    for (let i = 0; i < 4; i++) { const f = rr(r, 4000, 8000); modal(B, { t0: t0 + r() * 0.08, modes: [[f, 1, 0.02]], gain: 0.15 }); }
  }
}
for (const k of ['concrete', 'dirt', 'gravel', 'metal', 'wood', 'glass']) def('step_' + k, { n: 5, dur: 0.35, peak: 0.9, build: (B, r) => step(B, r, k) });

/* ============================= PLAYER STATE ============================= */
def('hurt', {
  n: 3, dur: 0.5, build: (B, r) => {
    tone(B, { t0: 0.002, f0: rr(r, 90, 110), f1: 40, glide: 0.04, env: { a: 0.001, hold: 0.01, tau: 0.08 }, gain: 1 });
    noise(B, { t0: 0.002, color: 'pink', filters: [['lowpass', 600, 1]], env: { a: 0.001, tau: 0.06 }, gain: 0.9 });
    noise(B, { t0: 0.004, color: 'pink', filters: [{ type: 'bandpass', f: 1600, to: 500, tau: 0.05, Q: 1.5 }], env: { a: 0.003, tau: 0.04 }, gain: 0.45 });
  },
});
def('heartbeat', {
  n: 1, dur: 0.6, build: (B) => {
    for (const [t, f, g] of [[0.002, 58, 1], [0.19, 50, 0.7]]) {
      tone(B, { t0: t, f0: f * 1.4, f1: f * 0.75, glide: 0.03, env: { a: 0.006, hold: 0.01, tau: 0.05 }, gain: g });
      noise(B, { t0: t, color: 'brown', filters: [['lowpass', 110, 1]], env: { a: 0.006, tau: 0.05 }, gain: g * 0.8 });
    }
  },
});
def('tinnitus', {
  n: 1, dur: 5, peak: 0.6, build: (B) => {
    tone(B, { t0: 0.01, f0: 3950, env: { a: 0.03, hold: 0.4, tau: 1.2 }, gain: 0.5 });
    tone(B, { t0: 0.01, f0: 4013, env: { a: 0.03, hold: 0.4, tau: 1.0 }, gain: 0.3 });
    noise(B, { t0: 0.01, filters: [['highpass', 6000, 0.7]], env: { a: 0.05, hold: 0.2, tau: 1.0 }, gain: 0.04 });
  },
});

/* ============================== EXPLOSIONS ============================== */
def('explosion', {
  n: 3, dur: 4.5, peak: 0.98, build: (B, r) => {
    const { ctx, sr } = B; const t0 = 0.002;
    const mix = ctx.createGain(); mix.gain.value = 0.42; const sh = shaper(ctx, 2.0); mix.connect(sh); sh.connect(B.out); const o = { out: mix };
    samples(B, nwave(sr, rr(r, 1.2, 2)), t0, 2.2, [['highpass', 200, 0.7]], mix);
    noise(B, { ...o, t0, filters: [{ type: 'lowpass', f: 9000, to: 1500, tau: 0.12, Q: 0.6 }], env: { a: 0.0005, hold: 0.012, tau: 0.1 }, gain: 1.2 });
    tone(B, { ...o, t0, f0: rr(r, 65, 80), f1: 26, glide: 0.25, env: { a: 0.002, hold: 0.03, tau: 0.55 }, gain: 1.8 });
    noise(B, { ...o, t0, color: 'brown', filters: [['lowpass', 170, 0.8]], env: { a: 0.006, hold: 0.1, tau: 0.95 }, gain: 1.7 });
    noise(B, { ...o, t0, color: 'pink', filters: [{ type: 'lowpass', f: 2600, to: 380, tau: 0.5, Q: 0.6 }], env: { a: 0.003, tau: 0.45 }, gain: 0.9 });
    for (const s of [0.14, 0.29, 0.47, 0.78, 1.15]) noise(B, { ...o, t0: s * rr(r, 0.85, 1.15), color: 'pink', filters: [['lowpass', 900, 0.7]], env: { a: 0.004, tau: 0.08 }, gain: 0.6 * Math.exp(-s / 0.6) });
    // debris raining down
    grit(B, { ...o, t0: 0.25, count: 70, span: 2.8, f: 2500, Q: 1, gain: 0.22, skew: 1.3, extra: [['lowpass', 5000, 0.7]] });
    for (let i = 0; i < 9; i++) { const t = rr(r, 0.4, 2.2); tone(B, { ...o, t0: t, f0: rr(r, 110, 180), f1: 70, env: { a: 0.001, tau: 0.03 }, gain: 0.25 * (1 - t / 3) }); noise(B, { ...o, t0: t, color: 'pink', filters: [['bandpass', rr(r, 400, 900), 1]], env: { a: 0.001, tau: 0.03 }, gain: 0.3 * (1 - t / 3) }); }
  },
});
def('explosion_far', {
  n: 3, dur: 5, peak: 0.9, build: (B, r) => {
    const t0 = 0.002;
    noise(B, { t0, color: 'pink', filters: [['bandpass', rr(r, 300, 500), 0.7]], env: { a: 0.002, tau: 0.05 }, gain: 1 });
    tone(B, { t0, f0: 55, f1: 24, glide: 0.3, env: { a: 0.01, hold: 0.05, tau: 0.8 }, gain: 1.3 });
    noise(B, { t0, color: 'brown', filters: [['lowpass', 200, 0.8]], env: { a: 0.05, hold: 0.2, tau: 1.3 }, gain: 1.5 });
    for (const s of [0.3, 0.6, 1.0, 1.5, 2.1]) noise(B, { t0: s * rr(r, 0.8, 1.2), color: 'brown', filters: [['lowpass', 500, 0.7]], env: { a: 0.02, tau: 0.25 }, gain: 0.6 * Math.exp(-s / 1.2) });
  },
});

/* =============================== AMBIENCE =============================== */
def('amb_wind', {
  n: 1, ch: 2, dur: 18, peak: 0.8, loop: 3, build: (B, r) => {
    const { ctx } = B;
    for (const out of [B.L, B.R]) {
      const src = ctx.createBufferSource(); src.buffer = B.noiseBuf('pink'); src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
      bp.frequency.setValueCurveAtTime(smoothCurve(r, 9, 220, 900), 0, B.dur - 0.01);
      const g = ctx.createGain(); g.gain.setValueCurveAtTime(smoothCurve(r, 11, 0.25, 1), 0, B.dur - 0.01);
      src.connect(bp); bp.connect(g); g.connect(out); src.start(0, r() * 2);
      const s2 = ctx.createBufferSource(); s2.buffer = B.noiseBuf('brown'); s2.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
      const g2 = ctx.createGain(); g2.gain.setValueCurveAtTime(smoothCurve(r, 7, 0.3, 0.8), 0, B.dur - 0.01);
      s2.connect(lp); lp.connect(g2); g2.connect(out); s2.start(0, r() * 2);
      // faint whistle through gaps
      const s3 = ctx.createBufferSource(); s3.buffer = B.noiseBuf('white'); s3.loop = true;
      const bp3 = ctx.createBiquadFilter(); bp3.type = 'bandpass'; bp3.Q.value = 14; bp3.frequency.setValueCurveAtTime(smoothCurve(r, 6, 1200, 2200), 0, B.dur - 0.01);
      const g3 = ctx.createGain(); g3.gain.setValueCurveAtTime(smoothCurve(r, 8, 0, 0.18), 0, B.dur - 0.01);
      s3.connect(bp3); bp3.connect(g3); g3.connect(out); s3.start(0, r() * 2);
    }
  },
});
def('amb_hum', {
  n: 1, ch: 2, dur: 14, peak: 0.7, loop: 3, build: (B, r) => {
    const { ctx } = B;
    for (const out of [B.L, B.R]) {
      const s = ctx.createBufferSource(); s.buffer = B.noiseBuf('brown'); s.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 95;
      const g = ctx.createGain(); g.gain.value = 1; s.connect(lp); lp.connect(g); g.connect(out); s.start(0, r() * 2);
      const s2 = ctx.createBufferSource(); s2.buffer = B.noiseBuf('pink'); s2.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 320; bp.Q.value = 0.5;
      const g2 = ctx.createGain(); g2.gain.setValueCurveAtTime(smoothCurve(r, 6, 0.08, 0.3), 0, B.dur - 0.01);
      s2.connect(bp); bp.connect(g2); g2.connect(out); s2.start(0, r() * 2);
      for (const [f, a] of [[50, 0.035], [100, 0.02], [150, 0.008]]) { const o = ctx.createOscillator(); o.frequency.value = f; const og = ctx.createGain(); og.gain.value = a; o.connect(og); og.connect(out); o.start(0); }
    }
  },
});
def('bird', {
  n: 4, dur: 1.6, peak: 0.8, build: (B, r) => {
    const chirps = 3 + Math.floor(r() * 5); let t = 0.01; const base = rr(r, 3600, 5200);
    for (let i = 0; i < chirps; i++) {
      const f = base * rr(r, 0.9, 1.15);
      tone(B, { t0: t, f0: f * 1.25, f1: f * 0.75, glide: 0.018, vib: [rr(r, 40, 90), f * 0.03], env: { a: 0.004, hold: 0.012, tau: 0.012 }, gain: rr(r, 0.5, 1) });
      t += rr(r, 0.07, 0.16);
    }
  },
});
def('crow', {
  n: 3, dur: 2.2, peak: 0.8, build: (B, r) => {
    const { ctx } = B; const caws = 2 + Math.floor(r() * 2); let t = 0.01;
    for (let i = 0; i < caws; i++) {
      const f = rr(r, 480, 600); const len = rr(r, 0.22, 0.34);
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t); osc.frequency.linearRampToValueAtTime(f * 0.82, t + len);
      const am = ctx.createGain(); am.gain.value = 0.6; const lfo = ctx.createOscillator(); lfo.frequency.value = rr(r, 60, 80); const lg = ctx.createGain(); lg.gain.value = 0.4; lfo.connect(lg); lg.connect(am.gain);
      const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 1150; f1.Q.value = 2.5;
      const f2 = ctx.createBiquadFilter(); f2.type = 'peaking'; f2.frequency.value = 2400; f2.Q.value = 2; f2.gain.value = 8;
      const e = ctx.createGain(); e.gain.setValueAtTime(0, 0); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(1, t + 0.03); e.gain.setValueAtTime(1, t + len - 0.06); e.gain.linearRampToValueAtTime(0, t + len);
      osc.connect(am); am.connect(f1); f1.connect(f2); f2.connect(e); e.connect(B.out);
      osc.start(t); osc.stop(t + len); lfo.start(t); lfo.stop(t + len);
      noise(B, { t0: t, filters: [['bandpass', 1300, 1.5]], env: { a: 0.03, hold: len - 0.08, tau: 0.03 }, gain: 0.25 });
      t += len + rr(r, 0.15, 0.35);
    }
  },
});

/* ================================ BAKING ================================ */
export async function bakeOne(name, sr, i = 0) {
  const R = RECIPES[name]; const r = rng32(hashStr(name) * 31 + i * 7919 + 1);
  const len = Math.ceil(R.dur * sr);
  const ctx = new OfflineAudioContext(R.ch, len, sr);
  const out = ctx.createGain(); out.connect(ctx.destination);
  const B = { ctx, sr, dur: R.dur, r, out, noiseBuf: (c) => noiseBuffer(ctx, c) };
  if (R.ch === 2) {
    const m = ctx.createChannelMerger(2); m.connect(ctx.destination);
    B.L = ctx.createGain(); B.R = ctx.createGain(); B.L.connect(m, 0, 0); B.R.connect(m, 0, 1);
  } else { B.L = B.R = out; }
  R.build(B, r, i);
  let buf = await ctx.startRendering();
  if (R.loop) buf = loopify(ctx, buf, R.loop); else if (!R.keepLead) buf = trimStart(ctx, buf);
  normalize(buf, R.peak);
  if (!R.loop) fadeEdges(buf, Math.min(0.05, R.dur * 0.1));
  return buf;
}

/** Bake every recipe (or `names`), limited concurrency. Calls onEach(name, buffers) as each finishes. */
export async function bakeAll(sr, { names = Object.keys(RECIPES), concurrency = 3, onEach } = {}) {
  const out = new Map(); const queue = [...names];
  async function worker() {
    while (queue.length) {
      const name = queue.shift(); const R = RECIPES[name]; const bufs = [];
      for (let i = 0; i < R.n; i++) bufs.push(await bakeOne(name, sr, i));
      out.set(name, bufs); onEach?.(name, bufs);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}
export { pick };
