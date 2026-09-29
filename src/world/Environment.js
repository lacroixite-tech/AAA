import * as THREE from 'three';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { SunLightShadow } from 'three/addons/lights/SunLightShadow.js';

/**
 * Sky, sun, fog, IBL, distant smoke. Owner: lighting agent.
 *
 * Exposes: sun (cascaded-shadow sun light; has .color/.intensity/.position/.shadow like a DirectionalLight),
 * sunDirection (unit Vector3 pointing TOWARD the sun), sunColor (linear, intensity folded in),
 * skyAmbient (linear avg sky radiance), fogColor, envMap (PMREM texture), fogAt(worldPos, camPos) helper.
 *
 * Global shader changes (all built-in materials):
 *  - fog chunks are replaced with exponential HEIGHT fog + aerial perspective whose inscatter colour is
 *    tinted toward the sun (Mie forward lobe). Distant geometry melts into the same haze the sky uses.
 *  - IBL comes from a PMREM of the procedural sky (scene.environment), so PBR materials get correct
 *    reflections and cool skylight fill.
 */

// ---------------------------------------------------------------- constants
const SUN_ELEVATION = 14.5 * THREE.MathUtils.DEG2RAD;
const SUN_AZIMUTH = 200 * THREE.MathUtils.DEG2RAD; // 0 = +Z. 200deg -> sun ahead-left when looking down -Z
const SUN_DIR = new THREE.Vector3(
  Math.cos(SUN_ELEVATION) * Math.sin(SUN_AZIMUTH),
  Math.sin(SUN_ELEVATION),
  Math.cos(SUN_ELEVATION) * Math.cos(SUN_AZIMUTH),
).normalize();
const SUN_COLOR = new THREE.Color(1.0, 0.74, 0.5); // linear, golden hour
const SUN_INTENSITY = 10.0;
const FOG_COLOR = new THREE.Color(0.40, 0.44, 0.50); // ambient haze (linear HDR) away from sun
const FOG_SUN_COLOR = new THREE.Color(1.5, 0.95, 0.55); // inscatter toward sun
const FOG_DENSITY = 0.0028; // per metre at ground level
const FOG_FALLOFF = 0.028; // height falloff (1/m)
const FOG_BASE = 0.0;

const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const v3 = (v) => `vec3(${f(v.x ?? v.r)}, ${f(v.y ?? v.g)}, ${f(v.z ?? v.b)})`;

/** GLSL shared by fog chunk, sky, smoke. */
export const ENV_GLSL = /* glsl */`
#ifndef ENV_GLSL_DEFINED
#define ENV_GLSL_DEFINED
const vec3 ENV_SUN_DIR = ${v3(SUN_DIR)};
const vec3 ENV_FOG_SUN = ${v3(FOG_SUN_COLOR)};
const float ENV_FOG_FALLOFF = ${f(FOG_FALLOFF)};
const float ENV_FOG_BASE = ${f(FOG_BASE)};
// Exponential height fog integrated along the view ray.
float envFogAmount( vec3 ro, vec3 rd, float dist, float density ) {
  float a = density * exp( -ENV_FOG_FALLOFF * ( ro.y - ENV_FOG_BASE ) );
  float k = ENV_FOG_FALLOFF * rd.y;
  float optical = abs( k ) > 1e-5 ? ( 1.0 - exp( -k * dist ) ) / k : dist;
  return 1.0 - exp( -a * max( optical, 0.0 ) );
}
// Inscattered colour along direction rd: cool skylight haze + warm Mie forward lobe toward the sun.
vec3 envFogColor( vec3 rd, vec3 baseColor ) {
  float mu = max( dot( rd, ENV_SUN_DIR ), 0.0 );
  float horiz = 1.0 - clamp( abs( rd.y ) * 2.0, 0.0, 1.0 );
  vec3 c = baseColor;
  c += ENV_FOG_SUN * ( 0.10 * pow( mu, 2.0 ) + 0.35 * pow( mu, 8.0 ) + 1.4 * pow( mu, 48.0 ) ) * ( 0.6 + 0.4 * horiz );
  return c;
}
#endif
`;

