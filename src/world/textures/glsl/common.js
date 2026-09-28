// Shared surface building blocks (brick wall, paint chipping, dirt/dust layers).
export const COMMON_GLSL = /* glsl */ `
struct Surf { vec3 albedo; float height; float rough; float metal; float ao; float mask; };
Surf surf0(){ Surf s; s.albedo = vec3(0.5); s.height = 0.0; s.rough = 0.9; s.metal = 0.0; s.ao = 1.0; s.mask = 0.0; return s; }

// Full brick wall layer (old soviet-era red brick w/ lime mortar). m in meters.
void brickWall(vec2 uv, vec2 m, float s0, out vec3 col, out float h, out float rough, out float mortarMask){
  vec2 id, lp, bs;
  vec2 wob = vec2(fbmC(uv, 0.06, 3, s0 + 1.0), fbmC(uv, 0.06, 3, s0 + 2.0)) * 0.0035;
  float d = brickLayout(m + wob, uSize, vec2(0.25, 0.075), 0.011, id, lp, bs);
  float hb = hash12(id + s0 + 3.1), hb2 = hash12(id + s0 + 9.7), hb3 = hash12(id + s0 + 21.3), hb4 = hash12(id + s0 + 33.9);
  // chipped / eroded arrises
  float chipN = fbmC(uv, 0.035, 4, s0 + 5.0) * 0.5 + 0.5;
  float chipBig = smoothstep(0.62, 0.78, fbmC(uv, 0.09, 3, s0 + 6.0) * 0.5 + 0.5);
  float erosion = 0.0015 + smoothstep(0.5, 0.85, chipN) * 0.006 * (0.3 + hb3) + chipBig * 0.012 * step(0.55, hb4);
  float de = d - erosion;
  float inBrick = smoothstep(-0.0006, 0.0008, de);
  mortarMask = 1.0 - inBrick;
  // brick face
  float face = 0.009 + 0.0035 * sat(de / 0.005) * (1.0 - 0.5 * hb2);
  float tilt = (lp.x / bs.x - 0.5) * (hb - 0.5) * 0.0025 + (lp.y / bs.y - 0.5) * (hb2 - 0.5) * 0.0015;
  float pits = 0.0;
  {
    vec4 v = vorC(uv, 0.006, 1.0, s0 + 12.0);
    pits = (1.0 - smoothstep(0.0, 0.28, v.x)) * step(0.72, v.z);
  }
  float grain = fbmC(uv, 0.02, 5, s0 + 14.0);
  float hBrick = face + tilt + grain * 0.0008 - pits * 0.0012 - chipBig * step(0.55, hb4) * 0.002 * (chipN);
  // mortar: sandy, slightly recessed and irregular
  float mortN = fbmC(uv, 0.012, 4, s0 + 17.0);
  float hMort = 0.0025 + mortN * 0.0012 + vnC(uv, 0.003, s0 + 18.0) * 0.0006;
  h = mix(hMort, hBrick, inBrick);
  // colours (sRGB) - aged, sooty soviet red brick
  vec3 cA = vec3(0.44, 0.22, 0.16), cB = vec3(0.54, 0.30, 0.21), cC = vec3(0.30, 0.17, 0.13), cD = vec3(0.56, 0.42, 0.33);
  vec3 bc = mix(cA, cB, hb);
  bc = mix(bc, cC, step(0.8, hb2) * 0.85);
  bc = mix(bc, cD, step(0.92, hb3) * 0.6);
  // fire flash / burnt end on some bricks
  float endT = step(0.7, hb4) * smoothstep(0.35, 0.0, lp.x / bs.x) + step(0.85, hb) * smoothstep(0.6, 1.0, lp.x / bs.x);
  bc = mix(bc, bc * vec3(0.5, 0.47, 0.47), endT * 0.6);
  float mott = fbmC(uv, 0.03, 4, s0 + 20.0);
  bc *= 0.88 + mott * 0.22;
  bc = mix(bc, bc * 0.55, pits);
  // sand-faced speckle
  float sp = vnC(uv, 0.0025, s0 + 22.0);
  bc *= 0.9 + 0.18 * smoothstep(0.3, 0.9, sp);
  // chipped arrises expose lighter, rougher inner clay (only where erosion is significant)
  float chipped = smoothstep(0.003, 0.007, erosion);
  bc = mix(bc, vec3(0.6, 0.38, 0.28), sat(1.0 - de / 0.003) * inBrick * chipped * 0.6);
  // per-brick dirt film
  bc = mix(bc, desat(bc, 0.5) * 0.8, hb3 * 0.35);
  vec3 mc = vec3(0.43, 0.41, 0.38) * (0.85 + mortN * 0.2) * (0.78 + 0.3 * vnC(uv, 0.004, s0 + 23.0));
  mc = mix(mc, vec3(0.3, 0.28, 0.26), smoothstep(0.1, 0.6, fbmC(uv, 0.15, 3, s0 + 24.0)) * 0.6);
  col = mix(mc, bc, inBrick);
  rough = mix(0.97, 0.84 + 0.1 * hb2 - pits * 0.0, inBrick);
}

// Paint chipping mask: returns 0 (intact paint) .. 1 (paint gone). band = primer ring width in mask units.
float chipMask(vec2 uv, float cell, float thresh, float s0){
  vec2 w = vec2(fbmC(uv, cell * 1.3, 3, s0 + 1.0), fbmC(uv, cell * 1.3, 3, s0 + 2.0)) * 0.25 / FQ(cell);
  float n = fbmC(uv + w, cell, 6, s0) * 0.5 + 0.5;
  float big = fbmC(uv, cell * 4.0, 3, s0 + 3.0) * 0.5 + 0.5; // clustered where larger-scale noise is high
  return n + (big - 0.5) * 0.35 - thresh;
}

// Generic rust colour field (sRGB)
vec3 rustColor(vec2 uv, float s0, out float rh){
  float a = fbmC(uv, 0.08, 5, s0 + 1.0) * 0.5 + 0.5;
  float b = fbmC(uv, 0.015, 4, s0 + 2.0) * 0.5 + 0.5;
  vec4 v = vorC(uv, 0.02, 1.0, s0 + 3.0);
  vec3 c = mix(vec3(0.20, 0.12, 0.075), vec3(0.40, 0.23, 0.12), smoothstep(0.25, 0.75, a));
  c = mix(c, vec3(0.12, 0.075, 0.05), smoothstep(0.55, 0.8, b) * 0.7);
  c = mix(c, vec3(0.52, 0.29, 0.13), smoothstep(0.8, 0.97, v.z) * smoothstep(0.3, 0.0, v.x) * 0.6);
  c *= 0.85 + 0.3 * vnC(uv, 0.003, s0 + 4.0);
  rh = (b - 0.5) * 0.0006 + (1.0 - smoothstep(0.0, 0.25, v.x)) * 0.0003 * step(0.5, v.z) + a * 0.0004;
  return c;
}

// Dust / dirt overlay amount 0..1
float dustAmt(vec2 uv, float cell, float s0){
  return sat(fbmC(uv, cell, 5, s0) * 0.9 + 0.5) * (0.7 + 0.3 * vnC(uv, cell * 0.1, s0 + 1.0));
}
`;
