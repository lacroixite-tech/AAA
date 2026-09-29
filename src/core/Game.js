import * as THREE from 'three';
import { Events } from './Events.js';
import { Input } from './Input.js';
import { CollisionWorld } from './CollisionWorld.js';
import { Materials } from '../world/Materials.js';
import { Environment } from '../world/Environment.js';
import { Level } from '../world/Level.js';
import { PlayerController } from '../player/PlayerController.js';
import { WeaponSystem } from '../weapons/WeaponSystem.js';
import { EffectsSystem } from '../fx/EffectsSystem.js';
import { EnemyManager } from '../ai/EnemyManager.js';
import { HUD } from '../ui/HUD.js';
import { AudioSystem } from '../audio/AudioSystem.js';
import { PostFX } from '../post/PostFX.js';
import { applyShot } from '../debug/shots.js';

/**
 * Central game object. Owns renderer/scene/camera and every subsystem.
 * Systems receive `game` in their constructor and expose `update(dt)`.
 * Update order: input -> player -> weapons -> ai -> fx -> environment -> hud -> audio -> render(post).
 */
export class Game {
  constructor(container) {
    this.params = new URLSearchParams(location.search);
    this.shotName = this.params.get('shot'); // deterministic screenshot mode
    this.quality = this.params.get('q') || 'high';
    this.time = 0;

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in PostFX
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.03, 1500);
    this.scene.add(this.camera);

    this.events = new Events();
    this.input = new Input(renderer.domElement);
    if (this.shotName) this.input.disabled = true;
    this.collision = new CollisionWorld(this);

    this.materials = new Materials(this);
    this.environment = new Environment(this);
    this.level = new Level(this);
    this.collision.build();
    this.player = new PlayerController(this);
    this.fx = new EffectsSystem(this);
    this.weapons = new WeaponSystem(this);
    this.enemies = new EnemyManager(this);
    this.hud = new HUD(this);
    this.audio = new AudioSystem(this);
    this.post = new PostFX(this);

    this.systems = [this.player, this.weapons, this.enemies, this.fx, this.environment, this.hud, this.audio];

    addEventListener('resize', () => this.resize());
    this.timer = new THREE.Timer(); this.timer.connect?.(document);
    this.frame = 0;
    this.shotFrames = +(this.params.get('frames') || 90);
    renderer.setAnimationLoop(() => this.tick());
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.post.setSize(innerWidth, innerHeight);
  }

  tick() {
    this.timer.update(); let dt = Math.min(this.timer.getDelta(), 1 / 20);
    if (this.shotName) dt = 1 / 60; // deterministic
    this.time += dt;
    for (const s of this.systems) s.update?.(dt);
    if (this.shotName) applyShot(this, this.shotName, this.frame);
    // In screenshot mode only the last few frames are rendered (CPU WebGL is slow);
    // simulation still runs every frame so timing-driven shots stay deterministic.
    if (!this.shotName || this.frame >= this.shotFrames - 8 || this.params.has('renderAll')) this.post.render(dt);
    this.input.endFrame();
    this.frame++;
    if (this.shotName && this.frame === this.shotFrames) window.__READY = true;
  }
}
