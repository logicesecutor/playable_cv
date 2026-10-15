# Front page

The first screen (`#upload-screen.landing` in `index.html`) is a scrolling front page. Its only job
is to get a PDF into the game; everything else on it is a preview. The real upload flow is unchanged:
`#dropzone`, `#file-input` and `#upload-error` are still read by `src/main.js`.

| File | Role |
|---|---|
| `index.html` | markup of every section; inline script that sets the theme before first paint |
| `src/landing.css` | front page styles and the two palettes, all scoped to `.landing` |
| `src/ui/landing.js` | `initLanding()`: theme switch, nav, sample button, shootable CV stage, ticker, scroll reveals |
| `src/ui/hunters.js` | `initHunters()`: "Meet the job hunters" 3D character preview |
| `src/ui/title.js` | animated "Destroy Your Career" title (shared with the join screen) |
| `public/example_cv.pdf` | the sample CV behind "No CV handy? Use the sample" |

The join, loading and game screens keep `src/style.css` and are not affected by the theme.

## Sections, top to bottom

1. **Nav** (`.lp-nav`, sticky): brand, five anchor links (Players, How it works, The game,
   Multiplayer, Controls), the theme button (moon / sun) and **Drop your CV**. The CTA links to
   `#lp-top`; 450 ms later the drop zone gets the `dragging` class for 700 ms as a flash. The nav gets
   a bottom hairline (`.stuck`) once the page has scrolled more than 8 px.
2. **Hero** (`#lp-top`): version tag, animated title, tagline "Your CV. Their bullets. No callbacks.",
   the compact drop zone, the error line, **No CV handy? Use the sample**, and the fineprint (the file
   leaves the machine only if you invite friends). Next to it, the shootable CV stage (below).
3. **Ticker** (`.lp-ticker`): 14 word slips, every fourth one a rare word in stamp red, repeated twice
   and scrolled in a 48 s loop (paused on hover). Words come from `WORDS` / `RARE_WORDS` in
   `src/fx/wordShots.js`.
4. **Meet the job hunters** (`#lp-players`): the 3D character preview (below).
5. **How it works** (`#lp-how`): three steps with small CSS illustrations that animate on hover.
6. **The game** (`#lp-cv`): the game's own CV on a paper sheet, MP1–MP5 listed as Experience, the
   three match awards as Skills, the typewriter blaster as Equipment, a REJECTED stamp.
7. **Multiplayer** (`#lp-mp`): host and join cards (the invite field and its **Copy** button are a
   mock: Copy only changes its label to "Copied" for 1.4 s), and four facts.
8. **Controls** (`#lp-controls`): desktop keys and touch controls.
9. **Footer**: version, GitHub link, credits.

Every element with `data-version` gets the `package.json` version (through `ui/title.js`). Headings and
cards with the `reveal` class fade in once 15 % of them is on screen (`IntersectionObserver`).

There is no drop zone at the end of the page: the nav CTA brings the visitor back to the hero.

## Themes

Two palettes, chosen by `<html data-theme="paper|dark">`. Both are CSS custom properties on `.landing`
at the top of `src/landing.css`; dark overrides the paper values under `html[data-theme="dark"] .landing`.

