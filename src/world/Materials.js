import * as THREE from 'three';
import { TextureBaker } from './textures/TextureBaker.js';
import { RECIPES } from './textures/recipes.js';

/**
 * Procedural PBR material library. Owner: materials agent.
 *
 *   game.materials.get(name, opts?) -> THREE.MeshStandardMaterial | MeshPhysicalMaterial
 *
 * Every material is backed by GPU-baked textures (albedo sRGB, tangent normal, ORM) generated on
 * first use and cached. Textures tile in world meters (1 UV = 1 m): each texture's repeat is set to
 * 1/tileSize so meter-UVs map to real-world feature sizes (a brick is ~0.25 m).
 *
 * Anti-tiling: an onBeforeCompile hook adds world-space low-frequency albedo/roughness variation
 * and (for walls) ground-contact grime; `triplanar` projects textures in world space (rubble default).
 *
 * opts: {
 *   repeat: number | [x, y]   extra UV scale multiplier (2 = features twice as small)
 *   color:  hex/Color         multiplies albedo (returns a clone)
 *   paint:  hex/Color         paint colour for metal_painted / car_paint (paint regions only)
 *   triplanar: bool           world-space projection (ignores mesh UVs)
 *   macro: number             anti-tiling variation strength multiplier (0 disables)
 *   grime: number             ground grime strength on vertical faces (0..1)
 *   side: THREE.Side
 * }
 */

const ALIASES = {
  metal: 'metal_painted', steel: 'metal_bare', iron: 'metal_rusty', rust: 'metal_rusty', stone: 'concrete',
  cement: 'concrete', road: 'asphalt', mud: 'dirt', earth: 'dirt', ground: 'dirt', sand: 'dirt', planks: 'wood_planks',
  fabric: 'cloth_camo', cloth: 'cloth_camo', canvas: 'tarp', tire: 'rubber', tyre: 'rubber', roof: 'roof_tiles',
  debris: 'rubble', paint: 'car_paint', window: 'glass', flesh: 'cloth_camo', sandbags: 'sandbag', floor_tiles: 'tiles',
};

// macro variation defaults: [albedoVar, roughVar, groundGrime, grimeHeight(m)]
const WALLS = [0.16, 0.25, 0.45, 1.3];
const GROUND = [0.2, 0.3, 0.0, 1.0];
const MISC = [0.08, 0.15, 0.2, 0.6];
const MACRO = {
  brick: WALLS, plaster: WALLS, concrete: [0.16, 0.25, 0.35, 1.0], concrete_dark: GROUND,
  asphalt: GROUND, dirt: [0.25, 0.3, 0, 1], gravel: GROUND, grass: [0.25, 0.2, 0, 1], rubble: GROUND, tiles: [0.12, 0.3, 0, 1],
  roof_tiles: [0.15, 0.2, 0, 1], wood: MISC, wood_planks: MISC, metal_painted: MISC, metal_rusty: MISC, metal_bare: [0.06, 0.2, 0, 1],
  sandbag: [0.12, 0.1, 0.3, 0.5], tarp: MISC, cloth_camo: [0.0, 0.0, 0, 1], glass: [0, 0, 0, 1], rubber: [0.05, 0.1, 0, 1],
  plastic: [0.05, 0.1, 0, 1], car_paint: [0.06, 0.2, 0.3, 0.5], road_line: [0.1, 0.1, 0, 1],
};

