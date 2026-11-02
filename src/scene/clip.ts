import { Material, Vector2, type Mesh, type Object3D, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from "three";
import { LOWER_MANHATTAN } from "../model/bounds";
import { toLocal } from "./geodesy";

const POLY = 32;
const SLICE = 24;

export const clipUniforms = {
  uPoly: { value: Array.from({ length: POLY }, () => new Vector2()) },
  uSlice: { value: Array.from({ length: SLICE }, () => new Vector2()) },
  uSliceOn: { value: 0 },
  uSliceY: { value: 0 },
};

fill(clipUniforms.uPoly.value, ringToLocal(LOWER_MANHATTAN));

function ringToLocal(ring: [number, number][]): Vector2[] {
  return ring.map(([lon, lat]) => {
    const p = toLocal(lon, lat, 0);
    return new Vector2(p.x, p.z);
  });
}

function fill(target: Vector2[], source: Vector2[]): void {
  const last = source[source.length - 1] ?? new Vector2();
  for (let i = 0; i < target.length; i += 1) {
    const point = source[Math.min(i, source.length - 1)] ?? last;
    target[i].copy(point);
  }
}

export function setSlice(ring: [number, number][] | null, heightY: number | null): void {
  if (!ring || heightY == null) {
    clipUniforms.uSliceOn.value = 0;
    return;
  }
  fill(clipUniforms.uSlice.value, ringToLocal(ring));
  clipUniforms.uSliceY.value = heightY;
  clipUniforms.uSliceOn.value = 1;
}

function unrolledInside(name: string, count: number): string {
  const tests: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const previous = (i + count - 1) % count;
    tests.push(`if (clipCross(p, ${name}[${i}], ${name}[${previous}])) inside = !inside;`);
  }
  return tests.join("\n  ");
}

const CLIP_PARS = /* glsl */ `
varying vec3 vClipWorld;
uniform vec2 uPoly[${POLY}];
uniform vec2 uSlice[${SLICE}];
uniform float uSliceOn;
uniform float uSliceY;
bool clipCross(vec2 p, vec2 a, vec2 b) {
  bool crosses = (a.y > p.y) != (b.y > p.y);
  if (!crosses) return false;
  float xCross = (b.x - a.x) * (p.y - a.y) / (b.y - a.y + 1e-6) + a.x;
  return p.x < xCross;
}
bool clipDistrict(vec2 p) {
  bool inside = false;
  ${unrolledInside("uPoly", POLY)}
  return inside;
}
bool clipSlice(vec2 p) {
  bool inside = false;
  ${unrolledInside("uSlice", SLICE)}
  return inside;
}
`;

export function patchClipMaterial(material: Material): void {
  const tagged = material as Material & { userData: { clipPatched?: boolean } };
  if (tagged.userData.clipPatched) return;
  tagged.userData.clipPatched = true;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => {
    previous?.(shader, renderer);
    shader.uniforms.uPoly = clipUniforms.uPoly;
    shader.uniforms.uSlice = clipUniforms.uSlice;
    shader.uniforms.uSliceOn = clipUniforms.uSliceOn;
    shader.uniforms.uSliceY = clipUniforms.uSliceY;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vClipWorld;")
      .replace(
        "#include <project_vertex>",
        "vClipWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>",
      );
    if (!shader.vertexShader.includes("vClipWorld")) return;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${CLIP_PARS}`)
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        if (!clipDistrict(vClipWorld.xz)) discard;
        if (uSliceOn > 0.5 && vClipWorld.y > uSliceY && clipSlice(vClipWorld.xz)) discard;`,
      );
  };
  material.customProgramCacheKey = () => `${previousKey?.() ?? ""}|manhattan-clip`;
  material.needsUpdate = true;
}

export function patchClipObject(root: Object3D): void {
  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) patchClipMaterial(material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}
