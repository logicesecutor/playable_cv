# Destroy Your Career — mobile touch controls

Make the game playable on phones and tablets: on-screen controls, landscape only, a cheaper
graphics preset. Desktop stays exactly as it was. Started and finished 2026-10-09 (v0.5.0):
**Phases T1–T5 done**. Not yet tried on a real device (see "Testing").

## Decisions

| Topic | Choice |
|---|---|
| Aim + fire | **Fire button + drag-to-aim with the same thumb.** Hold the fire button to shoot; sliding that thumb while holding it aims, like the look area. No need to lift the aiming thumb to shoot. |
| Movement | **Floating joystick** on the left 45 % of the screen: the base appears where the thumb lands. Analog speed (slow walk → walk). **Auto-sprint** when the stick is pushed to the edge (≥ 95 % of the radius) and roughly forward (within ~45°); the ring turns accent-coloured. No sprint button. |
| Look | Drag anywhere on the right 55 % of the screen. Several fingers can look at once. |
| Crouch | **Hold**, like C on the keyboard. Jump and reload are taps. |
| Orientation | **Landscape only.** In portrait a "Turn your phone sideways" card covers the game and the game pauses. Tapping Play goes **fullscreen + locks landscape** where the browser allows it: Android Chrome both, iPad fullscreen only, iPhone neither (the rotate card and the phone's own rotation do the job there). |
| Graphics | **Automatic "low" preset on touch devices**, "high" (the old values) on desktop. `?gfx=low` / `?gfx=high` overrides it on any device. |
| Aim assist | **None for now.** Same hitscan and spread as desktop. |
| Detection | Decided **once at load** from the primary pointer. `?touch=1` / `?touch=0` force it. A touch-screen laptop keeps the desktop controls. |
| Keyboard on a tablet | A Bluetooth keyboard still works in touch mode: WASD wins over the stick when pressed, Shift / C add sprint / crouch. The mouse is ignored in touch mode (phones fake a `mousedown` for every tap). |
| Target devices | **Android phones on Chrome**, and **tablets** (iPad, Android tablets). iPhone works in landscape but without fullscreen or orientation lock. |
| Multiplayer | Nothing changes on the network. Phones and desktops play in the same room. |

## How it works

### Touch mode (`src/input/touchMode.js`)

`detectTouch()` runs once at page load. A device is "touch" when its primary pointer is a finger:
`(pointer: coarse)` matches, or the device can't hover (`(hover: none)`) and has a touch screen
(`navigator.maxTouchPoints > 0`). `?touch=1` forces touch mode (useful with the browser's device
emulation), `?touch=0` forces the desktop controls on a phone. The result is exported as
`touchMode` and sets `html.touch`, which every touch-only CSS rule hangs off.

### "In control" instead of pointer lock (`src/player/playerController.js`)

Phones have no pointer lock, and before T1 every input path checked it (movement, aiming, firing,
the pause card). Now:

- `player.active` = `locked` (desktop: pointer captured) **or** `touchActive` (touch: Play tapped,
  not paused since). Movement, arrow-key aiming, `weapon.canShoot()` and the pause card all use
  `active`.
- `lock()` captures the pointer on desktop; in touch mode it sets `touchActive` and calls
  `onLockChanged(true)`. `unlock()` exits pointer lock on desktop; in touch mode it clears
  `touchActive`, releases every finger (`releaseTouch()`) and calls `onLockChanged(false)`. pvp and
  main.js call `player.unlock()` instead of `document.exitPointerLock()`.
- `player.touch = {forward, right, throttle, sprint, crouch}` is written by the on-screen controls.
  `update()` merges it with the keyboard: the stick drives movement unless a movement key is
  pressed; sprint and crouch are OR-ed.
- `addLook(yaw, pitch)` takes a drag in radians. Pitch is clamped to ±1.55 rad, and the gun sways
  with it like with the mouse.
- The touchpad "disable while typing" hint is skipped in touch mode.

### Throttle (`src/player/playerCore.js`)

`PlayerCore.step()` takes an optional `input.throttle` (0..1) that scales the speed (walk, sprint
and crouch). It defaults to 1, so the keyboard and `npm run sim` are unchanged.

### Weapon (`src/player/weapon.js`)

`touchTrigger` is a third trigger next to `mouseTrigger` (left mouse) and `keyTrigger` (F).
`releaseTriggers()` lets go of all three; pause, death, the end of a match and a guest reconnect
call it. `mousedown` is ignored in touch mode.

### On-screen controls (`src/ui/touchControls.js`, `index.html` `#touch`)

`TouchControls` is created only in touch mode. It is visible while the player is in control
(after Play and the intro, until pause), and hidden with every finger released otherwise.

```
 [||] [=] [M]                          [ammo] [minimap]
 CV integrity                                 kill feed (3 lines)
 players
                     hints
                                                     (crouch)
  ( stick )                       (reload)   (FIRE)   (jump)
             [health]
 |<---- move zone 45 % ---->|<-------- look zone 55 % -------->|
```

- **Joystick** (`#t-move`, left 45 %): the base appears under the thumb. If the finger slides past
  1.35 × the radius, the base trails it, so turning back reacts at once. Distance → throttle:
  nothing inside the deadzone (12 %), then a linear ramp from 30 % of walk speed to full walk speed
  at 80 % of the radius. At ≥ 95 % and with the stick within ~45° of straight ahead
  (`forward > 0.7`), it sprints. When idle, a faded ring sits bottom-left as a hint.
- **Look** (`#t-look`, right 55 %): each finger's movement since the last event × `lookSensitivity`
  (× `pitchFactor` vertically) goes to `player.addLook()`.
- **Fire** (88 px, accent-coloured): pointerdown sets `weapon.touchTrigger` (plus the dry-fire
  click when empty) and also registers the finger as a looker, so dragging it aims. The trigger
  lets go when the last finger leaves the button.
- **Jump** (tap, goes through `core.queueJump()`, so the jump buffer applies), **crouch** (hold,
  `player.touch.crouch`), **reload** (tap).
- **Top row**, top-left: pause (`player.unlock()`, the pause card comes back), scoreboard (hold,
  shown only in multiplayer; `pvp.showBoard()`, which Tab also uses now), mute (kept in sync with M).
- **Multi-touch**: every finger is tracked by its `pointerId`, and each control calls
  `setPointerCapture`, so a finger that slides off its button keeps driving it. One stick finger at
  a time; any number of lookers. `pointerup`, `pointercancel` and `lostpointercapture` all end a
  finger.
- The game screen switches off what fights with the controls: `touch-action: none`, text
  selection, the long-press callout and context menu, the tap highlight and overscroll.

### Play, fullscreen and auto-pause (`src/input/fullscreen.js`, `src/main.js`)

- The pause card reads "Tap to play" and lists the touch controls (`.touch-only` / `.desk-only`
  elements, switched by `html.touch`).
- Tapping it calls `enterLandscapeFullscreen()` inside the tap handler (browsers only allow
  fullscreen from a user gesture), then `player.lock()`. It requests fullscreen (`webkit` prefix
  for iPad) and then `screen.orientation.lock("landscape")`. Both are best effort and never throw.
- **Auto-pause** in touch mode (`player.unlock()`) when:
  - the phone turns to portrait (`matchMedia("(orientation: portrait)")`);
  - the app goes to the background (`visibilitychange`, `document.hidden`);
  - the player leaves fullscreen (the Android back gesture), only if it was fullscreen before.
- **Rotate card** (`#rotate`): in portrait the game screen is covered by "Turn your phone sideways"
  with an animated phone icon. CSS only (`@media (orientation: portrait)`).

### HUD in touch mode (`src/style.css`, "mobile layout")

- `viewport-fit=cover` in `index.html`; every HUD element is offset by the safe-area insets
  (`--sl`, `--sr`, `--st`, `--sb`), so nothing sits under a notch or a rounded corner.
- Top-left: the button row, then CV integrity (no letter count) and the player list below it.
- Top-right: a smaller minimap (116 px), ammo to its left (the jump button used to cover it), and
  the kill feed under the minimap, **newest 3 lines only** (desktop: 6) so it stays clear of the
  crouch button.
- Hints move to the top centre, away from the stick. They read "Tap to skip the intro" and
  "tap ↻ to reload" (`Hud` gets `{touch}`).
- The health bar is smaller, bottom centre between the thumbs. The match bar and killcam text move
  up to fit.
- The pause and end-of-match cards scroll if they don't fit a ~390 px tall landscape phone.
- The start and join pages scroll and get compact below 520 px of height. The drop zone reads
  "Tap to pick your CV". Text inputs are 16 px so iOS doesn't zoom in when one is focused.

### Graphics presets (`src/config.js` `graphics`, `src/main.js`)

At startup main.js picks a preset and copies it into `config.gfx` (with its `name`) before the map
is built: `?gfx=low` / `?gfx=high` if given, else "low" on touch and "high" on desktop. The active
preset is logged with the world stats (`[playable-cv] world … graphics low`).

| | high (desktop) | low (touch) |
|---|---|---|
| Pixel ratio cap | 2 | 1.25 (a 3× phone screen would otherwise render ~6× the pixels) |
| Shadow map | 4096 | 2048 |
| Shadow filter | PCF soft | PCF |
| Sparks / dust | 1500 / 2500 | 750 / 1250 |
| Debris shards | 2500 | 1200 (the oldest get recycled, as before) |

## Tuning

All in `src/config.js`. There is no sensitivity setting in the UI yet.

```js
touch: {
  lookSensitivity: 0.0062, // rad per CSS pixel of drag (look area and fire button)
  pitchFactor: 0.85,       // vertical drag a bit slower than horizontal
  stickRadius: 56,         // px: how far the knob travels
  stickDeadzone: 0.12,     // fraction of the radius that does nothing
  minThrottle: 0.3,        // speed just past the deadzone (fraction of walk speed)
  sprintAt: 0.95,          // stick pushed this far, roughly forward, sprints
},
graphics: {
  high: { pixelRatio: 2, shadowMapSize: 4096, softShadows: true, particles: 1, debris: 2500 },
  low:  { pixelRatio: 1.25, shadowMapSize: 2048, softShadows: false, particles: 0.5, debris: 1200 },
},
```

- `lookSensitivity` 0.0062 rad/px: a 250 px swipe turns ~90°. Lower it if aiming feels twitchy.
- `stickRadius` must match `--stick` in `style.css` (2 × radius = 112 px).
- The ~45° sprint cone (`forward > 0.7`) and the 80 % "full walk" point are in
  `TouchControls.moveStick()`.
- Button sizes and positions are in `style.css` (`#t-fire`, `#t-jump`, `#t-crouch`, `#t-reload`).
- If a phone still runs slowly, try `pixelRatio: 1` in `low` first: it has the biggest effect.

## Phases

**T1 — Touch mode + "in control"** ✅ `ddfe044` "Mobile T1: touch-mode detection + "in control" instead of pointer lock"
`input/touchMode.js`, `player.active`, `lock()` / `unlock()`, `player.touch`, `addLook()`,
`PlayerCore` throttle, `weapon.touchTrigger` / `releaseTriggers()`. Desktop unchanged.

**T2 — On-screen controls** ✅ `bb618db` "Mobile T2: on-screen touch controls (joystick, look, fire + aim, buttons)"
`ui/touchControls.js`, `#touch` in `index.html`, `config.touch`, `pvp.showBoard()`.

**T3 — Phone screens** ✅ `8a424f1` "Mobile T3: phone screens - tap to play, landscape only, fullscreen, HUD layout"
Tap to play + touch legend, rotate card, `input/fullscreen.js`, auto-pause, HUD layout with safe
areas, touch hints, compact start pages, 16 px inputs.

**T4 — Graphics preset** ✅ `3060cf0` "Mobile T4: cheaper graphics preset on phones and tablets"
`config.graphics` low / high, `config.gfx`, `?gfx=`.

**T5 — Checks + kill feed fix** ✅ `6928d53` "Mobile T5: keep the kill feed clear of the crouch button on phones"
Kill feed limited to 3 lines in touch mode; full regression pass.

Each phase: tested, committed locally (never pushed). Docs: this file, README, PLAN (v0.5.0).

## Testing

### Done (2026-10-09)

- `npm run sim`, `test:ray`, `test:interp`, `sim:net`, `sim:pvp`, `sim:match`: all pass. The
  throttle defaults to 1, so the movement sim is unchanged.
- **Desktop regression** in Chromium: no `touch` class, "high" graphics, click to play locks the
  pointer, WASD + F move and fire, the pause card shows the key list.
- **Emulated Pixel 7** in landscape, multi-touch sent over the DevTools protocol (CDP): stick and
  look with two fingers at once, sprint at the stick edge, fire while dragging, crouch hold, jump,
  reload, pause, the portrait card, the multiplayer HUD and the start page on a short screen.
- The emulation used software GL and ran at **~1 fps**, so it says nothing about feel or frame rate.

### Real-device checklist

Get the game on the device in one of two ways:

- **LAN**: `npm run dev -- --host` on the PC, then open the `http://192.168.x.x:5173` address Vite
  prints on the phone (same Wi-Fi).
- **Deployed**: https://logicesecutor.github.io/playable_cv/ after a push (HTTPS, closest to real use).

Add `?gfx=high` to compare presets, `?touch=0` to see the desktop layout on the device.

**Android phone, Chrome**

- [ ] Frame rate: smooth while walking, and while shooting a big letter (debris + dust). Note the
      model and whether `?gfx=low` with `pixelRatio: 1` is needed.
- [ ] Start page in landscape: title, "Tap to pick your CV", the file picker opens Files / Drive.
- [ ] Tap to play: goes fullscreen and the screen locks to landscape.
- [ ] Two-thumb play: move + look at the same time, sprint at the stick edge, fire while dragging
      to aim, crouch hold while moving, jump, reload. No browser menus, zoom or page scroll.
- [ ] Look sensitivity: comfortable for a 180° turn and for fine aim at a far letter.
- [ ] Turn to portrait: the rotate card shows and the game pauses; back to landscape + tap resumes.
- [ ] Back gesture: leaves fullscreen and pauses; Play goes fullscreen again.
- [ ] Background the app (home, notification, call) and come back: paused, no stuck trigger or
      movement, sound still works after Play.
- [ ] Notch / punch-hole / rounded corners: no button or HUD text cut off on either side (rotate
      the phone both ways).
- [ ] Pause card: the name input brings up the keyboard without zooming the page or breaking the
      layout; **Invite friends** and **Copy** work.
- [ ] Multiplayer with a desktop player: join from the phone via an invite link (and host from the
      phone), both see and shoot each other, scoreboard button, kill feed (3 lines), killcam,
      respawn, end card and rematch fit the screen.

**iPad / Android tablet**

- [ ] Same list as above. iPad: fullscreen on Play but no orientation lock (expected); the rotate
      card covers portrait.
- [ ] Controls are within thumb reach on a big screen, and the stick / buttons are not too small.
- [ ] Frame rate at the tablet's resolution (the 1.25 pixel ratio cap matters most here).
- [ ] With a Bluetooth keyboard: WASD overrides the stick, the touch buttons still work.

**iPhone (if at hand)**

- [ ] Plays in landscape after turning the phone; no fullscreen (expected). Check the Safari
      toolbar doesn't cover the bottom buttons.

## Known limits

- **No aim assist.** Hitting players on a phone against a mouse player may be hard; decide after a
  real playtest.
- **No gyro aiming.**
- **No sensitivity slider in the UI**: `config.touch` only.
- **iPhone can't lock orientation or go fullscreen**: the rotate card is the only guard.
- **Feel and performance are untested on real hardware**: the emulated run was ~1 fps.
- **Touch mode is decided once at load** from the primary pointer. A hybrid laptop with a touch
  screen keeps the desktop controls; `?touch=1` / `?touch=0` switch by hand.

## Ideas for later

- Optional light aim assist (slow-down over a target) if phone vs desktop feels unfair.
- Gyro aiming as an option.
- Sensitivity and button-size settings on the pause card (with M9's settings panel).
- Haptic feedback on hits (`navigator.vibrate`, Android only).