// --- shader injection -------------------------------------------------------
const VERT_HEAD = /* glsl */ `
varying vec3 vMW; varying vec3 vMN;
uniform vec2 uTexScale;
`;
const VERT_UV = /* glsl */ `
#ifdef USE_MAP
vMapUv *= uTexScale;
#endif
#ifdef USE_NORMALMAP
vNormalMapUv *= uTexScale;
#endif
#ifdef USE_ROUGHNESSMAP
vRoughnessMapUv *= uTexScale;
#endif
#ifdef USE_METALNESSMAP
vMetalnessMapUv *= uTexScale;
#endif
#ifdef USE_AOMAP
vAoMapUv *= uTexScale;
#endif
#ifdef USE_ALPHAMAP
vAlphaMapUv *= uTexScale;
#endif
#ifdef USE_CLEARCOATMAP
vClearcoatMapUv *= uTexScale;
#endif
`;
const VERT_WORLD = /* glsl */ `
{
  vec4 mwp = vec4( transformed, 1.0 );
  vec3 mwn = objectNormal;
  #ifdef USE_BATCHING
    mwp = batchingMatrix * mwp; mwn = mat3( batchingMatrix ) * mwn;
  #endif
  #ifdef USE_INSTANCING
    mwp = instanceMatrix * mwp; mwn = mat3( instanceMatrix ) * mwn;
  #endif
  mwp = modelMatrix * mwp;
  vMW = mwp.xyz;
  vMN = normalize( mat3( modelMatrix ) * mwn );
}
`;
const FRAG_HEAD = /* glsl */ `
varying vec3 vMW; varying vec3 vMN;
uniform vec4 uMacro; uniform vec3 uPaint; uniform float uPaintOn; uniform float uGroundY; uniform vec2 uTexScale; uniform vec2 uTileInv;
float mHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float mNoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mHash(i), mHash(i + vec3(1,0,0)), f.x), mix(mHash(i + vec3(0,1,0)), mHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(mHash(i + vec3(0,0,1)), mHash(i + vec3(1,0,1)), f.x), mix(mHash(i + vec3(0,1,1)), mHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
#ifdef MAT_TRIPLANAR
vec3 tpW; vec2 tuvX, tuvY, tuvZ;
#define TRI(tex) (texture2D(tex, tuvX) * tpW.x + texture2D(tex, tuvY) * tpW.y + texture2D(tex, tuvZ) * tpW.z)
#endif
`;
const FRAG_MACRO_ALBEDO = /* glsl */ `
#ifdef USE_MAP
  if (uPaintOn > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uPaint, sampledDiffuseColor.a);
#endif
float mA = mNoise(vMW * 0.13) * 0.6 + mNoise(vMW * 0.47 + 7.1) * 0.4;
float mB = mNoise(vMW * 0.06 + 3.3);
{
  vec3 c = diffuseColor.rgb * (1.0 + (mA - 0.5) * 2.0 * uMacro.x);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.0 + (mB - 0.5) * 1.6 * uMacro.x);
  c *= mix(vec3(1.0), vec3(1.04, 1.0, 0.94), (mB - 0.3) * uMacro.x * 2.0);
  float gy = vMW.y - uGroundY;
  float vert = 1.0 - abs(normalize(vMN).y);
  float gh = uMacro.w * (0.55 + 0.9 * mNoise(vec3(vMW.x * 1.7, 0.0, vMW.z * 1.7)));
  float streak = mNoise(vec3(vMW.x * 9.0, vMW.y * 0.6, vMW.z * 9.0));
  float gr = (1.0 - smoothstep(0.0, gh, gy - streak * 0.25)) * vert * uMacro.z;
  c *= mix(vec3(1.0), vec3(0.52, 0.47, 0.41), gr);
  diffuseColor.rgb = c;
}
`;
const FRAG_MACRO_ROUGH = /* glsl */ `
roughnessFactor = clamp(roughnessFactor * (1.0 + (mA - 0.5) * 2.0 * uMacro.y), 0.03, 1.0);
`;

const TRI_SETUP = /* glsl */ `
#ifdef MAT_TRIPLANAR
  tpW = pow(abs(normalize(vMN)), vec3(4.0)); tpW /= dot(tpW, vec3(1.0));
  vec3 tp = vMW * vec3(uTexScale.x) ;
  tuvX = tp.zy * uTileInv; tuvY = tp.xz * uTileInv; tuvZ = tp.xy * uTileInv;
#endif
`;
const TRI_NORMAL = /* glsl */ `
{
  vec3 wN = normalize(vMN);
  vec3 nX = texture2D(normalMap, tuvX).xyz * 2.0 - 1.0; nX.xy *= normalScale;
  vec3 nY = texture2D(normalMap, tuvY).xyz * 2.0 - 1.0; nY.xy *= normalScale;
  vec3 nZ = texture2D(normalMap, tuvZ).xyz * 2.0 - 1.0; nZ.xy *= normalScale;
  vec3 sN = sign(wN);
  nX = vec3(nX.xy * vec2(sN.x, 1.0) + wN.zy, abs(nX.z) * wN.x);
  nY = vec3(nY.xy * vec2(sN.y, 1.0) + wN.xz, abs(nY.z) * wN.y);
  nZ = vec3(nZ.xy * vec2(-sN.z, 1.0) + wN.xy, abs(nZ.z) * wN.z);
  vec3 wn = normalize(nX.zyx * tpW.x + nY.xzy * tpW.y + nZ.xyz * tpW.z);
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}
`;

