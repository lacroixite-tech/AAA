/** HUD overlay (DOM/CSS). Owner: ui agent. */
export class HUD {
  constructor(game) {
    this.game = game;
    const root = document.getElementById('ui-root');
    root.innerHTML = `<div style="position:fixed;left:50%;top:50%;width:4px;height:4px;margin:-2px;background:#fff;border-radius:50%"></div><div id="hud-ammo" style="position:fixed;right:40px;bottom:30px;color:#fff;font:600 28px system-ui"></div>`;
    this.ammoEl = document.getElementById('hud-ammo');
  }
  update() { const w = this.game.weapons; this.ammoEl.textContent = `${w.ammo} / ${w.reserve}`; }
}
