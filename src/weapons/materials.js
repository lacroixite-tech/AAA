import * as THREE from 'three';
import { weaponTextures } from './textures.js';

/**
 * Shared viewmodel projection. Viewmodel materials replace the camera projection with this matrix
 * (own FOV, ~55°) and squash depth into the front 2% of the depth range, so the gun never clips
 * into walls while still being lit/shadowed by the real scene (world positions are untouched).
 */
export const VM = {
  proj: { value: new THREE.Matrix4() },
};

/**
 * Depth remap: the viewmodel is drawn with its own projection, but writes a depth equal to the camera
 * projection's depth for a compressed distance (3.1 cm + 25% of its true distance, i.e. < 0.27 m).
 * The player capsule keeps walls further than that, so the gun never clips, while depth-based post
 * (GTAO, DOF, fog) still sees a plausible, correctly ordered depth for it.
 */
const VM_DEPTH_FN = /* glsl */`
#define VM_DEPTH(mv) { float dw = 0.031 + (-(mv).z) * 0.25; gl_Position.z = ((projectionMatrix[2][2] * (-dw) + projectionMatrix[3][2]) / dw) * gl_Position.w; }
`;
const VM_PROJECT = /* glsl */`
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
#ifdef VIEWMODEL
  gl_Position = vmProj * mvPosition;
  VM_DEPTH(mvPosition)
#else
  gl_Position = projectionMatrix * mvPosition;
#endif
`;

const FRAG_HEAD = /* glsl */`
uniform sampler2D uNoise; uniform sampler2D uDetail; uniform sampler2D uTriMap;
uniform float uTri; uniform float uDetailScale; uniform vec4 uDetailMask; uniform float uBump; uniform float uMicro;
uniform vec3 uWearColor; uniform float uWear; uniform float uWearRough; uniform float uWearMetal; uniform vec2 uEdge;
uniform float uScratch; uniform float uGrime; uniform vec3 uGrimeColor; uniform float uVar; uniform float uTriMapScale;
varying vec3 vObjPos; varying vec3 vObjNrm;
float gWear; float gGrime; vec4 gNz;
vec4 triS(sampler2D t, vec3 p, vec3 n, float s) {
  vec3 w = pow(abs(n), vec3(6.0)); w /= (w.x + w.y + w.z + 1e-5);
  return texture2D(t, p.zy * s) * w.x + texture2D(t, p.xz * s) * w.y + texture2D(t, p.xy * s) * w.z;
}
vec3 bumpN(vec3 surf_pos, vec3 surf_norm, float h) {
  vec3 sx = dFdx(surf_pos), sy = dFdy(surf_pos);
  vec3 R1 = cross(sy, surf_norm), R2 = cross(surf_norm, sx);
  float det = dot(sx, R1);
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 grad = sign(det) * (dh.x * R1 + dh.y * R2);
  return normalize(abs(det) * surf_norm - grad);
}
`;

let _id = 0;
/**
 * Physically-based gun material with object-space triplanar detail, curvature-driven edge wear
 * (bare metal on bevels), grime, scratches and derivative bump (stipple/weave/grain).
 */
