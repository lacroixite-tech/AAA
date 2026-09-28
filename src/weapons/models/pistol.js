import * as THREE from 'three';
import { PartBuilder, shape, rrect, sideX, frontZ, latheZ, cyl, box, DEG, circlePts } from '../geo.js';

/**
 * Striker-fired 9mm service pistol (Glock-17 proportions). Bore axis y=0, s=0 at rear of slide.
 * Slide is a separate group so it can cycle / lock back.
 */
const Z = (s) => -s;

export function buildPistol(mats, { forWorld = false } = {}) {
  const group = new THREE.Group(); group.name = 'pistol';
  // ---------------------------------------------------------------- frame (polymer)
  const F = new PartBuilder(48);
  const frame = [[0.186, -0.0115], [0.186, -0.025, 0.003], [0.121, -0.026, 0.002], [0.119, -0.050, 0.004], [0.112, -0.056, 0.005], [0.072, -0.056, 0.008],
    [0.052, -0.049, 0.004], [0.049, -0.060, 0.004], [0.045, -0.074, 0.007], [0.041, -0.088, 0.007], [0.036, -0.104, 0.008], [0.031, -0.124, 0.005],
    [0.028, -0.131, 0.002], [-0.009, -0.134, 0.002], [-0.014, -0.126, 0.005], [-0.011, -0.088, 0.02], [-0.002, -0.046, 0.01], [-0.012, -0.028, 0.006], [-0.006, -0.016, 0.004], [0.012, -0.0115]];
  const guardHole = [[0.113, -0.029, 0.001], [0.111, -0.048, 0.004], [0.075, -0.0505, 0.006], [0.057, -0.043, 0.004], [0.058, -0.029, 0.002]];
  F.add('poly', sideX(shape(frame, [guardHole], 4), 0.0262, 0.0032, 3), {});
  // grip panel (stippled, slightly wider)
  F.add('polyStip', sideX(shape([[0.046, -0.052, 0.003], [0.041, -0.088, 0.007], [0.034, -0.118, 0.006], [0.028, -0.127, 0.002], [-0.008, -0.13, 0.002], [-0.011, -0.122, 0.004], [-0.008, -0.088, 0.018], [0.002, -0.05, 0.006]], [], 4), 0.0292, 0.0045, 3), {});
  // accessory rail on dust cover
  for (let i = 0; i < 3; i++) F.add('poly', box(0.021, 0.0035, 0.0055), { p: [0, -0.0265, Z(0.14 + i * 0.012)] });
  F.add('poly', box(0.018, 0.003, 0.058), { p: [0, -0.0245, Z(0.152)] });
  // trigger
  F.add('poly', sideX(shape([[0.078, -0.026], [0.084, -0.026], [0.084, -0.034, 0.002], [0.08, -0.043, 0.003], [0.074, -0.047, 0.001], [0.075, -0.043], [0.078, -0.036, 0.002]]), 0.0055, 0.0008, 1), {});
  F.add('poly', box(0.0015, 0.008, 0.002), { p: [0, -0.038, Z(0.079)] });
  // slide stop lever + takedown tabs (left side)
  F.add('steel', sideX(shape([[0.07, -0.013, 0.001], [0.108, -0.013, 0.001], [0.108, -0.0165, 0.001], [0.076, -0.018, 0.002], [0.07, -0.016]]), 0.0016, 0.0005, 1), { p: [-0.0138, 0, 0] });
  for (const sx of [-1, 1]) F.add('steel', box(0.0014, 0.0035, 0.009), { p: [sx * 0.0135, -0.0185, Z(0.118)] });
  // pins
  for (const [s, y] of [[0.103, -0.02], [0.074, -0.019], [0.06, -0.033]]) for (const sx of [-1, 1]) F.add('steel', cyl(0.0014, 0.001, 10, 'x'), { p: [sx * 0.0131, y, Z(s)] });
  // magazine base plate + mag release
  F.add('poly', sideX(shape([[0.031, -0.129, 0.002], [-0.011, -0.133, 0.002], [-0.013, -0.141, 0.004], [0.031, -0.138, 0.004]]), 0.0245, 0.002, 2), { tint: [0.8, 0.8, 0.8] });
  F.add('poly', box(0.0025, 0.007, 0.009), { p: [0.0132, -0.046, Z(0.058)] });
  const frameG = F.build(mats); group.add(frameG);

  // ---------------------------------------------------------------- slide
  const slide = new THREE.Group(); group.add(slide);
  const S = new PartBuilder(48);
  const slideXS = [[-0.0128, -0.0115], [0.0128, -0.0115], [0.0128, 0.0085, 0.001], [0.0088, 0.0145, 0.002], [-0.0088, 0.0145, 0.002], [-0.0128, 0.0085, 0.001]];
  const slideXSnarrow = slideXS.map(([x, y, r]) => [x * 0.92, y, r]);
  S.add('steel', frontZ(shape(slideXS), 0.144, 0.0012, 2), { p: [0, 0, Z(0.042 + 0.072)] });
  S.add('steel', frontZ(shape(slideXSnarrow), 0.043, 0.0008, 1), { p: [0, 0, Z(0.0215)] });
  for (let i = 0; i < 8; i++) S.add('steel', frontZ(shape(slideXS.map(([x, y]) => [x, y * 0.96])), 0.0022, 0.0004, 1), { p: [0, -0.0003, Z(0.006 + i * 0.0045)] });
  // front chamfer (nose)
  S.add('steel', frontZ(shape(slideXS.map(([x, y, r]) => [x * 0.94, y, r])), 0.006, 0.002, 2), { p: [0, 0, Z(0.187)] });
  // ejection port (dark gap) + barrel hood
  S.add('dark', box(0.0205, 0.0012, 0.051), { p: [0.0005, 0.01455, Z(0.128)] });
  S.add('bright', box(0.0172, 0.0045, 0.046), { p: [0.0005, 0.0122, Z(0.129)], tint: [0.55, 0.55, 0.55] });
  S.add('dark', box(0.0012, 0.009, 0.051), { p: [0.01285, 0.0075, Z(0.128)] });
  // extractor (right)
  S.add('steel', box(0.0012, 0.003, 0.02), { p: [0.0133, 0.004, Z(0.1)], tint: [1.2, 1.2, 1.2] });
  // sights
  S.add('steel', sideX(shape([[0.003, 0.0145], [0.014, 0.0145], [0.012, 0.0215, 0.001], [0.004, 0.0215, 0.001]]), 0.017, 0.0008, 1), {});
  S.add('dark', box(0.0035, 0.0045, 0.012), { p: [0, 0.0195, Z(0.008)] });
  S.add('steel', sideX(shape([[0.172, 0.0145], [0.184, 0.0145], [0.182, 0.021, 0.001], [0.175, 0.021, 0.001]]), 0.0036, 0.0006, 1), {});
  // barrel muzzle & recoil spring guide at front face
  S.add('steel', frontZ(shape(circlePts(0, 0, 0.0072, 20), [circlePts(0, 0, 0.0046, 16)]), 0.003, 0.0006, 1), { p: [0, 0, Z(0.1905)] });
  S.add('dark', cyl(0.0046, 0.002, 16, 'z'), { p: [0, 0, Z(0.1895)] });
  S.add('steel', cyl(0.004, 0.003, 12, 'z'), { p: [0, -0.0145, Z(0.188)] });
  const slideG = S.build(mats); slide.add(slideG);
  // tritium dots
  const dot = (x, y, s, m) => { const d = new THREE.Mesh(new THREE.CircleGeometry(0.0011, 12), m); d.position.set(x, y, Z(s) + 0.00005); d.rotation.y = 0; slide.add(d); };
  dot(-0.0055, 0.0185, -0.0005, mats.tritium); dot(0.0055, 0.0185, -0.0005, mats.tritium);
  const fd = new THREE.Mesh(new THREE.CircleGeometry(0.0012, 12), mats.tritiumOrange); fd.position.set(0, 0.0185, Z(0.1715)); slide.add(fd);

  // magazine (for reload anim) — separate so it can drop out
  const M = new PartBuilder(48);
  M.add('poly', sideX(shape([[0.02, 0.0, 0.002], [-0.012, 0.0, 0.002], [-0.013, -0.101, 0.002], [0.03, -0.101, 0.002]]), 0.022, 0.0015, 1), {});
  M.add('poly', sideX(shape([[0.033, -0.099, 0.002], [-0.013, -0.103, 0.002], [-0.015, -0.111, 0.004], [0.033, -0.108, 0.004]]), 0.0245, 0.002, 2), { tint: [0.8, 0.8, 0.8] });
  M.add('brass', latheZ([[0, 0], [0.0049, 0], [0.0049, 0.015], [0.0046, 0.019], [0, 0.019]], 14), { p: [0, 0.004, Z(0.0)] });
  M.add('copper', latheZ([[0.0045, 0.019], [0.0045, 0.022], [0.0025, 0.028], [0, 0.029], [0, 0.029]], 14), { p: [0, 0.004, 0] });
  const mag = new THREE.Group(); mag.add(M.build(mats)); mag.position.set(0, -0.03, Z(0.02)); mag.rotation.x = 20 * DEG * 0; group.add(mag);
  mag.visible = true; mag.updateMatrix();
  const magRest = mag.matrix.clone();

  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, Z(0.195)); group.add(muzzle);
  const ejectPort = new THREE.Object3D(); ejectPort.position.set(0.012, 0.012, Z(0.125)); group.add(ejectPort);
  group.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.receiveShadow = true; o.castShadow = forWorld; } });
  let tris = 0; group.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  return { group, slide, mag, magRest, muzzle, ejectPort, tris, sight: new THREE.Vector3(0, 0.0205, Z(0.0)) };
}
