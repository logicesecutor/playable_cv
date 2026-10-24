#include<bonesDeclaration>

attribute position : vec3f;
attribute normal : vec3f;
attribute uv : vec2f;

uniform world : mat4x4f;
uniform viewProjection : mat4x4f;
uniform prevWorld : mat4x4f;
uniform prevViewProjection : mat4x4f;

varying vPos : vec3f;
varying vNormal : vec3f;
varying vUV : vec2f;
varying vClip : vec4f;
varying vPrevClip : vec4f;

@vertex
fn main(input : VertexInputs) -> FragmentInputs {
  var finalWorld = uniforms.world;
  var prevWorld = uniforms.prevWorld;
#if NUM_BONE_INFLUENCERS > 0
  // last frame's skin, for the motion vectors (player_corporate has 4 influences per vertex)
  let i = vertexInputs.matricesIndices;
  let w = vertexInputs.matricesWeights;
  prevWorld = prevWorld * (uniforms.mPreviousBones[i32(i[0])] * w[0] + uniforms.mPreviousBones[i32(i[1])] * w[1]
    + uniforms.mPreviousBones[i32(i[2])] * w[2] + uniforms.mPreviousBones[i32(i[3])] * w[3]);
#endif
#include<bonesVertex>
  let pos = finalWorld * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.vPos = pos.xyz;
  vertexOutputs.vNormal = (finalWorld * vec4f(vertexInputs.normal, 0.0)).xyz; // uniform scales only
  vertexOutputs.vUV = vertexInputs.uv;
  vertexOutputs.vClip = uniforms.viewProjection * pos;
  vertexOutputs.vPrevClip = uniforms.prevViewProjection * prevWorld * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.position = vertexOutputs.vClip;
}