export function gunMaterial(p, { vm = true, physical = false } = {}) {
  const tex = weaponTextures();
  const M = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const mat = new M({
    color: p.color ?? 0x1c1c1c, roughness: p.roughness ?? 0.5, metalness: p.metalness ?? 0,
    vertexColors: true, envMapIntensity: p.env ?? 1,
    ...(p.extra || {}),
  });
  const U = {
    uNoise: { value: tex.noise }, uDetail: { value: tex.detail }, uTriMap: { value: p.triMap || tex.noise },
    uTri: { value: p.tri ?? 9 }, uDetailScale: { value: p.detailScale ?? 30 },
    uDetailMask: { value: new THREE.Vector4(...(p.detailMask || [0, 0, 1, 0])) },
    uBump: { value: p.bump ?? 0.0001 }, uMicro: { value: p.micro ?? 0.2 },
    uWearColor: { value: new THREE.Color(p.wearColor ?? 0x9a9a98) }, uWear: { value: p.wear ?? 1 },
    uWearRough: { value: p.wearRough ?? 0.28 }, uWearMetal: { value: p.wearMetal ?? 1 },
    uEdge: { value: new THREE.Vector2(...(p.edge || [260, 900])) },
    uScratch: { value: p.scratch ?? 0.5 }, uGrime: { value: p.grime ?? 0.5 },
    uGrimeColor: { value: new THREE.Color(p.grimeColor ?? 0x2a2419) }, uVar: { value: p.variation ?? 0.25 },
    uTriMapScale: { value: p.triMapScale ?? 4 },
    vmProj: VM.proj,
  };
  mat.userData.uniforms = U;
  mat.defines = mat.defines || {};
  if (vm) mat.defines.VIEWMODEL = '';
  if (p.triMap) mat.defines.TRIMAP = '';
  mat.customProgramCacheKey = () => `gun${vm ? 'vm' : ''}${p.triMap ? 'tm' : ''}${physical ? 'ph' : ''}`;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 vmProj;\nvarying vec3 vObjPos; varying vec3 vObjNrm;' + VM_DEPTH_FN)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position; vObjNrm = normal;')
      .replace('#include <project_vertex>', VM_PROJECT);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <color_fragment>', /* glsl */`
        #include <color_fragment>
        gNz = triS(uNoise, vObjPos, vObjNrm, uTri);
        #ifdef TRIMAP
          diffuseColor.rgb *= triS(uTriMap, vObjPos, vObjNrm, uTriMapScale).rgb;
        #endif
        vec3 nG = normalize(vNormal);
        float curv = length(fwidth(nG)) / max(length(fwidth(vViewPosition)), 1e-6);
        float edge = smoothstep(uEdge.x, uEdge.y, curv);
        float brk = gNz.a * 1.35 + gNz.r * 0.3 - 0.2;
        gWear = smoothstep(0.25, 0.55, edge * brk) * uWear;
        gWear = max(gWear, smoothstep(0.55, 0.95, gNz.b) * uScratch * (0.4 + gNz.a));
        gGrime = smoothstep(0.35, 0.85, gNz.g) * uGrime;
        diffuseColor.rgb *= 1.0 + (gNz.r - 0.5) * 2.0 * uVar;
        diffuseColor.rgb = mix(diffuseColor.rgb, uGrimeColor, gGrime * 0.55);
        diffuseColor.rgb = mix(diffuseColor.rgb, uWearColor, gWear);
      `)
      .replace('#include <roughnessmap_fragment>', /* glsl */`
        #include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (1.0 + (gNz.r - 0.5) * 0.5) + gGrime * 0.18, 0.04, 1.0);
        roughnessFactor = mix(roughnessFactor, uWearRough, gWear);
      `)
      .replace('#include <metalnessmap_fragment>', /* glsl */`
        #include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, uWearMetal, gWear);
      `)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        #include <normal_fragment_maps>
        {
          float h = dot(triS(uDetail, vObjPos, vObjNrm, uDetailScale), uDetailMask) + gNz.r * uMicro - gWear * 0.3;
          normal = bumpN(-vViewPosition, normal, h * uBump);
        }
      `);
  };
  mat.name = p.name || `gun${_id++}`;
  return mat;
}

/** Simple unlit-ish additive/emissive material with the viewmodel projection (reticle glow, tritium). */
export function vmBasic(params, vm = true) {
  const mat = new THREE.MeshBasicMaterial(params);
  mat.defines = vm ? { VIEWMODEL: '' } : {};
  mat.customProgramCacheKey = () => `vmb${vm}`;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.vmProj = VM.proj;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 vmProj;' + VM_DEPTH_FN)
      .replace('#include <project_vertex>', VM_PROJECT);
  };
  return mat;
}

/** Patch any other standard material with the viewmodel projection (used for glass / decals). */
export function patchVM(mat, vm = true) {
  const prev = mat.onBeforeCompile;
  mat.defines = { ...(mat.defines || {}), ...(vm ? { VIEWMODEL: '' } : {}) };
  const key = mat.customProgramCacheKey();
  mat.customProgramCacheKey = () => key + (vm ? 'vmp' : 'wp');
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.vmProj = VM.proj;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 vmProj;' + VM_DEPTH_FN)
      .replace('#include <project_vertex>', VM_PROJECT);
  };
  return mat;
}

/**
 * Holographic sight reticle, rendered at optical infinity: the fragment compares its view ray with
 * the sight's boresight axis, so the dot sits exactly on the aim point (screen center when ADS)
 * with no parallax. EOTech-style 1 MOA dot + 68 MOA ring (scaled up for game readability).
 */
