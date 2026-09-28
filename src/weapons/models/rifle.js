import * as THREE from 'three';
import { PartBuilder, shape, rrect, sideX, topY, frontZ, latheZ, cyl, box, decalPlane, DEG, circlePts } from '../geo.js';

/**
 * M4A1-style carbine, fully procedural. Weapon space: X right, Y up, -Z forward; bore axis at y=0,
 * s (= -z) = 0 at the rear of the upper receiver. Muzzle at s = 0.60.
 */
const Z = (s) => -s;

function railRun(B, key, s0, s1, y0, { tint } = {}) {
  // Picatinny: continuous spine + individual beveled teeth (5.23 mm slots, 10 mm pitch)
  const spine = shape([[-0.0085, 0], [0.0085, 0], [0.0085, 0.002], [0.0106, 0.0034, 0.0004], [0.0106, 0.0054, 0.0004], [0.0097, 0.0063], [-0.0097, 0.0063], [-0.0106, 0.0054, 0.0004], [-0.0106, 0.0034, 0.0004], [-0.0085, 0.002]]);
  const len = s1 - s0;
  B.add(key, frontZ(spine, len, 0.0004, 1), { p: [0, y0, Z((s0 + s1) / 2)], tint });
  const tooth = shape([[-0.0097, 0.0062], [0.0097, 0.0062], [0.0079, 0.0081], [0.0074, 0.0094], [-0.0074, 0.0094], [-0.0079, 0.0081]]);
  const n = Math.floor((len - 0.004) / 0.01);
  const pad = (len - (n - 1) * 0.01) / 2;
  for (let i = 0; i < n; i++) {
    const s = s0 + pad + i * 0.01;
    B.add(key, frontZ(tooth, 0.0048, 0.0005, 1), { p: [0, y0, Z(s)], tint });
  }
  return n;
}

/** Flat panel (for the octagonal handguard) from cross-section point A to B, with slots. */
function panel(B, key, A, Bp, s0, s1, th, slots = [], opts = {}) {
  const dx = Bp[0] - A[0], dy = Bp[1] - A[1]; const len = Math.hypot(dx, dy);
  const d = new THREE.Vector3(dx / len, dy / len, 0);
  const N = new THREE.Vector3(-d.y, d.x, 0); // outward (panels are walked clockwise)
  if (opts.flip) N.negate();
  const holes = slots.map(([sa, sb, ta, tb]) => rrect((sa + sb) / 2, (ta + tb) / 2, sb - sa, tb - ta, Math.min(tb - ta, sb - sa) * 0.49));
  const sh = shape([[s0, 0], [s1, 0], [s1, len], [s0, len]], holes, 4);
  const g = new THREE.ExtrudeGeometry(sh, { depth: th - 0.001, bevelEnabled: true, bevelThickness: 0.0005, bevelSize: 0.0005, bevelOffset: -0.0005, bevelSegments: 1, curveSegments: 5 });
  // basis: shape X (s) -> (0,0,-1), shape Y (t) -> d, extrude -> X×Y
  const ex = new THREE.Vector3(0, 0, -1), ey = d.clone(), ez = new THREE.Vector3().crossVectors(ex, ey);
  const m = new THREE.Matrix4().makeBasis(ex, ey, ez);
  // put outer surface on the face line
  const inward = N.clone().negate();
  const off = ez.dot(inward) > 0 ? 0 : -th; // extrude spans [0, th] (approx); shift so it goes inward
  m.setPosition(new THREE.Vector3(A[0], A[1], 0).addScaledVector(ez, off + 0.0005));
  g.applyMatrix4(m);
  B.add(key, g, opts);
}

