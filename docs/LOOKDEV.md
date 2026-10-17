# Character lookdev — the giant office worker

A new, richer look for the characters: a **caricature built from strong, simple shapes**
(feature-animation style) with **PBR materials** that react to the office's light. The style is
defined on **one character first, the giant office worker**; the job-hunter players follow later
through a style guide. Local branch `feature/woman-lookdev` (never pushed).

![Style frame](lookdev-style-frame.jpg)

*Style frame (L1, locked 2026-10-17): front, ¾, profile, and the view from the CV she reads.
Cycles render under an office-like light rig.*

## Style decisions

| Topic | Choice |
|---|---|
| Direction | Caricature: pushed proportions, bold smooth shapes, no anatomical micro-detail. Style references were three animated-film characters (used for style only; she is an original character) |
| Her | A **grumpy office clerk in her 40s–50s**: heavy droopy upper lids, sour pout with down-turned corners, round bulbous nose, jowls, thin plucked arched brows pulled down at the inner ends |
| Head size | ~1/5 of her height; arms keep their length so her clips still reach the CV, the mug and the shredder |
| Body | Thin and bony |
| Hair | Teased updo / low, wide mini beehive with a bouffant roll over the forehead, broad swept locks, brown with thin grey streaks, matte (a hint of hairspray shine); a yellow pencil stuck through it |
| Glasses | Thick burgundy cat-eye frames |
| Details | Pearl stud earrings, mauve eyeshadow, berry lipstick, green-hazel eyes |
| Outfit | Kept, more detailed: chunky mauve knit cardigan, white collared blouse, grey trousers, red lanyard + badge (L3) |
| Rejected | A realistic base head nudged towards cartoon: read as "not human", too anatomical |

## How the head is built (Blender, `blender_src/`, not committed)

- Base: Blender Studio's CC0 **Human Base Meshes** bundle, "Head - Stylized"
  (`blender_src/human-base-meshes-bundle-v1.4.1/`).
- `scripts/lookdev_clerk.py`: loads the base head, caricatures it with landmark-driven soft
  deformations (`caricature()`: eye openings, brows, nose + bulbous tip, mouth, sagging cheeks,
  nasolabial folds, eye bags, longer lower face, jowls, neck), its own **eyeballs** (procedural iris,
  glossy coat) and **eyelids as separate shells** over the eyes (heavy upper lids; ready for blink
  shape keys), skin with colour masks (lips, warmth).
- `scripts/clerk_parts.py`: the hair (scalp cap that sinks under the skin below the hairline, so
  the hairline is a clean line, + beehive dome + front roll, voxel-remeshed into one mass and carved
  into swept locks; a `Flow` UV drives strand bands and grey streaks), pencil, brows, lashes,
  cat-eye glasses (Catmull-Rom outline), pearl earrings.
- `scripts/lookdev_common.py`: GPU Cycles, the office-like light rig (ceiling panel key, cool
  window fill, warm desk bounce, rim, monitor glow), turnaround cameras. Lookdev file:
  `blender_src/woman_lookdev.blend`; renders in `blender_src/renders/lookdev/`.

## Body and clothes (L3)

![Body and clips](lookdev-body.jpg)

*L3 (2026-10-17): typing pose, front, chest close-up, reading the CV, feeding the shredder,
sipping coffee. The clips run on the unchanged 50-bone `Woman_Rig`.*

- `scripts/build_clerk_body.py` builds everything straight into the rig's seated rest pose (her
  local space: metres, Z up, facing +Y, origin under the chair): Skin-modifier garments (the
  cardigan is voxel-remeshed to clean the armpit folds, then cut with planes: straight open V,
  neckline, open hem), ribbed hem band and cuffs, a button band following the cut edge with five
  buttons, a blouse kept only where it shows plus a collar, trousers, ankles, low pumps and hands
  as voxel-remeshed capsules along the rig's finger bones (berry nails), lanyard + badge, the old
  chair (taken from the old mesh, rigid on `Root`).
- The head from `lookdev_clerk.py` goes onto the neck (eye line at 1.245 m, turned to face +Y),
  its neck flare trimmed under the collar; `caricature()` now also turns the neck into a clean
  column.
- **Weights**: one smooth distance field per bone (`w ~ 1/d^6`, 3 bones, left/right locked) shared
  by every layer of clothing, so the layers move together; the head parts are rigid on `Head`
  (the neck blends into `Neck` / `Chest`); the hands use the finger bones. Everything is joined
  into one skinned mesh `Clerk`.
- **Clips**: `scripts/anim_clerk.py` = `anim_woman.py` adapted to the big head: the CV is read
  further out to her right, and while she feeds the shredder she scoots closer (0.19 m), leans
  less and turns her head away (her elbow used to rise over the old, small head). Reach error
  ≤ 10 cm as before; the forearm stays ≥ 30 cm from the head centre.
- **Known for later**: ~371k triangles in lookdev (hair ~90k, hands ~53k, cardigan ~66k from the
  voxel remeshes) → decimation + normal-map bakes in L7 (budget 60–80k); seen from the shredder's
  side, her feeding arm passes in front of her face.

## PBR textures and the game mesh (L4)

![High-poly vs game mesh](lookdev-pbr.jpg)

*Top: the high-poly lookdev model; bottom: the game mesh (58.6k triangles) with its baked maps,
same lights.*