export function reticleMaterial(vm = true) {
  return new THREE.ShaderMaterial({
    defines: vm ? { VIEWMODEL: '' } : {},
    uniforms: {
      vmProj: VM.proj, uColor: { value: new THREE.Color(6.0, 0.35, 0.18) },
      uRing: { value: 0.0175 }, uDot: { value: 0.0011 }, uBright: { value: 1 },
    },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: /* glsl */`
      uniform mat4 vmProj; varying vec3 vView; varying vec3 vAxis; varying vec3 vUp;
      ${VM_DEPTH_FN}
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = mv.xyz;
        vAxis = normalize((modelViewMatrix * vec4(0.0, 0.0, -1.0, 0.0)).xyz);
        vUp = normalize((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        #ifdef VIEWMODEL
          gl_Position = vmProj * mv; VM_DEPTH(mv)
        #else
          gl_Position = projectionMatrix * mv;
        #endif
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uRing; uniform float uDot; uniform float uBright;
      varying vec3 vView; varying vec3 vAxis; varying vec3 vUp;
      void main() {
        vec3 d = normalize(vView);
        vec3 ax = normalize(vAxis); vec3 up = normalize(vUp - ax * dot(vUp, ax)); vec3 rt = cross(ax, up);
        vec2 a = vec2(dot(d, rt), dot(d, up)) / max(dot(d, ax), 1e-3); // tangent-plane angles (rad)
        float r = length(a);
        float px = max(fwidth(r), 1e-5);
        float dotI = 1.0 - smoothstep(uDot - px, uDot + px, r);
        float ringW = uRing * 0.055;
        float ring = 1.0 - smoothstep(ringW - px, ringW + px, abs(r - uRing));
        // four tick marks on the ring (top, bottom, left, right)
        float tick = 0.0;
        vec2 aa = abs(a);
        float tl = uRing * 0.16, tw = uRing * 0.035;
        tick += (1.0 - smoothstep(tw - px, tw + px, aa.x)) * step(uRing - tl, aa.y) * step(aa.y, uRing + ringW * 0.5) * step(a.y, 0.0);
        tick += (1.0 - smoothstep(tw - px, tw + px, aa.y)) * step(uRing - tl, aa.x) * step(aa.x, uRing + ringW * 0.5);
        float glow = exp(-r * r / (uDot * uDot * 9.0)) * 0.25;
        float v = max(max(dotI, ring), tick) + glow;
        if (v < 0.002) discard;
        gl_FragColor = vec4(uColor * v * uBright, 1.0);
      }`,
  });
}

