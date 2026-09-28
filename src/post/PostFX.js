import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
/** Post-processing chain. Owner: lighting/post agent. */
export class PostFX {
  constructor(game) {
    this.game = game;
    game.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const c = new EffectComposer(game.renderer);
    c.addPass(new RenderPass(game.scene, game.camera));
    c.addPass(new OutputPass());
    this.composer = c;
  }
  setSize(w, h) { this.composer.setSize(w, h); }
  render(dt) { this.composer.render(dt); }
}
