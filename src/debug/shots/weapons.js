import * as THREE from 'three';
/** Weapon / viewmodel review poses. Camera starts at the level's player spawn. */
function atSpawn(game, pitch = -0.02, yawOff = 0) {
  const sp = game.level.playerSpawn; const p = game.player;
  const eye = sp.position.clone(); eye.y += p.eyeHeight;
  p.position.copy(sp.position); p.velocity.set(0, 0, 0); p.yaw = sp.yaw + yawOff; p.pitch = pitch;
  game.camera.position.copy(eye);
  game.camera.rotation.set(pitch, sp.yaw + yawOff, 0, 'YXZ');
}
const vm = (opts, pitch, yawOff) => ({
  noCamera: true,
  setup(game, frame) { atSpawn(game, pitch, yawOff); game.weapons.debugPose(opts, frame); },
});
export default {
  weapon_hip: vm({ weapon: 'rifle', fired: true }),
  weapon_ads: vm({ weapon: 'rifle', ads: 1, fired: true }),
  weapon_reload: vm({ weapon: 'rifle', reload: 0.5 }),
  weapon_reload2: vm({ weapon: 'rifle', reload: 1.3 }),
  weapon_reload_ch: vm({ weapon: 'rifle', reload: 2.03, empty: true }),
  weapon_sprint: vm({ weapon: 'rifle', sprint: 1, bob: 1, bobPhase: 1.2 }),
  weapon_inspect: vm({ weapon: 'rifle', inspect: 1.2, fired: true }),
  weapon_pistol: vm({ weapon: 'pistol' }),
  weapon_pistol_ads: vm({ weapon: 'pistol', ads: 1 }),
  weapon_pistol_reload: vm({ weapon: 'pistol', reload: 0.95, empty: true }),
  weapon_closeup: {
    noCamera: true,
    setup(game, frame) {
      const sp = game.level.playerSpawn;
      const yaw = sp.yaw;
      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      if (!game.__wcu) {
        const base = sp.position.clone().addScaledVector(fwd, 1.6);
        const hit = game.collision.raycast(base.clone().add(new THREE.Vector3(0, 3, 0)), new THREE.Vector3(0, -1, 0), 10, { dynamic: false });
        const gy = hit ? hit.point.y : sp.position.y;
        // weathered crate as a display surface
        const crate = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.62, 0.62), game.materials.get('wood_planks') || game.materials.get('wood'));
        crate.position.set(base.x, gy + 0.31, base.z); crate.rotation.y = yaw; crate.castShadow = crate.receiveShadow = true;
        game.scene.add(crate);
        const sc = game.weapons.showcase(new THREE.Vector3(base.x, gy + 0.62 + 0.024, base.z), yaw - Math.PI / 2);
        // lay the rifle on its right side so the left flank + optic face the camera
        sc.group.rotation.set(0, yaw - Math.PI / 2 + 0.12, 0);
        sc.group.children[0].rotation.set(0, 0, Math.PI / 2 * 0);
        game.__wcu = { base, gy, right, fwd };
        game.weapons.viewmodel.visible = false;
      }
      const { base, gy } = game.__wcu;
      const eye = base.clone().addScaledVector(fwd, 0.55).addScaledVector(right, -0.1); eye.y = gy + 0.95;
      const target = base.clone(); target.y = gy + 0.66;
      game.camera.position.copy(eye); game.camera.lookAt(target);
      game.camera.fov = 45; game.camera.updateProjectionMatrix();
      game.weapons.viewmodel.visible = false;
    },
  },
};