/** The full set of gun/arm materials. `vm` selects viewmodel projection (false for world showcase). */
export function makeGunMaterials(vm = true) {
  const tex = weaponTextures();
  const o = { vm };
  const m = {
    anod: gunMaterial({ name: 'anod', color: 0x1a1a1b, roughness: 0.56, metalness: 0.25, wearColor: 0x8c8c89, wear: 1, grime: 0.55, scratch: 0.45, variation: 0.2, bump: 6.4e-05, micro: 0.35, detailMask: [0, 0, 1, 0] }, o),
    anodFlat: gunMaterial({ name: 'anodFlat', color: 0x1d1d1e, roughness: 0.62, metalness: 0.1, wearColor: 0x6f6f6c, wear: 0.8, grime: 0.6, scratch: 0.35, variation: 0.25, bump: 6.4e-05 }, o),
    fde: gunMaterial({ name: 'fde', color: 0x6f5d45, roughness: 0.62, metalness: 0, wearColor: 0x9d8d73, wearRough: 0.55, wearMetal: 0, wear: 0.7, grime: 0.35, grimeColor: 0x4a4030, scratch: 0.3, variation: 0.12, bump: 7.2e-05, micro: 0.4, detailMask: [0, 0, 1, 0] }, o),
    fdeStip: gunMaterial({ name: 'fdeStip', color: 0x6a5942, roughness: 0.82, metalness: 0, wearColor: 0x9a896e, wearRough: 0.6, wearMetal: 0, wear: 0.6, grime: 0.4, grimeColor: 0x4a4030, scratch: 0.1, bump: 0.00028, detailScale: 22, detailMask: [1, 0, 0, 0], micro: 0.1 }, o),
    poly: gunMaterial({ name: 'poly', color: 0x151515, roughness: 0.68, metalness: 0, wearColor: 0x3a3a3a, wearRough: 0.5, wearMetal: 0, wear: 0.6, grime: 0.6, scratch: 0.35, bump: 7.2e-05 }, o),
    polyStip: gunMaterial({ name: 'polyStip', color: 0x171717, roughness: 0.8, metalness: 0, wearColor: 0x333333, wearRough: 0.55, wearMetal: 0, wear: 0.5, grime: 0.6, scratch: 0.05, bump: 0.00028, detailScale: 22, detailMask: [1, 0, 0, 0], micro: 0.1 }, o),
    steel: gunMaterial({ name: 'steel', color: 0x2c2b29, roughness: 0.42, metalness: 0.85, wearColor: 0xb9b6b0, wear: 1, wearRough: 0.22, grime: 0.5, scratch: 0.5, variation: 0.3, bump: 4.8e-05, detailMask: [0, 0, 0, 1], detailScale: 40 }, o),
    bright: gunMaterial({ name: 'bright', color: 0x8f8b84, roughness: 0.28, metalness: 1, wearColor: 0xc9c5bd, wear: 0.4, wearRough: 0.15, grime: 0.4, grimeColor: 0x1d1a14, scratch: 0.4, variation: 0.2, bump: 4e-05, detailMask: [0, 0, 0, 1], detailScale: 40 }, o),
    brass: gunMaterial({ name: 'brass', color: 0xc0924a, roughness: 0.3, metalness: 1, wearColor: 0xe0bd7c, wear: 0.4, wearRough: 0.2, grime: 0.35, grimeColor: 0x3c2a14, scratch: 0.2 }, o),
    copper: gunMaterial({ name: 'copper', color: 0xb06a40, roughness: 0.32, metalness: 1, wearColor: 0xd08a60, wear: 0.3, grime: 0.3, scratch: 0.1 }, o),
    rubber: gunMaterial({ name: 'rubber', color: 0x121212, roughness: 0.92, metalness: 0, wear: 0, grime: 0.7, scratch: 0, bump: 0.00016, detailScale: 60, detailMask: [0, 0, 1, 0] }, o),
    glove: gunMaterial({ name: 'glove', color: 0x6c5b45, roughness: 0.9, metalness: 0, wearColor: 0x8a7a62, wearRough: 0.9, wearMetal: 0, wear: 0.5, edge: [120, 500], grime: 0.9, grimeColor: 0x2c251b, scratch: 0, bump: 0.00012, detailScale: 65, detailMask: [0, 1, 0, 0], micro: 0.5, variation: 0.3 }, o),
    gloveDark: gunMaterial({ name: 'gloveDark', color: 0x1f1f1e, roughness: 0.75, metalness: 0, wearColor: 0x4a4a46, wearRough: 0.6, wearMetal: 0, wear: 0.7, edge: [150, 600], grime: 0.6, scratch: 0.2, bump: 0.00012, detailScale: 45, detailMask: [0, 0, 1, 0] }, o),
    glovePalm: gunMaterial({ name: 'glovePalm', color: 0x3b3328, roughness: 0.78, metalness: 0, wearColor: 0x5e5243, wearRough: 0.6, wearMetal: 0, wear: 0.6, edge: [120, 500], grime: 0.8, scratch: 0.1, bump: 0.00016, detailScale: 30, detailMask: [1, 0, 0, 0] }, o),
    sleeve: gunMaterial({ name: 'sleeve', color: 0xffffff, roughness: 0.95, metalness: 0, wear: 0, grime: 0.6, grimeColor: 0x3a3226, scratch: 0, bump: 0.00014, detailScale: 38, detailMask: [0, 1, 0, 0], micro: 0.4, variation: 0.12, triMap: tex.camo, triMapScale: 4.5, extra: { side: THREE.DoubleSide } }, o),
    webbing: gunMaterial({ name: 'webbing', color: 0x4c4636, roughness: 0.95, metalness: 0, wear: 0, grime: 0.6, scratch: 0, bump: 0.00012, detailScale: 120, detailMask: [0, 1, 0, 0] }, o),
  };
  // Lens: faint amber/blue coating, reflective.
  m.glass = patchVM(new THREE.MeshPhysicalMaterial({
    color: 0x9fb8b0, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.16, envMapIntensity: 1.6,
    specularIntensity: 1, depthWrite: false, side: THREE.DoubleSide,
  }), vm);
  m.lensInner = patchVM(new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.2, metalness: 0.5 }), vm);
  m.reticle = reticleMaterial(vm);
  m.marks = patchVM(new THREE.MeshStandardMaterial({
    color: 0x9d9d98, roughness: 0.45, metalness: 0.6, alphaMap: tex.marks, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }), vm);
  m.marksWhite = patchVM(new THREE.MeshStandardMaterial({
    color: 0xcfcac0, roughness: 0.7, metalness: 0, alphaMap: tex.marks, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }), vm);
  m.tritium = vmBasic({ color: new THREE.Color(0.6, 3.0, 0.8), toneMapped: false }, vm);
  m.tritiumOrange = vmBasic({ color: new THREE.Color(3.0, 1.0, 0.1), toneMapped: false }, vm);
  m.dark = vmBasic({ color: 0x030303 }, vm);
  return m;
}
