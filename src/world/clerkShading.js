// The giant office worker's PBR look in the game (docs/LOOKDEV.md, L5).
//
// Her office.glb materials (Clerk_*) are physically based (base colour, normal, ORM maps; coat on
// the eyes / glasses / nails, sheen on the knit and the hair). The game's own lights are aimed at
// the page and live in game space, so she ignores them: every scene light is replaced, in her
// shader, by lights of the OFFICE, given in the office's frame and turned into view space every
// frame (she stays lit like the baked room however the office swings around the page):
//
//   key      the ceiling panel right above her desk (warm white); it stutters now and then
//   fill     the windows on the room's +X wall (cool, soft)
//   monitor  her screen: a cool point light that wobbles as the screen content changes
//   ambient  a small sky / carpet hemisphere
//   IBL      an environment map rendered from the baked office at her head (initEnv), rotated
//            with the office (envMapRotation): her glasses, eyes, nails and skin reflect the room
//
// Skin gets a cheap subsurface look (light wrapping past the terminator, reddest in red), and the
// output goes through the same soft shoulder as the office bake (1 - e^-x), not the game's ACES,
// so she sits in the room like the baked furniture does.
import * as THREE from "three";

// office-space points (Blender x, y, z -> three.js x, z, -y), real metres
const P = (x, y, z) => new THREE.Vector3(x, z, -y);
export const CLERK_SPOTS = {
  head: P(-0.15, -0.55, 1.25), // where the environment map is captured
  panel: P(0, 0, 2.788), // the ceiling panel above her desk (build_office.py PANELS_X/Y = 0, 0)
  monitor: P(-0.15, 0.233, 1.06), // her screen's centre (build_office.py build_clutter)
};

const SHADER_PARS = /* glsl */ `
uniform vec3 uKeyDir, uKeyCol, uFillDir, uFillCol, uMonPos, uMonCol, uUpView, uSky, uGround;
uniform float uMonRange, uSSS, uExpo;
#ifdef CLERK_SSS
void clerkWrap( const in IncidentLight L, const in vec3 n, const in PhysicalMaterial material, inout ReflectedLight rl ) {
  float nl = dot( n, L.direction );
  vec3 w = vec3( 0.6, 0.32, 0.22 );
  vec3 wrapped = clamp( ( vec3( nl ) + w ) / ( 1.0 + w ), 0.0, 1.0 );
  rl.directDiffuse += ( wrapped - max( nl, 0.0 ) ) * L.color * BRDF_Lambert( material.diffuseColor ) * uSSS;
}
#endif
`;

const LIGHTS = /* glsl */ `
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
  geometryClearcoatNormal = clearcoatNormal;
#endif
IncidentLight directLight;
directLight.visible = true;
// key: the ceiling panel
directLight.direction = uKeyDir;
directLight.color = uKeyCol;
RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#ifdef CLERK_SSS
  clerkWrap( directLight, geometryNormal, material, reflectedLight );
#endif
// fill: the windows
directLight.direction = uFillDir;
directLight.color = uFillCol;
RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
// her monitor
{
  vec3 lv = uMonPos - geometryPosition;
  float d = length( lv );
  directLight.direction = lv / d;
  directLight.color = uMonCol / ( 1.0 + pow2( d / uMonRange ) );
  RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  #ifdef CLERK_SSS
    clerkWrap( directLight, geometryNormal, material, reflectedLight );
  #endif
}
#if defined( RE_IndirectDiffuse )
  vec3 iblIrradiance = vec3( 0.0 );
  vec3 irradiance = mix( uGround, uSky, dot( geometryNormal, uUpView ) * 0.5 + 0.5 );
#endif
#if defined( RE_IndirectSpecular )
  vec3 radiance = vec3( 0.0 );
  vec3 clearcoatRadiance = vec3( 0.0 );
#endif
`;

export class ClerkShading {
  /** @param {any} cfg config.office.clerk */
  constructor(cfg = {}) {
    this.cfg = cfg;
    this.uniforms = {
      uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
      uKeyCol: { value: new THREE.Color() },
      uFillDir: { value: new THREE.Vector3(1, 0, 0) },
      uFillCol: { value: new THREE.Color() },
      uMonPos: { value: new THREE.Vector3() },
      uMonCol: { value: new THREE.Color() },
      uMonRange: { value: 1 },
      uUpView: { value: new THREE.Vector3(0, 1, 0) },
      uSky: { value: new THREE.Color(cfg.sky ?? 0x6e6a62) },
      uGround: { value: new THREE.Color(cfg.ground ?? 0x2e2e34) },
      uSSS: { value: cfg.sss ?? 0.55 },
      uExpo: { value: cfg.exposure ?? 1.35 },
    };
    this.materials = [];
    this.envMap = null;
    this._q = new THREE.Quaternion();
    this._m3 = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
  }

