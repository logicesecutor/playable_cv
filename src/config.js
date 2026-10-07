// Every tunable number in one place.
export const config = {
  // ---- map scale
  metersPerPt: 0.3, // 1 PDF point -> metres. A4 page = ~179 x 253 m
  bodyHeight: 1.25, // extrusion height of body-size text (m): "cover height"
  heightExponent: 1.15, // bigger fonts get taller faster than linearly
  minHeight: 0.5,
  vectorHeight: 1.0, // filled shapes that are not glyphs
  ruleHeight: 0.7, // horizontal lines (section rules)
  ruleMinThickness: 0.25, // m, so hairlines are still solid walls
  curveSteps: 6, // segments per glyph curve (quality vs triangles)
  rasterScale: 3, // px per pt for the floor texture / minimap

  // ---- camera / input
  fov: 75,
  mouseSensitivity: 0.0022,
  keyLookSpeed: 2.4, // rad/s when aiming with the arrow keys

  // ---- player (metres, seconds)
  player: {
    radius: 0.35,
    eyeHeight: 1.65,
    crouchEyeHeight: 0.95, // below body-text height: crouch to take cover
    walkSpeed: 6.5,
    sprintSpeed: 11,
    crouchSpeed: 3,
    groundAccel: 14, // how fast velocity reaches the target on the ground (1/s)
    airAccel: 3, // air control
    jumpSpeed: 7.8, // apex ~1.4 m: enough to climb onto body text, not onto the name
    gravity: 22,
    stepHeight: 0.4, // walk up ledges this tall without jumping
    coyoteTime: 0.1, // can still jump this long after walking off an edge
    jumpBuffer: 0.12, // a jump pressed this early before landing still fires
    headBob: 0.045,
  },

  // ---- weapon
  weapon: {
    magazine: 30,
    fireInterval: 0.095, // ~630 rounds/min, automatic
    reloadTime: 1.3,
    autoReload: true, // pulling the trigger on an empty mag reloads
    spread: 0.004, // radians, standing still
    moveSpread: 0.02, // extra at full sprint speed
    airSpread: 0.04, // extra while airborne
    range: 400,
    kickPitch: 0.006, // permanent aim climb per shot
    kickYaw: 0.006,
    punch: 0.025, // visual-only kick that springs back
  },

  // ---- intro timeline (seconds)
  intro: {
    hold: 1.0, // flat page, top view
    rise: 2.0, // letters grow out of the paper
    flyStart: 2.4, // camera starts moving (overlaps the rise)
    fly: 3.2, // camera swoop to the spawn point
  },

  // ---- look
  inkLift: 0.1, // lifts pure black a little so letters show shading
};