- **Surface detail** (`scripts/clerk_textures.py`, procedural, object coordinates + colour
  attributes): skin pores, mottling, a shinier T-zone, faint forehead lines, crow's feet and
  under-eye shadow (`Age` attribute); **cable knit** (two crossing ropes per column on the front and
  back panels, stockinette elsewhere, ribs on the hem band and cuffs via the `Rib` attribute); blouse
  plain weave, trouser twill, shoe leather grain, chair fabric; burgundy plastic glasses; the
  printed **ID badge** (`scripts/make_badge.py` → `textures/badge.png`: HUMAN RESOURCES · Dept. of
  Rejections, her photo cropped from a lookdev render, "M. GRIMSBY, Senior Talent Rejector",
  employee #00451, barcode). The eyes keep their own space after the join through an `EyeCo`
  vector attribute.
- **Game mesh** (`scripts/clerk_bake.py`): the high-poly mesh is split into texture sets,
  decimated (collapse) to a budget, Smart-UV-projected, and baked in Cycles (selected to active,
  6 mm cage): base colour / roughness / metallic through an emission swap, tangent-space normals
  (shape + procedural bump), ambient occlusion; ORM packed (R occlusion, G roughness, B metallic);
  texels the rays missed are grown in from their neighbours. Vertex weights survive the decimation,
  so `Clerk_Game` is skinned to the same rig.

| Set | Parts | Triangles | Maps |
|---|---|---|---|
| Skin | face, eyelids, hands, ankles | 16,000 | 2048² base / normal / ORM |
| Cloth | cardigan, blouse, trousers, shoes, lanyard, chair | 22,000 | 2048² |
| Hair | hair, brows, lashes | 12,000 | 2048² |
| Acc | eyes, glasses frame, nails, pearls, pencil | 8,424 | 1024² (coat 1.0) |
| Badge | ID card | 60 | `badge.png` 512×768 |
| Lens | glasses lenses | 144 | none (alpha 0.05) |
| **Total** | 6 materials = 6 draw calls | **58,628** | |

- The whole bake takes about a minute on the RTX 3070 (OptiX).
- **Known**: a little dark spot in the nostrils and thin dark seams along the cardigan's open edge
  on the game mesh (decimation of thin rims); the PNGs are uncompressed bake output (~45 MB) and
  get converted (JPEG / KTX2) at export in L5.

## In the game (L5)

She is in `public/models/office.glb` now (6.9 MB, was 2.2 MB: her 2K JPEG maps), replacing the old
low-poly woman; the old mesh stays in `blender_src/office.blend` (collection `Woman_Old`, excluded).
Her clips were regenerated in `office.blend` with `anim_clerk.py` on the same `Woman_Rig`, so
`office.js` plays them unchanged (Type loop, idle one-shots, Shred synced to the match clock).

**Shading** (`src/world/clerkShading.js`, `ClerkShading`): her `Clerk_*` glTF materials stay
physically based (MeshPhysicalMaterial: maps, coat, sheen) but ignore the game's lights, which are
aimed at the page. In their shader the scene lights are replaced by the office's own, given in the
office frame and turned into view space every frame, so she stays lit like the baked room however
it swings around the page:

| Light | What | Config (`config.office.clerk`) |
|---|---|---|
| key | the ceiling panel above her desk, warm white | `keyDir`, `key`, `keyIntensity` 3.0 |
| fill | the windows on the +X wall, cool | `fillDir`, `fill`, `fillIntensity` 0.5 |
| monitor | her screen, a cool point light (range in real metres) | `monitor`, `monitorIntensity` 0.9, `monitorRange` 0.55 |
| ambient | sky / carpet hemisphere | `sky`, `ground` |
| IBL | an environment map captured from the baked office at her head (`Office.initEnv(renderer)`, PMREM, 128 px), rotated with the office (`envMapRotation`) | `envIntensity`, `envSize` |

Skin gets a light wrap past the terminator, reddest in red (`sss`); the output goes through the same
soft shoulder as the office bake (`1 - e^(-x·exposure)`), not ACES; the lenses are alpha-blended
(`lensOpacity`), the accessories' coat is softened (`accCoat`: a full coat mirrored the room on the
frames).

**Light events** (`Office.updateLights`, cosmetic, per screen, not networked):

- **Panel stutter**: the panel above her desk flicks on and off for 1–2 s every 30–90 s (first
  after 20–45 s); the key light drops to 25 %, a grey "off" quad covers the panel, the baked room dims
  by 6 % and the page's sun + hemisphere by 15 % (`config.office.flicker`: `gap`, `duration`,
  `first`, `roomDip`, `pageDip`, `enabled`; `office.lightDip` 0..1 is what main.js reads). The
  soundscape plays a starter tick and a short 120 Hz buzz at every flick (`OfficeAmbience.panelFlick`).
- **Monitor glow**: her screen's light steps to a new brightness every 1.5–6 s (windows changing)
  with a fast shimmer on top; the screens' colour follows it slightly (`config.office.monitorFlicker`).

Checked in the browser pane (dev server on Windows): she types, reads and feeds the CV with the new
look, the panel stutter dims her and the page, no console errors; `sim:shred`, `sim:match`,
`test:ray`, `sim:pvp` pass, `vite build` is clean.

## Steps

| # | Step | Status |
|---|---|---|
| L0 | Branch, lookdev scene, "before" renders | ✅ |
| L1 | Style frame: the head (two rounds; the second direction approved) | ✅ |
| L2 | Head details: eyes, lids, lashes, brows, glasses, hair | mostly done in L1 |
| L3 | Body + clothes on the existing 50-bone rig (`Woman_Rig`), reweighted, clips checked | ✅ |
| L4 | PBR texture sets baked from the procedural materials (skin, knit, weave, twill, plastic) + the decimated game mesh | ✅ |
| L5 | Export into `office.glb` + in-game shading (`MeshPhysicalMaterial`, office env light, monitor glow, panel flicker) | ✅ |
| L6 | Blinks and expression shape keys in her clips | |
| L7 | Phone LOD, performance; validation | |
| L8 | Docs + style guide for the players | |
