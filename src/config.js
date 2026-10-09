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

  // ---- touch controls (phones / tablets, ui/touchControls.js)
  touch: {
    lookSensitivity: 0.0062, // rad per CSS pixel of drag (look area and fire button)
    pitchFactor: 0.85, // vertical drag a bit slower than horizontal
    stickRadius: 56, // px: how far the knob travels
    stickDeadzone: 0.12, // fraction of the radius that does nothing
    minThrottle: 0.3, // speed just past the deadzone (fraction of walk speed)
    sprintAt: 0.95, // stick pushed this far, roughly forward, sprints
  },

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

  // ---- look of the Blender characters + gun (src/assets/models.js). URL overrides: ?toon=1 ?rim=0.5
  characters: {
    toon: false, // stepped toon lighting instead of smooth (MeshToonMaterial, 3 bands)
    rim: 0.35, // cool rim light on the silhouette (0 = off)
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

  // ---- multiplayer (peer-to-peer WebRTC; the host's browser is the server)
  net: {
    maxPlayers: 8,
    killTarget: 10, // first to this many kills wins the match
    connectTimeout: 15000, // ms to get a direct connection once the host is found
    // matchmaking ("signaling") server: only used to introduce the two browsers to each other.
    // Default: the free public PeerJS server. Override per page load with
    //   ?broker=ws://192.168.1.20:9000   (e.g. `npm run signal` on your LAN)
    broker: { host: "0.peerjs.com", port: 443, path: "/", secure: true, key: "peerjs", heartbeat: 5000, openTimeout: 8000 },
    // STUN lets browsers behind home routers find each other. Strict networks would also need
    // a TURN relay here: { urls: "turn:…", username: "…", credential: "…" }
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }],
    // Relay (TURN) for networks where a direct connection is impossible (free Metered account).
    // Simplest: Metered dashboard -> TURN Server -> Credentials -> "ICE" button on a credential,
    // paste the TURN entries here: [{ urls: "turn:…", username: "…", credential: "…" }, …]
    turnServers: [
      { urls: "stun:stun.relay.metered.ca:80" },
      { urls: "turn:global.relay.metered.ca:80", username: "3936a27c98ffa5cb0c5448f1", credential: "qgD3ndGTM8N75yd9" },
      { urls: "turn:global.relay.metered.ca:80?transport=tcp", username: "3936a27c98ffa5cb0c5448f1", credential: "qgD3ndGTM8N75yd9" },
      { urls: "turn:global.relay.metered.ca:443", username: "3936a27c98ffa5cb0c5448f1", credential: "qgD3ndGTM8N75yd9" },
      { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: "3936a27c98ffa5cb0c5448f1", credential: "qgD3ndGTM8N75yd9" },
    ],
    // Alternative: fetch fresh credentials. app = the <app> in https://<app>.metered.live,
    // apiKey = a credential's API key. Never the account's Secret Key. Empty = not used.
    turn: { metered: { app: "", apiKey: "" } },
  },
};
