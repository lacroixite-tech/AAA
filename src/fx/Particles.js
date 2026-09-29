import * as THREE from 'three';

/**
 * One pooled, depth-sorted, instanced particle renderer for ALL billboard FX (single draw call).
 * Premultiplied-alpha blending lets additive (alpha 0) and alpha-blended lit particles share one pass.
 * Modes: 0 camera billboard (rotated), 1 axis streak (cylindrical billboard along axis), 2 world-plane quad.
 * Lit particles get fake volumetric lighting from normals baked in the atlas (sun wrap + ambient +
 * forward scattering + dynamic flash light). "Soft" fade uses a per-particle surface plane
 * (analytic soft-particle; no depth pre-pass needed) plus near-camera fade.
 */
const MAX = 4096;

const vert = /* glsl */`
#include <common>
#include <fog_pars_vertex>
attribute vec4 aPos; attribute vec4 aAxis; attribute vec4 aColor;
attribute vec4 aP1; attribute vec4 aP2; attribute vec4 aP3; attribute vec4 aPlane;
uniform float uPixelWorld;
#ifdef VM
uniform mat4 vmProj;
#endif
varying float vViewZ; varying float vSoftD;
varying vec2 vUv; varying vec4 vColor; varying vec4 vP2; varying float vAdd; varying float vTile;
varying vec3 vWorld; varying vec3 vR; varying vec3 vU; varying vec3 vF; varying vec4 vPlane; varying float vSoft; varying float vSun;
void main(){
  vec3 c = aPos.xyz; float w = aPos.w; float L = aAxis.w; int mode = int(aP1.z + 0.5);
  vec3 toCam = normalize(cameraPosition - c);
  float depth = max(0.02, -(viewMatrix * vec4(c, 1.0)).z);
  float minW = aP3.y * depth * uPixelWorld;
  float af = 1.0;
  if (w < minW) { af = w / minW; w = minW; }
  vec3 R; vec3 U; vec3 F = toCam; float sx = w; float sy = L > 0.0 ? L : w;
  if (mode == 0) {
    vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float cs = cos(aP1.y), sn = sin(aP1.y);
    R = camR * cs + camU * sn; U = -camR * sn + camU * cs;
  } else if (mode == 1) {
    R = normalize(aAxis.xyz);
    vec3 s = cross(R, toCam); float sl = length(s);
    U = sl > 1e-4 ? s / sl : normalize(cross(R, vec3(0.0, 1.0, 0.0)));
    sx = max(L, w); sy = w;
    c += R * sx * 0.5 * aP3.z;
    F = normalize(cross(U, R)); if (dot(F, toCam) < 0.0) F = -F;
  } else {
    vec3 n = normalize(aAxis.xyz);
    vec3 t = normalize(cross(abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), n));
    vec3 b = cross(n, t);
    float cs = cos(aP1.y), sn = sin(aP1.y);
    R = t * cs + b * sn; U = -t * sn + b * cs; sy = L > 0.0 ? L : w;
    F = dot(n, toCam) < 0.0 ? -n : n;
  }
  vec3 world = c + R * position.x * sx + U * position.y * sy;
  vWorld = world; vR = R; vU = U; vF = F;
  float tI = floor(aP1.x + 0.5); vUv = (vec2(mod(tI, 4.0), floor(tI / 4.0)) + clamp(uv, 0.004, 0.996)) * 0.25; vColor = aColor; vColor.a *= af; vP2 = aP2; vAdd = aP1.w; vTile = aP1.x;
  vPlane = aPlane; vSoft = aP3.x; vSun = aP3.w;
  // near-camera fade for lit (volumetric) particles so they never clip the lens hard
  if (aP2.x > 0.0) vColor.a *= smoothstep(0.08, 0.08 + max(0.15, w * 0.5), depth);
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
#ifdef VM
  gl_Position = vmProj * mvPosition;
  { float dw = 0.031 + (-mvPosition.z) * 0.25; gl_Position.z = ((projectionMatrix[2][2] * (-dw) + projectionMatrix[3][2]) / dw) * gl_Position.w; }
#else
  gl_Position = projectionMatrix * mvPosition;
#endif
  vViewZ = -mvPosition.z; vSoftD = max(0.03, min(sx, sy) * 0.4);
  #include <fog_vertex>
}`;

