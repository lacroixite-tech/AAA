import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

/**
 * HDR post-processing chain. Owner: lighting/post agent.
 *
 *   scene (RGBA16F, 4x MSAA, float depth)
 *     -> GTAO (half res, depth-reconstructed normals, poisson denoise)
 *     -> bloom: 13-tap Karis downsample chain + tent upsample (CoD/Jimenez 2014), energy conserving mix
 *     -> sun shafts: sky mask + 2x radial blur at quarter res
 *     -> composite: AO, chromatic aberration, ADS peripheral blur, bloom + lens dirt, shafts, exposure,
 *        ACES filmic, CoD grade (lift/gamma/gain, split tone, desat), damage vignette, vignette, grain
 *     -> SMAA -> screen
 *
 * Public API: setADS(0..1), setDamage(0..1), flash(intensity=1, decay=12), exposure, enabled flags,
 *             setSize(w,h), render(dt). game.quality 'low' disables MSAA, GTAO, shafts, lens dirt.
 */

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`;

const mat = (frag, uniforms, defines = {}) => new THREE.ShaderMaterial({
  uniforms, defines, vertexShader: QUAD_VERT, fragmentShader: frag,
  depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
});

// 13-tap downsample (Jimenez, "Next Generation Post Processing in Call of Duty: AW")
const DOWN_FRAG = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uKaris; uniform float uClampMax;
varying vec2 vUv;
float lum( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
vec3 S( vec2 o ) { return min( texture2D( tSrc, vUv + o * uTexel ).rgb, vec3( uClampMax ) ); }
void main() {
  vec3 a = S( vec2( -2, 2 ) ), b = S( vec2( 0, 2 ) ), c = S( vec2( 2, 2 ) );
  vec3 d = S( vec2( -2, 0 ) ), e = S( vec2( 0, 0 ) ), f = S( vec2( 2, 0 ) );
  vec3 g = S( vec2( -2, -2 ) ), h = S( vec2( 0, -2 ) ), i = S( vec2( 2, -2 ) );
  vec3 j = S( vec2( -1, 1 ) ), k = S( vec2( 1, 1 ) ), l = S( vec2( -1, -1 ) ), m = S( vec2( 1, -1 ) );
  vec3 col;
  if ( uKaris > 0.5 ) {
    // weights re-normalised by the karis factors
    vec3 s0 = ( j + k + l + m ) * 0.25, s1 = ( a + b + d + e ) * 0.25, s2 = ( b + c + e + f ) * 0.25, s3 = ( d + e + g + h ) * 0.25, s4 = ( e + f + h + i ) * 0.25;
    float w0 = 0.5 / ( 1.0 + lum( s0 ) ), w1 = 0.125 / ( 1.0 + lum( s1 ) ), w2 = 0.125 / ( 1.0 + lum( s2 ) ), w3 = 0.125 / ( 1.0 + lum( s3 ) ), w4 = 0.125 / ( 1.0 + lum( s4 ) );
    col = ( s0 * w0 + s1 * w1 + s2 * w2 + s3 * w3 + s4 * w4 ) / ( w0 + w1 + w2 + w3 + w4 );
  } else {
    col = e * 0.125 + ( a + c + g + i ) * 0.03125 + ( b + d + f + h ) * 0.0625 + ( j + k + l + m ) * 0.125;
  }
  gl_FragColor = vec4( col, 1.0 );
}`;

const UP_FRAG = /* glsl */`
uniform sampler2D tLow; uniform sampler2D tHigh; uniform vec2 uTexel; uniform float uRadius;
varying vec2 vUv;
void main() {
  vec2 o = uTexel * uRadius;
  vec3 s = texture2D( tLow, vUv ).rgb * 4.0;
  s += ( texture2D( tLow, vUv + vec2( o.x, 0 ) ).rgb + texture2D( tLow, vUv - vec2( o.x, 0 ) ).rgb + texture2D( tLow, vUv + vec2( 0, o.y ) ).rgb + texture2D( tLow, vUv - vec2( 0, o.y ) ).rgb ) * 2.0;
  s += texture2D( tLow, vUv + o ).rgb + texture2D( tLow, vUv - o ).rgb + texture2D( tLow, vUv + vec2( o.x, -o.y ) ).rgb + texture2D( tLow, vUv + vec2( -o.x, o.y ) ).rgb;
  gl_FragColor = vec4( texture2D( tHigh, vUv ).rgb + s / 16.0, 1.0 );
}`;

