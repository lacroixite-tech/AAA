# AAA — Operation Nightfall (Three.js FPS)

## Art direction (every system must match this)
- Setting: a war-torn Eastern-European industrial town. The map is a street intersection with a central
  plaza, damaged 3–4 storey brick/plaster apartment blocks, a warehouse/garage, burnt-out cars,
  sandbag positions, barricades, rubble, power poles with sagging cables, puddles.
- Time: late afternoon golden hour. Low warm sun (~15° elevation) raking across facades, long shadows,
  cool blue skylight fill, atmospheric haze and a faint smoke column in the distance.
- Look target: *Call of Duty: Modern Warfare (2019) / MWII / MWIII* — grounded, photoreal, filmic
  tone mapping, restrained desaturated grade with warm highlights / teal shadows, dense micro-detail,
  everything worn, chipped, dirty. Nothing should look clean, flat, untextured, or "programmer art".
- Everything is procedural (no external asset downloads are guaranteed). Textures are generated at load
  (canvas/GPU), geometry is built in code. Quality comes from detail, layering, and good shading.

## Performance budget
Must stay real-time on a mid-range desktop GPU (target 60 fps at 1080p, `?q=high`). Use instancing,
merged geometries, texture atlases/reuse, LODs where cheap. Load time < 15 s.

## Layout & ownership
| Area | Files (you own these) |
|---|---|
| core (lead only) | `src/core/*`, `src/main.js`, `index.html`, `scripts/*` |
| materials | `src/world/Materials.js`, `src/world/textures/**` |
| level | `src/world/Level.js`, `src/world/level/**` |
| lighting/post | `src/world/Environment.js`, `src/post/**` |
| player+hud | `src/player/**`, `src/ui/**` |
| weapons | `src/weapons/**` |
| fx | `src/fx/**` |
| ai | `src/ai/**` |
| audio | `src/audio/**` |
Each area also owns `src/debug/shots/<area>.js` (screenshot poses). Do not edit files you don't own; if you need a
change in a shared file (esp. `src/core/Game.js`), make the smallest possible additive edit and mention it in your report.

## Contracts
- `game` fields: `renderer, scene, camera, events, input, collision, materials, environment, level, player,
  weapons, fx, enemies, hud, audio, post, time, quality ('low'|'high'), shotName`.
- Systems: `constructor(game)`, `update(dt)`. Update order: player → weapons → enemies → fx → environment → hud → audio → post.render.
- Materials: `game.materials.get(name)` → `THREE.Material`. Required names:
  `concrete, concrete_dark, plaster, brick, metal_painted, metal_rusty, metal_bare, wood, wood_planks, asphalt,
  dirt, gravel, sandbag, tarp, glass, rubber, plastic, rubble, tiles, roof_tiles, grass, car_paint, cloth_camo`.
  Materials should work with default UVs in world-scale meters (1 UV unit = 1 m) — the level agent
  generates UVs in meters. `game.materials.get(name, {repeat})` may return a clone.
- Colliders: meshes with `userData.collider = true` + `userData.surface` (concrete|metal|wood|dirt|glass|flesh|sandbag|...)
  are baked into the BVH by `game.collision.build()` right after Level is constructed.
- `game.collision.raycast(origin, dir, far)` → `{point, normal, distance, surface, object, part}`; `resolveCapsule`.
  Dynamic hittables: `collision.addDynamic(root)`; child meshes may set `userData.part = 'head'|'body'|'limb'`.
- Level exposes `playerSpawn {position, yaw}`, `enemySpawns: Vector3[]`, optional `coverPoints`, `navPoints`.
- Environment exposes `sun` (DirectionalLight), `sunDirection` (Vector3).
- Player exposes `position (feet), velocity, yaw, pitch, onGround, sprinting, crouching, sliding, aiming, health, eyeHeight, moveSpeed01`, `damage(amount, fromPos)`.
- Weapons expose `current` ({name, ammo, magSize, reserve, fireMode}), `reloading`, `adsAmount` (0..1), `fovMultiplier`.
- Events: `weapon:fire {origin, dir, muzzleWorld, weapon}`, `hit {point, normal, surface, object, part, dir, damage}`,
  `weapon:reload {weapon}`, `weapon:empty`, `enemy:fire {origin, dir, enemy}`, `enemy:hit`, `enemy:killed {enemy, headshot}`,
  `player:damaged {amount, fromPos}`, `player:footstep {surface, intensity}`, `player:land {speed}`, `player:jump`.

## Review workflow
`node scripts/shot.mjs <shot...>` renders deterministic screenshots via headless Chromium (SwiftShader, slow
but correct) into `shots/`. Shot poses live in `src/debug/shots/*.js`. `/?shot=name` in a browser shows the same pose.