  /** the game's version of one of her glTF materials */
  material(src) {
    const m = src.clone();
    const name = src.name;
    m.fog = false;
    m.toneMapped = false;
    if (name === "Clerk_Lens") {
      Object.assign(m, { transparent: true, opacity: this.cfg.lensOpacity ?? 0.07, depthWrite: false, roughness: 0.02, metalness: 0 });
      m.side = THREE.DoubleSide;
    } else m.side = THREE.FrontSide;
    if (m.isMeshPhysicalMaterial) {
      if (name === "Clerk_Cloth") m.sheenColor = new THREE.Color(0xd9c3cf).multiplyScalar(0.55);
      if (name === "Clerk_Hair") m.sheenColor = new THREE.Color(0x8a6a52).multiplyScalar(0.5);
      if (name === "Clerk_Acc") m.clearcoat = this.cfg.accCoat ?? 0.6; // full coat mirrored the room on the frames
    }
    m.envMapIntensity = this.cfg.envIntensity ?? 1;
    const skin = name === "Clerk_Skin";
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      if (skin) shader.defines = { ...(shader.defines || {}), CLERK_SSS: "" };
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <lights_physical_pars_fragment>", `#include <lights_physical_pars_fragment>\n${SHADER_PARS}`)
        .replace("#include <lights_fragment_begin>", LIGHTS)
        .replace("#include <opaque_fragment>", "outgoingLight = 1.0 - exp( -outgoingLight * uExpo );\n#include <opaque_fragment>");
    };
    m.customProgramCacheKey = () => `pcv-clerk-${skin ? "skin" : "pbr"}`;
    if (this.envMap) m.envMap = this.envMap;
    this.materials.push(m);
    return m;
  }

  /**
   * Capture the baked office from her head into a PMREM environment map (once, at load). Only the
   * static, unlit office meshes are rendered, at real scale, in a scene of their own.
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Object3D[]} meshes office meshes (already with their game materials)
   */
  initEnv(renderer, meshes) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcfc8b6);
    for (const o of meshes) {
      const c = new THREE.Mesh(o.geometry, o.material);
      o.updateWorldMatrix(true, false);
      // the meshes' matrices relative to the office content (real metres, office frame)
      c.matrixAutoUpdate = false;
      c.matrix.copy(o.userData.officeMatrix ?? o.matrix);
      scene.add(c);
    }
    const rt = new THREE.WebGLCubeRenderTarget(this.cfg.envSize ?? 128, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.02, 30, rt);
    cam.position.copy(CLERK_SPOTS.head);
    scene.add(cam);
    cam.update(renderer, scene);
    const pm = new THREE.PMREMGenerator(renderer);
    this.envMap = pm.fromCubemap(rt.texture).texture;
    pm.dispose();
    rt.dispose();
    for (const m of this.materials) {
      m.envMap = this.envMap;
      m.needsUpdate = true;
    }
  }

  /**
   * Per frame: the office's lights in view space, the environment's rotation, the light events.
   * @param {THREE.Matrix4} officeWorld office content's matrixWorld (real metres -> game space)
   * @param {THREE.Camera} camera
   * @param {{panel: number, monitor: number}} levels 0..1 outputs of the panel and the screen
   */
  update(officeWorld, camera, levels) {
    const u = this.uniforms, c = this.cfg;
    const view = camera.matrixWorldInverse;
    const key = this._v.fromArray(c.keyDir ?? [0.15, 1.54, -0.55]).normalize();
    u.uKeyDir.value.copy(key).transformDirection(officeWorld).transformDirection(view);
    u.uFillDir.value.fromArray(c.fillDir ?? [1, 0.15, 0.1]).normalize().transformDirection(officeWorld).transformDirection(view);
    u.uUpView.value.set(0, 1, 0).transformDirection(officeWorld).transformDirection(view);
    const kc = c.key ?? [1.0, 0.95, 0.86], ki = (c.keyIntensity ?? 3.0) * (0.25 + 0.75 * levels.panel);
    u.uKeyCol.value.setRGB(kc[0] * ki, kc[1] * ki, kc[2] * ki);
    const fc = c.fill ?? [0.78, 0.86, 1.0], fi = c.fillIntensity ?? 0.5;
    u.uFillCol.value.setRGB(fc[0] * fi, fc[1] * fi, fc[2] * fi);
    const mc = c.monitor ?? [0.62, 0.74, 1.0], mi = (c.monitorIntensity ?? 0.9) * levels.monitor;
    u.uMonCol.value.setRGB(mc[0] * mi, mc[1] * mi, mc[2] * mi);
    u.uMonPos.value.copy(CLERK_SPOTS.monitor).applyMatrix4(officeWorld).applyMatrix4(view);
    officeWorld.decompose(this._p, this._q, this._s);
    u.uMonRange.value = (c.monitorRange ?? 0.55) * this._s.x;
    // world direction -> office frame for the environment lookup
    const inv = this._m3.makeRotationFromQuaternion(this._q).invert();
    for (const m of this.materials) m.envMapRotation.setFromRotationMatrix(inv);
  }
}