| Token | Paper & ink (default) | Dark (classic look) | Used for |
|---|---|---|---|
| `--bg` | `#f3efe6` (the game's paper floor) | `#09090b` | page background, behind a 40 px grid |
| `--bg-glow` | `#ffffff` | `#1a1a20` | radial glow at the top, behind the character |
| `--panel` | `#ffffff` | `#111114` | cards, buttons, inputs |
| `--line` / `--line-strong` | `#d9d3c5` / `#8a8478` | `#26262c` / `#4a4a55` | borders |
| `--text` / `--muted` | `#111114` / `#5c574d` | `#ececf1` / `#8b8b96` | text |
| `--accent` / `--accent-hover` | `#2348e6` / `#1b3bc4` (ink blue) | `#ff5a36` / `#ff6f4f` (orange) | primary buttons, kickers, focus rings |
| `--on-accent` | `#ffffff` | `#140804` | text on the accent |
| `--accent-tint` | `#e6ebff` | `#1a1210` | button hover, drop zone flash |
| `--stamp` | `#c8232f` | `#e0303c` | REJECTED / CAREER / FIRED! stamps, rare ticker words |
| `--ink` | `#111114` | `#09090b` | text on paper (slips, the game's CV) |
| `--screen` | `#111114` | `#0e0e12` | dark panels: CV stage, ticker, step illustrations, player list |
| `--grid` | `#e3ded2` | `#ffffff0f` | background grid lines |
| `--error` | `#b8322a` | `#ff8a73` | `#upload-error` |

`--paper`, `--ink-muted`, `--on-screen`, `--scrim` and `--gut` (side gutter: 16 px, 32 px from 760 px)
are shared by both. The sample CV on the stage and the game's CV are always white paper.

### How the theme is chosen and stored

- **Before first paint**: an inline script in `index.html`'s `<head>` sets `data-theme` from
  `localStorage["dyc-theme"]`, else from `prefers-color-scheme: dark`, else `paper`. No flash.
- **`initTheme()` in `ui/landing.js`** owns it after that. Until the visitor clicks the toggle, it
  follows the device, including live changes of the system setting. A click flips the theme and saves
  the choice in `localStorage` (`dyc-theme`, value `paper` or `dark`); from then on the device setting
  is ignored. If storage is blocked (private mode), the switch still works for the page load.
- The switch cross-fades colours for 0.35 s by adding `html.theming` for 400 ms. The button's
  `aria-label` names the theme it switches to.

## The shootable CV stage

`#lp-stage` in the hero: a made-up CV ("Alex Rivera, Senior Synergy Engineer") extruded in CSS 3D, no
WebGL, so it paints immediately. `createStage()` in `ui/landing.js`:

- **Extrusion**: every word of each `.row` becomes a `.w` span holding 7 stacked copies
  (`DEPTH`, 1.4 px apart on Z) and a `.top` face that takes the clicks.
- **Aim**: the pointer moves a crosshair (shown for mouse only) and tilts the paper a few degrees
  (`--rx`, `--rz`).
- **Shoot** (click / tap): ammo drops by one; a word slip (a random word, 1 in 8 rare, as in the game)
  flies in from the bottom right to the hit point and falls away. If a word was hit, 140 ms later it
  breaks into one shard per letter, leaves a scorch, and a REJECTED stamp is printed on the paper (at
  most one per 120 px, like `STAMP_GAP` in the game). The CV integrity chip shows the share of words
  left. At 0 ammo the gun reloads for 1.1 s (no shots), then back to 30; the chip turns "low" at 5.
- **↻ Reprint** appears after the first destroyed word and restores everything.
- **Demo**: 2.6 s after load (once the title has landed) the stage fires up to 4 shots on its own,
  one every 1.8 s, at random visible words (never the name). It skips a beat while the pointer is over
  the stage, the tab is hidden or the front page is not the active screen. The first real click stops
  the demo for good.

## Meet the job hunters

`ui/hunters.js` shows the real in-game character: `ModelAvatar` (`src/player/modelAvatar.js`) built
from the same models as a match (`preloadModels` / `getModel` in `src/assets/models.js`), with the same
clips, accent tint and rim light.

- **Lazy start**: WebGL is created only when `#hv` comes within 400 px of the viewport. It waits for
  the models main.js already started downloading. If they are missing or WebGL fails, the box shows
  "The 3D preview couldn't start on this device." The controls work before the 3D is ready (they only
  change the state).
- **Render**: only while the section is visible and the front page is the active screen
  (`isActive`). Shadow-only floor, lights like the game world.
- **Camera**: `OrbitControls`, drag to turn, zoom 3–7 m, no pan, slow auto-turn until the first drag.
- **Outfit**: corporate or engineer (default engineer), rebuilds the avatar.
- **Colour**: the 8 `PLAYER_COLORS` from `src/net/room.js` (default blue); tints the `Accent`
  material on the body and the gun, and the name tag underline.
- **Poses** Idle / Walk / Run / Crouch / Jump: no clip is forced; the avatar gets fake network state
  (`FLAG` bits from `src/net/snapshots.js`, forward speed 6.5 for Walk and 11 for Run) and picks the
  clip itself, as for a remote player.
- **Fire**: `avatar.fire()` plus a word slip flying out of the muzzle. **Reload**: sets `FLAG.reload`
  for 1.3 s. **Get fired**: `die()`, a FIRED! stamp over the body, the camera follows the slumped body,
  revive after 2.6 s (or on any pose button).
- **Name tag**: the text field updates an HTML tag projected over the head (empty = "Player").

It is a showcase only. In a match the host still assigns outfits (`pickOutfit`) and colours.

## Wiring in main.js

```js
const landing = initLanding({ onSample: () => startSample() });
initHunters({ isActive: () => !screens.upload.hidden });
```

- `show(name)` calls `landing.setActive(name === "upload")`, so the stage demo pauses on other screens.
- `startSample()` fetches `${import.meta.env.BASE_URL}example_cv.pdf` (works under the GitHub Pages
  sub-path), wraps it in a `File` and runs the normal `start(file)` flow. On failure: "Couldn't load
  the sample CV. Drop your own PDF instead."
- `fail()` scrolls `#upload-error` into view, since the drop zone may be off screen.
- Back from a game: **Home** (pause card, end card; `src/ui/leave.js`) disposes the game (a host's
  room closes, its guests come back here with "The host left the game."), drops `#join=` from the
  URL, hides `#upload-error` and calls `show("upload")`. See README "Leaving a game".

## Reduced motion

With `prefers-reduced-motion: reduce`: no theme cross-fade, no demo shots, no ticker scroll (the words
wrap instead), no scroll reveals (content shown at once), no paper tilt, no shards, no stamp slam,
word slips appear at the hit point without flying, no smooth scrolling, and the character does not
auto-turn.

## Mobile

- Under 980 px the hero, the job hunters and the game's CV go to one column; the stage and the
  character box get shorter (and again under 480 px), the paper is scaled down.
- Under 760 px the nav links are hidden; under 480 px the nav CTA and the drop zone's Play button are
  hidden too (the hero drop zone is right below).
- Copy that differs by device uses `.desk-only` / `.touch-only` (style.css, keyed on `html.touch`
  from `src/input/touchMode.js`): "Drop your CV here" vs "Tap to pick your CV", "Click" vs "Tap a
  word to shoot it".
- The character canvas uses `touch-action: pan-y`, so a vertical swipe still scrolls the page.

## How to change

| What | Where |
|---|---|
| Word slips (stage, ticker, character) | `WORDS` and `RARE_WORDS` in `src/fx/wordShots.js` (the game uses the same lists) |
| Colours | the token blocks at the top of `src/landing.css` (`.landing` for paper, `html[data-theme="dark"] .landing` for dark) |
| Default theme for first visits | the inline script in `index.html` and `initTheme()` in `src/ui/landing.js` |
| Sample PDF | replace `public/example_cv.pdf` (keep the name, or change `startSample()` in `src/main.js`) |
| Sample CV on the stage | the `.row` divs inside `#lp-paper` in `index.html` |
| Section text | `index.html` |
| Outfit descriptions, colour names | `OUTFIT_TEXT`, `COLOR_NAMES` in `src/ui/hunters.js` |

See the [README](../README.md) for the game itself.