const frag = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uAtlas;
uniform sampler2D uDepth; uniform float uHasDepth; uniform vec2 uRes; uniform float uNear; uniform float uFar;
varying float vViewZ; varying float vSoftD;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uAmbient; uniform vec3 uGround;
uniform vec3 uFlashPos; uniform vec3 uFlashColor; uniform vec3 uFlash2Pos; uniform vec3 uFlash2Color;
varying vec2 vUv; varying vec4 vColor; varying vec4 vP2; varying float vAdd; varying float vTile;
varying vec3 vWorld; varying vec3 vR; varying vec3 vU; varying vec3 vF; varying vec4 vPlane; varying float vSoft; varying float vSun;
vec3 fireRamp(float x){
  x = clamp(x, 0.0, 1.35);
  vec3 c0 = vec3(0.0), c1 = vec3(0.35, 0.03, 0.005), c2 = vec3(1.4, 0.32, 0.03), c3 = vec3(3.2, 1.35, 0.3), c4 = vec3(6.0, 4.2, 2.2);
  if (x < 0.25) return mix(c0, c1, x / 0.25);
  if (x < 0.5) return mix(c1, c2, (x - 0.25) / 0.25);
  if (x < 0.8) return mix(c2, c3, (x - 0.5) / 0.3);
  return mix(c3, c4, (x - 0.8) / 0.55);
}
float hg(float mu, float g){ float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * mu, 1.5)); }
void main(){
  vec4 t = texture2D(uAtlas, vUv);
  float a = t.a;
  float erode = vP2.z;
  if (erode > 0.0) { a = clamp((a - erode) / max(1e-3, 1.0 - erode), 0.0, 1.0); a = a * (2.0 - a); }
  float lit = vP2.x, emis = vP2.y, heat = vP2.w;
  vec3 col;
  // unlit / emissive component (hot white core where intensity is high)
  vec3 hot = vColor.rgb * (0.25 + t.b) + vec3(pow(t.b, 3.0)) * dot(vColor.rgb, vec3(0.3, 0.5, 0.2)) * 0.6;
  col = hot * (1.0 - lit);
  if (lit > 0.0) {
    vec2 nxy = t.rg * 2.0 - 1.0;
    vec3 n = normalize(vR * nxy.x + vU * nxy.y + vF * sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
    float ndl = dot(n, uSunDir);
    float wrap = max(0.0, (ndl + 0.5) / 1.5);
    float thick = t.b;
    vec3 V = normalize(vWorld - cameraPosition);
    float mu = dot(V, uSunDir);
    vec3 amb = mix(uGround, uAmbient, n.y * 0.5 + 0.5);
    vec3 L = amb * (0.55 + 0.45 * thick) + uSunColor * vSun * wrap * (0.4 + 0.6 * thick) * RECIPROCAL_PI;
    L += uSunColor * vSun * hg(mu, 0.55) * (1.0 - a * 0.7) * 0.5; // backlit forward scatter (golden-hour glow through smoke)
    vec3 d1 = uFlashPos - vWorld; float q1 = dot(d1, d1);
    L += uFlashColor * (0.35 + 0.65 * max(0.0, dot(n, d1 * inversesqrt(q1 + 1e-4)))) / (q1 + 0.4);
    vec3 d2 = uFlash2Pos - vWorld; float q2 = dot(d2, d2);
    L += uFlash2Color * (0.35 + 0.65 * max(0.0, dot(n, d2 * inversesqrt(q2 + 1e-4)))) / (q2 + 0.5);
    col += vColor.rgb * L * lit;
  }
  if (heat > 0.0) {
    float T = t.b * heat * (0.35 + 0.65 * smoothstep(0.0, 0.6, t.a));
    vec3 fire = fireRamp(T) * emis;
    col = mix(col, vec3(0.0), smoothstep(0.15, 0.55, T)) + fire;
  }
  float alpha = a * vColor.a;
  if (vPlane.x * vPlane.x + vPlane.y * vPlane.y + vPlane.z * vPlane.z > 0.5) {
    float sd = dot(vWorld, vPlane.xyz) + vPlane.w;
    alpha *= smoothstep(0.0, vSoft, sd);
  }
  // depth-buffer soft particles (scene depth blitted just before the particle draw)
  if (uHasDepth > 0.5) {
    float dz = texture2D(uDepth, gl_FragCoord.xy / uRes).x;
    float sceneDist = (uNear * uFar) / (uFar - (uFar - uNear) * dz);
    alpha *= clamp((sceneDist - vViewZ) / vSoftD, 0.0, 1.0);
  }
  #ifdef USE_FOG
  {
    float ff; vec3 fcol = fogColor;
    #ifdef ENV_GLSL_DEFINED
      vec3 fogRay = vFogWorldPos - cameraPosition; float fogDist = length(fogRay); vec3 fogDir = fogRay / max(fogDist, 1e-4);
      #ifdef FOG_EXP2
        ff = envFogAmount(cameraPosition, fogDir, fogDist, fogDensity);
      #else
        ff = smoothstep(fogNear, fogFar, vFogDepth);
      #endif
      fcol = envFogColor(fogDir, fogColor);
    #else
      #ifdef FOG_EXP2
        ff = 1.0 - exp(- fogDensity * fogDensity * vFogDepth * vFogDepth);
      #else
        ff = smoothstep(fogNear, fogFar, vFogDepth);
      #endif
    #endif
    col = mix(col * (1.0 - ff), mix(col, fcol, ff), 1.0 - vAdd);
  }
  #endif
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(col * alpha, alpha * (1.0 - vAdd));
}`;

class Particle {
  constructor() {
    this.alive = false;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.axis = new THREE.Vector3(0, 1, 0);
    this.c0 = new THREE.Color(); this.c1 = new THREE.Color();
    this.plane = new THREE.Vector4(); this.start = new THREE.Vector3();
  }
}

export class Particles {
  constructor(fx, atlas, opts = {}) {
    this.vm = !!opts.vm;
    this.fx = fx; this.game = fx.game;
    this.pool = []; for (let i = 0; i < MAX; i++) this.pool.push(new Particle());
    this.free = [...this.pool].reverse();
    this.live = [];
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.attrs = {};
    for (const n of ['aPos', 'aAxis', 'aColor', 'aP1', 'aP2', 'aP3', 'aPlane']) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4); a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(n, a); this.attrs[n] = a;
    }
    g.instanceCount = 0;
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uAtlas: { value: null }, uPixelWorld: { value: 0.002 },
      uSunDir: { value: new THREE.Vector3(0.6, 0.3, 0.4).normalize() }, uSunColor: { value: new THREE.Color(3, 2.5, 2) },
      uAmbient: { value: new THREE.Color(0.35, 0.42, 0.55) }, uGround: { value: new THREE.Color(0.18, 0.15, 0.12) },
      uFlashPos: { value: new THREE.Vector3() }, uFlashColor: { value: new THREE.Color(0, 0, 0) },
      uFlash2Pos: { value: new THREE.Vector3() }, uFlash2Color: { value: new THREE.Color(0, 0, 0) },
      uDepth: { value: null }, uHasDepth: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.03 }, uFar: { value: 1500 },
      vmProj: { value: new THREE.Matrix4() },
    }]);
    if (opts.vmProj) this.uniforms.vmProj = opts.vmProj; // share the weapons' live uniform object
    this.uniforms.uAtlas.value = atlas;
    const m = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, fog: true, defines: this.vm ? { VM: 1 } : {},
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, premultipliedAlpha: true,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = this.vm ? 60 : 50;
    this.fx.root.add(this.mesh);
    if (!this.vm) this.mesh.onBeforeRender = (renderer, scene, camera) => this._grabDepth(renderer, camera);
    this._sort = []; this._tmp = new THREE.Vector3(); this._fwd = new THREE.Vector3();
  }

  /**
   * Copy the scene depth (opaque pass is complete when transparents draw) into our own depth texture via
   * blitFramebuffer, so particles can fade against real geometry without a depth pre-pass.
   */
  _grabDepth(renderer, camera) {
    const U = this.uniforms; U.uHasDepth.value = 0;
    const rt = renderer.getRenderTarget(); const post = this.game.post;
    if (!rt || !rt.depthTexture || (post?.sceneRT && rt !== post.sceneRT) || this._depthFailed) return;
    try {
      const gl = renderer.getContext(); if (!gl.blitFramebuffer) return;
      const w = rt.width, h = rt.height;
      if (!this._depthRT || this._depthRT.width !== w || this._depthRT.height !== h) {
        this._depthRT?.dispose();
        const dt = new THREE.DepthTexture(w, h); dt.type = rt.depthTexture.type; dt.format = rt.depthTexture.format;
        this._depthRT = new THREE.WebGLRenderTarget(w, h, { depthTexture: dt, depthBuffer: true, samples: 0, type: THREE.UnsignedByteType });
        renderer.initRenderTarget ? renderer.initRenderTarget(this._depthRT) : null;
      }
      const P = renderer.properties;
      const src = P.get(rt).__webglMultisampledFramebuffer || P.get(rt).__webglFramebuffer;
      const dst = P.get(this._depthRT).__webglFramebuffer;
      if (!src || !dst) return;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, src);
      if (!this._depthChecked && (this._depthChecked = true) && gl.getError() !== gl.NO_ERROR) { this._depthFailed = true; console.warn('fx: depth blit failed, soft particles use plane fade'); return; }
      U.uDepth.value = this._depthRT.depthTexture; U.uHasDepth.value = 1; U.uRes.value.set(w, h);
      U.uNear.value = camera.near; U.uFar.value = camera.far;
    } catch (e) { this._depthFailed = true; console.warn('fx: depth blit error', e.message); }
  }

  /** Spawn a particle. See fields below for options (all optional). */
  spawn(o) {
    const p = this.free.pop(); if (!p) return null;
    p.alive = true; p.age = 0; p.life = o.life ?? 1; p.delay = o.delay ?? 0;
    p.pos.copy(o.pos); if (o.vel) p.vel.copy(o.vel); else p.vel.set(0, 0, 0);
    p.gravity = o.gravity ?? 0; p.drag = o.drag ?? 0; p.buoy = o.buoy ?? 0;
    p.floorY = o.floorY ?? -1e9; p.rest = o.rest ?? 0.3;
    p.s0 = o.size ?? 0.1; p.s1 = o.size1 ?? p.s0; p.sPow = o.sizePow ?? 2.2;
    p.len = o.len ?? 0; p.len1 = o.len1 ?? p.len; p.stretch = o.stretch ?? 0;
    p.tile = o.tile ?? 8; p.rot = o.rot ?? 0; p.rotVel = o.rotVel ?? 0;
    p.mode = o.mode ?? 0; if (o.axis) p.axis.copy(o.axis); p.anchor = o.anchor ?? 0;
    const c = o.color ?? [1, 1, 1]; p.c0.setRGB(c[0], c[1], c[2]);
    const c1 = o.color1 ?? c; p.c1.setRGB(c1[0], c1[1], c1[2]);
    p.alpha = o.alpha ?? 1; p.fadeIn = o.fadeIn ?? 0.05; p.fadeOut = o.fadeOut ?? 0.5; p.alphaPow = o.alphaPow ?? 1;
    p.add = o.additive ?? 0; p.lit = o.lit ?? 0; p.emis = o.emissive ?? 1;
    p.e0 = o.erode ?? 0; p.e1 = o.erode1 ?? p.e0; p.h0 = o.heat ?? 0; p.h1 = o.heat1 ?? p.h0; p.hPow = o.heatPow ?? 1;
    if (o.plane) { p.plane.copy(o.plane); p.soft = o.soft ?? 0.3; } else { p.plane.set(0, 0, 0, 0); p.soft = 1; }
    p.minPx = o.minPx ?? 0; p.turb = o.turb ?? 0; p.seed = this.fx.rand() * 100;
    p.flicker = o.flicker ?? 0; p.sun = o.sun ?? this.fx.sunVis;
    p.tracer = !!o.tracer;
    if (p.tracer) { p.start.copy(o.pos); p.axis.copy(o.dir); p.dist = o.dist; p.speed = o.speed; p.tlen = o.len; p.mode = 1; }
    this.live.push(p);
    return p;
  }

  update(dt, simulate) {
    const live = this.live; const t = this.fx.time;
    if (simulate) {
      for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i];
        if (p.delay > 0) { p.delay -= dt; continue; }
        p.age += dt;
        if (p.age >= p.life || (p.tracer && p.age * p.speed - p.tlen > p.dist)) { p.alive = false; live[i] = live[live.length - 1]; live.pop(); this.free.push(p); continue; }
        if (p.tracer) continue;
        p.vel.y += (p.buoy - p.gravity) * dt;
        if (p.drag) p.vel.multiplyScalar(Math.exp(-p.drag * dt));
        if (p.turb) { p.vel.x += Math.sin(t * 1.7 + p.seed) * p.turb * dt; p.vel.z += Math.cos(t * 1.3 + p.seed * 1.7) * p.turb * dt; }
        p.pos.addScaledVector(p.vel, dt);
        if (p.pos.y < p.floorY) { p.pos.y = p.floorY; if (p.vel.y < 0) p.vel.y *= -p.rest; p.vel.x *= 0.55; p.vel.z *= 0.55; }
        p.rot += p.rotVel * dt;
      }
    }
    // sort back-to-front
    const cam = this.game.camera; const cp = cam.getWorldPosition(this._tmp); const fwd = cam.getWorldDirection(this._fwd);
    const n = live.length; const s = this._sort; s.length = 0;
    for (let i = 0; i < n; i++) { const p = live[i]; if (p.delay > 0) continue; p._d = (p.pos.x - cp.x) * fwd.x + (p.pos.y - cp.y) * fwd.y + (p.pos.z - cp.z) * fwd.z; s.push(p); }
    s.sort((a, b) => b._d - a._d);
    const A = this.attrs; const P0 = A.aPos.array, AX = A.aAxis.array, CO = A.aColor.array, P1 = A.aP1.array, P2 = A.aP2.array, P3 = A.aP3.array, PL = A.aPlane.array;
    let k = 0;
    for (const p of s) {
      const u = Math.min(1, p.age / p.life);
      const i4 = k * 4;
      const size = p.s0 + (p.s1 - p.s0) * (1 - Math.pow(1 - u, p.sPow));
      let fade = p.alpha;
      if (u < p.fadeIn) fade *= u / p.fadeIn;
      if (u > 1 - p.fadeOut) fade *= Math.pow((1 - u) / p.fadeOut, p.alphaPow);
      if (p.flicker) fade *= 1 - p.flicker * (0.5 + 0.5 * Math.sin(t * 40 + p.seed * 13));
      let x = p.pos.x, y = p.pos.y, z = p.pos.z, ax = p.axis.x, ay = p.axis.y, az = p.axis.z;
      let L = p.len + (p.len1 - p.len) * u;
      if (p.tracer) {
        const trav = p.age * p.speed; const head = Math.min(trav, p.dist); const tail = Math.max(0, trav - p.tlen);
        const mid = (head + tail) * 0.5; L = Math.max(0.001, head - tail);
        x = p.start.x + ax * mid; y = p.start.y + ay * mid; z = p.start.z + az * mid;
      } else if (p.mode === 1 && p.stretch > 0) {
        const sp = p.vel.length();
        if (sp > 1e-4) { ax = p.vel.x / sp; ay = p.vel.y / sp; az = p.vel.z / sp; }
        L = Math.max(size * 1.5, sp * p.stretch);
      }
      P0[i4] = x; P0[i4 + 1] = y; P0[i4 + 2] = z; P0[i4 + 3] = size;
      AX[i4] = ax; AX[i4 + 1] = ay; AX[i4 + 2] = az; AX[i4 + 3] = L;
      CO[i4] = p.c0.r + (p.c1.r - p.c0.r) * u; CO[i4 + 1] = p.c0.g + (p.c1.g - p.c0.g) * u; CO[i4 + 2] = p.c0.b + (p.c1.b - p.c0.b) * u; CO[i4 + 3] = fade;
      P1[i4] = p.tile; P1[i4 + 1] = p.rot; P1[i4 + 2] = p.mode; P1[i4 + 3] = p.add;
      P2[i4] = p.lit; P2[i4 + 1] = p.emis; P2[i4 + 2] = p.e0 + (p.e1 - p.e0) * u; P2[i4 + 3] = p.h0 + (p.h1 - p.h0) * Math.pow(u, p.hPow);
      P3[i4] = p.soft; P3[i4 + 1] = p.minPx; P3[i4 + 2] = p.anchor; P3[i4 + 3] = p.sun;
      PL[i4] = p.plane.x; PL[i4 + 1] = p.plane.y; PL[i4 + 2] = p.plane.z; PL[i4 + 3] = p.plane.w;
      k++;
    }
    for (const a of Object.values(A)) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(4, k * 4)); a.needsUpdate = true; }
    this.mesh.geometry.instanceCount = k;
    // pixel size in world units at depth 1
    const h = this.game.renderer.domElement.height || 720;
    const fov = this.vm ? (this.game.weapons?.vmFov || cam.fov) : cam.fov;
    this.uniforms.uPixelWorld.value = 2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2) / (h / (this.game.renderer.getPixelRatio?.() || 1));
  }
}
