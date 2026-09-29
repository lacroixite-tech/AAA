import * as THREE from 'three';

// Material review board: one panel + sphere per material at x=500 (away from the level), lit by
// the level sun at a grazing angle. Close-up shots frame single panels at arm's length.
const ORIGIN = new THREE.Vector3(500, 0, 0);
const COLS = 8, P = 1.5, GAP = 0.3;

function meterUVs(geo) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (nx >= ny && nx >= nz) uv.setXY(i, z * Math.sign(nrm.getX(i)) * -1, y);
    else if (ny >= nz) uv.setXY(i, x, z);
    else uv.setXY(i, x * Math.sign(nrm.getZ(i)), y);
  }
  uv.needsUpdate = true;
  return geo;
}

function label(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 48;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(0, 0, 256, 48);
  g.fillStyle = '#fff'; g.font = 'bold 26px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 25);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.15), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
  return m;
}

function sunDir(game) {
  const env = game.environment;
  if (env?.sunDirection) return env.sunDirection.clone().normalize();
  if (env?.sun) return env.sun.position.clone().sub(env.sun.target?.position || new THREE.Vector3()).normalize();
  return new THREE.Vector3(0.6, 0.27, 0.4).normalize();
}

function build(game, subset) {
  if (game.__matBoard) return game.__matBoard;
  const t0 = performance.now();
  const M = game.materials;
  const only = game.params?.get?.('mats');
  const names = only ? only.split(',') : (subset || M.names);
  const s = sunDir(game);
  const sunAz = Math.atan2(s.x, s.z);
  const faceAz = sunAz + THREE.MathUtils.degToRad(68); // wall normal azimuth: sun rakes across at grazing angle
  const root = new THREE.Group();
  root.position.copy(ORIGIN); root.rotation.y = faceAz; // local +Z = wall normal
  game.scene.add(root);
  root.updateMatrixWorld(true);

  const ground = new THREE.Mesh(meterUVs(new THREE.BoxGeometry(40, 0.2, 30)), M.get('asphalt'));
  ground.position.set(0, -0.1, 8); ground.receiveShadow = true; root.add(ground);
  const back = new THREE.Mesh(meterUVs(new THREE.BoxGeometry(16, 6.5, 0.3)), M.get('concrete_dark'));
  back.position.set(0, 3.25, -0.4); back.receiveShadow = true; root.add(back);

  const rows = Math.ceil(names.length / COLS);
  const cols = Math.min(COLS, names.length);
  const width = cols * (P + GAP) - GAP;
  const panels = {};
  names.forEach((n, i) => {
    const c = i % COLS, r = Math.floor(i / COLS);
    const x = -width / 2 + P / 2 + c * (P + GAP);
    const y = 0.35 + P / 2 + (rows - 1 - r) * (P + GAP + 0.1);
    const mat = M.get(n);
    const box = new THREE.Mesh(meterUVs(new THREE.BoxGeometry(P, P, 0.12)), mat);
    box.position.set(x, y, 0); box.castShadow = box.receiveShadow = true; root.add(box);
    const sph = new THREE.Mesh(new THREE.SphereGeometry(0.28, 64, 32), mat);
    const uv = sph.geometry.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * Math.PI * 2 * 0.28, uv.getY(k) * Math.PI * 0.28);
    sph.position.set(x + P / 2 - 0.3, y - P / 2 + 0.3, 0.4); sph.castShadow = sph.receiveShadow = true; root.add(sph);
    const lb = label(n); lb.position.set(x - P / 2 + 0.42, y - P / 2 - 0.1, 0.07); root.add(lb);
    panels[n] = new THREE.Vector3(x, y, 0.06);
  });
  root.updateMatrixWorld(true);
  const board = { root, panels, faceAz, width, rows, ms: performance.now() - t0 };
  console.info(`[materials] board built in ${board.ms.toFixed(0)} ms (bake ${M.baker.totalMs.toFixed(0)} ms)`);
  game.__matBoard = board;
  return board;
}

function aim(game, board, localPos, dist, yawOff = 0, pitch = 0) {
  if (game.weapons?.viewmodel) game.weapons.viewmodel.visible = false;
  const target = localPos.clone().applyMatrix4(board.root.matrixWorld);
  const yaw = board.faceAz + yawOff;
  const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const cam = target.clone().addScaledVector(dir, dist);
  cam.y += Math.sin(-pitch) * dist;
  game.camera.position.copy(cam);
  game.camera.lookAt(target);
  if (game.player) { game.player.position.set(cam.x, cam.y - (game.player.eyeHeight || 1.6), cam.z); game.player.velocity?.set(0, 0, 0); }
}

function close(name, dist = 1.0, yawOff = 0.25, pitch = 0.0) {
  return {
    noCamera: true,
    setup(game) { const b = build(game, [name]); aim(game, b, b.panels[name], dist, yawOff, pitch); },
  };
}

const SHOTS = {
  mat_group: {
    noCamera: true,
    setup(game) {
      const b = build(game); const ps = Object.values(b.panels);
      const c = ps.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / ps.length);
      aim(game, b, c, 1.2 + ps.length * 0.55, 0.0, 0.02);
    },
  },
};
export default {
  ...SHOTS,
  materials_board: {
    noCamera: true,
    setup(game) { const b = build(game); aim(game, b, new THREE.Vector3(0, 3.0, 0), 9.5, 0.0, 0.05); },
  },
  mat_brick: close('brick'),
  mat_concrete: close('concrete'),
  mat_metal_rusty: close('metal_rusty'),
  mat_wood: close('wood_planks'),
  mat_plaster: close('plaster'),
  mat_asphalt: close('asphalt'),
  mat_painted: close('metal_painted'),
  mat_sandbag: close('sandbag', 0.8),
  mat_roof: close('roof_tiles'),
  mat_ground: {
    noCamera: true,
    setup(game) { const b = build(game); aim(game, b, new THREE.Vector3(-2, 0, 4.5), 2.2, 0.4, 0.75); },
  },
};
