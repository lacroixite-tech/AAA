// Procedural PBR surface recipes. Each recipe is a GLSL `Surf surface(vec2 uv)` evaluated on the GPU
// over one texture tile (uv 0..1 == `size` meters). Albedo is authored in sRGB; height in meters.
// size: tile size in meters (world UV: 1 unit = 1 m). res: texture resolution multiplier.
// nrm: normal strength, ao: cavity AO strength (per meter of depression), aoR: cavity radius (m).

export const RECIPES = {
  // ------------------------------------------------------------------ BRICK
  brick: { size: 2.25, res: 2, nrm: 1.0, ao: 55, aoR: 0.012, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0(); vec2 m = uv * uSize;
  vec3 col; float h, r, mm;
  brickWall(uv, m, 0.0, col, h, r, mm);
  // soot & grime, water run-off streaks, efflorescence
  float grime = sat(warpC(uv, 0.9, 5, 1.0, 30.0) * 1.4 + 0.4);
  float streak = streaksC(uv, 0.05, 0.9, 31.0);
  float stain = smoothstep(0.45, 0.85, streak) * smoothstep(0.2, 0.7, fbmC(uv, 0.75, 3, 32.0) * 0.5 + 0.5);
  col *= mix(1.0, 0.55, grime * 0.7);
  col = mix(col, desat(col, 0.5) * vec3(0.62, 0.6, 0.58), stain * 0.75);
  float soot = smoothstep(0.5, 0.9, warpC(uv, 0.6, 5, 1.5, 35.0) * 0.5 + 0.5);
  col = mix(col, col * vec3(0.4, 0.38, 0.37), soot * 0.6);
  float eff = smoothstep(0.62, 0.85, fbmC(uv, 0.4, 5, 33.0) * 0.5 + 0.5);
  col = mix(col, vec3(0.72, 0.70, 0.66), eff * (0.25 + 0.5 * mm) * 0.8);
  float dust = smoothstep(0.3, 0.9, vnC(uv, 0.02, 34.0)) * 0.12;
  col = mix(col, vec3(0.55, 0.5, 0.45), dust);
  s.albedo = col; s.height = h; s.rough = r - stain * 0.08; s.ao = 1.0 - mm * 0.25;
  return s;
}` },

  // ------------------------------------------------------------------ PLASTER (painted render over brick)
  plaster: { size: 4.5, res: 4, nrm: 1.0, ao: 45, aoR: 0.015, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0(); vec2 m = uv * uSize;
  // stucco micro relief (sprayed render)
  float stucco = fbmC(uv, 0.02, 5, 1.0) * 0.0008 + (vnC(uv, 0.0035, 2.0) - 0.5) * 0.0007 + fbmC(uv, 0.3, 4, 3.0) * 0.002;
  // spalling: irregular patches, denser toward the bottom of the tile (walls are usually UV'd v-up)
  float loss = fbmC(uv, 1.4, 7, 4.0) * 0.5 + 0.5;
  loss += fbmC(uv, 0.06, 3, 5.0) * 0.035;   // jagged edges
  loss += (0.5 - uv.y) * 0.0;
  float plasterGone = smoothstep(0.645, 0.649, loss);
  float renderEdge = smoothstep(0.615, 0.62, loss + fbmC(uv, 0.03, 3, 6.0) * 0.012);
  // isolated paint flakes / blisters
  float flakes = smoothstep(0.7, 0.705, fbmC(uv, 0.12, 6, 7.0) * 0.5 + 0.5 + (fbmC(uv, 0.8, 2, 8.0)) * 0.12);
  float paintGone = max(renderEdge, flakes);
  // paint: faded, repainted in slightly different tones
  vec3 paint = vec3(0.68, 0.66, 0.61);
  float patchN = fbmC(uv, 1.6, 3, 9.0);
  paint = mix(paint, vec3(0.64, 0.63, 0.6), smoothstep(0.15, 0.2, patchN) * 0.9);
  paint *= 0.92 + 0.12 * (fbmC(uv, 0.3, 4, 10.0) * 0.5 + 0.5);
  paint *= 0.96 + 0.06 * vnC(uv, 0.006, 11.0);
  vec3 render = vec3(0.5, 0.49, 0.46) * (0.82 + 0.25 * vnC(uv, 0.004, 12.0)) * (0.9 + 0.12 * fbmC(uv, 0.1, 3, 13.0));
  vec3 bcol; float bh, br, bm; brickWall(uv, m, 50.0, bcol, bh, br, bm);
  bcol = mix(bcol, render * 0.85, bm * 0.6);            // old mortar/render residue in joints
  bcol = mix(bcol, render, smoothstep(0.55, 0.8, fbmC(uv, 0.08, 4, 49.0) * 0.5 + 0.5) * 0.6); // render stuck to brick
  float hp = 0.02 + stucco;
  float hRender = 0.0192 + stucco * 0.5;
  vec3 col = mix(paint, render, paintGone);
  float h = mix(hp, hRender, paintGone);
  float rough = mix(0.88, 0.95, paintGone);
  // broken plaster edge bevel: lighter crumbly lip
  float lip = smoothstep(0.628, 0.646, loss) * (1.0 - plasterGone);
  col = mix(col, vec3(0.6, 0.59, 0.56), lip * 0.4);
  h -= lip * 0.01 * (0.5 + 0.5 * vnC(uv, 0.006, 14.0));
  col = mix(col, bcol, plasterGone);
  h = mix(h, bh, plasterGone);
  rough = mix(rough, br, plasterGone);
  // cracks (jagged, map-like)
  float crMask = smoothstep(0.45, 0.65, fbmC(uv, 1.2, 3, 16.0) * 0.5 + 0.5);
  float cr = crackNet(uv, 0.5, 0.0018, 0.45, 15.0) * crMask;
  float cr2 = crackNet(uv, 0.15, 0.001, 0.4, 17.0) * crMask * smoothstep(0.5, 0.7, fbmC(uv, 0.6, 3, 18.0) * 0.5 + 0.5);
  float crack = max(cr, cr2 * 0.7) * (1.0 - plasterGone);
  col *= 1.0 - crack * 0.45;
  h -= crack * 0.0025;
  // water staining from top, tide marks, grime, soot
  float streak = streaksC(uv, 0.07, 1.4, 19.0);
  float wet = smoothstep(0.45, 0.9, streak) * (0.4 + 0.6 * smoothstep(0.1, 0.6, fbmC(uv, 1.5, 3, 20.0) * 0.5 + 0.5));
  col = mix(col, col * vec3(0.7, 0.66, 0.6), wet * 0.6);
  float grime = sat(fbmC(uv, 1.1, 6, 22.0) * 1.2 + 0.35);
  col *= mix(1.0, 0.62, grime * 0.6);
  col = mix(col, col * vec3(0.8, 0.7, 0.58), smoothstep(0.6, 0.85, streaksC(uv, 0.1, 0.8, 24.0)) * smoothstep(0.6, 0.7, vnC(uv, 1.5, 25.0)) * 0.6);
  col *= 0.94 + 0.1 * vnC(uv, 0.012, 26.0);
  float soot = smoothstep(0.55, 0.9, fbmC(uv, 0.5, 5, 23.0) * 0.5 + 0.5);
  col = mix(col, col * vec3(0.55, 0.53, 0.5), soot * 0.45);
  s.albedo = col; s.height = h; s.rough = rough - wet * 0.06; s.ao = 1.0 - crack * 0.5;
  return s;
}` },

  // ------------------------------------------------------------------ CONCRETE
  concrete: { size: 4.0, res: 2, nrm: 1.0, ao: 60, aoR: 0.01, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0();
  vec3 base = vec3(0.55, 0.54, 0.51);
  float big = fbmC(uv, 1.0, 4, 1.0) * 0.5 + 0.5;
  float mid = fbmC(uv, 0.18, 4, 2.0) * 0.5 + 0.5;
  vec3 col = base * (0.84 + 0.22 * big) * (0.92 + 0.14 * mid);
  col = mix(col, col * vec3(1.03, 1.0, 0.95), smoothstep(0.4, 0.7, fbmC(uv, 0.6, 3, 3.0) * 0.5 + 0.5));
  // aggregate / sand speckles
  vec4 ag = vorC(uv, 0.006, 1.0, 4.0);
  float agg = (1.0 - smoothstep(0.15, 0.45, ag.x)) * step(0.55, ag.z);
  col *= 1.0 + (ag.z - 0.75) * agg * 0.4;
  col *= 0.94 + 0.12 * vnC(uv, 0.0025, 5.0);
  // bug holes (air pores)
  vec4 bh = vorC(uv, 0.03, 1.0, 6.0);
  float poreZone = smoothstep(0.45, 0.75, fbmC(uv, 0.5, 3, 60.0) * 0.5 + 0.5);
  float pore = (1.0 - smoothstep(0.05, 0.08 + 0.12 * fract(bh.z * 13.0), bh.x)) * step(0.93 - poreZone * 0.1, bh.z);
  vec4 bh2 = vorC(uv, 0.008, 1.0, 7.0);
  float pore2 = (1.0 - smoothstep(0.08, 0.2, bh2.x)) * step(0.94 - poreZone * 0.1, bh2.z);
  float h = fbmC(uv, 0.08, 5, 8.0) * 0.0012 + fbmC(uv, 0.01, 3, 9.0) * 0.00035;
  h -= pore * 0.003 + pore2 * 0.0009;
  col *= 1.0 - pore * 0.45 - pore2 * 0.25;
  // formwork board seams (faint horizontal ridges every ~0.5m)
  float by = fract(uv.y * FQ(0.5));
  float seam = smoothstep(0.012, 0.0, abs(by - 0.5)) * (0.5 + 0.5 * vnC(uv, 0.3, 10.0));
  h += seam * 0.0012;
  col *= 1.0 - seam * 0.06;
  // water run-off, rust streaks, grime
  float streak = streaksC(uv, 0.06, 1.2, 11.0);
  float stainMask = smoothstep(0.1, 0.7, fbmC(uv, 1.3, 3, 12.0) * 0.5 + 0.5);
  float wet = smoothstep(0.5, 0.9, streak) * stainMask;
  col = mix(col, col * vec3(0.62, 0.61, 0.6), wet * 0.7);
  float rust = smoothstep(0.78, 0.95, streaksC(uv, 0.04, 0.8, 13.0)) * smoothstep(0.7, 0.8, vnC(uv, 1.0, 14.0));
  col = mix(col, col * vec3(0.85, 0.62, 0.45), rust * 0.6);
  float grime = sat(warpC(uv, 1.4, 5, 1.2, 15.0) * 0.9 + 0.2);
  col *= mix(1.0, 0.68, grime * 0.5);
  // blotchy dark patches (oil, soot)
  float blot = smoothstep(0.72, 0.8, warpC(uv, 0.5, 4, 1.5, 16.0) * 0.5 + 0.5);
  col *= 1.0 - blot * 0.25;
  // cracks
  float crack = crackNet(uv, 0.9, 0.0022, 0.35, 17.0) * smoothstep(0.35, 0.65, fbmC(uv, 1.3, 3, 18.0) * 0.5 + 0.5);
  crack = max(crack, crackNet(uv, 0.25, 0.0012, 0.35, 19.0) * smoothstep(0.55, 0.75, fbmC(uv, 1.0, 3, 20.0) * 0.5 + 0.5));
  col *= 1.0 - crack * 0.7;
  h -= crack * 0.004;
  float rough = 0.9 - wet * 0.12 + agg * 0.03 - blot * 0.1 + (mid - 0.5) * 0.08;
  s.albedo = col; s.height = h; s.rough = rough; s.ao = 1.0 - pore * 0.6;
  return s;
}` },

  concrete_dark: { size: 4.0, res: 2, nrm: 1.0, ao: 60, aoR: 0.01, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0();
  float big = fbmC(uv, 1.0, 4, 41.0) * 0.5 + 0.5;
  float mid = fbmC(uv, 0.15, 4, 42.0) * 0.5 + 0.5;
  vec3 col = vec3(0.36, 0.355, 0.34) * (0.8 + 0.3 * big) * (0.9 + 0.16 * mid);
  vec4 ag = vorC(uv, 0.007, 1.0, 43.0);
  float agg = (1.0 - smoothstep(0.1, 0.5, ag.x)) * step(0.45, ag.z);
  col *= 1.0 + (ag.z - 0.7) * agg * 0.6;
  col *= 0.92 + 0.14 * vnC(uv, 0.0025, 44.0);
  float h = fbmC(uv, 0.06, 5, 45.0) * 0.0015 + agg * 0.0006 + fbmC(uv, 0.012, 3, 46.0) * 0.0004;
  vec4 bh = vorC(uv, 0.02, 1.0, 47.0);
  float pore = (1.0 - smoothstep(0.08, 0.25, bh.x)) * step(0.8, bh.z);
  h -= pore * 0.003; col *= 1.0 - pore * 0.5;
  // damp patches + moss/algae in low areas
  float damp = smoothstep(0.45, 0.75, warpC(uv, 1.2, 4, 1.4, 48.0) * 0.5 + 0.5);
  col = mix(col, col * 0.62, damp * 0.8);
  float moss = smoothstep(0.62, 0.8, fbmC(uv, 0.35, 5, 49.0) * 0.5 + 0.5) * damp;
  col = mix(col, vec3(0.22, 0.24, 0.15) * (0.7 + 0.5 * vnC(uv, 0.004, 50.0)), moss * 0.7);
  float oil = smoothstep(0.75, 0.82, warpC(uv, 0.7, 4, 1.8, 51.0) * 0.5 + 0.5);
  col *= 1.0 - oil * 0.35;
  float crack = crackNet(uv, 0.8, 0.003, 0.45, 52.0) * smoothstep(0.3, 0.6, fbmC(uv, 1.3, 3, 53.0) * 0.5 + 0.5);
  col *= 1.0 - crack * 0.7; h -= crack * 0.005;
  float streak = smoothstep(0.5, 0.9, streaksC(uv, 0.06, 1.0, 54.0));
  col *= 1.0 - streak * 0.2;
  s.albedo = col; s.height = h; s.rough = 0.88 - damp * 0.2 - oil * 0.25 + moss * 0.1; s.ao = 1.0 - pore * 0.5;
  return s;
}` },

  // ------------------------------------------------------------------ ASPHALT
  asphalt: { size: 6.0, res: 2, nrm: 1.0, ao: 70, aoR: 0.008, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0(); vec2 m = uv * uSize;
  // aged, oxidised binder with exposed aggregate
  float age = fbmC(uv, 1.5, 4, 1.0) * 0.5 + 0.5;
  vec3 binder = mix(vec3(0.16, 0.16, 0.16), vec3(0.28, 0.275, 0.265), smoothstep(0.3, 0.75, age));
  vec2 cid, rel;
  vec4 v = vorCi(uv, 0.009, 1.0, 2.0, cid, rel);
  float stone = smoothstep(0.02, 0.12, v.w) * step(0.45, v.z);
  vec3 sh = hash32(cid + 3.0);
  vec3 scol = mix(vec3(0.3, 0.3, 0.3), vec3(0.46, 0.46, 0.45), sh.x);
  scol = mix(scol, vec3(0.42, 0.38, 0.35), step(0.85, sh.y) * 0.6);
  vec4 v2 = vorC(uv, 0.0035, 1.0, 4.0);
  float fine = smoothstep(0.03, 0.12, v2.w) * step(0.4, v2.z);
  vec3 col = binder * (0.85 + 0.3 * vnC(uv, 0.002, 5.0));
  col = mix(col, scol * (0.8 + 0.3 * v2.z), fine * 0.45);
  col = mix(col, scol, stone * (0.35 + 0.4 * age));
  float h = stone * (0.0015 + 0.0015 * sh.z) * smoothstep(0.0, 0.2, v.w) + fine * 0.0006 + fbmC(uv, 0.05, 4, 6.0) * 0.0008;
  float rough = 0.93 - stone * 0.05;
  // patch repairs: rectangular darker, fresher asphalt
  vec2 pc = floor(m / 3.0); vec2 pl = m - pc * 3.0; pc = mod(pc, vec2(floor(uSize / 3.0 + 0.5)));
  vec3 ph = hash32(pc + 60.0);
  vec2 pctr = vec2(0.6) + ph.xy * 1.8; vec2 phs = vec2(0.35) + hash22(pc + 61.0) * vec2(0.9, 0.6);
  vec2 pd = abs(pl - pctr) - phs;
  float pdist = max(pd.x, pd.y);
  float pedge = fbmC(uv, 0.08, 3, 62.0) * 0.02;
  float patchM = step(0.7, ph.z) * smoothstep(0.004, -0.004, pdist + pedge);
  vec3 pcol = vec3(0.17, 0.17, 0.165) * (0.85 + 0.3 * vnC(uv, 0.003, 63.0));
  pcol = mix(pcol, vec3(0.3, 0.3, 0.29), fine * 0.3);
  col = mix(col, pcol, patchM);
  h = mix(h, 0.0012 + fine * 0.0004 + fbmC(uv, 0.1, 3, 64.0) * 0.0015, patchM);
  rough = mix(rough, 0.82, patchM);
  float seal = smoothstep(0.03, 0.0, abs(pdist + pedge)) * step(0.7, ph.z) * (0.6 + 0.4 * vnC(uv, 0.05, 76.0));
  col = mix(col, vec3(0.05), seal * 0.9); rough = mix(rough, 0.45, seal); h += seal * 0.0006;
  // alligator cracking in fatigued areas
  float fat = smoothstep(0.55, 0.75, warpC(uv, 1.8, 4, 1.0, 65.0) * 0.5 + 0.5) * (1.0 - patchM);
  vec2 wq = uv + vec2(fbmC(uv, 0.3, 3, 66.0), fbmC(uv, 0.3, 3, 67.0)) * 0.02;
  vec4 ac = vorC(wq, 0.22, 0.9, 68.0);
  float alli = (1.0 - smoothstep(0.0, 0.035 + 0.02 * vnC(uv, 0.05, 69.0), ac.w)) * fat;
  // long cracks, some tar-sealed
  float lc = crackNet(uv, 1.5, 0.005, 0.5, 70.0);
  float lcMask = smoothstep(0.35, 0.6, fbmC(uv, 2.0, 3, 71.0) * 0.5 + 0.5);
  float sealed = step(0.5, vnC(uv, 3.0, 72.0));
  float openC = max(alli, lc * lcMask * (1.0 - sealed));
  col *= 1.0 - openC * 0.75; h -= openC * 0.006;
  float tarLine = crackNet(uv, 1.5, 0.035, 0.5, 70.0) * lcMask * sealed;
  col = mix(col, vec3(0.04), tarLine * 0.95); rough = mix(rough, 0.4, tarLine); h += tarLine * 0.0008;
  // oil stains & tyre polish
  float oil = smoothstep(0.7, 0.85, warpC(uv, 0.8, 4, 2.0, 74.0) * 0.5 + 0.5);
  col *= 1.0 - oil * 0.45; rough -= oil * 0.25;
  float dust = smoothstep(0.55, 0.85, fbmC(uv, 0.6, 4, 75.0) * 0.5 + 0.5);
  col = mix(col, vec3(0.42, 0.39, 0.35), dust * 0.35); rough += dust * 0.04;
  s.albedo = col; s.height = h; s.rough = rough; s.ao = 1.0 - openC * 0.6;
  return s;
}` },

  // ------------------------------------------------------------------ METALS
  metal_painted: { size: 2.0, res: 2, nrm: 1.0, ao: 40, aoR: 0.004, paint: [0.30, 0.34, 0.29], glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0();
  float c = chipMask(uv, 0.12, 0.71, 1.0);
  float chip = smoothstep(0.0, 0.003, c);
  float primer = smoothstep(-0.014, -0.012, c) * (1.0 - chip);
  // paint (grey value, tinted in shader by uPaint through the albedo alpha mask)
  float pv = 0.8 + 0.08 * (fbmC(uv, 0.4, 4, 3.0) * 0.5 + 0.5) + 0.04 * vnC(uv, 0.004, 4.0);
  float fade = sat(fbmC(uv, 0.9, 4, 5.0) * 0.9 + 0.4);           // chalky UV-faded areas
  vec3 paintCol = vec3(pv) * (1.0 + fade * 0.25);
  float rh; vec3 rc = rustColor(uv, 10.0, rh);
  float bare = smoothstep(0.6, 0.85, vnC(uv, 0.02, 6.0)) * smoothstep(0.015, 0.04, c);
  vec3 under = mix(rc, vec3(0.5, 0.49, 0.47), bare);
  vec3 col = mix(paintCol, vec3(0.5, 0.42, 0.38), primer * 0.8);
  col = mix(col, under, chip);
  s.mask = (1.0 - chip) * (1.0 - primer * 0.8);
  // rust run-off below chips (stays inside paint -> tinted & darkened)
  float bleed = 0.0;
  float jx = (vnC(uv, 0.05, 20.0) - 0.5) * 0.004;
  for (int i = 1; i <= 12; i++){
    float o = float(i) * 0.0045;
    bleed += smoothstep(-0.01, 0.01, chipMask(uv + vec2(jx * float(i) * 0.2, o), 0.12, 0.71, 1.0)) * (1.0 - float(i) / 13.0);
  }
  bleed = sat(bleed * 0.35) * smoothstep(0.3, 0.8, streaksC(uv, 0.008, 0.25, 21.0)) * (1.0 - chip);
  col = mix(col, col * vec3(0.62, 0.42, 0.28), bleed * 0.8);
  // light scratches through paint
  float sc = smoothstep(0.992, 1.0, 1.0 - abs(gnoise(vec2(uv.x * FQ(0.9), uv.y * FQ(0.002)), vec2(FQ(0.9), FQ(0.002)), 22.0))) * step(0.8, vnC(uv, 0.3, 23.0));
  vec2 dg = vec2(uv.x + uv.y, uv.x - uv.y);
  sc = max(sc, smoothstep(0.992, 1.0, 1.0 - abs(gnoise(vec2(dg.x * FQ(0.003), dg.y * FQ(0.8)), vec2(FQ(0.003), FQ(0.8)), 24.0))) * step(0.78, vnC(uv, 0.25, 25.0)));
  sc *= 1.0 - chip;
  col = mix(col, col * 0.75, sc * 0.6);
  // dirt: darker film + dust
  float dirt = sat(fbmC(uv, 0.7, 5, 30.0) * 0.8 + 0.3);
  col *= mix(1.0, 0.7, dirt * 0.5);
  float dust = dustAmt(uv, 0.3, 31.0);
  col = mix(col, col * 0.7 + vec3(0.12, 0.11, 0.1), dust * 0.35);
  float h = -chip * 0.00025 + fbmC(uv, 0.008, 3, 32.0) * 0.00004 + chip * rh * 0.6 - sc * 0.00006;
  float rough = mix(0.5 + fade * 0.2, mix(0.88, 0.45, bare), chip) + dust * 0.15 + dirt * 0.08;
  s.albedo = col; s.height = h; s.rough = rough; s.metal = chip * bare * 0.9 + sc * 0.3;
  return s;
}` },

  metal_rusty: { size: 2.0, res: 2, nrm: 1.2, ao: 50, aoR: 0.004, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0();
  float rh; vec3 col = rustColor(uv, 1.0, rh);
  float blister = fbmC(uv, 0.03, 5, 2.0) * 0.5 + 0.5;
  vec4 pv = vorC(uv, 0.012, 1.0, 3.0);
  float pit = (1.0 - smoothstep(0.0, 0.35, pv.x)) * step(0.6, pv.z);
  float h = rh * 1.5 + blister * 0.0008 - pit * 0.0006;
  col *= 1.0 - pit * 0.35;
  // flaky scale plates
  vec4 fl = vorC(uv, 0.035, 0.9, 4.0);
  float plate = step(0.45, fl.z) * smoothstep(0.0, 0.08, fl.w) * smoothstep(0.3, 0.7, fbmC(uv, 0.3, 3, 5.0) * 0.5 + 0.5);
  h += plate * (0.0004 + 0.0004 * fl.z);
  col = mix(col, col * vec3(1.12, 1.04, 0.96), plate * 0.35);
  // remnant old paint (blistered, rust bleeding through)
  float c = chipMask(uv, 0.22, 0.55, 6.0);
  float paint = 1.0 - smoothstep(-0.004, 0.0, c);
  vec3 pcol = vec3(0.24, 0.26, 0.22) * (0.8 + 0.3 * vnC(uv, 0.1, 7.0)) * (0.9 + 0.15 * vnC(uv, 0.004, 17.0));
  float through = smoothstep(0.45, 0.8, fbmC(uv, 0.04, 5, 8.0) * 0.5 + 0.5);
  pcol = mix(pcol, col * 1.1, through * 0.65);
  float blist = step(0.8, vorC(uv, 0.01, 1.0, 18.0).z) * (1.0 - smoothstep(0.1, 0.4, vorC(uv, 0.01, 1.0, 18.0).x));
  pcol = mix(pcol, vec3(0.42, 0.26, 0.14), blist * 0.6);
  float edge = smoothstep(-0.018, -0.002, c) * paint;
  col = mix(col, pcol, paint);
  col = mix(col, col * 1.25 + 0.03, edge * 0.4);
  h += paint * 0.0004 + edge * 0.00025 + blist * paint * 0.0003;
  // vertical run streaks + grime
  float st = smoothstep(0.55, 0.9, streaksC(uv, 0.02, 0.5, 9.0));
  col = mix(col, col * vec3(0.72, 0.6, 0.52), st * 0.5);
  float grime = sat(fbmC(uv, 0.8, 4, 11.0) * 0.8 + 0.3);
  col *= mix(1.0, 0.7, grime * 0.5);
  float bare = smoothstep(0.86, 0.92, fbmC(uv, 0.08, 4, 10.0) * 0.5 + 0.5) * (1.0 - paint);
  col = mix(col, vec3(0.36, 0.35, 0.34), bare);
  s.albedo = col; s.height = h; s.rough = mix(mix(0.92, 0.7, paint), 0.5, bare) - plate * 0.03;
  s.metal = bare * 0.85 + (1.0 - paint) * 0.05; s.ao = 1.0 - pit * 0.4;
  return s;
}` },

  metal_bare: { size: 1.0, res: 1, nrm: 1.0, ao: 30, aoR: 0.003, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0();
  // galvanised / brushed steel
  float brush = gnoise(vec2(uv.x * FQ(0.4), uv.y * FQ(0.0015)), vec2(FQ(0.4), FQ(0.0015)), 1.0) * 0.5 + 0.5;
  float brush2 = gnoise(vec2(uv.x * FQ(0.08), uv.y * FQ(0.0006)), vec2(FQ(0.08), FQ(0.0006)), 2.0) * 0.5 + 0.5;
  vec2 sid, rel; vec4 sp = vorCi(uv, 0.03, 1.0, 3.0, sid, rel);
  float spangle = hash12(sid + 4.0);
  vec3 col = vec3(0.66, 0.66, 0.67) * (0.95 + 0.05 * spangle) * (0.95 + 0.07 * brush + 0.05 * brush2);
  float rough = 0.36 + 0.06 * spangle + 0.08 * brush2;
  float smudge = smoothstep(0.45, 0.8, warpC(uv, 0.3, 4, 1.5, 5.0) * 0.5 + 0.5);
  col *= 1.0 - smudge * 0.12; rough += smudge * 0.12;
  // white rust (zinc oxide) and red rust spots
  float zinc = smoothstep(0.76, 0.88, fbmC(uv, 0.08, 5, 6.0) * 0.5 + 0.5);
  col = mix(col, vec3(0.72, 0.72, 0.7), zinc * 0.7);
  float rh; vec3 rc = rustColor(uv, 7.0, rh);
  float rs = smoothstep(0.76, 0.83, fbmC(uv, 0.12, 5, 8.0) * 0.5 + 0.5);
  col = mix(col, rc, rs);
  float sc = smoothstep(0.98, 1.0, 1.0 - abs(gnoise(vec2((uv.x + uv.y) * FQ(0.002), (uv.x - uv.y) * FQ(0.5)), vec2(FQ(0.002), FQ(0.5)), 9.0))) * step(0.6, vnC(uv, 0.2, 10.0));
  col *= 1.0 + sc * 0.15; rough -= sc * 0.1;
  float dust = dustAmt(uv, 0.4, 11.0) * 0.5;
  col = mix(col, vec3(0.45, 0.43, 0.4), dust * 0.4); rough += dust * 0.2;
  s.albedo = col; s.height = brush * 0.00003 + rs * rh - sc * 0.00004 + zinc * 0.0001;
  s.rough = mix(rough, 0.9, max(rs, zinc * 0.8)); s.metal = (1.0 - rs) * (1.0 - zinc * 0.7) * (1.0 - dust * 0.4);
  return s;
}` },

  // ------------------------------------------------------------------ WOOD
  wood: { size: 2.0, res: 2, nrm: 1.0, ao: 50, aoR: 0.006, glsl: /* glsl */ `
float woodGrain(vec2 uv, float s0, out float late){
  // grain runs along u. rings = warped distance along v.
  float warp = fbmA(uv, vec2(0.5, 0.08), 4, s0) * 0.6 + fbmA(uv, vec2(0.12, 0.03), 3, s0 + 1.0) * 0.15;
  float ringF = FQ(0.006);
  float t = uv.y * ringF + warp * 6.0;
  float ring = fract(t);
  late = smoothstep(0.55, 0.8, ring) * smoothstep(1.0, 0.85, ring);
  float fibre = gnA(uv, vec2(0.15, 0.0012), s0 + 2.0) * 0.5 + 0.5;
  return fibre;
}
Surf surface(vec2 uv){
  Surf s = surf0();
  float late; float fibre = woodGrain(uv, 1.0, late);
  float w = fbmC(uv, 0.5, 4, 3.0) * 0.5 + 0.5;
  // weathered: grey silver surface with brown underneath
  vec3 brown = vec3(0.42, 0.31, 0.21), grey = vec3(0.50, 0.47, 0.42);
  float weather = smoothstep(0.25, 0.7, w);
  vec3 col = mix(brown, grey, weather);
  col *= 0.86 + 0.16 * fibre;
  col = mix(col, col * vec3(0.62, 0.58, 0.55), late * 0.75);
  // splits / checks along grain
  float split = smoothstep(0.965, 0.995, 1.0 - abs(gnA(uv, vec2(0.35, 0.02), 4.0))) * smoothstep(0.55, 0.75, vnA(uv, vec2(0.6, 0.06), 5.0));
  // knots
  vec2 kid, krel; vec4 kv = vorCi(uv * vec2(1.0, 1.0), 0.35, 0.9, 6.0, kid, krel);
  float kr = length(krel * vec2(1.0, 2.2));
  float knot = step(0.7, kv.z) * (1.0 - smoothstep(0.03, 0.08, kr));
  float knotRing = step(0.7, kv.z) * (1.0 - smoothstep(0.08, 0.2, kr));
  col = mix(col, vec3(0.2, 0.13, 0.08), knot * 0.85);
  col = mix(col, col * 0.75, knotRing * (0.5 + 0.5 * sin(kr * 180.0)) * 0.5);
  col *= 1.0 - split * 0.75;
  float dirt = sat(warpC(uv, 0.8, 4, 1.2, 7.0) * 0.8 + 0.2);
  col *= mix(1.0, 0.72, dirt * 0.45);
  float h = late * 0.0007 + fibre * 0.00025 - split * 0.0035 + knot * 0.0004 + fbmC(uv, 0.2, 3, 8.0) * 0.001;
  s.albedo = col; s.height = h; s.rough = 0.82 + weather * 0.1 - knot * 0.1; s.ao = 1.0 - split * 0.6;
  return s;
}` },

  wood_planks: { size: 2.0, res: 2, nrm: 1.0, ao: 45, aoR: 0.006, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0(); vec2 m = uv * uSize;
  float rows = FQ(0.16); float pw = uSize / rows;
  float row = floor(m.y / pw); float ly = m.y - row * pw;
  // one or two butt joints per row
  float j1 = hash12(vec2(row, 7.0)) * uSize;
  float two = step(0.45, hash12(vec2(row, 9.0)));
  float j2 = mod(j1 + uSize * (0.3 + 0.4 * hash12(vec2(row, 8.0))), uSize);
  float ja = two > 0.5 ? min(j1, j2) : j1, jb = two > 0.5 ? max(j1, j2) : j1;
  float dj1 = abs(mod(m.x - j1 + uSize * 0.5, uSize) - uSize * 0.5);
  float dj2 = abs(mod(m.x - j2 + uSize * 0.5, uSize) - uSize * 0.5);
  float dj = two > 0.5 ? min(dj1, dj2) : dj1;
  float seg = (two > 0.5 && m.x >= ja && m.x < jb) ? 1.0 : 0.0;
  vec2 pid = vec2(row, seg);
  float ph = hash12(pid + 11.0), ph2 = hash12(pid + 12.0), ph3 = hash12(pid + 13.0);
  float edgeD = min(min(ly, pw - ly), dj);
  float gap = 0.003 + 0.003 * ph2;
  float inP = smoothstep(gap * 0.5, gap * 0.5 + 0.0008, edgeD);
  // grain (per-plank offset so neighbours differ)
  vec2 guv = uv + vec2(ph * 0.37, ph2 * 0.21);
  float warp = fbmA(guv, vec2(1.0, 0.12), 4, 20.0) * 0.8 + fbmA(guv, vec2(0.25, 0.04), 3, 28.0) * 0.2;
  float t = (m.y + warp * 0.012) * 2.0 * FQ(0.012) / uSize;
  float ring = fract(t + ph * 5.0);
  float late = smoothstep(0.45, 0.85, ring) * smoothstep(1.0, 0.9, ring);
  float fibre = fbmA(guv, vec2(0.25, 0.002), 3, 21.0) * 0.5 + 0.5;
  float fibre2 = gnA(guv, vec2(0.06, 0.0009), 29.0) * 0.5 + 0.5;
  vec3 brown = mix(vec3(0.40, 0.32, 0.24), vec3(0.32, 0.25, 0.19), ph);
  vec3 grey = mix(vec3(0.45, 0.43, 0.40), vec3(0.35, 0.34, 0.32), ph2);
  float weather = sat(0.65 + ph3 * 0.35 + fbmC(uv, 0.4, 4, 22.0) * 0.6);
  vec3 col = mix(brown, grey, weather);
  col *= 0.8 + 0.2 * fibre + 0.1 * fibre2;
  col = mix(col, col * vec3(0.78, 0.74, 0.7), late * 0.4);
  float grainDirt = smoothstep(0.62, 0.8, fibre) * weather;
  col *= 1.0 - grainDirt * 0.25;
  // old flaking paint on some boards
  float painted = step(0.8, ph3);
  float pm = painted * smoothstep(0.5, 0.52, fbmA(uv, vec2(0.3, 0.012), 6, 23.0) * 0.5 + 0.5 + (ph - 0.5) * 0.2 + (fibre - 0.5) * 0.3);
  col = mix(col, vec3(0.36, 0.42, 0.4) * (0.8 + 0.2 * fibre) * (0.85 + 0.25 * vnC(uv, 0.02, 24.0)), pm);
  // splits along grain
  float split = smoothstep(0.985, 0.998, 1.0 - abs(gnA(guv, vec2(0.5, 0.03), 25.0))) * smoothstep(0.7, 0.85, vnA(guv, vec2(0.8, 0.08), 26.0));
  col *= 1.0 - split * 0.7;
  // nails near joints + rust bleed
  float ny = min(abs(ly - pw * 0.25), abs(ly - pw * 0.75));
  float nd = length(vec2(abs(dj - 0.03), ny));
  float nail = 1.0 - smoothstep(0.0028, 0.004, nd);
  float nstreak = (1.0 - smoothstep(0.002, 0.012, abs(dj - 0.03))) * smoothstep(0.05, 0.0, ny) * 0.8;
  col = mix(col, col * vec3(0.6, 0.45, 0.35), nstreak * 0.6);
  col = mix(col, vec3(0.18, 0.13, 0.1), nail);
  // edge wear & dirt accumulation near gaps
  float edgeWear = smoothstep(0.015, 0.0, edgeD - gap * 0.5);
  col *= 1.0 - edgeWear * 0.3;
  float dirt = sat(fbmC(uv, 0.8, 4, 27.0) * 0.8 + 0.2);
  col *= mix(1.0, 0.72, dirt * 0.45);
  col = mix(vec3(0.04, 0.035, 0.03), col, inP);
  float bow = (ly / pw - 0.5); bow = -bow * bow * 0.003 * ph2;
  float h = inP * (0.006 + bow + (ph - 0.5) * 0.0015 - edgeWear * 0.0012 + late * 0.0004 + fibre * 0.0003 + fibre2 * 0.0002 - split * 0.003 + pm * 0.0002 + nail * 0.0003);
  s.albedo = col; s.height = h; s.rough = mix(0.82 + weather * 0.1 - pm * 0.15, 1.0, 1.0 - inP) - nail * 0.3;
  s.metal = nail * 0.3;
  s.ao = mix(0.35, 1.0, inP);
  return s;
}` },

  // ------------------------------------------------------------------ GROUND
  dirt: { size: 4.0, res: 2, nrm: 1.3, ao: 40, aoR: 0.02, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0();
  float dry = smoothstep(0.3, 0.75, warpC(uv, 1.2, 5, 1.0, 1.0) * 0.5 + 0.5);
  vec3 col = mix(vec3(0.27, 0.21, 0.155), vec3(0.47, 0.41, 0.33), dry);
  col *= 0.85 + 0.25 * (fbmC(uv, 0.1, 5, 2.0) * 0.5 + 0.5);
  col *= 0.9 + 0.15 * vnC(uv, 0.003, 3.0);
  float clod = fbmC(uv, 0.08, 6, 4.0);
  float crumbs = vnC(uv, 0.004, 14.0);
  float h = clod * 0.01 + fbmC(uv, 0.6, 3, 5.0) * 0.02 + crumbs * 0.0012;
  col *= 0.9 + 0.2 * crumbs;
  // pebbles
  vec2 id, rel; vec4 v = vorCi(uv, 0.035, 1.0, 6.0, id, rel);
  float pr = 0.18 + 0.3 * hash12(id + 7.0);
  float angular = v.x + abs(dot(rel, normalize(hash22(id + 17.0) - 0.5))) * 0.35;
  float peb = step(0.8, v.z) * (1.0 - smoothstep(pr * 0.85, pr, angular));
  vec3 ph = hash32(id + 8.0);
  vec3 pcol = mix(vec3(0.38, 0.36, 0.33), vec3(0.6, 0.55, 0.48), ph.x) * (0.8 + 0.3 * vnC(uv, 0.004, 9.0));
  pcol = mix(pcol, vec3(0.45, 0.3, 0.22), step(0.85, ph.y));
  float dome = sqrt(sat(1.0 - (angular / pr) * (angular / pr)));
  col = mix(col, pcol * (0.75 + 0.35 * dome), peb);
  h += peb * dome * 0.006 * (0.6 + ph.z);
  vec4 v2 = vorC(uv, 0.012, 1.0, 10.0);
  float peb2 = step(0.82, v2.z) * (1.0 - smoothstep(0.2, 0.32, v2.x));
  col = mix(col, vec3(0.5, 0.47, 0.42) * (0.7 + 0.5 * v2.y), peb2 * 0.8);
  h += peb2 * 0.002;
  // twigs / dry grass bits
  float tw = smoothstep(0.975, 0.995, 1.0 - abs(gnoise(vec2((uv.x + uv.y) * FQ(0.25), (uv.x - uv.y) * FQ(0.004)), vec2(FQ(0.25), FQ(0.004)), 11.0))) * step(0.75, vnC(uv, 0.15, 12.0));
  col = mix(col, vec3(0.55, 0.47, 0.33), tw * 0.8); h += tw * 0.001;
  float damp = (1.0 - dry) * smoothstep(0.4, 0.7, fbmC(uv, 0.5, 3, 13.0) * 0.5 + 0.5);
  col *= 1.0 - damp * 0.25;
  s.albedo = col; s.height = h; s.rough = 0.97 - damp * 0.2 - peb * 0.12;
  return s;
}` },

  gravel: { size: 2.0, res: 2, nrm: 1.3, ao: 40, aoR: 0.008, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0();
  vec3 col = vec3(0.2, 0.18, 0.16) * (0.8 + 0.3 * vnC(uv, 0.004, 1.0));
  float h = 0.0;
  float occ = 1.0;
  for (int L = 0; L < 3; L++){
    float cell = L == 0 ? 0.03 : (L == 1 ? 0.018 : 0.011);
    vec2 id, rel; vec4 v = vorCi(uv, cell, 1.0, 2.0 + float(L) * 5.0, id, rel);
    vec3 ph = hash32(id + float(L) * 3.0 + 1.0);
    // angular stones: facet planes
    vec2 dir = normalize(hash22(id + 9.0) - 0.5);
    float facet = abs(dot(rel, dir)) * 0.6 + abs(dot(rel, vec2(-dir.y, dir.x))) * 0.3;
    float r = sat(v.w / (0.25 + 0.2 * ph.z));
    float stone = smoothstep(0.02, 0.12, v.w) * step(float(L) * 0.25, ph.y);
    float hh = (0.004 + 0.004 * ph.x) * cell / 0.02 * (sqrt(r) - facet * 0.4) + float(2 - L) * 0.002;
    vec3 sc = mix(vec3(0.48, 0.46, 0.43), vec3(0.66, 0.62, 0.56), ph.x);
    sc = mix(sc, vec3(0.42, 0.38, 0.35), step(0.75, ph.z));
    sc = mix(sc, vec3(0.58, 0.5, 0.42), step(0.9, ph.y) * 0.8);
    sc *= 0.85 + 0.25 * vnC(uv, 0.003, 30.0 + float(L));
    sc *= 0.85 + 0.3 * sqrt(r);
    float take = stone * step(h, hh);
    col = mix(col, sc, take);
    h = mix(h, hh, take);
  }
  float dust = smoothstep(0.4, 0.8, fbmC(uv, 0.4, 4, 40.0) * 0.5 + 0.5);
  col = mix(col, vec3(0.52, 0.48, 0.42), dust * 0.35);
  s.albedo = col; s.height = h; s.rough = 0.82 + dust * 0.1;
  return s;
}` },

  grass: { size: 2.0, res: 2, nrm: 1.2, ao: 40, aoR: 0.006, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0();
  // soil base
  vec3 soil = mix(vec3(0.25, 0.2, 0.15), vec3(0.4, 0.34, 0.26), vnC(uv, 0.1, 1.0));
  float cover = smoothstep(0.25, 0.55, warpC(uv, 0.7, 5, 1.0, 2.0) * 0.5 + 0.5);
  vec3 col = soil * (0.8 + 0.3 * vnC(uv, 0.005, 3.0));
  float h = fbmC(uv, 0.1, 4, 4.0) * 0.004;
  // blade layers along several integer-lattice directions (keeps tiling)
  vec2 dirs[6] = vec2[6](vec2(1,0), vec2(0,1), vec2(1,1), vec2(1,-1), vec2(2,1), vec2(1,-2));
  float top = 0.0; vec3 bcol = vec3(0);
  for (int i = 0; i < 6; i++){
    vec2 d = dirs[i]; vec2 dn = vec2(-d.y, d.x);
    float fa = FQ(0.05), fb = FQ(0.0028);
    float pyy = dot(uv, dn) * fb;
    float cellB = mod(floor(pyy), fb);
    float rowOff = hash12(vec2(cellB, float(i) + 0.5));
    vec2 p = vec2(dot(uv, d) * fa + rowOff, pyy);
    float cellA = mod(floor(p.x), fa);
    float hsh = hash12(vec2(cellA, cellB) + float(i) * 13.0);
    float bl = 1.0 - abs(fract(p.y) - 0.5) * 2.0;
    float len = fract(p.x);
    float blade = smoothstep(0.55, 0.95, bl) * smoothstep(0.0, 0.25, len) * (1.0 - len * 0.6) * step(0.35, hsh);
    float bh = blade * (0.3 + 0.7 * hsh) * (1.0 - len);
    vec3 gc = mix(vec3(0.33, 0.36, 0.17), vec3(0.58, 0.54, 0.33), hash12(vec2(hsh, 3.0)));
    gc = mix(gc, vec3(0.47, 0.4, 0.28), step(0.8, hash12(vec2(hsh, 5.0))));
    gc *= 0.7 + 0.6 * len;
    float take = step(top, bh) * step(0.01, bh);
    bcol = mix(bcol, gc, take); top = max(top, bh);
  }
  float clump = fbmC(uv, 0.07, 4, 70.0) * 0.5 + 0.5;
  float g = smoothstep(0.02, 0.2, top) * cover * smoothstep(0.25, 0.45, clump + 0.2);
  bcol *= 0.6 + 0.6 * clump;
  col = mix(col, bcol, g);
  col *= mix(1.0, 0.8 + 0.2 * top, cover);
  h += top * 0.006 * cover;
  float dry = smoothstep(0.35, 0.75, fbmC(uv, 0.5, 4, 60.0) * 0.5 + 0.5);
  h += clump * 0.01 * cover;
  col = mix(col, desat(col, 0.5) * vec3(1.15, 1.05, 0.85), dry * 0.5);
  s.albedo = col; s.height = h; s.rough = 0.9;
  return s;
}` },

  rubble: { size: 3.0, res: 2, nrm: 1.2, ao: 25, aoR: 0.025, triplanar: true, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0();
  // fine debris / dust matrix
  vec3 dustC = vec3(0.56, 0.54, 0.5);
  vec3 col = dustC * (0.75 + 0.35 * vnC(uv, 0.005, 1.0)) * (0.85 + 0.2 * (fbmC(uv, 0.2, 4, 2.0) * 0.5 + 0.5));
  vec4 gr = vorC(uv, 0.008, 1.0, 60.0);
  col *= 0.85 + 0.25 * gr.z * smoothstep(0.0, 0.1, gr.w);
  float h = fbmC(uv, 0.1, 4, 2.0) * 0.008 + gr.z * 0.0015 * smoothstep(0.0, 0.15, gr.w);
  for (int L = 0; L < 3; L++){
    float cell = L == 0 ? 0.16 : (L == 1 ? 0.07 : 0.03);
    vec2 id, rel; vec4 v = vorCi(uv, cell, 1.0, 3.0 + float(L) * 7.0, id, rel);
    vec3 ph = hash32(id + float(L) * 5.0 + 2.0);
    vec2 slope = (hash22(id + 4.0) - 0.5) * 1.4;
    float shrink = 0.1 + 0.15 * ph.x; // chunks don't fill their cells: debris between them
    float inside = smoothstep(shrink, shrink + 0.04, v.w);
    float hh = (cell * (0.18 + 0.3 * ph.x) + dot(rel, slope) * cell * 0.9) * inside;
    hh += fbmC(uv, cell * 0.3, 3, 20.0 + float(L)) * cell * 0.05;
    float present = step(0.35 + float(L) * 0.1, ph.y);
    vec3 cc;
    float t = ph.z;
    if (t < 0.55) cc = vec3(0.52, 0.51, 0.48) * (0.8 + 0.3 * vnC(uv, 0.004, 30.0));             // concrete
    else if (t < 0.72) cc = mix(vec3(0.44, 0.26, 0.19), vec3(0.52, 0.32, 0.24), ph.x);         // brick
    else if (t < 0.84) cc = vec3(0.66, 0.64, 0.58);                                              // plaster
    else if (t < 0.93) cc = vec3(0.3, 0.3, 0.29);                                                // asphalt / dark stone
    else cc = vec3(0.36, 0.3, 0.24);                                                             // wood / earth
    cc *= 0.85 + 0.3 * (fbmC(uv, 0.02, 3, 40.0) * 0.5 + 0.5);
    // broken faces are lighter and cleaner, top faces dusty
    float fresh = smoothstep(0.1, 0.5, dot(normalize(vec2(1, 1)), slope));
    cc = mix(cc, cc * 1.15, fresh * 0.4);
    float take = present * step(h, hh) * inside;
    col = mix(col, cc, take);
    h = mix(h, hh, take);
  }
  // pervasive dust coat
  float dust = smoothstep(0.25, 0.75, fbmC(uv, 0.3, 4, 50.0) * 0.5 + 0.5);
  col = mix(col, dustC * 1.05, dust * 0.45);
  col = desat(col, 0.15);
  s.albedo = col; s.height = h; s.rough = 0.93;
  return s;
}` },

  // ------------------------------------------------------------------ FABRICS
  sandbag: { size: 1.0, res: 4, nrm: 1.0, ao: 60, aoR: 0.002, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0();
  float T = FQ(0.0042); // thread pitch
  vec2 wv = vec2(fbmC(uv, 0.05, 3, 1.0), fbmC(uv, 0.05, 3, 2.0)) * 0.25 / T;
  vec2 p = uv * T + wv * T * 0.0 + vec2(fbmC(uv, 0.03, 2, 3.0), fbmC(uv, 0.03, 2, 4.0)) * 0.35;
  vec2 c = floor(p), f = fract(p);
  float thx = 0.75 + 0.35 * hash12(vec2(mod(c.x, T), 5.0)); // warp thickness per thread
  float thy = 0.75 + 0.35 * hash12(vec2(mod(c.y, T), 6.0));
  float warpP = pow(sat(sin(PI * f.x) * thx), 0.6);
  float weftP = pow(sat(sin(PI * f.y) * thy), 0.6);
  float over = mod(c.x + c.y, 2.0);
  float wUnd = sin(PI * f.y), fUnd = sin(PI * f.x);
  float hWarp = warpP * (0.5 + 0.5 * (over > 0.5 ? wUnd : 1.0 - wUnd));
  float hWeft = weftP * (0.5 + 0.5 * (over > 0.5 ? 1.0 - fUnd : fUnd));
  float h = max(hWarp, hWeft);
  float isWarp = step(hWeft, hWarp);
  float hole = (1.0 - smoothstep(0.12, 0.35, h));
  float fuzz = fbmC(uv, 0.004, 3, 7.0);
  vec3 jute = mix(vec3(0.48, 0.42, 0.31), vec3(0.56, 0.49, 0.37), hash12(vec2(mod(isWarp > 0.5 ? c.x : c.y, T), isWarp)));
  jute *= 0.8 + 0.25 * h + fuzz * 0.12;
  vec3 col = mix(jute, vec3(0.12, 0.1, 0.08), hole * 0.85);
  // dirt, mud, stains
  float mud = smoothstep(0.45, 0.85, warpC(uv, 0.4, 5, 1.5, 8.0) * 0.5 + 0.5);
  col = mix(col, vec3(0.33, 0.28, 0.21) * (0.8 + 0.3 * h), mud * 0.45);
  float wet = smoothstep(0.55, 0.8, fbmC(uv, 0.3, 4, 9.0) * 0.5 + 0.5);
  col *= 1.0 - wet * 0.25;
  float dust = smoothstep(0.3, 0.9, fbmC(uv, 0.2, 4, 10.0) * 0.5 + 0.5);
  col = mix(col, vec3(0.62, 0.57, 0.48), dust * 0.25 * h);
  // lumpy fill under fabric
  float lump = fbmC(uv, 0.12, 4, 11.0) * 0.004;
  s.albedo = col; s.height = h * 0.0009 + lump + fuzz * 0.00008; s.rough = 0.95 - wet * 0.1; s.ao = 1.0 - hole * 0.3;
  return s;
}` },

  tarp: { size: 2.0, res: 2, nrm: 1.0, ao: 40, aoR: 0.01, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0();
  float T = FQ(0.0018);
  vec2 p = uv * T;
  float weave = (sin(p.x * PI) * sin(p.y * PI)) * (mod(floor(p.x) + floor(p.y), 2.0) * 2.0 - 1.0);
  float folds = ridgedC(uv, 0.5, 4, 1.0);
  float folds2 = fbmC(uv, 0.25, 4, 2.0);
  float h = folds * 0.008 + folds2 * 0.004 + weave * 0.00006;
  vec3 col = vec3(0.30, 0.31, 0.22) * (0.9 + 0.12 * vnC(uv, 0.02, 3.0));
  // sun-bleached / worn on fold ridges
  float ridge = smoothstep(0.75, 0.95, folds);
  col = mix(col, vec3(0.44, 0.44, 0.35), ridge * 0.5);
  float bleach = smoothstep(0.4, 0.8, fbmC(uv, 0.8, 3, 4.0) * 0.5 + 0.5);
  col = mix(col, desat(col, 0.4) * 1.2, bleach * 0.4);
  float dirt = smoothstep(0.4, 0.8, warpC(uv, 0.6, 5, 1.2, 5.0) * 0.5 + 0.5);
  col = mix(col, vec3(0.25, 0.21, 0.16), dirt * 0.5);
  float water = smoothstep(0.02, 0.0, abs(fbmC(uv, 0.7, 4, 6.0) - 0.1)) * 0.5;
  col *= 1.0 - water * 0.3;
  col *= 0.95 + 0.05 * weave;
  s.albedo = col; s.height = h; s.rough = 0.8 + dirt * 0.1 - ridge * 0.05;
  return s;
}` },

  cloth_camo: { size: 1.0, res: 2, nrm: 0.8, ao: 40, aoR: 0.002, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0();
  // woodland-style camo, horizontally elongated blobs
  float a = fbmA(uv + vec2(fbmC(uv, 0.2, 3, 1.0), fbmC(uv, 0.2, 3, 2.0)) * 0.03, vec2(0.25, 0.14), 5, 3.0) * 0.5 + 0.5;
  float b = fbmA(uv + vec2(fbmC(uv, 0.2, 3, 4.0), fbmC(uv, 0.2, 3, 5.0)) * 0.03, vec2(0.22, 0.12), 5, 6.0) * 0.5 + 0.5;
  float c = fbmA(uv, vec2(0.08, 0.05), 4, 7.0) * 0.5 + 0.5;
  vec3 col = vec3(0.47, 0.43, 0.33);                     // khaki
  col = mix(col, vec3(0.30, 0.31, 0.2), step(0.52, a));  // olive
  col = mix(col, vec3(0.33, 0.25, 0.17), step(0.58, b)); // brown
  col = mix(col, vec3(0.1, 0.1, 0.085), step(0.68, c));  // black
  // twill weave
  float T = FQ(0.0012);
  float tw = fract((uv.x + uv.y) * T);
  float twill = sin(tw * TAU) * 0.5 + 0.5;
  float fib = vnC(uv, 0.0008, 8.0);
  col *= 0.9 + 0.12 * twill + 0.06 * fib;
  // fading, dirt, wear
  float fade = smoothstep(0.3, 0.8, fbmC(uv, 0.3, 4, 9.0) * 0.5 + 0.5);
  col = mix(col, desat(col, 0.3) * 1.1 + 0.02, fade * 0.35);
  float dirt = smoothstep(0.5, 0.85, warpC(uv, 0.3, 5, 1.5, 10.0) * 0.5 + 0.5);
  col = mix(col, vec3(0.3, 0.25, 0.19), dirt * 0.45);
  float crease = ridgedC(uv, 0.25, 3, 11.0);
  s.albedo = col; s.height = twill * 0.00012 + crease * 0.003 + fib * 0.00004; s.rough = 0.88 + dirt * 0.07;
  return s;
}` },

  // ------------------------------------------------------------------ MISC
  glass: { size: 1.5, res: 1, nrm: 0.5, ao: 0, aoR: 0.002, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0();
  float dust = smoothstep(0.35, 0.9, fbmC(uv, 0.35, 5, 1.0) * 0.5 + 0.5);
  float streak = smoothstep(0.55, 0.95, streaksC(uv, 0.015, 0.4, 2.0));
  float smudge = smoothstep(0.55, 0.8, warpC(uv, 0.15, 4, 2.0, 3.0) * 0.5 + 0.5);
  float spots = step(0.93, vorC(uv, 0.008, 1.0, 4.0).z) * (1.0 - smoothstep(0.2, 0.4, vorC(uv, 0.008, 1.0, 4.0).x));
  float d = sat(dust * 0.6 + streak * 0.35 + smudge * 0.25 + spots * 0.5);
  s.albedo = mix(vec3(0.22, 0.24, 0.24), vec3(0.55, 0.52, 0.46), d);
  s.mask = d; // used as alpha (dirt layer opacity)
  s.rough = 0.04 + d * 0.6; s.height = d * 0.00005;
  return s;
}` },

  rubber: { size: 1.0, res: 1, nrm: 1.0, ao: 30, aoR: 0.003, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0();
  float n = fbmC(uv, 0.01, 4, 1.0);
  vec3 col = vec3(0.075, 0.074, 0.078) * (0.9 + 0.2 * vnC(uv, 0.002, 2.0));
  float dust = smoothstep(0.35, 0.85, fbmC(uv, 0.25, 5, 3.0) * 0.5 + 0.5);
  col = mix(col, vec3(0.36, 0.33, 0.29), dust * 0.45);
  float scuff = smoothstep(0.97, 1.0, 1.0 - abs(gnA(uv, vec2(0.08, 0.003), 4.0))) * step(0.6, vnC(uv, 0.2, 5.0));
  col = mix(col, vec3(0.17), scuff * 0.6);
  s.albedo = col; s.height = n * 0.0002 - scuff * 0.0001; s.rough = 0.78 + dust * 0.15 + scuff * 0.05;
  return s;
}` },

  plastic: { size: 1.0, res: 1, nrm: 1.0, ao: 30, aoR: 0.003, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0();
  float stip = vnC(uv, 0.0015, 1.0) * 0.6 + vnC(uv, 0.0007, 2.0) * 0.4;
  vec3 col = vec3(0.16, 0.165, 0.16) * (0.95 + 0.08 * stip);
  float sc = max(
    smoothstep(0.985, 1.0, 1.0 - abs(gnA(uv, vec2(0.3, 0.001), 3.0))) * step(0.65, vnC(uv, 0.15, 4.0)),
    smoothstep(0.985, 1.0, 1.0 - abs(gnoise(vec2((uv.x + uv.y) * FQ(0.001), (uv.x - uv.y) * FQ(0.3)), vec2(FQ(0.001), FQ(0.3)), 5.0))) * step(0.65, vnC(uv, 0.15, 6.0)));
  col = mix(col, vec3(0.32), sc * 0.7);
  float dust = smoothstep(0.35, 0.85, fbmC(uv, 0.3, 5, 7.0) * 0.5 + 0.5);
  col = mix(col, vec3(0.42, 0.4, 0.37), dust * 0.4);
  float fade = smoothstep(0.3, 0.8, fbmC(uv, 0.6, 3, 8.0) * 0.5 + 0.5);
  col = mix(col, col * 1.3 + 0.03, fade * 0.3);
  s.albedo = col; s.height = stip * 0.00006 - sc * 0.00005; s.rough = 0.45 + stip * 0.1 + dust * 0.35 + sc * 0.15;
  return s;
}` },

  tiles: { size: 2.0, res: 2, nrm: 1.0, ao: 50, aoR: 0.006, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0(); vec2 m = uv * uSize;
  float n = FQ(0.3); float ts = uSize / n;
  vec2 tid = floor(m / ts); vec2 lp = m - tid * ts; tid = mod(tid, vec2(n));
  vec3 th = hash32(tid + 1.0);
  float grout = 0.004;
  float ed = min(min(lp.x, ts - lp.x), min(lp.y, ts - lp.y)) - grout * 0.5;
  // chipped corners/edges
  float chipN = fbmC(uv, 0.02, 4, 2.0) * 0.5 + 0.5;
  float chip = smoothstep(0.62, 0.8, chipN) * 0.006;
  float inT = smoothstep(0.0, 0.0006, ed - chip);
  float missing = step(0.93, th.x);
  float checker = mod(tid.x + tid.y, 2.0);
  vec3 tc = mix(vec3(0.6, 0.57, 0.52), vec3(0.5, 0.43, 0.37), checker);
  tc *= 0.92 + 0.12 * th.y;
  tc *= 0.95 + 0.08 * (fbmC(uv, 0.05, 4, 3.0) * 0.5 + 0.5);
  // speckled glaze
  tc *= 0.94 + 0.1 * smoothstep(0.5, 0.9, vnC(uv, 0.002, 4.0));
  // cracks in some tiles
  float cr = crackNet(uv, 0.15, 0.0012, 0.6, 5.0) * step(0.7, th.z);
  vec3 groutC = vec3(0.45, 0.43, 0.4) * (0.8 + 0.3 * vnC(uv, 0.003, 6.0));
  vec3 bed = vec3(0.5, 0.49, 0.46) * (0.75 + 0.35 * (fbmC(uv, 0.03, 4, 7.0) * 0.5 + 0.5));
  vec3 col = mix(groutC, tc, inT);
  col *= 1.0 - cr * 0.6;
  float h = inT * (0.006 + fbmC(uv, 0.5, 2, 8.0) * 0.0004 + (th.y - 0.5) * 0.0006) - cr * 0.002 + (1.0 - inT) * vnC(uv, 0.003, 9.0) * 0.0005;
  float rough = mix(0.9, 0.22 + th.z * 0.1, inT);
  // missing tile: mortar bed with notched trowel ridges
  float ridges = sin(lp.x * 250.0) * 0.5 + 0.5;
  col = mix(col, bed * (0.9 + 0.1 * ridges), missing);
  h = mix(h, -0.002 + ridges * 0.0015 + fbmC(uv, 0.02, 3, 10.0) * 0.001, missing);
  rough = mix(rough, 0.95, missing);
  // dirt/dust
  float dirt = sat(warpC(uv, 0.7, 5, 1.3, 11.0) * 0.9 + 0.35);
  col = mix(col, vec3(0.4, 0.37, 0.32), dirt * 0.45);
  rough = mix(rough, 0.85, dirt * 0.8);
  float scr = smoothstep(0.985, 1.0, 1.0 - abs(gnA(uv, vec2(0.2, 0.001), 12.0))) * step(0.6, vnC(uv, 0.2, 13.0)) * inT;
  rough += scr * 0.3;
  s.albedo = col; s.height = h; s.rough = rough; s.ao = mix(0.6, 1.0, inT);
  return s;
}` },

  roof_tiles: { size: 2.0, res: 2, nrm: 1.0, ao: 30, aoR: 0.02, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0(); vec2 m = uv * uSize;
  // clay pantiles: v runs up the roof slope, rows overlap downward
  float cols = FQ(0.22), rows = FQ(0.19);
  vec2 ts = vec2(uSize / cols, uSize / rows);
  float row = floor(m.y / ts.y);
  float off = mod(row, 2.0) * 0.5 * ts.x;
  float cx = floor((m.x + off) / ts.x);
  vec2 lp = vec2(mod(m.x + off, ts.x), mod(m.y, ts.y)) / ts;
  // scalloped lower edge follows the tile curvature
  float prof = 0.5 - 0.5 * cos(TAU * lp.x);
  float edgeY = 0.1 * (1.0 - prof) + 0.02 * vnC(uv, 0.03, 15.0);
  float below = step(lp.y, edgeY);           // this texel shows the top of the row below
  row -= below; lp.y = below > 0.5 ? lp.y + 1.0 : lp.y;
  off = mod(row, 2.0) * 0.5 * ts.x;
  cx = floor((m.x + off) / ts.x);
  lp.x = mod(m.x + off, ts.x) / ts.x;
  prof = 0.5 - 0.5 * cos(TAU * lp.x);
  vec2 id = vec2(mod(cx, cols), mod(row, rows));
  vec3 th = hash32(id + 3.0);
  float along = sat((lp.y - edgeY) / (1.0 - edgeY));
  float h = 0.022 * prof + 0.02 * (1.0 - along) + (th.x - 0.5) * 0.003;
  h -= below * 0.018;
  vec3 clay = mix(vec3(0.5, 0.29, 0.2), vec3(0.4, 0.23, 0.17), th.z);
  clay = mix(clay, vec3(0.36, 0.26, 0.22), step(0.75, th.x) * 0.7);
  clay = desat(clay, 0.15);
  clay *= 0.88 + 0.18 * (fbmC(uv, 0.04, 4, 6.0) * 0.5 + 0.5);
  clay *= 0.9 + 0.15 * vnC(uv, 0.003, 7.0);
  clay *= mix(0.6, 1.0, prof);                 // dark troughs (dirt, moisture)
  float lichen = smoothstep(0.62, 0.8, fbmC(uv, 0.05, 5, 8.0) * 0.5 + 0.5) * smoothstep(0.3, 0.7, fbmC(uv, 0.6, 3, 9.0) * 0.5 + 0.5);
  clay = mix(clay, vec3(0.58, 0.56, 0.46), lichen * 0.55);
  float moss = (1.0 - prof) * smoothstep(0.45, 0.75, vnC(uv, 0.25, 10.0));
  clay = mix(clay, vec3(0.2, 0.22, 0.13), moss * 0.6);
  float soot = sat(fbmC(uv, 0.8, 4, 11.0) * 0.8 + 0.2);
  clay *= mix(1.0, 0.65, soot * 0.5);
  float streak = smoothstep(0.5, 0.9, streaksC(uv, 0.03, 0.6, 12.0));
  clay *= 1.0 - streak * 0.2;
  vec3 col = clay;
  col *= mix(1.0, 0.45, below * smoothstep(0.0, 1.0, 1.0 - (edgeY - (lp.y - 1.0)) / max(edgeY, 0.001)) + below * 0.2);
  // cracked / broken tiles
  float cr = crackNet(uv, 0.2, 0.0015, 0.2, 13.0) * step(0.8, th.y);
  col *= 1.0 - cr * 0.7; h -= cr * 0.004;
  h += fbmC(uv, 0.015, 3, 14.0) * 0.0004;
  s.albedo = col; s.height = h; s.rough = 0.82 + lichen * 0.1 - streak * 0.05; s.ao = mix(1.0, 0.55, below);
  return s;
}` },

  car_paint: { size: 2.0, res: 1, nrm: 0.6, ao: 0, aoR: 0.003, paint: [0.24, 0.29, 0.33], glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0();
  float pv = 0.8 + 0.05 * vnC(uv, 0.3, 1.0);
  float dust = sat(smoothstep(0.3, 0.9, fbmC(uv, 0.5, 5, 2.0) * 0.5 + 0.5) * 0.8 + smoothstep(0.6, 0.95, streaksC(uv, 0.02, 0.35, 3.0)) * 0.5);
  float speck = step(0.85, vnC(uv, 0.002, 4.0)) * 0.5;
  vec3 dustC = vec3(0.56, 0.52, 0.46);
  // scratches through paint
  float sc = max(
    smoothstep(0.988, 1.0, 1.0 - abs(gnA(uv, vec2(0.5, 0.0015), 5.0))) * step(0.72, vnC(uv, 0.3, 6.0)),
    smoothstep(0.988, 1.0, 1.0 - abs(gnoise(vec2((uv.x + uv.y) * FQ(0.0015), (uv.x - uv.y) * FQ(0.5)), vec2(FQ(0.0015), FQ(0.5)), 7.0))) * step(0.7, vnC(uv, 0.3, 8.0)));
  // small rust spots / stone chips
  vec4 v = vorC(uv, 0.03, 1.0, 9.0);
  float chipS = step(0.94, v.z) * (1.0 - smoothstep(0.08, 0.14, v.x));
  float rh; vec3 rc = rustColor(uv, 10.0, rh);
  vec3 col = vec3(pv);
  s.mask = 1.0;
  col = mix(col, vec3(0.55, 0.55, 0.54), sc); s.mask *= 1.0 - sc;
  col = mix(col, rc, chipS); s.mask *= 1.0 - chipS;
  float d = sat(dust + speck * dust);
  col = mix(col, dustC, d * 0.65);
  s.mask *= 1.0 - d * 0.65;
  s.albedo = col; s.height = -sc * 0.00005 - chipS * 0.0002 + d * 0.00005;
  s.rough = mix(0.32, 0.9, d) + sc * 0.2 + chipS * 0.5;
  s.metal = sc * 0.6;
  s.ao = sat(1.0 - d * 1.2 - chipS - sc); // clearcoat mask (car_paint uses R as clearcoat)
  return s;
}` },

  road_line: { size: 4.0, res: 1, nrm: 1.0, ao: 0, aoR: 0.004, glsl: /* glsl */ `
Surf surface(vec2 uv){
  Surf s = surf0();
  float wear = fbmA(uv, vec2(0.6, 0.3), 5, 1.0) * 0.5 + 0.5;
  vec4 v = vorC(uv, 0.008, 1.0, 2.0);
  float stoneHole = step(0.45, v.z) * smoothstep(0.08, 0.2, v.w) * smoothstep(0.35, 0.8, wear);
  float tyre = smoothstep(0.4, 0.7, vnA(uv, vec2(0.8, 0.15), 3.0));
  float a = sat(smoothstep(0.62, 0.52, wear + tyre * 0.15) - stoneHole * 0.9);
  a *= 0.85 + 0.15 * vnC(uv, 0.004, 4.0);
  vec3 col = vec3(0.78, 0.77, 0.72) * (0.8 + 0.2 * vnC(uv, 0.02, 5.0));
  col = mix(col, vec3(0.45, 0.43, 0.4), smoothstep(0.3, 0.8, fbmC(uv, 0.3, 4, 6.0) * 0.5 + 0.5) * 0.5);
  s.albedo = col; s.mask = a; s.height = a * 0.0004; s.rough = 0.7;
  return s;
}` },
};
