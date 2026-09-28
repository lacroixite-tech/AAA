import * as THREE from 'three';
import { NOISE_GLSL } from './glsl/noise.js';
import { COMMON_GLSL } from './glsl/common.js';

/**
 * GPU texture baker. Evaluates a recipe's `surface(uv)` GLSL over a tile into half-float
 * intermediates (albedo+mask, height/rough/metal/ao), then a second pass derives the
 * tangent-space normal map from the height field (Sobel, physically scaled in meters) and a
 * cavity AO term, writing final 8-bit textures with mipmaps:
 *   map    : sRGB albedo (alpha = recipe mask, e.g. paint mask / dirt opacity)
 *   normal : tangent-space normal (OpenGL +Y)
 *   orm    : R = AO, G = roughness, B = metalness (glTF ORM packing that three.js reads)
 */
const VERT = /* glsl */ `
in vec3 position;
void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PASS2 = /* glsl */ `
precision highp float;
uniform sampler2D tA; uniform sampler2D tB;
uniform float uRes; uniform float uSize; uniform float uNrm; uniform float uAo; uniform float uAoR;
layout(location = 0) out vec4 oAlb;
layout(location = 1) out vec4 oNrm;
layout(location = 2) out vec4 oOrm;
float H(vec2 uv){ return texture(tB, uv).r; }
void main(){
  vec2 px = 1.0 / vec2(uRes);
  vec2 uv = gl_FragCoord.xy * px;
  float tm = uSize / uRes; // meters per texel
  float h00 = H(uv + vec2(-1,-1) * px), h10 = H(uv + vec2(0,-1) * px), h20 = H(uv + vec2(1,-1) * px);
  float h01 = H(uv + vec2(-1, 0) * px), h11 = H(uv), h21 = H(uv + vec2(1, 0) * px);
  float h02 = H(uv + vec2(-1, 1) * px), h12 = H(uv + vec2(0, 1) * px), h22 = H(uv + vec2(1, 1) * px);
  float dx = ((h20 + 2.0 * h21 + h22) - (h00 + 2.0 * h01 + h02)) / (8.0 * tm);
  float dy = ((h02 + 2.0 * h12 + h22) - (h00 + 2.0 * h10 + h20)) / (8.0 * tm);
  vec3 n = normalize(vec3(-dx * uNrm, -dy * uNrm, 1.0));
  // cavity occlusion: how far below its surroundings this texel is
  float rt = max(1.0, uAoR / tm);
  float acc = 0.0, wsum = 0.0;
  for (int i = 0; i < 12; i++){
    float a = float(i) * 2.39996 + 0.3;
    float r = rt * (0.35 + 0.65 * fract(float(i) * 0.618));
    float w = 1.0;
    acc += max(H(uv + vec2(cos(a), sin(a)) * r * px) - h11, 0.0) * w; wsum += w;
  }
  float cav = acc / wsum;
  vec4 A = texture(tA, uv), B = texture(tB, uv);
  float ao = clamp(1.0 - cav * uAo, 0.0, 1.0) * B.a;
  oAlb = vec4(A.rgb * mix(1.0, ao, 0.3), A.a);
  oNrm = vec4(n * 0.5 + 0.5, 1.0);
  oOrm = vec4(ao, clamp(B.g, 0.02, 1.0), clamp(B.b, 0.0, 1.0), 1.0);
}`;

export class TextureBaker {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.tmp = new Map(); // res -> intermediate MRT
    this.pass2 = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: PASS2,
      uniforms: { tA: { value: null }, tB: { value: null }, uRes: { value: 0 }, uSize: { value: 1 }, uNrm: { value: 1 }, uAo: { value: 1 }, uAoR: { value: 0.01 } },
      depthTest: false, depthWrite: false,
    });
    this.maxAniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    this.totalMs = 0;
  }

  _tmp(res) {
    let rt = this.tmp.get(res);
    if (!rt) {
      rt = new THREE.WebGLRenderTarget(res, res, {
        count: 2, type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      });
      this.tmp.set(res, rt);
    }
    return rt;
  }

  bake(name, recipe, res) {
    const t0 = performance.now();
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const prevAuto = r.autoClear;
    const prevXr = r.xr.enabled; r.xr.enabled = false;
    const prevShadow = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false;

    const pass1 = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT,
      fragmentShader: `precision highp float;\nprecision highp int;\nuniform float uRes; uniform float uSize;\n` +
        `layout(location = 0) out vec4 oA;\nlayout(location = 1) out vec4 oB;\n` +
        NOISE_GLSL + COMMON_GLSL + recipe.glsl +
        `\nvoid main(){ vec2 uv = gl_FragCoord.xy / uRes; Surf s = surface(uv);\n` +
        `  oA = vec4(srgb2lin(s.albedo), s.mask); oB = vec4(s.height, s.rough, s.metal, s.ao); }`,
      uniforms: { uRes: { value: res }, uSize: { value: recipe.size } },
      depthTest: false, depthWrite: false,
    });
    pass1.name = 'bake_' + name;
    const tmp = this._tmp(res);
    this.quad.material = pass1;
    r.setRenderTarget(tmp);
    r.render(this.scene, this.camera);

    const out = new THREE.WebGLRenderTarget(res, res, {
      count: 3, depthBuffer: false, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, anisotropy: this.maxAniso,
    });
    const [map, normal, orm] = out.textures;
    map.colorSpace = THREE.SRGBColorSpace;
    map.name = name + '_albedo'; normal.name = name + '_normal'; orm.name = name + '_orm';
    const u = this.pass2.uniforms;
    u.tA.value = tmp.textures[0]; u.tB.value = tmp.textures[1];
    u.uRes.value = res; u.uSize.value = recipe.size; u.uNrm.value = recipe.nrm ?? 1;
    u.uAo.value = recipe.ao ?? 40; u.uAoR.value = recipe.aoR ?? 0.01;
    this.quad.material = this.pass2;
    r.setRenderTarget(out);
    r.render(this.scene, this.camera);

    if (this.profile) r.getContext().finish();
    r.setRenderTarget(prevRT); r.autoClear = prevAuto; r.xr.enabled = prevXr; r.shadowMap.autoUpdate = prevShadow;
    pass1.dispose();
    const ms = performance.now() - t0; this.totalMs += ms;
    if (this.profile) console.info(`[bake] ${name} ${res}px ${ms.toFixed(0)} ms`);
    return { map, normal, orm, target: out, size: recipe.size, res, ms };
  }

  disposeTemps() { for (const rt of this.tmp.values()) rt.dispose(); this.tmp.clear(); }
}