export function buildRifle(mats, { forWorld = false } = {}) {
  const B = new PartBuilder(48);
  const T = {};
  // ---------------------------------------------------------------- upper receiver
  B.add('anod', sideX(shape([[0.004, -0.017, 0.0008], [0.180, -0.017, 0.0008], [0.180, 0.0145, 0.0008], [0.012, 0.0145, 0.002], [0.004, 0.009, 0.001]]), 0.0225, 0.0012), {});
  // lower lip ledge
  B.add('anod', sideX(shape([[0.006, -0.0172, 0], [0.179, -0.0172, 0], [0.179, -0.006, 0.001], [0.006, -0.006, 0.001]]), 0.0238, 0.0008), {});
  // barrel-nut collar
  B.add('anod', latheZ([[0.0, 0.176], [0.0165, 0.176], [0.0172, 0.179], [0.0172, 0.188], [0.0162, 0.19], [0.0, 0.19]], 28), { tint: [0.9, 0.9, 0.9] });
  // forward assist housing (right) + plunger
  B.add('anod', sideX(shape([[0.004, -0.004, 0.002], [0.030, -0.004, 0.004], [0.062, 0.0005, 0.006], [0.030, 0.012, 0.004], [0.004, 0.011, 0.002]]), 0.009, 0.0028, 3), { p: [0.0135, 0, 0] });
  B.add('steel', latheZ([[0.0, -0.012], [0.0052, -0.012], [0.0058, -0.0105], [0.0058, 0.004], [0.0048, 0.005], [0.0048, 0.012], [0, 0.012]], 18), { p: [0.0165, 0.0035, Z(0.004)], r: [0, -18 * DEG, 0] });
  for (let i = 0; i < 6; i++) B.add('steel', latheZ([[0.0, 0], [0.006, 0], [0.006, 0.0012], [0, 0.0012]], 18), { p: [0.0165 - Math.sin(18 * DEG) * (-0.01 + i * 0.002), 0.0035, Z(0.004 - 0.01 + i * 0.002)], r: [0, -18 * DEG, 0] });
  // brass deflector
  B.add('anod', sideX(shape([[0.052, -0.004, 0.002], [0.066, -0.004, 0.001], [0.066, 0.013, 0.002], [0.058, 0.013, 0.003]]), 0.007, 0.0022, 3), { p: [0.0125, 0, 0] });
  // ejection port frame (right)
  B.add('anod', sideX(shape(rrect(0.094, 0.0, 0.062, 0.021, 0.002), [rrect(0.094, 0.0, 0.057, 0.0165, 0.0015)]), 0.0014, 0.0004, 1), { p: [0.0115, 0, 0] });
  // left side: bolt-release boss & ribs
  B.add('anod', sideX(shape([[0.090, -0.013, 0.002], [0.150, -0.013, 0.002], [0.150, -0.009, 0.001], [0.090, -0.009, 0.001]]), 0.0012, 0.0004, 1), { p: [-0.0118, 0, 0] });
  // ---------------------------------------------------------------- top rail (upper + handguard: monolithic look)
  railRun(B, 'anod', 0.010, 0.178, 0.0145);
  railRun(B, 'anod', 0.184, 0.492, 0.0145);

  // ---------------------------------------------------------------- lower receiver
  const lowerProf = [[-0.014, 0.013, 0.003], [0.004, 0.013, 0.001], [0.004, -0.0172, 0], [0.176, -0.0172, 0.001], [0.176, -0.031, 0.004], [0.160, -0.040, 0.003], [0.150, -0.043, 0], [0.085, -0.047, 0], [0.032, -0.047, 0.002], [0.004, -0.046, 0.002], [-0.010, -0.036, 0.005], [-0.018, -0.024, 0.004], [-0.018, -0.008, 0.003]];
  B.add('anod', sideX(shape(lowerProf), 0.0245, 0.0012), {});
  // front pivot lug ears
  B.add('anod', sideX(shape([[0.162, -0.018, 0.001], [0.183, -0.018, 0.003], [0.183, -0.034, 0.005], [0.168, -0.036, 0.002]]), 0.0245, 0.0015), {});
  // magwell (hollow) + flare
  const mwOuter = rrect(0, 0.1175, 0.033, 0.075, 0.003), mwHole = rrect(0, 0.1175, 0.0238, 0.0645, 0.0025);
  B.add('anod', topY(shape(mwOuter, [mwHole]), 0.036, 0.0012), { p: [0, -0.059, 0] });
  B.add('anod', topY(shape(rrect(0, 0.1175, 0.0355, 0.079, 0.003), [mwHole]), 0.006, 0.0015), { p: [0, -0.078, 0] });
  // magwell front serrations
  for (let i = 0; i < 6; i++) B.add('anod', box(0.022, 0.0016, 0.0022), { p: [0, -0.046 - i * 0.0048, Z(0.1555)] });
  // bolt catch (left)
  B.add('steel', sideX(shape([[0.066, -0.019, 0.001], [0.082, -0.019, 0.002], [0.086, -0.028, 0.002], [0.078, -0.032, 0.002], [0.070, -0.026, 0.001]]), 0.0028, 0.0008, 1), { p: [-0.0135, 0, 0] });
  // mag release (right) with fence
  B.add('steel', latheZ([[0, 0], [0.0042, 0], [0.0045, 0.0012], [0.0045, 0.003], [0, 0.003]], 16), { p: [0.0118, -0.036, Z(0.080)], r: [0, -Math.PI / 2, 0] });
  B.add('anod', sideX(shape([[0.071, -0.043, 0.002], [0.089, -0.043, 0.002], [0.089, -0.028, 0.003], [0.083, -0.030, 0.002], [0.077, -0.030], [0.071, -0.028, 0.003]]), 0.003, 0.0009, 1), { p: [0.0128, 0, 0] });
  // pins (both sides)
  const pins = [[0.172, -0.027, 0.0034], [-0.009, -0.008, 0.0034], [0.060, -0.036, 0.0022], [0.041, -0.031, 0.0022]];
  for (const [s, y, r] of pins) for (const sx of [-1, 1]) {
    B.add('steel', latheZ([[0, 0], [r, 0], [r * 0.9, 0.0009], [0, 0.0012]], 14), { p: [sx * 0.0122, y, Z(s)], r: [0, -sx * Math.PI / 2, 0] });
  }
  // trigger guard (Magpul-style) and trigger
  B.add('anod', sideX(shape([[0.086, -0.046], [0.086, -0.052, 0.002], [0.072, -0.066, 0.007], [0.035, -0.066, 0.006], [0.019, -0.057, 0.004], [0.017, -0.046]],
    [[[0.078, -0.047], [0.078, -0.052, 0.002], [0.067, -0.0605, 0.004], [0.037, -0.0605, 0.004], [0.026, -0.054, 0.003], [0.025, -0.047]]]), 0.0105, 0.0016, 2), { tint: [0.85, 0.85, 0.85] });
  T.trigger = sideX(shape([[0.047, -0.044], [0.053, -0.044], [0.0535, -0.049, 0.002], [0.0505, -0.056, 0.003], [0.044, -0.0605, 0.001], [0.0445, -0.058], [0.0475, -0.053, 0.002], [0.048, -0.048]]), 0.0045, 0.0006, 1);
  // selector (ambi lever) — separate so fire-mode toggle rotates it
  const selGeo = sideX(shape([[-0.003, -0.0025, 0.0015], [0.016, -0.002, 0.002], [0.017, 0.0025, 0.002], [-0.003, 0.0025, 0.0015]]), 0.0022, 0.0007, 1);
  const selHub = latheZ([[0, 0], [0.0045, 0], [0.0045, 0.0022], [0, 0.0022]], 16); selHub.rotateY(Math.PI / 2); selHub.translate(-0.0011, 0, 0);
  // grip (stippled polymer, FDE) — soap-bar bevel
  const gripProf = [[0.034, -0.046], [0.028, -0.064, 0.006], [0.023, -0.078, 0.009], [0.014, -0.100, 0.012], [0.004, -0.124, 0.006], [-0.004, -0.131, 0.005], [-0.040, -0.133, 0.007], [-0.045, -0.124, 0.006], [-0.031, -0.090, 0.014], [-0.021, -0.062, 0.010], [-0.024, -0.051, 0.004], [-0.013, -0.044, 0.002]];
  B.add('fdeStip', sideX(shape(gripProf, [], 4), 0.031, 0.0072, 4), {});
  // grip core cap
  B.add('fde', sideX(shape([[0.006, -0.126, 0.002], [-0.040, -0.128, 0.004], [-0.043, -0.1365, 0.004], [-0.002, -0.1345, 0.004]]), 0.026, 0.002, 2), { tint: [0.8, 0.78, 0.75] });

  // ---------------------------------------------------------------- buffer tube, castle nut, end plate, stock
  B.add('anod', latheZ([[0, -0.012], [0.0146, -0.012], [0.0146, -0.196], [0.0125, -0.199], [0, -0.199]], 28), {});
  B.add('anod', latheZ([[0.0147, -0.013], [0.0188, -0.0135], [0.019, -0.022], [0.0152, -0.0235]], 28), { tint: [0.8, 0.8, 0.8] });
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.3; B.add('anod', box(0.0036, 0.004, 0.0048), { p: [Math.cos(a) * 0.0182, Math.sin(a) * 0.0182, Z(-0.0182)], r: [0, 0, a], tint: [0.4, 0.4, 0.4] }); }
  B.add('steel', frontZ(shape([[-0.017, -0.02, 0.004], [0.017, -0.02, 0.004], [0.017, 0.012, 0.006], [-0.017, 0.012, 0.006]], [circlePts(0, 0, 0.0148, 20)]), 0.0025, 0.0006, 1), { p: [0, 0, Z(-0.0115)] });
  // end-plate sling loop (left)
  B.add('steel', new THREE.TorusGeometry(0.0055, 0.0014, 8, 16), { p: [-0.021, -0.006, Z(-0.012)], r: [0, 0, 0], smooth: true });
  // stock: CTR/MOE style body with lightening cut
  const stockProf = [[-0.078, 0.019, 0.004], [-0.200, 0.023, 0.03], [-0.232, 0.034, 0.006], [-0.238, 0.030, 0.002], [-0.238, -0.088, 0.004], [-0.228, -0.094, 0.006], [-0.180, -0.060, 0.03], [-0.120, -0.028, 0.02], [-0.078, -0.020, 0.004]];
  const stockHole = [[-0.215, -0.012, 0.006], [-0.215, -0.074, 0.008], [-0.172, -0.030, 0.01], [-0.172, -0.014, 0.004]];
  B.add('fde', sideX(shape(stockProf, [stockHole], 5), 0.036, 0.0055, 3), {});
  // stock tube housing ridge + lock lever
  B.add('fde', latheZ([[0.0, -0.075], [0.0192, -0.075], [0.0195, -0.08], [0.0195, -0.19], [0.0, -0.19]], 24), { tint: [0.95, 0.95, 0.95] });
  B.add('fde', sideX(shape([[-0.085, -0.021, 0.002], [-0.135, -0.03, 0.004], [-0.13, -0.036, 0.003], [-0.09, -0.029, 0.002]]), 0.012, 0.002, 2), { tint: [0.9, 0.9, 0.9] });
  // buttpad (rubber, grooves)
  B.add('rubber', sideX(shape([[-0.2355, 0.033, 0.004], [-0.2475, 0.031, 0.004], [-0.2475, -0.091, 0.004], [-0.2355, -0.093, 0.004]]), 0.043, 0.004, 3), {});
  for (let i = 0; i < 9; i++) B.add('rubber', box(0.041, 0.0028, 0.0022), { p: [0, 0.024 - i * 0.0135, Z(-0.2485)] });
  // QD sling cup on stock (left) + on handguard (left)
  const qd = latheZ([[0.0, 0.0], [0.0068, 0.0], [0.0072, 0.001], [0.0072, 0.005], [0.0048, 0.0052], [0.0045, 0.002], [0.0, 0.002]], 18);
  B.add('steel', qd.clone(), { p: [-0.0172, -0.012, Z(-0.2)], r: [0, Math.PI / 2, 0] });
  B.add('steel', qd.clone(), { p: [-0.0232, -0.008, Z(0.215)], r: [0, Math.PI / 2, 0] });

  // ---------------------------------------------------------------- handguard (octagonal, M-LOK)
  const hs0 = 0.186, hs1 = 0.492, th = 0.0026;
  const P = {
    tl: [-0.0118, 0.0145], tr: [0.0118, 0.0145],
    rt: [0.0236, 0.0035], rb: [0.0236, -0.0175],
    br: [0.0122, -0.0295], bl: [-0.0122, -0.0295],
    lb: [-0.0236, -0.0175], lt: [-0.0236, 0.0035],
  };
  const mlok = (len, n, s0, pitch = 0.040, sl = 0.032) => { const o = []; for (let i = 0; i < n; i++) { const a = s0 + i * pitch; o.push([a, a + sl]); } return o; };
  const sideSlots = mlok(0, 7, 0.212, 0.04, 0.032).map(([a, b]) => [a, b, 0.0075, 0.0145]);
  const diagSlots = mlok(0, 7, 0.212, 0.04, 0.032).map(([a, b]) => [a, b, 0.0045, 0.0115]);
  const botSlots = mlok(0, 7, 0.212, 0.04, 0.032).map(([a, b]) => [a, b, 0.0085, 0.0159]);
  // walk CCW when viewed from behind looking forward (+x right): top -> right diag -> right -> ...
  panel(B, 'anod', P.tl, P.tr, hs0, hs1, th, [], {});
  panel(B, 'anod', P.tr, P.rt, hs0, hs1, th, [], {});
  panel(B, 'anod', P.rt, P.rb, hs0, hs1, th, sideSlots, {});
  panel(B, 'anod', P.rb, P.br, hs0, hs1, th, diagSlots, {});
  panel(B, 'anod', P.br, P.bl, hs0, hs1, th, botSlots, {});
  panel(B, 'anod', P.bl, P.lb, hs0, hs1, th, diagSlots.map(([a, b, c, d]) => [a, b, 0.0159 - d, 0.0159 - c]), {});
  panel(B, 'anod', P.lb, P.lt, hs0, hs1, th, sideSlots.map(([a, b, c, d]) => [a, b, 0.021 - d, 0.021 - c]), {});
  panel(B, 'anod', P.lt, P.tl, hs0, hs1, th, [], {});
  // front and rear end rings
  const oct = [P.tl, P.tr, P.rt, P.rb, P.br, P.bl, P.lb, P.lt].map(([x, y]) => [x, y, 0.0015]);
  B.add('anod', frontZ(shape(oct, [circlePts(0, -0.003, 0.0125, 20)]), 0.005, 0.0012, 2), { p: [0, 0, Z(hs1 - 0.002)] });
  B.add('anod', frontZ(shape(oct.map(([x, y]) => [x * 1.02, y + (y > 0 ? 0 : -0.0005), 0.0015]), [circlePts(0, -0.003, 0.016, 20)]), 0.008, 0.0012, 2), { p: [0, 0, Z(hs0 + 0.003)], tint: [0.85, 0.85, 0.85] });
  // handguard cross bolts (hex heads) at rear
  for (const sx of [-1, 1]) for (const s of [0.195, 0.205]) B.add('steel', cyl(0.0022, 0.0012, 6, 'x'), { p: [sx * 0.0243, -0.012, Z(s)] });
  // front BUIS (folded) and rear BUIS (folded)
  B.add('anod', sideX(shape([[0.462, 0.024, 0.001], [0.49, 0.024, 0.001], [0.49, 0.031, 0.003], [0.47, 0.0335, 0.004], [0.462, 0.031, 0.002]]), 0.02, 0.0015, 2), {});
  B.add('anod', sideX(shape([[0.468, 0.033, 0.001], [0.489, 0.033, 0.001], [0.487, 0.036, 0.001], [0.47, 0.036]]), 0.008, 0.0008, 1), {});
  B.add('anod', sideX(shape([[0.010, 0.024, 0.001], [0.038, 0.024, 0.001], [0.038, 0.031, 0.002], [0.030, 0.0345, 0.003], [0.010, 0.033, 0.003]]), 0.02, 0.0015, 2), {});
  B.add('anod', cyl(0.004, 0.006, 14, 'x'), { p: [0.013, 0.028, Z(0.024)] });

  // ---------------------------------------------------------------- barrel, gas block, flash hider
  B.add('steel', latheZ([[0, 0.17], [0.0108, 0.17], [0.0108, 0.33], [0.0098, 0.334], [0.0098, 0.355], [0.0094, 0.36], [0.0094, 0.546], [0.0075, 0.548], [0, 0.548]], 24), {});
  B.add('steel', frontZ(shape(rrect(0, -0.002, 0.024, 0.026, 0.004), [circlePts(0, 0, 0.0099, 18)]), 0.018, 0.001, 2), { p: [0, 0, Z(0.344)] }); // gas block
  B.add('steel', cyl(0.0024, 0.16, 10, 'z'), { p: [0, 0.012, Z(0.26)] }); // gas tube
  // A2 birdcage
  B.add('steel', latheZ([[0.0055, 0.546], [0.0112, 0.546], [0.0115, 0.548], [0.0115, 0.556], [0.0055, 0.556]], 24), {});
  B.add('steel', latheZ([[0.0055, 0.592], [0.0115, 0.592], [0.0115, 0.598], [0.011, 0.6], [0.0055, 0.6]], 24), {});
  // prongs (bottom closed): slots centered at 90° ±50°, ±100° (top-referenced)
  const closedArcs = [];
  { const slots = [0, 50, -50, 100, -100].map((a) => (90 + a) * DEG), hw = 11 * DEG; const edges = [];
    for (const c of slots) edges.push([c - hw, c + hw]);
    edges.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < edges.length; i++) { const a = edges[i][1], b = i + 1 < edges.length ? edges[i + 1][0] : edges[0][0] + Math.PI * 2; closedArcs.push([a, b - a]); } }
  for (const [a, len] of closedArcs) {
    // lathe phi is measured from +Z toward +X before rotation; our ring after rotateX maps (x,z)->(x,-y)… use explicit
    const g = latheZ([[0.0078, 0.556], [0.0115, 0.556], [0.0115, 0.592], [0.0078, 0.592]], Math.max(3, Math.round(len / (12 * DEG))), 0, len);
    // lathe phi starts at +Z (pre-rotation) which becomes -Y... rotate so arc starts at angle a from +X
    g.rotateZ(a + len - Math.PI / 2);
    B.add('steel', g, { crease: 60 });
  }

  // ---------------------------------------------------------------- optic (holographic)
  const oy = 0.0239; // rail top
  B.add('anodFlat', sideX(shape([[0.046, oy, 0], [0.118, oy, 0], [0.118, oy + 0.0072, 0.002], [0.046, oy + 0.0072, 0.002]]), 0.0305, 0.0012), {});
  B.add('anodFlat', latheZ([[0, 0], [0.0062, 0], [0.0066, 0.001], [0.0066, 0.005], [0, 0.0055]], 18), { p: [-0.0152, oy + 0.004, Z(0.082)], r: [0, Math.PI / 2, 0] }); // clamp knob
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; B.add('anodFlat', box(0.004, 0.0014, 0.0014), { p: [-0.0182, oy + 0.004 + Math.sin(a) * 0.0066, Z(0.082) + Math.cos(a) * 0.0066], tint: [0.9, 0.9, 0.9] }); }
  // body (battery housing)
  B.add('anodFlat', sideX(shape([[0.034, oy + 0.006, 0.003], [0.128, oy + 0.006, 0.002], [0.132, oy + 0.0165, 0.003], [0.036, oy + 0.0165, 0.004]]), 0.036, 0.0022, 2), {});
  // hood
  const hoodOuter = [[-0.0215, 0.038, 0.002], [0.0215, 0.038, 0.002], [0.0215, 0.080, 0.009], [0.012, 0.089, 0.005], [-0.012, 0.089, 0.005], [-0.0215, 0.080, 0.009]];
  const hoodHole = rrect(0, 0.0635, 0.034, 0.031, 0.003);
  B.add('anodFlat', frontZ(shape(hoodOuter, [hoodHole], 4), 0.080, 0.0016, 2), { p: [0, 0, Z(0.084)] });
  // hood front lip (chamfered)
  B.add('anodFlat', frontZ(shape(hoodOuter.map(([x, y, r]) => [x * 1.04, y + (y < 0.05 ? -0.0005 : 0.001), r]), [rrect(0, 0.0635, 0.035, 0.032, 0.003)], 4), 0.006, 0.0018, 2), { p: [0, 0, Z(0.121)], tint: [0.85, 0.85, 0.85] });
  // rear buttons
  for (const [x, c] of [[-0.009, 0.7], [0.0, 1], [0.009, 0.7]]) B.add('rubber', new THREE.CylinderGeometry(0.0034, 0.0036, 0.004, 14).rotateX(Math.PI / 2), { p: [x, oy + 0.0115, Z(0.034)], tint: [c, c, c] });
  // side window "ears" on hood top
  B.add('anodFlat', box(0.01, 0.003, 0.03), { p: [0, 0.0895, Z(0.1)] });

  // ---------------------------------------------------------------- merge static parts
  const group = B.build(mats);
  group.name = 'rifle';

  // glass + reticle + lens interior tint
  const rearGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.034, 0.031), mats.glass); rearGlass.position.set(0, 0.0635, Z(0.058));
  const frontGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.034, 0.031), mats.glass); frontGlass.position.set(0, 0.0635, Z(0.117));
  const reticle = new THREE.Mesh(new THREE.PlaneGeometry(0.034, 0.031), mats.reticle); reticle.position.set(0, 0.0635, Z(0.1165)); reticle.renderOrder = 5;
  group.add(rearGlass, frontGlass, reticle);

  // markings (decals)
  const mk = (w, h, uv, mat, p, r) => { const m = new THREE.Mesh(decalPlane(w, h, uv), mat); m.position.set(...p); m.rotation.set(...r); group.add(m); return m; };
  mk(0.05, 0.012, [0.0, 0.0, 0.5, 0.39], mats.marks, [-0.01665, -0.056, Z(0.1175)], [0, -Math.PI / 2, 0]);
  mk(0.034, 0.0045, [0.52, 0.03, 1.0, 0.25], mats.marks, [-0.01235, -0.0215, Z(0.022)], [0, -Math.PI / 2, 0]);
  // rail numbers on the handguard rail (left flank)
  mk(0.3, 0.0038, [0.0, 0.5, 1.0, 0.75], mats.marksWhite, [-0.01065, 0.0189, Z(0.335)], [0, -Math.PI / 2, 0]);
  // optic side logo
  mk(0.034, 0.0065, [0.0, 0.76, 0.5, 1.0], mats.marks, [-0.0181, oy + 0.0115, Z(0.08)], [0, -Math.PI / 2, 0]);

  // ---------------------------------------------------------------- moving parts
  const mp = (key, geo, parent = group) => { const b = new PartBuilder(48); b.add(key, geo); const g = b.build(mats); parent.add(g); return g; };
  const trig = mp('steel', T.trigger);
  const sel = new THREE.Group(); sel.position.set(-0.0131, -0.029, Z(0.022)); group.add(sel);
  { const b = new PartBuilder(48); b.add('steel', selGeo); b.add('steel', selHub); sel.add(b.build(mats)); }
  const selR = new THREE.Group(); selR.position.set(0.0131, -0.029, Z(0.022)); group.add(selR);
  { const b = new PartBuilder(48); b.add('steel', selGeo.clone().scale(0.8, 0.8, 0.8)); b.add('steel', selHub.clone().scale(-1, 1, 1)); selR.add(b.build(mats)); }

  // charging handle (slides back along +z)
  const ch = new THREE.Group(); group.add(ch);
  { const b = new PartBuilder(48);
    b.add('anod', topY(shape([[-0.0215, -0.013, 0.002], [0.0215, -0.013, 0.002], [0.0215, -0.005, 0.0025], [0.006, -0.002, 0.002], [0.006, 0.012], [-0.006, 0.012], [-0.006, -0.002, 0.002], [-0.0215, -0.005, 0.0025]]), 0.0065, 0.0015, 2), { p: [0, 0.0105, 0] });
    b.add('anod', box(0.006, 0.004, 0.012), { p: [-0.0195, 0.0105, Z(-0.008)], tint: [0.7, 0.7, 0.7] });
    b.add('anod', box(0.006, 0.004, 0.012), { p: [0.0195, 0.0105, Z(-0.008)], tint: [0.7, 0.7, 0.7] });
    ch.add(b.build(mats)); }

  // dust cover (hinge along z at bottom of port, right side)
  const dust = new THREE.Group(); dust.position.set(0.0122, -0.0098, 0); group.add(dust);
  { const b = new PartBuilder(48);
    b.add('anod', sideX(shape(rrect(0.094, 0.0098, 0.059, 0.0185, 0.0015)), 0.0012, 0.0004, 1), { p: [0.0003, 0, 0] });
    for (let i = 0; i < 5; i++) b.add('anod', box(0.0008, 0.012, 0.0012), { p: [0.0012, 0.0098, Z(0.08 + i * 0.007)], tint: [0.8, 0.8, 0.8] });
    b.add('steel', cyl(0.0011, 0.07, 8, 'z'), { p: [0, 0, Z(0.094)] });
    dust.add(b.build(mats)); }
  // bolt carrier visible through the port
  const bolt = new THREE.Group(); group.add(bolt);
  { const b = new PartBuilder(48);
    b.add('dark', box(0.001, 0.016, 0.056), { p: [0.0106, 0, Z(0.094)] });
    b.add('bright', latheZ([[0.0082, 0.064], [0.0082, 0.125]], 20, Math.PI * 0.25, Math.PI * 0.5), { p: [0.0032, 0, 0] });
    b.add('bright', box(0.004, 0.005, 0.009), { p: [0.0105, 0.001, Z(0.107)] });
    bolt.add(b.build(mats)); }

  // magazine
  const mag = buildMag(mats);
  mag.position.set(0, -0.031, Z(0.1175));
  group.add(mag);
  const magRest = mag.matrix.clone(); mag.updateMatrix(); magRest.copy(mag.matrix);

  // muzzle anchor
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, Z(0.605)); group.add(muzzle);
  const ejectPort = new THREE.Object3D(); ejectPort.position.set(0.014, 0.0, Z(0.095)); group.add(ejectPort);

  group.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.receiveShadow = true; o.castShadow = forWorld; } });
  let tris = 0; group.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });

  return {
    group, mag, magRest, trigger: trig, selector: [sel, selR], ch, dust, bolt, muzzle, ejectPort, tris,
    sight: new THREE.Vector3(0, 0.0635, Z(0.06)),
  };
}

