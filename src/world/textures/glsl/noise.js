// Tileable (periodic) procedural noise library used by the GPU texture baker.
// All functions take lattice coordinates p and an integer period `per` so the
// result tiles seamlessly over uv 0..1 when p = uv * per.
// `uSize` = tile size in meters; helpers suffixed C take feature sizes in meters.
export const NOISE_GLSL = /* glsl */ `
#define PI 3.14159265
#define TAU 6.28318531
float sat(float x){ return clamp(x, 0.0, 1.0); }
vec3 sat3(vec3 x){ return clamp(x, 0.0, 1.0); }
float remap(float x, float a, float b){ return sat((x - a) / (b - a)); }
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 desat(vec3 c, float k){ return mix(c, vec3(lum(c)), k); }

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash32(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
vec2 sd2(float s){ return vec2(s * 17.13, s * 31.71); }

// periodic value noise 0..1
float vnoise(vec2 p, vec2 per, float s){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 o = sd2(s);
  float a = hash12(mod(i, per) + o), b = hash12(mod(i + vec2(1, 0), per) + o);
  float c = hash12(mod(i + vec2(0, 1), per) + o), d = hash12(mod(i + vec2(1, 1), per) + o);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
vec2 grd(vec2 i){ float a = hash12(i) * TAU; return vec2(cos(a), sin(a)); }
// periodic gradient noise ~ -1..1
float gnoise(vec2 p, vec2 per, float s){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 o = sd2(s);
  float a = dot(grd(mod(i, per) + o), f);
  float b = dot(grd(mod(i + vec2(1, 0), per) + o), f - vec2(1, 0));
  float c = dot(grd(mod(i + vec2(0, 1), per) + o), f - vec2(0, 1));
  float d = dot(grd(mod(i + vec2(1, 1), per) + o), f - vec2(1, 1));
  return 1.45 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p, vec2 per, int oct, float s){
  float a = 0.5, t = 0.0, n = 0.0;
  for (int i = 0; i < 9; i++){ if (i >= oct) break; t += a * gnoise(p, per, s + float(i) * 1.7); n += a; p *= 2.0; per *= 2.0; a *= 0.5; }
  return t / n;
}
float fbmG(vec2 p, vec2 per, int oct, float gain, float s){
  float a = 0.5, t = 0.0, n = 0.0;
  for (int i = 0; i < 9; i++){ if (i >= oct) break; t += a * gnoise(p, per, s + float(i) * 1.7); n += a; p *= 2.0; per *= 2.0; a *= gain; }
  return t / n;
}
// ridged: sharp creases (cracks, folds) 0..1 (1 on the ridge)
float ridged(vec2 p, vec2 per, int oct, float s){
  float a = 0.5, t = 0.0, n = 0.0;
  for (int i = 0; i < 6; i++){ if (i >= oct) break; t += a * (1.0 - abs(gnoise(p, per, s + float(i) * 3.1))); n += a; p *= 2.0; per *= 2.0; a *= 0.5; }
  return t / n;
}
// periodic voronoi: x=F1, y=F2, z=cell hash, w=distance to cell border
vec4 voronoi(vec2 p, vec2 per, float jit, float s, out vec2 cellId, out vec2 rel){
  vec2 n = floor(p), f = fract(p);
  vec2 o = sd2(s);
  float F1 = 8.0, F2 = 8.0; vec2 mr = vec2(0), mg = vec2(0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    vec2 g = vec2(i, j);
    vec2 r = g + hash22(mod(n + g, per) + o) * jit + (1.0 - jit) * 0.5 - f;
    float d = dot(r, r);
    if (d < F1){ F2 = F1; F1 = d; mr = r; mg = g; } else if (d < F2) F2 = d;
  }
  float md = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++){
    vec2 g = mg + vec2(i, j);
    vec2 r = g + hash22(mod(n + g, per) + o) * jit + (1.0 - jit) * 0.5 - f;
    if (dot(mr - r, mr - r) > 1e-5) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  cellId = mod(n + mg, per);
  rel = mr;
  return vec4(sqrt(F1), sqrt(F2), hash12(cellId + o + 7.7), md);
}
vec4 voronoiF(vec2 p, vec2 per, float jit, float s){ vec2 a, b; return voronoi(p, per, jit, s, a, b); }

// ---- meter-based helpers (uSize = tile size in meters) ----
float FQ(float cell){ return max(1.0, floor(uSize / cell + 0.5)); }
float fbmC(vec2 uv, float cell, int oct, float s){ float f = FQ(cell); return fbm(uv * f, vec2(f), oct, s); }
float fbmA(vec2 uv, vec2 cell, int oct, float s){ vec2 f = vec2(FQ(cell.x), FQ(cell.y)); return fbm(uv * f, f, oct, s); }
float vnC(vec2 uv, float cell, float s){ float f = FQ(cell); return vnoise(uv * f, vec2(f), s); }
float vnA(vec2 uv, vec2 cell, float s){ vec2 f = vec2(FQ(cell.x), FQ(cell.y)); return vnoise(uv * f, f, s); }
float gnA(vec2 uv, vec2 cell, float s){ vec2 f = vec2(FQ(cell.x), FQ(cell.y)); return gnoise(uv * f, f, s); }
float ridgedC(vec2 uv, float cell, int oct, float s){ float f = FQ(cell); return ridged(uv * f, vec2(f), oct, s); }
vec4 vorC(vec2 uv, float cell, float jit, float s){ float f = FQ(cell); return voronoiF(uv * f, vec2(f), jit, s); }
vec4 vorCi(vec2 uv, float cell, float jit, float s, out vec2 id, out vec2 rel){ float f = FQ(cell); return voronoi(uv * f, vec2(f), jit, s, id, rel); }
// domain-warped fbm (organic stains / blotches)
float warpC(vec2 uv, float cell, int oct, float amt, float s){
  vec2 w = vec2(fbmC(uv, cell, 3, s + 11.0), fbmC(uv, cell, 3, s + 23.0));
  // warp by an integer number of periods is not required: warping the sample point keeps it periodic
  return fbmC(fract(uv + w * amt), cell, oct, s);
}
// thin branching crack lines 0..1 (1 = in crack)
float cracksC(vec2 uv, float cell, float width, float s){
  vec2 w = vec2(fbmC(uv, cell * 0.7, 3, s + 5.0), fbmC(uv, cell * 0.7, 3, s + 9.0)) * 0.35 / FQ(cell);
  float r = ridgedC(fract(uv + w), cell, 2, s);
  return smoothstep(1.0 - width, 1.0 - width * 0.25, r);
}
// vertical streaks (water run-off) 0..1
float streaksC(vec2 uv, float wcell, float hcell, float s){
  float n = vnA(uv, vec2(wcell, hcell), s);
  float n2 = vnA(uv, vec2(wcell * 0.37, hcell * 0.6), s + 4.0);
  return n * 0.6 + n2 * 0.4;
}
vec3 srgb2lin(vec3 c){ c = max(c, vec3(0)); return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }

// running-bond brick layout; m in meters inside the tile. Returns signed distance to
// brick border (>0 inside brick, meters). id = brick id (periodic), lp = local pos in brick.
float brickLayout(vec2 m, float S, vec2 nominal, float mortar, out vec2 id, out vec2 lp, out vec2 bs){
  float cols = max(1.0, floor(S / nominal.x + 0.5));
  float rows = max(2.0, 2.0 * floor(S / (2.0 * nominal.y) + 0.5));
  bs = vec2(S / cols, S / rows);
  float row = floor(m.y / bs.y);
  float off = mod(row, 2.0) * 0.5 * bs.x;
  float col = floor((m.x + off) / bs.x);
  lp = vec2(mod(m.x + off, bs.x), mod(m.y, bs.y));
  id = vec2(mod(col, cols), mod(row, rows));
  float dx = min(lp.x, bs.x - lp.x) - mortar * 0.5;
  float dy = min(lp.y, bs.y - lp.y) - mortar * 0.5;
  return min(dx, dy);
}
`;