const NOISE_GLSL = /* glsl */`
float h12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float h13( vec3 p3 ) { p3 = fract( p3 * 0.1031 ); p3 += dot( p3, p3.zyx + 31.32 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float vnoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( h12( i ), h12( i + vec2( 1, 0 ) ), u.x ), mix( h12( i + vec2( 0, 1 ) ), h12( i + vec2( 1, 1 ) ), u.x ), u.y );
}
float vnoise3( vec3 p ) {
  vec3 i = floor( p ), f = fract( p ); vec3 u = f * f * ( 3.0 - 2.0 * f );
  float a = mix( mix( h13( i ), h13( i + vec3( 1, 0, 0 ) ), u.x ), mix( h13( i + vec3( 0, 1, 0 ) ), h13( i + vec3( 1, 1, 0 ) ), u.x ), u.y );
  float b = mix( mix( h13( i + vec3( 0, 0, 1 ) ), h13( i + vec3( 1, 0, 1 ) ), u.x ), mix( h13( i + vec3( 0, 1, 1 ) ), h13( i + vec3( 1, 1, 1 ) ), u.x ), u.y );
  return mix( a, b, u.z );
}
float fbm( vec2 p, int oct ) {
  float s = 0.0, a = 0.5;
  mat2 r = mat2( 0.8, -0.6, 0.6, 0.8 );
  for ( int i = 0; i < 7; i ++ ) { if ( i >= oct ) break; s += a * vnoise( p ); p = r * p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
float fbm3( vec3 p, int oct ) {
  float s = 0.0, a = 0.5;
  for ( int i = 0; i < 6; i ++ ) { if ( i >= oct ) break; s += a * vnoise3( p ); p = p * 2.02 + vec3( 11.3, 5.7, 3.1 ); a *= 0.5; }
  return s;
}
`;

// ---------------------------------------------------------------- global fog chunk override
function installFogChunks() {
  const C = THREE.ShaderChunk;
  if (C.__envFog) return;
  C.__envFog = true;
  C.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif`;
  C.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorldPos = ( mvPosition.xyz - viewMatrix[ 3 ].xyz ) * mat3( viewMatrix );
#endif`;
  C.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${ENV_GLSL}
#endif`;
  C.fog_fragment = /* glsl */`
#ifdef USE_FOG
  {
    vec3 fogRay = vFogWorldPos - cameraPosition;
    float fogDist = length( fogRay );
    vec3 fogDir = fogRay / max( fogDist, 1e-4 );
    #ifdef FOG_EXP2
      float fogFactor = envFogAmount( cameraPosition, fogDir, fogDist, fogDensity );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    gl_FragColor.rgb = mix( gl_FragColor.rgb, envFogColor( fogDir, fogColor ), fogFactor );
  }
#endif`;
}

// ---------------------------------------------------------------- sky
const SKY_VERT = /* glsl */`
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = gl_Position.w; // at far plane
}`;