function injectShader(shader, mat) {
  const d = mat.userData.pbr;
  const u = shader.uniforms;
  u.uTexScale = { value: new THREE.Vector2(d.scale[0], d.scale[1]) };
  u.uTileInv = { value: new THREE.Vector2(1 / d.size, 1 / d.size) };
  u.uMacro = { value: new THREE.Vector4(...d.macro) };
  u.uPaint = { value: new THREE.Color().fromArray(d.paint || [1, 1, 1]) };
  u.uPaintOn = { value: d.paint ? 1 : 0 };
  u.uGroundY = { value: d.groundY ?? 0 };
  let vs = shader.vertexShader, fs = shader.fragmentShader;
  vs = vs.replace('#include <common>', '#include <common>\n' + VERT_HEAD)
    .replace('#include <uv_vertex>', '#include <uv_vertex>\n' + VERT_UV)
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + VERT_WORLD);
  fs = (d.triplanar ? '#define MAT_TRIPLANAR\n' : '') + fs;
  fs = fs.replace('#include <common>', '#include <common>\n' + FRAG_HEAD);
  if (d.triplanar) {
    const tri = (chunk, from, to) => THREE.ShaderChunk[chunk].split(from).join(to);
    fs = fs.replace('#include <map_fragment>', TRI_SETUP + tri('map_fragment', 'texture2D( map, vMapUv )', 'TRI(map)'))
      .replace('#include <roughnessmap_fragment>', tri('roughnessmap_fragment', 'texture2D( roughnessMap, vRoughnessMapUv )', 'TRI(roughnessMap)') + FRAG_MACRO_ROUGH)
      .replace('#include <metalnessmap_fragment>', tri('metalnessmap_fragment', 'texture2D( metalnessMap, vMetalnessMapUv )', 'TRI(metalnessMap)'))
      .replace('#include <aomap_fragment>', tri('aomap_fragment', 'texture2D( aoMap, vAoMapUv )', 'TRI(aoMap)'))
      .replace('#include <normal_fragment_maps>', TRI_NORMAL);
  }
  // albedo + roughness macro variation
  fs = fs.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_MACRO_ALBEDO)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + FRAG_MACRO_ROUGH);
  shader.vertexShader = vs; shader.fragmentShader = fs;
}

class PBRStandardMaterial extends THREE.MeshStandardMaterial {
  onBeforeCompile(shader) { if (this.userData.pbr) injectShader(shader, this); }
  customProgramCacheKey() { const d = this.userData.pbr; return d ? `pbr${d.triplanar ? 't' : 'u'}` : ''; }
}
class PBRPhysicalMaterial extends THREE.MeshPhysicalMaterial {
  onBeforeCompile(shader) { if (this.userData.pbr) injectShader(shader, this); }
  customProgramCacheKey() { const d = this.userData.pbr; return d ? `pbr${d.triplanar ? 't' : 'u'}` : ''; }
}

const RES_STEPS = { 1: 512, 2: 1024, 4: 2048 };

export class Materials {
  constructor(game) {
    this.game = game;
    this.names = Object.keys(RECIPES);
    this.baker = new TextureBaker(game.renderer);
    this.baker.profile = !!game.params?.get?.('bakeprof');
    this.sets = new Map();   // name -> baked texture set
    this.cache = new Map();  // key -> material
    const q = game.quality || 'high';
    this.resScale = q === 'low' ? 0.5 : 1;
    const texParam = game.params?.get?.('tex');
    if (texParam) this.resScale = +texParam;
    this._warned = new Set();
  }

  /** Resolve a name (with aliases); unknown names fall back to concrete with one warning. */
  resolve(name) {
    const n = ALIASES[name] || name;
    if (RECIPES[n]) return n;
    if (!this._warned.has(name)) { this._warned.add(name); console.warn(`[Materials] unknown material "${name}", using concrete`); }
    return 'concrete';
  }