export function buildMag(mats, { empty = false } = {}) {
  // PMAG-style curved polymer magazine. Origin = top centre (inserted position).
  const B = new PartBuilder(48);
  const L = 0.182, N = 18, half = 0.0305;
  const C = [], Nn = [];
  let p = new THREE.Vector2(0, 0), th = 0;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    th = t < 0.22 ? 0 : 17 * DEG * Math.pow((t - 0.22) / 0.78, 1.3);
    C.push(p.clone()); Nn.push(new THREE.Vector2(Math.cos(th), Math.sin(th)));
    p = p.clone().add(new THREE.Vector2(Math.sin(th), -Math.cos(th)).multiplyScalar(L / N));
  }
  const front = C.map((c, i) => [c.x + Nn[i].x * half, c.y + Nn[i].y * half]);
  const rear = C.map((c, i) => [c.x - Nn[i].x * half, c.y - Nn[i].y * half]).reverse();
  front[0].push(0.001); rear[rear.length - 1].push(0.001);
  B.add('fde', sideX(shape([...front, ...rear]), 0.0232, 0.0018, 2), {});
  // lower body flare / baseplate
  const e = C[N], ne = Nn[N], de = new THREE.Vector2(-ne.y, ne.x); // de = downward-ish? (perp)
  const bp = [];
  const q = (u, v) => [e.x + ne.x * u + de.x * v, e.y + ne.y * v * 0 + ne.y * u + de.y * v];
  bp.push([...q(-half - 0.004, 0.004), 0.002], [...q(half + 0.0045, 0.004), 0.002], [...q(half + 0.0045, -0.011), 0.004], [...q(-half - 0.004, -0.011), 0.004]);
  B.add('fde', sideX(shape(bp), 0.0275, 0.003, 3), { tint: [0.92, 0.92, 0.92] });
  // raised grip ribs across the lower half, both sides
  for (let k = 0; k < 7; k++) {
    const i = 9 + k; const c = C[i], n = Nn[i];
    const ang = Math.atan2(n.y, n.x);
    for (const sx of [-1, 1]) B.add('fde', box(0.0016, 0.0022, 0.048), { p: [sx * 0.0122, c.y, Z(c.x)], r: [ang, 0, 0], tint: [0.9, 0.9, 0.9] });
  }
  // dot-matrix label panel (slightly raised), upper body sides
  for (const sx of [-1, 1]) B.add('fde', box(0.0008, 0.03, 0.04), { p: [sx * 0.0119, -0.068, Z(0.001)], tint: [1.05, 1.05, 1.05] });
  // front/rear ridge lines
  for (let i = 3; i < N - 1; i += 2) { const c = C[i], n = Nn[i]; B.add('fde', box(0.016, 0.004, 0.0025), { p: [0, c.y + n.y * (half + 0.0006), Z(c.x + n.x * (half + 0.0006))], tint: [0.88, 0.88, 0.88] }); }
  // feed lips + top round
  B.add('poly', sideX(shape([[-0.028, 0.0], [0.024, 0.0], [0.024, 0.004, 0.001], [-0.028, 0.004, 0.001]]), 0.022, 0.001), { p: [0, 0.0005, 0] });
  if (!empty) {
    B.add('brass', latheZ([[0, -0.028], [0.0045, -0.028], [0.0048, -0.0265], [0.0045, -0.026], [0.0048, -0.0255], [0.0048, 0.006], [0.0032, 0.010], [0.0032, 0.013], [0, 0.013]], 16), { p: [-0.0035, 0.0078, 0] });
    B.add('copper', latheZ([[0.0029, 0.013], [0.0029, 0.018], [0.0018, 0.026], [0.0004, 0.029], [0, 0.029]], 16), { p: [-0.0035, 0.0078, 0] });
    B.add('brass', latheZ([[0, -0.028], [0.0048, -0.028], [0.0048, 0.006], [0.0032, 0.010], [0.0032, 0.013], [0, 0.013]], 12), { p: [0.0045, 0.0015, Z(-0.002)] });
  }
  const g = B.build(mats);
  const grp = new THREE.Group(); grp.add(g);
  grp.traverse((o) => { o.frustumCulled = false; });
  return grp;
}