const SKY_FRAG = /* glsl */`
uniform float uTime;
uniform float uSunDisc;   // 1 = draw disc (view), 0 = env capture
uniform float uEnvMode;   // 1 = PMREM capture (lower hemisphere = ground bounce)
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uCoverage;
varying vec3 vWorldPos;
${ENV_GLSL}
${NOISE_GLSL}

vec3 skyBase( vec3 rd ) {
  float mu = dot( rd, ENV_SUN_DIR );
  float y = max( rd.y, 0.0 );
  vec3 zenith = vec3( 0.14, 0.25, 0.47 );
  vec3 horizon = vec3( 0.62, 0.66, 0.72 );
  float t = pow( 1.0 - y, 4.0 );
  vec3 col = mix( zenith, horizon, t );
  // deeper blue opposite the sun high up, warm/golden band near the sun on the horizon
  vec2 hz = normalize( rd.xz + 1e-5 );
  float az = dot( hz, normalize( ENV_SUN_DIR.xz ) ) * 0.5 + 0.5;
  col = mix( col, vec3( 1.45, 0.95, 0.55 ), pow( t, 1.4 ) * pow( az, 3.0 ) * 0.8 );
  col *= mix( 0.85, 1.1, az );
  // Mie aureole
  float m = max( mu, 0.0 );
  col += uSunColor * ( 0.03 * pow( m, 4.0 ) + 0.07 * pow( m, 30.0 ) + 0.25 * pow( m, 400.0 ) + 1.2 * pow( m, 6000.0 ) );
  return col;
}

// Broken cumulus / stratocumulus layer (projected onto a curved dome) + high cirrus.
float cloudDensity( vec2 q, float cov ) {
  float base = fbm( q, 6 );
  float d = smoothstep( cov, cov + 0.3, base );
  // billowy erosion at the edges
  float b = 1.0 - abs( vnoise( q * 5.0 ) * 2.0 - 1.0 );
  d = clamp( d - ( 1.0 - d ) * b * 0.45, 0.0, 1.0 );
  return d;
}
vec4 clouds( vec3 rd, out float cirrusA ) {
  cirrusA = 0.0;
  if ( rd.y <= 0.0 ) return vec4( 0.0 );
  float mu = dot( rd, ENV_SUN_DIR );
  vec2 p = rd.xz / ( rd.y + 0.08 );                // curved layer projection
  vec2 wind = vec2( 1.0, 0.35 ) * uTime * 0.004;
  vec2 q = p * 1.9 + wind;
  q += ( vec2( vnoise( q * 0.7 + 3.1 ), vnoise( q * 0.7 + 7.7 ) ) - 0.5 ) * 0.5;
  float cov = uCoverage + 0.22 * ( fbm( q * 0.12 + 5.0, 2 ) - 0.4 ) + 0.3 * pow( max( mu, 0.0 ), 90.0 ); // keep a gap around the sun
  float dens = cloudDensity( q, cov );
  // self-shadowing: march toward the sun in layer space
  vec2 sdir = normalize( ENV_SUN_DIR.xz ) * 0.07;
  float od = 0.0;
  for ( int i = 1; i <= 3; i ++ ) od += smoothstep( cov - 0.05, cov + 0.3, fbm( q + sdir * float( i ), 4 ) );
  float trans = exp( -od * 0.9 );
  float fwd = pow( max( mu, 0.0 ), 5.0 );
  float silver = pow( max( mu, 0.0 ), 30.0 ) * ( 1.0 - dens ) * 5.0;
  vec3 amb = mix( vec3( 0.26, 0.30, 0.38 ), vec3( 0.40, 0.44, 0.52 ), clamp( rd.y * 2.0, 0.0, 1.0 ) );
  float g = 0.72, hg = ( 1.0 - g * g ) / pow( 1.0 + g * g - 2.0 * g * mu, 1.5 ) * 0.08;
  vec3 lit = uSunColor * ( trans * ( 0.10 + 0.18 * fwd ) + silver * 0.05 + hg * exp( -dens * 2.2 ) * 0.35 );
  vec3 col = amb * ( 0.6 + 0.4 * ( 1.0 - dens * dens ) ) + lit;
  float fade = smoothstep( 0.0, 0.10, rd.y );
  float a = smoothstep( 0.0, 0.85, dens ) * fade * 0.93;

  // cirrus: long thin streaks high up
  vec2 cq = rd.xz / ( rd.y + 0.25 );
  cq = mat2( 0.8, -0.6, 0.6, 0.8 ) * cq;
  cq = cq * vec2( 0.9, 1.7 ) + vec2( uTime * 0.002, 0.0 );
  float cn = fbm( cq + vec2( vnoise( cq * 0.4 ) * 2.0, 0.0 ), 5 );
  cirrusA = smoothstep( 0.52, 0.9, cn ) * 0.12 * smoothstep( 0.03, 0.3, rd.y ) * ( 1.0 - a );
  return vec4( col, a );
}

// Distant town skyline silhouettes at the horizon (fully hazed)
float skyline( vec3 rd ) {
  float ang = atan( rd.z, rd.x );
  float x = ang * 90.0;
  float cell = floor( x );
  float r = h12( vec2( cell, 7.0 ) );
  float h = 0.004 + 0.022 * r * r;
  if ( r > 0.93 ) h += 0.02 * step( 0.4, fract( x ) ) * step( fract( x ), 0.6 ); // chimney / tower
  float cell2 = floor( x * 0.37 );
  h = max( h, 0.003 + 0.012 * h12( vec2( cell2, 3.0 ) ) );
  // trees / scrub
  h = max( h, 0.004 + 0.006 * vnoise( vec2( x * 1.7, 0.0 ) ) );
  return step( rd.y, h );
}

void main() {
  vec3 rd = normalize( vWorldPos - cameraPosition );
  vec3 col = skyBase( rd );
  float cirrusA;
  vec4 cl = clouds( rd, cirrusA );
  float mu = dot( rd, ENV_SUN_DIR );

  // sun disc with limb darkening (behind clouds)
  if ( uSunDisc > 0.5 ) {
    float cosR = 0.99996; // ~0.5 deg radius (slightly enlarged for readability)
    float d = ( mu - cosR ) / ( 1.0 - cosR );
    if ( d > 0.0 ) {
      float limb = pow( clamp( d, 0.0, 1.0 ), 0.35 );
      col += uSunColor * 60.0 * smoothstep( 0.0, 0.15, d ) * mix( 0.6, 1.0, limb );
    }
  }
  vec3 cirrusCol = uSunColor * ( 0.25 + 1.8 * pow( max( mu, 0.0 ), 10.0 ) ) * 0.4 + vec3( 0.35, 0.38, 0.45 );
  col = mix( col, cirrusCol, cirrusA );
  col = mix( col, cl.rgb, cl.a );

  // horizon haze: identical fog to geometry so silhouettes melt into the sky
  float dist = rd.y > 0.0 ? 6000.0 : 1800.0;
  float fogA = envFogAmount( cameraPosition, rd, dist, uFogDensity );
  vec3 fogC = envFogColor( rd, uFogColor );
  if ( uEnvMode < 0.5 ) {
    float sk = skyline( rd );
    vec3 silhouette = vec3( 0.05, 0.05, 0.055 );
    float skFog = envFogAmount( cameraPosition, rd, 1100.0, uFogDensity );
    col = mix( col, mix( silhouette, fogC, skFog ), sk );
    if ( rd.y < 0.0 ) col = mix( silhouette, fogC, skFog );
  } else if ( rd.y < 0.0 ) {
    // ground bounce for IBL: sunlit dusty ground, warm
    float g = clamp( -rd.y * 3.0, 0.0, 1.0 );
    col = mix( fogC, vec3( 0.20, 0.17, 0.13 ), g );
    fogA = 0.0;
  }
  col = mix( col, fogC, rd.y > 0.0 ? fogA : 0.0 );
  gl_FragColor = vec4( col, 1.0 );
}`;

