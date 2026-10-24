import { MultiRenderTarget } from "@babylonjs/core/Materials/Textures/multiRenderTarget.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial.js";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial.js";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";
import { Color4 } from "@babylonjs/core/Maths/math.color.js";
import "@babylonjs/core/ShadersWGSL/ShadersInclude/bonesDeclaration.js";
import "@babylonjs/core/ShadersWGSL/ShadersInclude/bonesVertex.js";
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.multiRender.js";
import surface from "./surface.wgsl?raw";
import vertexSource from "./gbuffer.vertex.wgsl?raw";
import fragment from "./gbuffer.fragment.wgsl?raw";

const { TEXTURETYPE_UNSIGNED_BYTE: U8, TEXTURETYPE_HALF_FLOAT: F16, TEXTURETYPE_FLOAT: F32 } = Constants;
const { TEXTUREFORMAT_RGBA: RGBA, TEXTUREFORMAT_R: R, TEXTUREFORMAT_RG: RG } = Constants;

/**
 * The G-buffer: every mesh rasterized once into 5 targets (layout in gbuffer.fragment.wgsl) with
 * our material shader; view.js shows them. The camera's own pass draws nothing (layerMask 0). `materials[id - 1]` is the source
 * material behind each material id (0 = nothing hit).
 */
export function createGBuffer(scene, camera) {
  const engine = scene.getEngine();
  const size = () => ({ width: engine.getRenderWidth(), height: engine.getRenderHeight() });
  const mrt = new MultiRenderTarget("gbuffer", size(), 5, scene, {
    types: [U8, F16, F16, F32, F16],
    formats: [RGBA, RGBA, RGBA, R, RG],
    samplingModes: Array(5).fill(Constants.TEXTURE_NEAREST_SAMPLINGMODE),
    generateMipMaps: false,
    generateDepthBuffer: true,
  }, ["albedo", "normal", "emission", "depth", "motion"]);
  mrt.clearColor = new Color4(0, 0, 0, 0);
  mrt.renderList = scene.meshes.filter((m) => m.getTotalVertices() > 0);
  scene.customRenderTargets.push(mrt);
  camera.layerMask = 0;

  // last frame's transforms, for the motion vectors
  const prev = new Map();
  const prevViewProjection = camera.getTransformationMatrix().clone();

  // one G-buffer material per source material, ids in creation order
  const materials = [];
  const made = new Map();
  const textures = {};
  const texture = (file, srgb) => {
    if (!textures[file]) {
      textures[file] = new Texture(`textures/${file}`, scene, { invertY: false, useSRGBBuffer: srgb }); // glTF UVs: v down
      textures[file].anisotropicFilteringLevel = 8;
    }
    return textures[file];
  };
  const gbufferMaterial = (m) => {
    if (made.has(m)) return made.get(m);
    let g;
    if (m instanceof MultiMaterial) {
      g = new MultiMaterial(`gbuffer.${m.name}`, scene);
      g.subMaterials = m.subMaterials.map(gbufferMaterial);
    } else {
      const x = m.metadata?.gltf?.extras ?? {};
      const defines = x.set ? ["#define SET"] : m.albedoTexture ? ["#define ALBEDO_TEX"] : [];
      g = new ShaderMaterial(`gbuffer.${m.name}`, scene, { vertexSource, fragmentSource: surface + fragment }, {
        attributes: ["position", "normal", "uv"],
        uniforms: ["world", "viewProjection", "prevWorld", "prevViewProjection", "cameraPosition", "color", "roughness",
          "metal", "emission", "materialId", "microRepeat", "microStrength", "mPreviousBones"],
        samplers: ["albedoTex", "normalTex", "ormTex", "microTex"],
        defines: [...defines, "#define BONES_VELOCITY_ENABLED"],
        shaderLanguage: ShaderLanguage.WGSL,
      });
      g.backFaceCulling = m.backFaceCulling;
      g.sideOrientation = m.sideOrientation;
      materials.push(m);
      g.setFloat("materialId", materials.length);
      g.setColor3("color", m.albedoColor);
      g.setFloat("roughness", m.roughness ?? 1);
      g.setFloat("metal", m.metallic ?? 0);
      g.setColor3("emission", m.emissiveColor.scale(m.emissiveIntensity));
      if (x.set) {
        g.setTexture("albedoTex", texture(`${x.set}_albedo.jpg`, true));
        g.setTexture("normalTex", texture(`${x.set}_normal.png`, false));
        g.setTexture("ormTex", texture(`${x.set}_orm.png`, false));
        g.setTexture("microTex", texture(`micro_${x.micro}.png`, false));
        g.setFloat("microRepeat", x.microRepeat);
        g.setFloat("microStrength", x.microStrength);
      } else if (m.albedoTexture) {
        g.setTexture("albedoTex", m.albedoTexture); // the glTF loader makes it an sRGB buffer
      }
      g.onBindObservable.add((mesh) => {
        const p = prev.get(mesh);
        const effect = g.getEffect();
        effect.setMatrix("prevWorld", p.world);
        if (p.bones) effect.setMatrices("mPreviousBones", p.bones);
      });
    }
    made.set(m, g);
    return g;
  };

  const skinned = mrt.renderList.filter((m) => m.skeleton);
  for (const m of mrt.renderList) {
    m.skeleton && (m.skeleton.useTextureToStoreBoneMatrices = false); // a uniform array, like mPreviousBones
    mrt.setMaterialForRendering(m, gbufferMaterial(m.material));
    prev.set(m, { world: m.computeWorldMatrix(true).clone(), bones: m.skeleton && new Float32Array(16 * (m.skeleton.bones.length + 1)) }); // BonesPerMesh = bones + 1
  }
  // the camera's pass skips every mesh, so their skeletons are not prepared by the scene. Forced:
  // prepare() skips a render id it has seen, and this observable also fires at the end of a frame
  scene.onBeforeRenderTargetsRenderObservable.add(() => {
    skinned.forEach((m) => m.skeleton.prepare(true));
    for (const g of made.values()) g.setMatrix?.("prevViewProjection", prevViewProjection);
  });
  scene.onAfterRenderObservable.add(() => {
    for (const [m, p] of prev) {
      p.world.copyFrom(m.getWorldMatrix());
      p.bones?.set(m.skeleton.getTransformMatrices(m));
    }
    prevViewProjection.copyFrom(camera.getTransformationMatrix());
  });

  return {
    mrt,
    materials,
    resize: () => mrt.resize(size()),
  };
}
