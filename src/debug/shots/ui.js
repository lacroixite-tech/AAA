import * as THREE from 'three';
// Screenshot poses for player + HUD. All poses derive from level.playerSpawn so they stay valid
// while the level evolves.

function spawnPose(game, { yawOff = 0, pitch = -0.02, state = 'stand', fwd = 0 } = {}) {
  const sp = game.level.playerSpawn;
  const yaw = sp.yaw + yawOff;
  const f = [sp.position.x - Math.sin(yaw) * fwd, sp.position.y, sp.position.z - Math.cos(yaw) * fwd];
  game.player.poseForShot({ feet: f, yaw, pitch, state });
}

export default {
  ui_hud: {
    noCamera: true,
    setup(game, frame) {
      const hud = game.hud, p = game.player;
      hud.forceVisible = true;
      spawnPose(game, { yawOff: 0.12, pitch: -0.03 });
      if (frame === 1) hud.setObjective('Clear the Kovalenko intersection');
      if (frame === 50) {
        game.events.emit('enemy:killed', { enemy: null, headshot: false });
        game.events.emit('enemy:killed', { enemy: null, headshot: true });
      }
      if (frame >= 60) {
        // white hitmarker, damage indicator from front-left, firing enemy pings
        hud._hm.t = 0.05; hud._hm.kill = false; hud.el.hm.classList.remove('kill', 'pop');
        if (!hud._shotDmg) {
          const sp = p.position;
          hud.addDamageIndicator(new THREE.Vector3(sp.x - 20, sp.y, sp.z - 6).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0));
          hud._shotDmg = true;
        }
        for (const d of hud._dmg) d.t = 0.2;
        p.health = 62; p.lastDamageTime = game.time; hud._hitFlash = 0;
        const yaw = p.yaw;
        const pts = [[-0.35, 26], [0.2, 34], [0.9, 18]];
        pts.forEach(([a, r], i) => {
          const pos = new THREE.Vector3(p.position.x - Math.sin(yaw + a) * r, 1.5, p.position.z - Math.cos(yaw + a) * r);
          game.events.emit('enemy:fire', { origin: pos, dir: new THREE.Vector3(), enemy: { id: 'shot' + i } });
        });
        hud._bloom = 0.35;
      }
    },
  },
  ui_menu: {
    noCamera: true,
    setup(game) {
      game.hud.forceMenu = true;
      spawnPose(game, { yawOff: 0.35, pitch: 0.02 });
    },
  },
  ui_death: {
    noCamera: true,
    setup(game, frame) {
      const p = game.player;
      game.hud.forceVisible = true;
      if (frame === 2) { p.spawnTime = -99; p.damage(250, p.position.clone().add(new THREE.Vector3(5, 0, -5))); }
      if (p.dead) { p._deathT = 1.2; p.respawnIn = 3.3; p.applyCamera(); }
    },
  },
  player_slide: {
    noCamera: true,
    setup(game) {
      game.hud.forceVisible = true;
      spawnPose(game, { yawOff: -0.25, pitch: -0.04, state: 'slide' });
    },
  },
};