  /** Baked texture set {map, normal, orm, size} for a material name. */
  textures(name) {
    name = this.resolve(name);
    let set = this.sets.get(name);
    if (!set) {
      const rc = RECIPES[name];
      const res = Math.max(128, Math.round((RES_STEPS[rc.res] || 1024) * this.resScale));
      set = this.baker.bake(name, rc, res);
      for (const t of [set.map, set.normal, set.orm]) t.repeat.set(1 / rc.size, 1 / rc.size);
      this.sets.set(name, set);
    }
    return set;
  }

  /** Tile size in meters of a material's texture. */
  tileSize(name) { return RECIPES[this.resolve(name)].size; }

  /** Bake every material up-front (optional; get() bakes lazily). */
  preload(names = this.names) { for (const n of names) this.get(n); this.baker.disposeTemps(); }

  get(name, opts = {}) {
    const n = this.resolve(name);
    const key = n + (opts && Object.keys(opts).length ? JSON.stringify(opts, (k, v) => (v && v.isColor ? v.getHex() : v)) : '');
    let m = this.cache.get(key);
    if (m) return m;
    m = this._build(n, opts || {});
    this.cache.set(key, m);
    return m;
  }

  _build(name, opts) {
    const rc = RECIPES[name];
    const set = this.textures(name);
    const rep = opts.repeat == null ? [1, 1] : Array.isArray(opts.repeat) ? opts.repeat : [opts.repeat, opts.repeat];
    const macro = (MACRO[name] || MISC).slice();
    if (opts.macro != null) { macro[0] *= opts.macro; macro[1] *= opts.macro; }
    if (opts.grime != null) macro[2] = opts.grime;
    const paintSrc = opts.paint ?? rc.paint;
    const paint = paintSrc == null ? null : (Array.isArray(paintSrc) ? new THREE.Color().setRGB(...paintSrc, THREE.SRGBColorSpace) : new THREE.Color(paintSrc));
    const pbr = {
      name, size: rc.size, scale: rep, macro, triplanar: opts.triplanar ?? !!rc.triplanar,
      paint: paint ? [paint.r, paint.g, paint.b] : null, groundY: opts.groundY ?? 0,
    };
    let mat;
    const common = {
      map: set.map, normalMap: set.normal, roughnessMap: set.orm, metalnessMap: set.orm, aoMap: set.orm,
      roughness: 1, metalness: 1, aoMapIntensity: 1, side: opts.side ?? THREE.FrontSide,
    };
    if (name === 'glass') {
      mat = new PBRPhysicalMaterial({
        ...common, aoMap: null, metalnessMap: null, metalness: 0, color: 0xffffff,
        transparent: true, depthWrite: false, side: opts.side ?? THREE.DoubleSide,
        ior: 1.5, specularIntensity: 1, envMapIntensity: 1.2,
      });
    } else if (name === 'car_paint') {
      mat = new PBRPhysicalMaterial({
        ...common, aoMap: null, clearcoat: 1, clearcoatMap: set.orm, clearcoatRoughness: 0.08,
      });
    } else if (name === 'road_line') {
      mat = new PBRStandardMaterial({
        ...common, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
    } else {
      mat = new PBRStandardMaterial(common);
    }
    if (opts.color != null) mat.color.set(opts.color);
    mat.name = name;
    mat.userData.pbr = pbr;
    mat.userData.surface = SURFACE[name] || 'concrete';
    return mat;
  }
}

/** Impact/footstep surface class for each material (for userData.surface). */
export const SURFACE = {
  concrete: 'concrete', concrete_dark: 'concrete', plaster: 'concrete', brick: 'concrete', tiles: 'concrete', roof_tiles: 'concrete',
  rubble: 'concrete', asphalt: 'concrete', metal_painted: 'metal', metal_rusty: 'metal', metal_bare: 'metal', car_paint: 'metal',
  wood: 'wood', wood_planks: 'wood', dirt: 'dirt', gravel: 'dirt', grass: 'dirt', sandbag: 'sandbag', tarp: 'cloth',
  cloth_camo: 'cloth', glass: 'glass', rubber: 'rubber', plastic: 'plastic', road_line: 'concrete',
};