// ---------------------------------------------------------------- distant smoke column
const SMOKE_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const SMOKE_FRAG = /* glsl */`
uniform float uTime;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uRight;
varying vec2 vUv;
varying vec3 vWorldPos;
${ENV_GLSL}
${NOISE_GLSL}
float plume( vec2 uv ) {
  float y = uv.y;
  float bend = 0.4 + 0.3 * pow( y, 2.2 );
  float width = 0.045 + 0.2 * pow( y, 0.7 );
  float dx = ( uv.x - bend ) / width;
  vec3 np = vec3( ( uv.x - bend ) * 16.0, uv.y * 15.0 - uTime * 0.12, uTime * 0.03 );
  // large turbulent warp so the column breaks into distinct rolling puffs
  np.x += ( vnoise3( np * 0.3 + 9.0 ) - 0.5 ) * 2.2;
  float n = fbm3( np, 5 );
  float billow = 1.0 - abs( vnoise3( np * 2.1 + 4.0 ) * 2.0 - 1.0 );
  float shape = exp( -dx * dx * 0.55 );
  float d = shape * ( 0.7 + 1.5 * n + 0.35 * billow ) - 0.85;
  d *= smoothstep( 0.92, 0.3, y ) * smoothstep( 0.0, 0.015, y );
  return clamp( d * 2.2, 0.0, 1.0 );
}
void main() {
  float d = plume( vUv );
  if ( d < 0.003 ) discard;
  // pseudo-volumetric shading: normal from the density gradient (billboard plane + view axis)
  vec2 e = vec2( 0.006, 0.0 );
  float gx = plume( vUv + e.xy ) - plume( vUv - e.xy );
  float gy = plume( vUv + e.yx ) - plume( vUv - e.yx );
  vec3 fwdV = normalize( cross( uRight, vec3( 0.0, 1.0, 0.0 ) ) ); // toward camera-ish
  vec3 N = normalize( -gx * 6.0 * uRight - gy * 6.0 * vec3( 0.0, 1.0, 0.0 ) + fwdV * ( 0.35 + d ) );
  float ndl = dot( N, ENV_SUN_DIR );
  float wrap = clamp( ( ndl + 0.35 ) / 1.35, 0.0, 1.0 );
  // self shadowing toward the sun
  vec2 sd = normalize( vec2( dot( ENV_SUN_DIR, uRight ), ENV_SUN_DIR.y ) + 1e-4 ) * 0.03;
  float ds = plume( vUv + sd ) + plume( vUv + sd * 2.5 );
  float lit = wrap * exp( -ds * 0.9 );
  float albedo = mix( 0.10, 0.30, smoothstep( 0.05, 0.6, vUv.y ) ); // sooty black base -> greyer, thinner top
  vec3 skyAmb = mix( vec3( 0.20, 0.19, 0.18 ), vec3( 0.42, 0.47, 0.56 ), N.y * 0.5 + 0.5 );
  vec3 col = albedo * ( skyAmb * ( 1.0 - 0.35 * d ) + uSunColor * lit * 0.32 );
  // backlit silver edge where the plume is thin
  float mu = max( dot( normalize( vWorldPos - cameraPosition ), ENV_SUN_DIR ), 0.0 );
  col += uSunColor * pow( mu, 6.0 ) * ( 1.0 - d ) * 0.05;
  // ember glow at the base
  col += vec3( 2.5, 0.8, 0.2 ) * smoothstep( 0.035, 0.0, vUv.y ) * d;
  vec3 ray = vWorldPos - cameraPosition;
  float dist = length( ray );
  vec3 rd = ray / dist;
  float fa = envFogAmount( cameraPosition, rd, dist, uFogDensity );
  col = mix( col, envFogColor( rd, uFogColor ), fa * 0.45 );
  gl_FragColor = vec4( col, smoothstep( 0.0, 0.75, d ) * 0.96 );
}`;

