// The M2 macro + micro blend (blender_src make_materials.closeup does the same in numpy); shared by
// the G-buffer raster and, from M6, the ray tracer's hit shading. Micro texel: R albedo, G normal
// Y, B roughness, A normal X, 0.5 = no change; s = the material's micro strength.
struct Surface {
  albedo : vec3f,
  normal : vec3f, // tangent space, +X right, +Y up the image
  roughness : f32,
}

fn microBlend(albedo : vec3f, normal : vec3f, roughness : f32, micro : vec4f, s : f32) -> Surface {
  var out : Surface;
  out.albedo = clamp(albedo * (1.0 + 2.0 * s * (micro.r - 0.5)), vec3f(0.0), vec3f(1.0));
  out.normal = normalize(vec3f(normal.xy + (micro.ag - 0.5) * 2.0 * s, normal.z)); // whiteout-style
  out.roughness = clamp(roughness * (1.0 + 2.0 * s * (micro.b - 0.5)), 0.02, 1.0);
  return out;
}
