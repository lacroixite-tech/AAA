import * as THREE from 'three';

/**
 * FX screenshot poses. A small "test bay" (concrete wall + painted steel panel) is built in front of the
 * player spawn so impacts/decals are reproducible regardless of level layout. Effects are triggered at
 * fixed frames and the FX simulation is frozen (game.fx.frozen) so the capture lands mid-effect.
 */
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function bay(game) {
  if (game._fxBay) return game._fxBay;
  const sp = game.level.playerSpawn;
  // orient the bay so the wall is raked by the low sun (~40 deg off its normal)
  let yaw = sp.yaw || 0;
  const sd = game.environment?.sunDirection;
  if (sd) {
    const a = Math.atan2(sd.x, sd.z) + 0.7; // wall normal azimuth
    const n = V(Math.sin(a), 0, Math.cos(a));
    yaw = Math.atan2(n.x, n.z); // fwd = -n  => (-sin yaw, 0, -cos yaw) = -n
  }
  const fwd = V(-Math.sin(yaw), 0, -Math.cos(yaw)); const right = V(Math.cos(yaw), 0, -Math.sin(yaw));
  const base = sp.position.clone();
  let ground = base.y;
  const h = game.collision.raycast(base.clone().add(V(0, 3, 0)), V(0, -1, 0), 10, { dynamic: false });
  if (h) ground = h.point.y;
  base.y = ground;
  const M = game.materials;
  const mat = (n, fb) => { try { return M.get(n) || M.get(fb); } catch { return M.get(fb); } };
  const wallPos = base.clone().addScaledVector(fwd, 4.2).add(V(0, 1.7, 0));
  const wall = new THREE.Mesh(new THREE.BoxGeometry(7, 3.4, 0.4), mat('concrete', 'concrete'));
  wall.position.copy(wallPos); wall.rotation.y = yaw; wall.castShadow = wall.receiveShadow = true;
  wall.userData.collider = true; wall.userData.surface = 'concrete';
  const panel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.3, 0.06), mat('metal_painted', 'metal'));
  panel.position.copy(base).addScaledVector(fwd, 3.95).addScaledVector(right, 2.1).add(V(0, 1.2, 0)); panel.rotation.y = yaw;
  panel.castShadow = panel.receiveShadow = true; panel.userData.collider = true; panel.userData.surface = 'metal';
  game.scene.add(wall, panel);
  game.collision.build();
  const face = base.clone().addScaledVector(fwd, 4.0); // concrete wall front face (ground level)
  const pface = base.clone().addScaledVector(fwd, 3.92).addScaledVector(right, 2.1);
  game._fxBay = { base, fwd, right, yaw, ground, face, pface, n: fwd.clone().negate() };
  return game._fxBay;
}

function setCam(game, pos, target) {
  const cam = game.camera; cam.position.copy(pos);
  const d = target.clone().sub(pos).normalize();
  const yaw = Math.atan2(-d.x, -d.z), pitch = Math.asin(d.y);
  cam.rotation.set(pitch, yaw, 0, 'YXZ');
  const p = game.player; if (p) { p.position.set(pos.x, pos.y - (p.eyeHeight || 1.65), pos.z); p.yaw = yaw; p.pitch = pitch; p.velocity?.set(0, 0, 0); }
  cam.updateMatrixWorld(true);
}

function shootAt(game, from, pt) {
  const dir = pt.clone().sub(from).normalize();
  const h = game.collision.raycast(from, dir, 50, { dynamic: false });
  if (h) game.fx.spawnImpact(h.point, h.normal, h.surface, dir);
}

