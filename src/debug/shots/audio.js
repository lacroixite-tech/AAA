import * as THREE from 'three';
/**
 * Audio smoke test: /?shot=audio_events exercises every event path of AudioSystem
 * (fires, impacts, flybys, reloads, footsteps, damage, explosion) and logs voice counts.
 */
const ev = (g, name, data) => g.events.emit(name, data);
export default {
  audio_events: {
    pos: [0, 1.65, 20], yaw: 0, pitch: -0.05,
    setup(g, f) {
      const a = g.audio; if (!a?.enabled) return;
      if (f === 1) a.init()?.resume().catch(() => {});
      const cam = g.camera.position;
      const fwd = new THREE.Vector3(0, 0, -1);
      if (f % 6 === 0) ev(g, 'weapon:fire', { origin: cam.clone(), dir: fwd, weapon: f % 36 === 0 ? { name: 'X16 pistol' } : { name: 'M4A1' } });
      if (f % 6 === 1) ev(g, 'hit', { point: new THREE.Vector3(0, 1, 0), normal: new THREE.Vector3(0, 0, 1), surface: ['concrete', 'metal_rusty', 'wood', 'dirt', 'glass', 'brick'][(f / 6 | 0) % 6], dir: fwd, damage: 30 });
      if (f % 10 === 2) ev(g, 'enemy:fire', { origin: new THREE.Vector3(3, 1.5, -40), dir: new THREE.Vector3(-3, 0.1, 60).normalize() });
      if (f === 20) ev(g, 'enemy:hit', { part: 'head' });
      if (f === 22) ev(g, 'enemy:killed', { headshot: true });
      if (f === 25) ev(g, 'weapon:reload', { weapon: { name: 'M4A1', ammo: 0, reloadTime: 2.2 } });
      if (f === 30) ev(g, 'weapon:empty');
      if (f % 15 === 3) ev(g, 'player:footstep', { surface: ['concrete', 'gravel', 'metal', 'wood', 'dirt', 'glass'][(f / 15 | 0) % 6], intensity: 0.8 });
      if (f === 40) ev(g, 'player:jump');
      if (f === 55) ev(g, 'player:land', { speed: 7 });
      if (f === 60) ev(g, 'player:damaged', { amount: 30, fromPos: new THREE.Vector3(5, 1.5, 0) });
      if (f === 62) ev(g, 'fx:shell_land', { position: new THREE.Vector3(0.5, 0, 19) });
      if (f === 65) ev(g, 'fx:explosion', { position: new THREE.Vector3(4, 0, 14), radius: 6 });
      if (f === 70) g.player.health = 25;
      if (f === 89) console.warn(`[audio] state=${a.ctx?.state} buffers=${a.buffers.size}/${a.names.length} voices=${a.voices} indoor=${a.indoor.toFixed(2)}`);
    },
  },
};