// ---------------------------------------------------------------- cascaded sun shadow with custom split
const _lightDir = new THREE.Vector3(), _up = new THREE.Vector3(), _center = new THREE.Vector3();
const _orient = new THREE.Matrix4(), _viewToLight = new THREE.Matrix4();
const _nc = [0, 0, 0, 0].map(() => new THREE.Vector3()), _fc = [0, 0, 0, 0].map(() => new THREE.Vector3());
const _cc = new Array(8).fill(0).map(() => new THREE.Vector3());

/** SunLightShadow with an explicit near-cascade split distance (default scheme puts it too far out). */
class GameSunShadow extends SunLightShadow {
  constructor() { super(); this.splitDistance = 16; this.fade = 0.18; }
  updateMatrices(light, viewCamera) {
    if (viewCamera === undefined) return;
    const N = 2;
    const insetX = Math.min(0.25, (Math.ceil(this.radius) + 1) / this.mapSize.x);
    const insetY = Math.min(0.25, (Math.ceil(this.radius) + 1) / this.mapSize.y);
    for (let i = 0; i < N; i++) this._viewports[i].set(i + insetX, insetY, 1 - 2 * insetX, 1 - 2 * insetY);
    const resX = this.mapSize.x * (1 - 2 * insetX), resY = this.mapSize.y * (1 - 2 * insetY);
    const res = Math.min(resX, resY);
    const camera = this.camera;
    const near = viewCamera.near;
    const far = Math.max(near + 1e-6, Math.min(camera.far, viewCamera.far));
    const splits = this._cascadeSplits;
    splits[0] = near; splits[1] = Math.min(this.splitDistance, far * 0.5); splits[2] = far;
    _lightDir.setFromMatrixPosition(light.matrixWorld).negate().normalize();
    _up.set(0, 1, 0); if (Math.abs(_up.dot(_lightDir)) > 0.99) _up.set(0, 0, 1);
    _orient.lookAt(_center.set(0, 0, 0), _lightDir, _up);
    _viewToLight.copy(_orient).transpose().multiply(viewCamera.matrixWorld);
    const inv = viewCamera.projectionMatrixInverse;
    let maxZ = -Infinity;
    for (let i = 0; i < 4; i++) {
      const x = i === 0 || i === 1 ? 1 : -1, y = i === 0 || i === 3 ? 1 : -1;
      const nc = _nc[i].set(x, y, -1).applyMatrix4(inv);
      _fc[i].copy(nc).multiplyScalar(far / near);
      nc.applyMatrix4(_viewToLight); _fc[i].applyMatrix4(_viewToLight);
      maxZ = Math.max(maxZ, nc.z, _fc[i].z);
    }
    maxZ += this.casterReach ?? 120;
    const sNear = camera.near;
    for (let i = 0; i < N; i++) {
      const cNear = i === 0 ? splits[0] : this._cascadeData[i - 1].z;
      const cFar = splits[i + 1];
      const fadeStart = cFar - this.fade * (cFar - splits[i]);
      this._cascadeData[i].set(i === 0 ? -1e10 : cNear, cFar, fadeStart, 0);
      const na = (cNear - near) / (far - near), fa = (cFar - near) / (far - near);
      _center.set(0, 0, 0);
      for (let j = 0; j < 4; j++) {
        _cc[j * 2].lerpVectors(_nc[j], _fc[j], na); _cc[j * 2 + 1].lerpVectors(_nc[j], _fc[j], fa);
        _center.add(_cc[j * 2]).add(_cc[j * 2 + 1]);
      }
      _center.multiplyScalar(1 / 8);
      let r2 = 0, minZ = Infinity;
      for (let j = 0; j < 8; j++) { r2 = Math.max(r2, _cc[j].distanceToSquared(_center)); minZ = Math.min(minZ, _cc[j].z); }
      let radius = Math.ceil(Math.sqrt(r2) * 4) / 4; // quantise so the texel size is stable while turning
      radius /= 1 - 1 / res;
      const tx = 2 * radius / resX, ty = 2 * radius / resY;
      _center.x = Math.round(_center.x / tx) * tx; _center.y = Math.round(_center.y / ty) * ty;
      _center.z = maxZ + sNear;
      _center.applyMatrix4(_orient);
      const cam = this._cameras[i];
      cam.position.copy(_center);
      cam.quaternion.setFromRotationMatrix(_orient);
      cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
      cam.near = sNear; cam.far = maxZ - minZ + 2 * sNear;
      cam.coordinateSystem = camera.coordinateSystem; cam._reversedDepth = camera.reversedDepth;
      cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      this._updateMatrix(cam, this._matrices[i], this._frustums[i], this._viewports[i]);
    }
  }
}