// Sun-shaft occlusion mask: bright sky pixels near the sun
const RAYMASK_FRAG = /* glsl */`
uniform sampler2D tScene; uniform sampler2D tDepth; uniform vec2 uSun; uniform float uAspect;
varying vec2 vUv;
void main() {
  float d = texture2D( tDepth, vUv ).x;
  float sky = step( 0.99999, d );
  vec3 c = min( texture2D( tScene, vUv ).rgb, vec3( 12.0 ) );
  vec2 dv = ( vUv - uSun ) * vec2( uAspect, 1.0 );
  float fall = exp( -dot( dv, dv ) * 7.0 );
  float l = max( dot( c, vec3( 0.3, 0.5, 0.2 ) ) - 0.9, 0.0 );
  gl_FragColor = vec4( c * ( l / ( l + 1.0 ) ) * sky * fall, 1.0 );
}`;

const RADIAL_FRAG = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uSun; uniform float uDensity; uniform float uDecay;
varying vec2 vUv;
#define N 28
void main() {
  vec2 delta = ( vUv - uSun ) * uDensity / float( N );
  vec2 uv = vUv;
  float jitter = fract( sin( dot( vUv, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  uv -= delta * jitter;
  vec3 acc = vec3( 0.0 ); float w = 1.0, wsum = 0.0;
  for ( int i = 0; i < N; i ++ ) { acc += texture2D( tSrc, uv ).rgb * w; wsum += w; w *= uDecay; uv -= delta; }
  gl_FragColor = vec4( acc / wsum, 1.0 );
}`;

// Average log luminance of the smallest bloom mip -> 1x1, temporally adapted.
const LUMA_FRAG = /* glsl */`
uniform sampler2D tSrc; uniform sampler2D tPrev; uniform float uRate;
varying vec2 vUv;
void main() {
  float s = 0.0;
  for ( int y = 0; y < 8; y ++ ) for ( int x = 0; x < 8; x ++ ) {
    vec2 uv = ( vec2( x, y ) + 0.5 ) / 8.0;
    // centre-weighted metering
    float w = 1.0 + 1.5 * exp( -dot( uv - 0.5, uv - 0.5 ) * 8.0 );
    vec3 c = texture2D( tSrc, uv ).rgb;
    s += log( max( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 ) ) * w;
  }
  float wsum = 0.0;
  for ( int y = 0; y < 8; y ++ ) for ( int x = 0; x < 8; x ++ ) { vec2 uv = ( vec2( x, y ) + 0.5 ) / 8.0; wsum += 1.0 + 1.5 * exp( -dot( uv - 0.5, uv - 0.5 ) * 8.0 ); }
  float avg = s / wsum;
  float prev = texture2D( tPrev, vec2( 0.5 ) ).r;
  gl_FragColor = vec4( mix( prev, avg, uRate ), 0.0, 0.0, 1.0 );
}`;

const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tBlur; uniform sampler2D tAO; uniform sampler2D tRays; uniform sampler2D tDirt; uniform sampler2D tDepth; uniform float uNear; uniform float uFar;
uniform vec2 uRes; uniform float uTime; uniform float uExposure; uniform float uBloomMix; uniform float uDirt;
uniform float uAO; uniform float uBloomNorm; uniform float uRaysI; uniform vec3 uRaysColor; uniform float uCA; uniform float uADS; uniform float uDamage; uniform float uFlash;
uniform float uGrain; uniform float uVignette; uniform sampler2D tLuma; uniform float uAutoExp; uniform float uLumaRef; uniform float uFlare; uniform sampler2D tFlare; uniform float uDebug; uniform float uGlare;
uniform vec3 uLift; uniform vec3 uGamma; uniform vec3 uGain; uniform float uSat; uniform float uContrast;
varying vec2 vUv;
float lum( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
// ACES fitted (Hill) incl. sRGB->AP1 matrices
vec3 RRTAndODTFit( vec3 v ) { vec3 a = v * ( v + 0.0245786 ) - 0.000090537; vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081; return a / b; }
vec3 aces( vec3 c ) {
  const mat3 I = mat3( 0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777 );
  const mat3 O = mat3( 1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602 );
  return clamp( O * RRTAndODTFit( I * c ), 0.0, 1.0 );
}
float hash( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
vec3 toSRGB( vec3 c ) { return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) ); }
void main() {
  vec2 uv = vUv;
  vec2 dc = uv - 0.5;
  float aspect = uRes.x / uRes.y;
  float r2 = dot( dc * vec2( aspect, 1.0 ), dc * vec2( aspect, 1.0 ) );
  // radial chromatic aberration (grows toward edges)
  vec2 caOff = dc * r2 * uCA;
  vec3 col;
  col.r = texture2D( tScene, uv - caOff ).r;
  col.g = texture2D( tScene, uv ).g;
  col.b = texture2D( tScene, uv + caOff ).b;
  // ambient occlusion: full strength in dim/ambient areas, reduced on brightly sunlit pixels
  float zb = texture2D( tDepth, uv ).x;
  float vz = uNear * uFar / ( uFar - zb * ( uFar - uNear ) );
  float ao = pow( texture2D( tAO, uv ).r, 1.6 );
  ao = mix( ao, 1.0, smoothstep( 45.0, 90.0, vz ) );
  float l0 = lum( col );
  col *= mix( 1.0, ao, uAO * ( 1.0 - 0.55 * smoothstep( 0.4, 2.5, l0 ) ) );
  // ADS: peripheral defocus
  float per = smoothstep( 0.18, 0.62, sqrt( r2 ) ) * uADS;
  col = mix( col, texture2D( tBlur, uv ).rgb, per );
  // bloom (energy conserving) + lens dirt lit by bloom
  vec3 bloom = texture2D( tBloom, uv ).rgb * uBloomNorm;
  vec3 dirt = texture2D( tDirt, uv ).rgb;
  vec3 hot = max( bloom - 1.5, 0.0 );
  col = mix( col, bloom, uBloomMix ) + hot * uGlare + hot * dirt * uDirt;
  // sun shafts: inscatter grows with view distance (near geometry barely receives any)
  col += texture2D( tRays, uv ).rgb * uRaysColor * uRaysI * clamp( vz / 120.0, 0.08, 1.0 );
  // pseudo lens flare: ghosts + halo from the bright bloom, mirrored through the centre
  if ( uFlare > 0.0 ) {
    vec2 fuv = 1.0 - uv;
    vec2 gv = ( vec2( 0.5 ) - fuv ) * 0.42;
    vec3 fl = vec3( 0.0 );
    for ( int i = 0; i < 4; i ++ ) {
      vec2 suv = fuv + gv * float( i );
      float wgt = pow( 1.0 - clamp( length( vec2( 0.5 ) - suv ) / 0.7071, 0.0, 1.0 ), 6.0 );
      vec3 tint = i == 1 ? vec3( 0.5, 0.8, 1.0 ) : ( i == 2 ? vec3( 1.0, 0.7, 0.4 ) : vec3( 0.7, 1.0, 0.8 ) );
      fl += max( texture2D( tFlare, suv ).rgb * uBloomNorm - 1.0, 0.0 ) * wgt * tint;
    }
    vec2 hv = normalize( vec2( 0.5 ) - fuv + 1e-5 ) * 0.36;
    float hw = pow( 1.0 - clamp( length( vec2( 0.5 ) - fract( fuv + hv ) ) / 0.7071, 0.0, 1.0 ), 5.0 );
    fl += max( texture2D( tFlare, fuv + hv ).rgb * uBloomNorm - 1.0, 0.0 ) * hw * vec3( 1.0, 0.8, 0.6 ) * 0.5;
    col += fl * uFlare * ( 0.6 + 0.4 * dirt );
  }
  // exposure (manual * auto eye adaptation) + flash
  float avgL = exp( texture2D( tLuma, vec2( 0.5 ) ).r );
  float auto_ = clamp( pow( uLumaRef / avgL, 0.4 ), 0.8, 1.4 );
  col *= uExposure * mix( 1.0, auto_, uAutoExp ) * ( 1.0 + uFlash * 3.0 );
  // damage: desaturate + drain toward red at the edges (pre tonemap)
  float L = lum( col );
  col = mix( col, vec3( L ), uDamage * 0.55 );
  // pre-tonemap grade: white balance split — cool shadows, warm highlights
  float tl = L / ( L + 0.6 );
  col *= mix( vec3( 0.92, 1.0, 1.07 ), vec3( 1.06, 1.0, 0.92 ), smoothstep( 0.1, 0.9, tl ) );
  // contrast around mid grey in log space
  col = max( col, 0.0 );
  col = 0.18 * pow( col / 0.18 + 1e-6, vec3( uContrast ) );
  // tonemap
  vec3 t = aces( col );
  // saturation
  float tL = lum( t );
  t = mix( vec3( tL ), t, uSat );
  // lift / gamma / gain (ASC-CDL-ish, display referred)
  t = uGain * ( t + uLift * ( 1.0 - t ) );
  t = pow( max( t, 0.0 ), 1.0 / uGamma );
  // vignette (optical falloff)
  float vig = 1.0 - uVignette * smoothstep( 0.25, 1.1, r2 * 1.3 );
  t *= vig;
  // damage vignette
  float dv = smoothstep( 0.1, 0.9, sqrt( r2 ) * 1.1 ) * uDamage;
  t = mix( t, vec3( 0.35, 0.02, 0.01 ) * ( 0.5 + 0.5 * tL ), dv * 0.8 );
  t = clamp( t, 0.0, 1.0 );
  vec3 o = toSRGB( t );
  // film grain: luminance-weighted, animated, applied in display space
  float gn = hash( uv * uRes + fract( uTime * 13.37 ) * 1000.0 ) + hash( uv * uRes * 1.37 + fract( uTime * 7.1 ) * 500.0 ) - 1.0;
  float gw = uGrain * ( 1.0 - 0.7 * lum( o ) );
  o += gn * gw;
  // blue-noise-ish dither against banding
  o += ( hash( uv * uRes + 0.5 ) - 0.5 ) / 255.0;
  if ( uDebug > 0.5 ) o = vec3( texture2D( tAO, uv ).r );
  gl_FragColor = vec4( clamp( o, 0.0, 1.0 ), 1.0 );
}`;

function makeLensDirt() {
  const S = 512;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  let seed = 1337; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.globalCompositeOperation = 'lighter';
  // soft smudges
  for (let i = 0; i < 40; i++) {
    const x = rnd() * S, y = rnd() * S, r = 20 + rnd() * 90;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.04 + rnd() * 0.08;
    gr.addColorStop(0, `rgba(255,245,230,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // dust specks / water spots (bokeh rings)
  for (let i = 0; i < 260; i++) {
    const x = rnd() * S, y = rnd() * S, r = 1 + rnd() * rnd() * 9;
    g.fillStyle = `rgba(255,250,240,${0.05 + rnd() * 0.18})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    if (r > 5) { g.strokeStyle = `rgba(255,250,240,${0.1 + rnd() * 0.12})`; g.lineWidth = 1; g.stroke(); }
  }
  // wipe streaks
  for (let i = 0; i < 6; i++) {
    g.strokeStyle = `rgba(255,240,220,${0.03 + rnd() * 0.04})`; g.lineWidth = 6 + rnd() * 20;
    g.beginPath(); const x = rnd() * S, y = rnd() * S; g.moveTo(x, y);
    g.bezierCurveTo(x + rnd() * 200 - 100, y + rnd() * 200 - 100, x + rnd() * 300 - 150, y + rnd() * 300 - 150, x + rnd() * 400 - 200, y + rnd() * 400 - 200); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const _v = new THREE.Vector3(), _fwd = new THREE.Vector3();

export class PostFX {
  constructor(game) {
    this.game = game;
    const r = game.renderer;
    this.renderer = r;
    this.high = game.quality !== 'low';
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.autoUpdate = false; // updated once per frame, before the main pass only (not for GTAO/other renders)

    this.exposure = 0.85;
    this.ads = 0; this.damage = 0; this._flash = 0; this._flashDecay = 12;
    this.aoStrength = 0.85; this.bloomMix = 0.045; this.dirtStrength = 0.35;
    this.caStrength = 0.004; this.grain = 0.035; this.vignette = 0.38;
    this.raysEnabled = this.high; this.aoEnabled = this.high;
    this.bloomLevels = this.high ? 6 : 5;

    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const W = size.x, H = size.y;

    // --- scene target
    const depth = new THREE.DepthTexture(W, H);
    depth.type = THREE.FloatType;
    this.sceneRT = new THREE.WebGLRenderTarget(W, H, {
      type: THREE.HalfFloatType, samples: this.high ? 4 : 0, depthTexture: depth,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });

    // --- GTAO (half res, depth only)
    this.gtao = new GTAOPass(game.scene, game.camera, Math.max(1, W >> 1), Math.max(1, H >> 1));
    this.gtao.setGBuffer(depth); // depth-only: normals reconstructed from depth, no extra scene render
    this.gtao.output = GTAOPass.OUTPUT.Off;
    this.gtao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: 12, distanceFallOff: 1.0 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 12 });
    this.whiteTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); this.whiteTex.needsUpdate = true;
    this.blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); this.blackTex.needsUpdate = true;

    // --- bloom chain
    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.down = []; this.up = [];
    for (let i = 0; i < this.bloomLevels; i++) { this.down.push(new THREE.WebGLRenderTarget(1, 1, rtOpts)); this.up.push(new THREE.WebGLRenderTarget(1, 1, rtOpts)); }
    this.downMat = mat(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uKaris: { value: 0 }, uClampMax: { value: 200 } });
    this.upMat = mat(UP_FRAG, { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } });

    // --- sun shafts (quarter res)
    this.rayA = new THREE.WebGLRenderTarget(1, 1, rtOpts); this.rayB = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.rayMaskMat = mat(RAYMASK_FRAG, { tScene: { value: this.sceneRT.texture }, tDepth: { value: depth }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 } });
    this.radialMat = mat(RADIAL_FRAG, { tSrc: { value: null }, uSun: { value: new THREE.Vector2() }, uDensity: { value: 0.9 }, uDecay: { value: 0.96 } });

    // --- auto exposure (1x1 ping-pong, log luminance)
    const lumOpts = { type: THREE.FloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this.lumA = new THREE.WebGLRenderTarget(1, 1, lumOpts); this.lumB = new THREE.WebGLRenderTarget(1, 1, lumOpts);
    this.lumaMat = mat(LUMA_FRAG, { tSrc: { value: null }, tPrev: { value: null }, uRate: { value: 1 } });
    this._lumFirst = true;
    this.autoExposure = true;
    this.adaptSpeed = 1.6;

    // --- composite -> LDR (sRGB encoded) -> SMAA -> screen
    this.ldrRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.compMat = mat(COMPOSITE_FRAG, {
      tScene: { value: this.sceneRT.texture }, tBloom: { value: null }, tBlur: { value: null }, tAO: { value: this.whiteTex },
      tRays: { value: this.blackTex }, tDepth: { value: depth }, uNear: { value: 0.1 }, uFar: { value: 1000 }, tDirt: { value: this.high ? makeLensDirt() : this.blackTex },
      uRes: { value: new THREE.Vector2(W, H) }, uTime: { value: 0 }, uExposure: { value: 1 }, uBloomMix: { value: 0.04 }, uDirt: { value: 0.3 },
      uAO: { value: 0.8 }, uBloomNorm: { value: 1 / 6 }, uRaysI: { value: 0 }, uRaysColor: { value: new THREE.Color(1.0, 0.75, 0.5) }, uCA: { value: 0.006 },
      uADS: { value: 0 }, uDamage: { value: 0 }, uFlash: { value: 0 }, uGrain: { value: 0.035 }, uVignette: { value: 0.35 },
      uLift: { value: new THREE.Vector3(0.002, 0.005, 0.009) }, tLuma: { value: null }, uAutoExp: { value: 1 }, uLumaRef: { value: 0.19 }, uFlare: { value: 0.12 }, uDebug: { value: 0 }, uGlare: { value: 0.18 }, tFlare: { value: null }, uGamma: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
      uGain: { value: new THREE.Vector3(1.02, 1.0, 0.96) }, uSat: { value: 0.86 }, uContrast: { value: 1.14 },
    });
    this.grade = this.compMat.uniforms; // tweakable
    this.smaa = new SMAAPass();
    this.smaa.renderToScreen = true;

    this.quad = new FullScreenQuad(null);
    this.setSize(innerWidth, innerHeight);
  }

  // ---------------------------------------------------------------- public hooks
  setADS(a) { this._adsDriven = true; this.ads = THREE.MathUtils.clamp(a, 0, 1); }
  setDamage(d) { this.damage = THREE.MathUtils.clamp(d, 0, 1); }
  flash(intensity = 1, decay = 12) { this._flash = Math.max(this._flash, intensity); this._flashDecay = decay; }

  /** Current metered scene luminance (debug; stalls the GPU). */
  debugLuma() {
    const px = new Float32Array(4);
    this.renderer.readRenderTargetPixels(this.lumA, 0, 0, 1, 1, px);
    return Math.exp(px[0]);
  }

  setSize(w, h) {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const W = size.x, H = size.y;
    this.W = W; this.H = H;
    this.sceneRT.setSize(W, H);
    this.gtao.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1));
    let bw = W, bh = H;
    for (let i = 0; i < this.bloomLevels; i++) {
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      this.down[i].setSize(bw, bh); this.up[i].setSize(bw, bh);
    }
    this.rayA.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2)); this.rayB.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2));
    this.ldrRT.setSize(W, H);
    this.smaa.setSize(W, H);
    this.compMat.uniforms.uRes.value.set(W, H);
  }

  _pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  render(dt) {
    const r = this.renderer, game = this.game, cam = game.camera;
    // pick up ADS automatically from weapons if nobody drives it explicitly
    const w = game.weapons;
    const adsTarget = this._adsDriven ? this.ads : (w && typeof w.adsAmount === 'number' ? w.adsAmount : this.ads);
    this._flash = Math.max(0, this._flash - this._flashDecay * dt * this._flash - dt * 0.5);

    // 1. scene -> HDR
    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(game.scene, cam);

    // 2. GTAO
    const U = this.compMat.uniforms;
    if (this.aoEnabled) {
      this.gtao.render(r, null, null);
      U.tAO.value = this.gtao.pdRenderTarget.texture;
    } else U.tAO.value = this.whiteTex;

    // 3. bloom chain
    const dm = this.downMat.uniforms, um = this.upMat.uniforms;
    let src = this.sceneRT.texture, sw = this.W, shh = this.H;
    for (let i = 0; i < this.bloomLevels; i++) {
      dm.tSrc.value = src; dm.uTexel.value.set(1 / sw, 1 / shh); dm.uKaris.value = 0; dm.uClampMax.value = i === 0 ? 400 : 1e4;
      this._pass(this.downMat, this.down[i]);
      src = this.down[i].texture; sw = this.down[i].width; shh = this.down[i].height;
    }
    let low = this.down[this.bloomLevels - 1].texture;
    for (let i = this.bloomLevels - 2; i >= 0; i--) {
      const lowRT = i === this.bloomLevels - 2 ? this.down[i + 1] : this.up[i + 1];
      um.tLow.value = low; um.tHigh.value = this.down[i].texture; um.uTexel.value.set(1 / lowRT.width, 1 / lowRT.height);
      this._pass(this.upMat, this.up[i]);
      low = this.up[i].texture;
    }
    U.tBloom.value = this.up[0].texture;
    U.tBlur.value = this.down[1].texture; U.tFlare.value = this.up[Math.min(3, this.bloomLevels - 2)].texture;
    U.uBloomMix.value = this.bloomMix; U.uBloomNorm.value = 1 / this.bloomLevels;

    // 3b. eye adaptation from the smallest mip
    {
      const lm = this.lumaMat.uniforms;
      lm.tSrc.value = this.down[this.bloomLevels - 1].texture;
      lm.tPrev.value = this.lumA.texture;
      lm.uRate.value = this._lumFirst || game.shotName ? 1 : 1 - Math.exp(-dt * this.adaptSpeed);
      this._pass(this.lumaMat, this.lumB);
      [this.lumA, this.lumB] = [this.lumB, this.lumA];
      this._lumFirst = false;
      U.tLuma.value = this.lumA.texture;
      U.uAutoExp.value = this.autoExposure ? 1 : 0;
    }

    // 4. sun shafts
    let raysI = 0;
    const env = game.environment;
    if (this.raysEnabled && env?.sunDirection) {
      cam.getWorldDirection(_fwd);
      const facing = _fwd.dot(env.sunDirection);
      _v.copy(cam.position).addScaledVector(env.sunDirection, 1000).project(cam);
      const sx = _v.x * 0.5 + 0.5, sy = _v.y * 0.5 + 0.5;
      const edge = Math.max(Math.abs(_v.x), Math.abs(_v.y));
      raysI = THREE.MathUtils.smoothstep(facing, 0.2, 0.75) * (1 - THREE.MathUtils.smoothstep(edge, 1.0, 1.8));
      if (raysI > 0.001) {
        this.rayMaskMat.uniforms.uSun.value.set(sx, sy);
        this.rayMaskMat.uniforms.uAspect.value = this.W / this.H;
        this._pass(this.rayMaskMat, this.rayA);
        this.radialMat.uniforms.uSun.value.set(sx, sy);
        this.radialMat.uniforms.tSrc.value = this.rayA.texture; this.radialMat.uniforms.uDensity.value = 0.95;
        this._pass(this.radialMat, this.rayB);
        this.radialMat.uniforms.tSrc.value = this.rayB.texture; this.radialMat.uniforms.uDensity.value = 0.35;
        this._pass(this.radialMat, this.rayA);
        U.tRays.value = this.rayA.texture;
      }
    }
    if (raysI <= 0.001) U.tRays.value = this.blackTex;
    U.uRaysI.value = raysI * 0.55;

    // 5. composite
    U.uTime.value = game.time; U.uNear.value = cam.near; U.uFar.value = cam.far;
    U.uExposure.value = this.exposure;
    U.uAO.value = this.aoStrength;
    U.uDirt.value = this.dirtStrength;
    U.uCA.value = this.caStrength;
    U.uGrain.value = this.grain;
    U.uVignette.value = this.vignette;
    U.uADS.value = adsTarget;
    U.uDamage.value = this.damage;
    U.uFlash.value = this._flash;
    U.uDebug.value = this.debugView === 'ao' ? 1 : 0;
    this._pass(this.compMat, this.ldrRT);

    // 6. SMAA -> screen
    this.smaa.render(r, null, this.ldrRT);
    r.setRenderTarget(null);
  }
}