export default {
  fx_muzzle: {
    noCamera: true,
    setup(game, f) {
      const b = bay(game);
      const eye = b.base.clone().add(V(0, 1.62, 0)).addScaledVector(b.fwd, -0.6);
      setCam(game, eye, eye.clone().addScaledVector(b.fwd, 4).add(V(0, -0.3, 0)));
      if (f >= 56 && f <= 84 && (f - 56) % 7 === 0) {
        const cam = game.camera; const origin = cam.getWorldPosition(V()); const dir = cam.getWorldDirection(V());
        game.events.emit('weapon:fire', { origin, dir, weapon: { ...(game.weapons?.current || {}), tracerEvery: 1 } });
        shootAt(game, origin, origin.clone().addScaledVector(dir, 10).add(V((f % 3 - 1) * 0.15, (f % 2) * 0.1, 0)));
      }
      if (f === 84) game.fx.frozen = true;
    },
  },
  fx_impacts_concrete: {
    noCamera: true,
    setup(game, f) {
      const b = bay(game);
      const eye = b.face.clone().addScaledVector(b.n, 1.6).addScaledVector(b.right, -1.1).add(V(0, 1.55, 0));
      const look = b.face.clone().addScaledVector(b.right, 0.05).add(V(0, 1.2, 0));
      setCam(game, eye, look);
      const gun = eye.clone().addScaledVector(b.right, 0.4).add(V(0, -0.2, 0));
      const pts = { 50: [-0.75, 1.55], 64: [0.1, 0.95], 74: [-0.45, 1.2], 80: [0.35, 1.5], 84: [-0.15, 1.35] };
      if (pts[f]) shootAt(game, gun, b.face.clone().addScaledVector(b.right, pts[f][0]).add(V(0, pts[f][1], 0)));
      if (f === 85) game.fx.frozen = true;
    },
  },
  fx_impacts_metal: {
    noCamera: true,
    setup(game, f) {
      const b = bay(game);
      const eye = b.pface.clone().addScaledVector(b.n, 1.6).addScaledVector(b.right, -1.0).add(V(0, 1.5, 0));
      const look = b.pface.clone().addScaledVector(b.right, 0.1).add(V(0, 1.15, 0));
      setCam(game, eye, look);
      const gun = eye.clone().addScaledVector(b.right, 0.35).add(V(0, -0.2, 0));
      const pts = { 66: [-0.5, 1.6], 76: [0.3, 1.1], 81: [-0.2, 1.35], 84: [0.1, 1.0] };
      if (pts[f]) shootAt(game, gun, b.pface.clone().addScaledVector(b.right, pts[f][0]).add(V(0, pts[f][1], 0)));
      if (f === 86) game.fx.frozen = true;
    },
  },
  fx_decals: {
    noCamera: true,
    setup(game, f) {
      const b = bay(game);
      const eye = b.face.clone().addScaledVector(b.n, 2.6).addScaledVector(b.right, 0.3).add(V(0, 1.5, 0));
      setCam(game, eye, b.face.clone().addScaledVector(b.right, 0.5).add(V(0, 1.2, 0)));
      const gun = eye.clone().add(V(0.1, -0.2, 0));
      if (f >= 2 && f < 44) {
        const r = game.fx.rand;
        for (let i = 0; i < 2; i++) {
          // recoil-climb spray pattern clusters
          const cx = (f % 3 === 0 ? -1.0 : f % 3 === 1 ? 0.3 : 1.8) + (r() - 0.5) * 0.9;
          const cy = 1.1 + (r() - 0.3) * 1.1;
          shootAt(game, gun, b.face.clone().addScaledVector(b.right, cx).add(V(0, cy, 0)));
        }
      }
      if (f === 88) game.fx.frozen = true;
    },
  },
  fx_explosion: {
    noCamera: true,
    setup(game, f) {
      const b = bay(game);
      const center = b.base.clone().addScaledVector(b.fwd, 2.4).addScaledVector(b.right, -1.5);
      const eye = b.base.clone().addScaledVector(b.fwd, -7).addScaledVector(b.right, -3).add(V(0, 1.65, 0));
      setCam(game, eye, center.clone().addScaledVector(b.right, 2.6).add(V(0, 1.7, 0)));
      if (f === 66) game.fx.explosion(center);
      if (f === 66 + 13) game.fx.frozen = true;
    },
  },
  fx_explosion_late: {
    noCamera: true,
    setup(game, f) {
      const b = bay(game);
      const center = b.base.clone().addScaledVector(b.fwd, 2.4).addScaledVector(b.right, -1.5);
      const eye = b.base.clone().addScaledVector(b.fwd, -7).addScaledVector(b.right, -3).add(V(0, 1.65, 0));
      setCam(game, eye, center.clone().addScaledVector(b.right, 2.6).add(V(0, 2.0, 0)));
      if (f === 10) game.fx.explosion(center);
      if (f === 88) game.fx.frozen = true;
    },
  },
  fx_shells: {
    noCamera: true,
    setup(game, f) {
      const b = bay(game);
      const eye = b.base.clone().add(V(0, 1.62, 0));
      const tgt = eye.clone().addScaledVector(b.fwd, 2.2).addScaledVector(b.right, 0.9).add(V(0, -1.1, 0));
      setCam(game, eye, tgt);
      if (f >= 20 && f <= 83 && (f - 20) % 7 === 0) {
        const cam = game.camera; const origin = cam.getWorldPosition(V()); const dir = cam.getWorldDirection(V());
        const aim = eye.clone().addScaledVector(b.fwd, 4).add(V(0, -0.3, 0)).sub(origin).normalize();
        game.events.emit('weapon:fire', { origin, dir: aim, weapon: game.weapons?.current });
        void dir;
      }
      if (f === 85) game.fx.frozen = true;
    },
  },
};