// ---------------------------------------------------------------- Environment
export class Environment {
  constructor(game) {
    this.game = game;
    const s = game.scene;
    const high = game.quality !== 'low';
    installFogChunks();

    this.sunDirection = SUN_DIR.clone();
    this.sunColor = SUN_COLOR.clone().multiplyScalar(SUN_INTENSITY);
    this.fogColor = FOG_COLOR.clone();
    this.skyAmbient = new THREE.Color(0.33, 0.37, 0.45);

    // --- fog (height/aerial via chunk override; FogExp2 supplies colour + ground density uniforms)
    s.fog = new THREE.FogExp2(FOG_COLOR.clone(), FOG_DENSITY);
    s.background = null;

    // --- sun: cascaded shadows (2 cascades in one atlas, texel-snapped, sphere-fitted => no shimmer)
    const sun = new SunLight(SUN_COLOR.clone(), SUN_INTENSITY);
    sun.shadow = new GameSunShadow();
    sun.name = 'sun';
    sun.position.copy(SUN_DIR).multiplyScalar(100);
    sun.castShadow = true;
    const sh = sun.shadow;
    sh.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
    sh.camera.near = 0.5;
    sh.camera.far = high ? 170 : 110; // shadow distance
    sh.splitDistance = high ? 15 : 20;
    sh.casterReach = 140;
    sh.bias = -0.00025;
    sh.normalBias = 0.035;
    sh.radius = high ? 1.6 : 1.0;
    s.add(sun);
    sun.updateMatrixWorld();
    this.sun = sun;

    // --- warm bounce fill: light reflected off sunlit facades/ground back onto surfaces facing away from the sun
    const bounce = new THREE.DirectionalLight(new THREE.Color(1.0, 0.78, 0.58), 0.3);
    bounce.name = 'sunBounce';
    bounce.position.set(-SUN_DIR.x, 0.35, -SUN_DIR.z).normalize().multiplyScalar(100);
    bounce.castShadow = false;
    s.add(bounce); s.add(bounce.target);
    this.bounce = bounce;

    // --- sky dome
    this.skyUniforms = {
      uTime: { value: 0 }, uSunDisc: { value: 1 }, uEnvMode: { value: 0 },
      uSunColor: { value: this.sunColor.clone() },
      uFogColor: { value: FOG_COLOR.clone() }, uFogDensity: { value: FOG_DENSITY },
      uCoverage: { value: 0.43 },
    };
    const skyMat = new THREE.ShaderMaterial({
      name: 'sky', uniforms: this.skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMat);
    sky.frustumCulled = false; sky.renderOrder = -1000; sky.name = 'sky';
    sky.userData.noCollide = true;
    s.add(sky);
    this.sky = sky;

    // --- IBL from the sky (no sun disc; ground bounce in lower hemisphere)
    this._buildEnvMap(game.renderer);

    // --- distant smoke column (cylindrical billboard)
    this.smokeUniforms = {
      uTime: { value: 0 }, uSunColor: { value: this.sunColor.clone() },
      uFogColor: { value: FOG_COLOR.clone() }, uFogDensity: { value: FOG_DENSITY },
      uRight: { value: new THREE.Vector3(1, 0, 0) },
    };
    const smokeMat = new THREE.ShaderMaterial({
      name: 'distantSmoke', uniforms: this.smokeUniforms, vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG,
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    const g = new THREE.PlaneGeometry(1, 1); g.translate(0, 0.5, 0);
    const smoke = new THREE.Mesh(g, smokeMat);
    const smokeAz = SUN_AZIMUTH - 0.55; // off to the side of the sun
    smoke.position.set(Math.sin(smokeAz) * 700, -4, Math.cos(smokeAz) * 700);
    smoke.scale.set(440, 520, 1);
    smoke.frustumCulled = false; smoke.renderOrder = 5; smoke.name = 'distantSmoke';
    s.add(smoke);
    this.smoke = smoke;
    // a second, fainter column further away
    const smoke2 = new THREE.Mesh(g, smokeMat.clone());
    smoke2.material.uniforms = { ...this.smokeUniforms, uRight: { value: new THREE.Vector3(1, 0, 0) } };
    const az2 = SUN_AZIMUTH + Math.PI + 0.6;
    smoke2.position.set(Math.sin(az2) * 950, -6, Math.cos(az2) * 950);
    smoke2.scale.set(380, 360, 1);
    smoke2.frustumCulled = false; smoke2.renderOrder = 5;
    s.add(smoke2);
    this.smoke2 = smoke2;
  }

  _buildEnvMap(renderer) {
    const envScene = new THREE.Scene();
    const mat = this.sky.material.clone();
    mat.uniforms = THREE.UniformsUtils.clone(this.skyUniforms);
    mat.uniforms.uSunDisc.value = 0; mat.uniforms.uEnvMode.value = 1;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat);
    envScene.add(dome);
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromScene(envScene, 0, 0.1, 500, { size: 256 });
    pm.dispose(); mat.dispose(); dome.geometry.dispose();
    this.envMap = rt.texture;
    this.game.scene.environment = this.envMap;
    this.game.scene.environmentIntensity = 1.1;
  }

  /** CPU mirror of the fog function (for sprites/fx that do their own fogging). */
  fogAmount(worldPos, camPos) {
    const dx = worldPos.x - camPos.x, dy = worldPos.y - camPos.y, dz = worldPos.z - camPos.z;
    const dist = Math.hypot(dx, dy, dz) || 1e-4;
    const a = FOG_DENSITY * Math.exp(-FOG_FALLOFF * (camPos.y - FOG_BASE));
    const k = FOG_FALLOFF * dy / dist;
    const od = Math.abs(k) > 1e-5 ? (1 - Math.exp(-k * dist)) / k : dist;
    return 1 - Math.exp(-a * Math.max(od, 0));
  }

  update(dt) {
    const cam = this.game.camera;
    const t = this.game.time;
    this.skyUniforms.uTime.value = t;
    this.sky.position.copy(cam.position);
    this.smokeUniforms.uTime.value = t;
    for (const sm of [this.smoke, this.smoke2]) {
      // cylindrical billboard facing the camera
      const dx = cam.position.x - sm.position.x, dz = cam.position.z - sm.position.z;
      sm.rotation.set(0, Math.atan2(dx, dz), 0);
      sm.updateMatrixWorld();
      sm.material.uniforms.uRight.value.set(Math.cos(sm.rotation.y), 0, -Math.sin(sm.rotation.y));
      sm.material.uniforms.uTime.value = t;
    }
  }
}
