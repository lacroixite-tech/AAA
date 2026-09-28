import * as THREE from 'three';

/** Screenshot poses for enemy soldiers (owner: ai agent). */
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function base(game) {
  const sp = game.level?.playerSpawn;
  const p = sp?.position ? sp.position.clone() : V(0, 0, 20);
  const yaw = sp?.yaw ?? 0;
  const fwd = V(-Math.sin(yaw), 0, -Math.cos(yaw)), right = V(Math.cos(yaw), 0, -Math.sin(yaw));
  return { p, yaw, fwd, right };
}
function ground(game, x, z, y0 = 0) {
  const h = game.collision?.raycast?.(V(x, y0 + 3, z), V(0, -1, 0), 8, { dynamic: false });
  return h ? h.point.y : y0;
}
function setCam(game, pos, look) {
  const c = game.camera; c.position.copy(pos); c.lookAt(look); c.updateMatrixWorld(true);
  const p = game.player; if (p?.position) { p.position.set(pos.x, pos.y - (p.eyeHeight ?? 1.65), pos.z); p.velocity?.set(0, 0, 0); }
  if (game.weapons?.viewmodel) game.weapons.viewmodel.visible = false;
}
function place(game, B, fwdDist, sideDist) {
  const q = B.p.clone().addScaledVector(B.fwd, fwdDist).addScaledVector(B.right, sideDist);
  q.y = ground(game, q.x, q.z, B.p.y); return q;
}
function spawnOnce(game, key, fn) {
  if (!game.__aiShot) game.__aiShot = {};
  if (!game.__aiShot[key]) game.__aiShot[key] = fn();
  return game.__aiShot[key];
}
function hideCrowd(game, keep) { for (const s of game.enemies?.soldiers || []) if (!keep.includes(s)) s.root.visible = false; }

export default {
  ai_lineup: {
    noCamera: true,
    setup(game, frame) {
      const B = base(game);
      const S = spawnOnce(game, 'lineup', () => [0, 1, 2].map((i) => {
        const pos = place(game, B, 3.7, (i - 1) * 1.25);
        const camYaw = Math.atan2(B.p.x - pos.x, B.p.z - pos.z);
        const yaw = camYaw + [0.25, Math.PI / 2 + 0.1, Math.PI + 0.3][i];
        return game.enemies.spawn(pos, { ai: false, yaw, loadout: i });
      }));
      hideCrowd(game, S);
      S.forEach((s, i) => { s.anim.ads = 0; s.anim.crouch = 0; s.anim.aimPitch = -0.05; s.faceTarget = null; s.anim.bladed = i === 1 ? 0.6 : 1; });
      const eye = B.p.clone().addScaledVector(B.fwd, 0.0); eye.y = ground(game, eye.x, eye.z, B.p.y) + 1.45;
      setCam(game, eye, B.p.clone().addScaledVector(B.fwd, 3.7).setY(eye.y - 0.45));
      game.camera.fov = 60; game.camera.updateProjectionMatrix();
      void frame;
    },
  },
  ai_closeup: {
    noCamera: true,
    setup(game) {
      const B = base(game);
      const S = spawnOnce(game, 'close', () => {
        const pos = place(game, B, 1.6, 0.1);
        const camYaw = Math.atan2(B.p.x - pos.x, B.p.z - pos.z);
        return [game.enemies.spawn(pos, { ai: false, yaw: camYaw + 0.55, loadout: 0 })];
      });
      hideCrowd(game, S);
      const s = S[0];
      const target = B.p.clone().addScaledVector(B.right, 3).addScaledVector(B.fwd, 0.5); target.y = s.position.y + 1.5;
      s.faceTarget = target; s.anim.ads = 1;
      const head = s.position.clone(); head.y += 1.6;
      const eye = B.p.clone().addScaledVector(B.fwd, 0.55).addScaledVector(B.right, 0.25); eye.y = head.y + 0.02;
      setCam(game, eye, head.clone().add(V(0, -0.1, 0)));
      game.camera.fov = 45; game.camera.updateProjectionMatrix();
    },
  },
  ai_combat: {
    noCamera: true,
    setup(game) {
      const B = base(game);
      const S = spawnOnce(game, 'combat', () => {
        const out = [];
        const nav = game.enemies.nav;
        const cam = B.p.clone(); cam.y += 1.6;
        const covers = (nav?.cover || []).filter((c) => {
          const d = c.p.distanceTo(B.p); if (d < 7 || d > 22) return false;
          const to = V().subVectors(B.p, c.p).setY(0).normalize();
          return -to.dot(c.n) > 0.5 && nav.los(V(c.p.x, c.p.y + 1.55, c.p.z), cam);
        }).sort((a, b) => a.p.distanceTo(B.p) - b.p.distanceTo(B.p));
        const picks = [];
        for (const c of covers) { if (picks.every((p) => p.p.distanceTo(c.p) > 2.5)) picks.push(c); if (picks.length >= 3) break; }
        const fall = [[9, -2.5], [12, 2.2], [15, -0.2]];
        for (let i = 0; i < 3; i++) {
          const c = picks[i];
          const pos = c ? c.p.clone() : place(game, B, fall[i][0], fall[i][1]);
          const yaw = Math.atan2(B.p.x - pos.x, B.p.z - pos.z);
          const s = game.enemies.spawn(pos, { ai: false, yaw, loadout: i });
          s.shotCrouch = c ? c.low : i === 0;
          out.push(s);
        }
        return out;
      });
      hideCrowd(game, S);
      const cam = B.p.clone(); cam.y = ground(game, cam.x, cam.z, B.p.y) + 1.6;
      S.forEach((s, i) => { s.faceTarget = cam.clone().add(V((i - 1) * 0.3, -0.2, 0)); s.anim.ads = 1; s.anim.crouch = s.shotCrouch ? 1 : 0; });
      setCam(game, cam, B.p.clone().addScaledVector(B.fwd, 10).setY(cam.y - 0.5));
      game.camera.fov = 55; game.camera.updateProjectionMatrix();
    },
  },
  ai_death: {
    noCamera: true,
    setup(game, frame) {
      const B = base(game);
      const S = spawnOnce(game, 'death', () => [0, 1].map((i) => {
        const pos = place(game, B, 4.2 + i * 1.2, i ? 1.1 : -0.7);
        const yaw = Math.atan2(B.p.x - pos.x, B.p.z - pos.z) + (i ? -0.4 : 0.2);
        return game.enemies.spawn(pos, { ai: false, yaw, loadout: i + 1 });
      }));
      hideCrowd(game, S);
      const cam = B.p.clone(); cam.y = ground(game, cam.x, cam.z, B.p.y) + 1.55;
      S.forEach((s) => { if (s.alive) { s.faceTarget = cam; s.anim.ads = 1; } });
      if (frame === 66 && S[0].alive) { const d = V().subVectors(S[0].position, cam).setY(0).normalize(); S[0].takeHit({ part: 'body', damage: 200, dir: d, point: S[0].position.clone().add(V(0, 1.3, 0)) }); }
      if (frame === 58 && S[1].alive) { const d = V().subVectors(S[1].position, cam).setY(0).normalize(); S[1].takeHit({ part: 'head', damage: 200, dir: d, point: S[1].position.clone().add(V(0, 1.7, 0)) }); }
      setCam(game, cam, B.p.clone().addScaledVector(B.fwd, 5).setY(cam.y - 0.8));
      game.camera.fov = 60; game.camera.updateProjectionMatrix();
    },
  },
};
