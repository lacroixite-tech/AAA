/**
 * Deterministic camera poses for screenshot review: open /?shot=<name>.
 * Each agent owns its own file in ./shots/<area>.js exporting `default { name: shot }`.
 * shot: { pos:[x,y,z] (eye), yaw, pitch, setup?(game, frame) } — setup runs every frame
 * AFTER systems update and BEFORE render, so it can pose weapons/enemies/fx deterministically.
 * Set `noCamera: true` to let setup() drive the camera itself.
 */
const mods = import.meta.glob('./shots/*.js', { eager: true });
export const SHOTS = {};
for (const m of Object.values(mods)) Object.assign(SHOTS, m.default);

export function applyShot(game, name, frame) {
  const s = SHOTS[name]; if (!s) return;
  if (!s.noCamera) {
    const p = game.player;
    p.position.set(s.pos[0], s.pos[1] - p.eyeHeight, s.pos[2]); p.velocity.set(0, 0, 0);
    p.yaw = s.yaw; p.pitch = s.pitch;
    game.camera.position.set(...s.pos);
    game.camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ');
  }
  s.setup?.(game, frame);
  game.camera.updateMatrixWorld(true);
}
