import * as THREE from 'three';

/** Screenshot poses for enemy soldiers (owner: ai agent). */
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Pick a camera spot/direction near the player spawn with open space ahead and flattering sun (front-left). */
function base(game, dist = 4, key = 'b') {
  game.__aiBase = game.__aiBase || {};
  if (game.__aiBase[key]) return game.__aiBase[key];
  const sp = game.level?.playerSpawn;
  const p0 = sp?.position ? sp.position.clone() : V(0, 0, 20);
  const sd = game.environment?.sunDirection ? game.environment.sunDirection.clone().setY(0).normalize() : V(0.3, 0, -1).normalize();
  const col = game.collision;
  const clear = (o, d, len) => { const h = col?.raycast?.(o, d, len, { dynamic: false }); return !h; };
  let best = null;
  for (const off of [[0, 0], [0, -6], [0, -12], [-4, -8], [4, -8], [0, -20], [-5, -16], [5, -16]]) {
    const p = p0.clone().add(V(off[0], 0, off[1]));
    for (let i = 0; i < 24; i++) {
      const yaw = (i / 24) * Math.PI * 2;
      const fwd = V(-Math.sin(yaw), 0, -Math.cos(yaw)), right = V(Math.cos(yaw), 0, -Math.sin(yaw));
      const o1 = p.clone().setY(p.y + 1.5), o2 = p.clone().setY(p.y + 0.5);
      if (!clear(o1, fwd, dist + 2) || !clear(o2, fwd, dist + 2)) continue;
      let ok = true;
      for (const sx of [-1.6, 1.6]) { const q = p.clone().addScaledVector(right, sx).setY(p.y + 1.0); if (!clear(q, fwd, dist + 1.5)) ok = false; }
      if (!ok) continue;
      // want the sun behind-left of the camera (subject lit from front-left, raking)
      const want = fwd.clone().negate().applyAxisAngle(V(0, 1, 0), -0.75);
      let sc = want.dot(sd) * 2 - off[1] * -0.02 - Math.hypot(off[0], off[1]) * 0.03;
      const back = col?.raycast?.(o1, fwd, 60, { dynamic: false });
      if (back && back.distance > dist + 3 && back.distance < 25) sc += 0.6; // nice backdrop
      if (!best || sc > best.sc) best = { sc, p, yaw, fwd, right };
    }
  }
  if (!best) { const yaw = sp?.yaw ?? 0; best = { p: p0, yaw, fwd: V(-Math.sin(yaw), 0, -Math.cos(yaw)), right: V(Math.cos(yaw), 0, -Math.sin(yaw)) }; }
  game.__aiBase[key] = best;
  return best;
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
function snap(S) { for (const s of S) if (s.alive) { s.locomotion?.(0); s.anim.snap(); } }
function hideCrowd(game, keep) { for (const s of game.enemies?.soldiers || []) if (!keep.includes(s)) s.root.visible = false; }

export default {
  ai_lineup: {
    noCamera: true,
    setup(game, frame) {
      const B = base(game, 3.7, 'lineup');
      const S = spawnOnce(game, 'lineup', () => [0, 1, 2].map((i) => {
        const pos = place(game, B, 3.7, (i - 1) * 1.25);
        const camYaw = Math.atan2(B.p.x - pos.x, B.p.z - pos.z);
        const yaw = camYaw + [0.25, Math.PI / 2 + 0.1, Math.PI + 0.3][i];
        return game.enemies.spawn(pos, { ai: false, yaw, loadout: i });
      }));
      hideCrowd(game, S);
      S.forEach((s, i) => { s.anim.ads = 0; s.anim.crouch = 0; s.anim.aimPitch = -0.05; s.faceTarget = null; s.anim.bladed = i === 1 ? 0.6 : 1; });
      const eye = B.p.clone().addScaledVector(B.fwd, 0.0); eye.y = ground(game, eye.x, eye.z, B.p.y) + 1.45;
      snap(S); setCam(game, eye, B.p.clone().addScaledVector(B.fwd, 3.7).setY(eye.y - 0.45));
      game.camera.fov = 60; game.camera.updateProjectionMatrix();
      void frame;
    },
  },
  ai_closeup: {
    noCamera: true,
    setup(game) {
      const B = base(game, 2, 'close');
      const S = spawnOnce(game, 'close', () => {
        const pos = place(game, B, 1.6, 0.1);
        const camYaw = Math.atan2(B.p.x - pos.x, B.p.z - pos.z);
        return [game.enemies.spawn(pos, { ai: false, yaw: camYaw + 0.35, loadout: 0 })];
      });
      hideCrowd(game, S);
      const s = S[0];
      const target = B.p.clone().addScaledVector(B.right, 3).addScaledVector(B.fwd, 0.5); target.y = s.position.y + 1.5;
      s.faceTarget = null; s.anim.ads = 0; s.noLook = true;
      const head = s.position.clone(); head.y += 1.55;
      const eye = B.p.clone().addScaledVector(B.fwd, 0.35).addScaledVector(B.right, -0.2); eye.y = head.y + 0.02;
      snap(S); setCam(game, eye, head.clone().add(V(0, -0.12, 0)));
      game.camera.fov = 38; game.camera.updateProjectionMatrix();
    },
  },
  ai_combat: {
    noCamera: true,
    setup(game) {
      const sp = game.level?.playerSpawn; const yaw0 = sp?.yaw ?? 0;
      const B = { p: (sp?.position || V(0, 0, 20)).clone(), yaw: yaw0, fwd: V(-Math.sin(yaw0), 0, -Math.cos(yaw0)), right: V(Math.cos(yaw0), 0, -Math.sin(yaw0)) };
      const S = spawnOnce(game, 'combat', () => {
        const out = [];
        const spots = [[9.6, -2.4, false], [6.8, 0.9, true], [11.2, 2.9, false]];
        spots.forEach(([f, r, kneel], i) => {
          const pos = place(game, B, f, r);
          const s = game.enemies.spawn(pos, { ai: false, yaw: Math.atan2(B.p.x - pos.x, B.p.z - pos.z), loadout: i });
          s.shotCrouch = kneel; out.push(s);
        });
        return out;
      });
      hideCrowd(game, S);
      // advance the camera so the nearest soldier is ~7 m away (stop short of any obstacle)
      const dmin = Math.min(...S.map((s) => s.position.distanceTo(B.p)));
      let adv = Math.max(0, dmin - 6.5);
      const hb = game.collision?.raycast?.(V(B.p.x, B.p.y + 1.0, B.p.z), B.fwd, adv + 1, { dynamic: false });
      if (hb) adv = Math.max(0, Math.min(adv, hb.distance - 1.2));
      const cam = B.p.clone().addScaledVector(B.fwd, adv); cam.y = ground(game, cam.x, cam.z, B.p.y) + 1.6;
      S.forEach((s, i) => { s.faceTarget = cam.clone().add(V((i - 1) * 0.3, -0.2, 0)); s.anim.ads = 1; s.anim.crouch = s.shotCrouch ? 1 : 0; });
      snap(S); setCam(game, cam, cam.clone().addScaledVector(B.fwd, 10).setY(cam.y - 0.6));
      game.camera.fov = 55; game.camera.updateProjectionMatrix();
    },
  },
  ai_death: {
    noCamera: true,
    setup(game, frame) {
      const B = base(game, 6, 'death');
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
      snap(S); setCam(game, cam, B.p.clone().addScaledVector(B.fwd, 5).setY(cam.y - 0.8));
      game.camera.fov = 60; game.camera.updateProjectionMatrix();
    },
  },
};
