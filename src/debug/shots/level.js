// Level review poses (eye-level cinematic + aerial overview). yaw 0 = looking north (-Z).
// Viewmodel + HUD are hidden so the environment can be judged on its own.
function clean(game) {
  if (game.weapons?.viewmodel) game.weapons.viewmodel.visible = false;
  const ui = document.getElementById('ui-root'); if (ui) ui.style.display = 'none';
}
const S = (pos, yaw, pitch) => ({ pos, yaw, pitch, setup: clean });
export default {
  level_street: S([-2.5, 1.7, -40], Math.PI - 0.06, 0.03),
  level_street_n: S([1.8, 1.7, 44], 0.04, 0.03),
  level_plaza: S([12, 1.85, -19], -1.02, 0.03),
  level_alley: S([-24.2, 1.7, -13], 0.02, 0.04),
  level_warehouse: S([-24.5, 1.7, 43], 0.55, 0.06),
  level_aerial: S([62, 68, 78], 0.66, -0.62),
  level_ruin: S([-3, 1.7, 26], -0.62, 0.08),
};
