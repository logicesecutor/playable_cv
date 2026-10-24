import { RawTexture2DArray } from "@babylonjs/core/Materials/Textures/rawTexture2DArray.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Constants } from "@babylonjs/core/Engines/constants.js";

export const SIZE = 512; // secondary hits see the textures blurred by their ray cones: half the raster's 1024 is plenty

/**
 * The texture arrays for the ray tracer's hit shading (M8): one layer per macro set (albedo, ORM),
 * one per other albedo texture (the player's palettes) and a white layer last for materials without
 * textures, so the shader always samples both arrays. Albedo is stored linear (8 bits) so the mips
 * average light, not sRGB codes. No normal or micro maps: at secondary hits they are not visible.
 * `layer(material)` is the layer of a G-buffer source material.
 */
export async function loadTextureArrays(scene, materials) {
  const sets = [...new Set(materials.map((m) => m.metadata?.gltf?.extras?.set).filter(Boolean))];
  const others = [...new Set(materials.filter((m) => !m.metadata?.gltf?.extras?.set && m.albedoTexture).map((m) => m.albedoTexture))];
  const layers = sets.length + others.length + 1;
  const albedo = new Uint8Array(4 * SIZE * SIZE * layers).fill(255);
  const orm = new Uint8Array(albedo.length).fill(255);
  const toLinear = Uint8Array.from({ length: 256 }, (_, c) => {
    const s = c / 255;
    return Math.round(255 * (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4));
  });
  const linear = (rgba) => rgba.map((c, i) => ((i & 3) === 3 ? c : toLinear[c]));
  const file = async (name) => {
    const blob = await (await fetch(`textures/${name}`)).blob();
    const image = await createImageBitmap(blob, {
      resizeWidth: SIZE, resizeHeight: SIZE, resizeQuality: "high", colorSpaceConversion: "none", premultiplyAlpha: "none",
    });
    const ctx = new OffscreenCanvas(SIZE, SIZE).getContext("2d");
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, SIZE, SIZE).data;
  };
  const slice = (i) => 4 * SIZE * SIZE * i;
  await Promise.all(sets.map(async (set, i) => {
    const [a, o] = await Promise.all([file(`${set}_albedo.jpg`), file(`${set}_orm.png`)]);
    albedo.set(linear(a), slice(i));
    orm.set(o, slice(i));
  }));
  await Promise.all(others.map(async (tex, i) => {
    // the glTF loader's textures are not inverted: row 0 is v = 0, as in the arrays
    const src = new Uint8Array((await tex.readPixels()).buffer);
    const { width: w, height: h } = tex.getSize();
    const up = new Uint8Array(4 * SIZE * SIZE); // nearest: a palette is flat colour cells
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const s = 4 * (Math.floor((y * h) / SIZE) * w + Math.floor((x * w) / SIZE));
        up.set(src.subarray(s, s + 4), 4 * (y * SIZE + x));
      }
    }
    albedo.set(linear(up), slice(sets.length + i));
  }));

  const array = (data) => {
    const t = new RawTexture2DArray(data, SIZE, SIZE, layers, Constants.TEXTUREFORMAT_RGBA, scene, true, false,
      Texture.TRILINEAR_SAMPLINGMODE);
    t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 1;
    return t;
  };
  return {
    albedo: array(albedo),
    orm: array(orm),
    layer(m) {
      const set = m.metadata?.gltf?.extras?.set;
      if (set) return sets.indexOf(set);
      if (m.albedoTexture) return sets.length + others.indexOf(m.albedoTexture);
      return layers - 1;
    },
  };
}
