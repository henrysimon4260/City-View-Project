import {
  Color,
  DoubleSide,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  HalfFloatType,
  LinearFilter,
  type WebGLRenderer,
} from "three";
import { SEA_LEVEL_Y } from "./geodesy";

const vertex = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying vec2 vXZ;
void main() {
  vec3 transformed = position;
  float swell = sin(dot(transformed.xz, vec2(0.04, 0.015)) + uTime * 0.35) * 0.55;
  swell += sin(dot(transformed.xz, vec2(-0.02, 0.05)) + uTime * 0.22) * 0.35;
  transformed.y += swell;
  vec4 world = modelMatrix * vec4(transformed, 1.0);
  vWorld = world.xyz;
  vXZ = transformed.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragment = /* glsl */ `
uniform sampler2D uReflection;
uniform vec2 uResolution;
uniform float uTime;
uniform float uReflect;
uniform vec3 uCamera;
uniform vec3 uSun;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSky;
varying vec3 vWorld;
varying vec2 vXZ;
float ripple(vec2 p) {
  float h = 0.0;
  h += sin(dot(p, vec2(0.011, 0.004)) + uTime * 0.4);
  h += sin(dot(p, vec2(-0.005, 0.013)) + uTime * 0.28) * 0.55;
  h += sin(dot(p, vec2(0.016, -0.008)) + uTime * 0.62) * 0.22;
  return h;
}
void main() {
  float e = 6.0;
  float h = ripple(vXZ);
  vec3 normal = normalize(vec3(-(ripple(vXZ + vec2(e, 0.0)) - h) / e, 2.4, -(ripple(vXZ + vec2(0.0, e)) - h) / e));
  vec3 viewDir = normalize(uCamera - vWorld);
  float fresnel = pow(1.0 - clamp(dot(normal, viewDir), 0.0, 1.0), 3.0);
  vec2 uv = gl_FragCoord.xy / uResolution + normal.xz * 0.02;
  vec3 reflected = mix(uSky, texture2D(uReflection, uv).rgb, uReflect);
  vec3 water = mix(uShallow, uDeep, clamp(fresnel + 0.15, 0.0, 1.0));
  vec3 color = mix(water, reflected, fresnel * 0.78);
  vec3 sunDir = normalize(uSun);
  float spec = pow(max(dot(reflect(-sunDir, normal), viewDir), 0.0), 90.0);
  color += vec3(1.0, 0.93, 0.82) * spec * 0.85;
  float glint = pow(max(dot(reflect(-sunDir, normal), viewDir), 0.0), 28.0);
  color += vec3(0.75, 0.86, 0.9) * glint * 0.18;
  gl_FragColor = vec4(color, 1.0);
}
`;

export class HarborWater {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly target: WebGLRenderTarget | null;
  private readonly reflectionCamera: PerspectiveCamera;
  private readonly sun = new Vector3();
  private time = 0;

  constructor(
    private readonly renderer: WebGLRenderer,
    reflections: boolean,
    scale: number,
  ) {
    const geometry = new PlaneGeometry(160000, 160000, 40, 40);
    geometry.rotateX(-Math.PI / 2);
    this.material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uReflection: { value: null },
        uResolution: { value: new Vector3(1, 1, 1) },
        uReflect: { value: reflections ? 1 : 0 },
        uCamera: { value: new Vector3() },
        uSun: { value: new Vector3(0, 1, 0) },
        uDeep: { value: new Color("#0c242c") },
        uShallow: { value: new Color("#1d4c56") },
        uSky: { value: new Color("#9ec3df") },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
      side: DoubleSide,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.position.y = SEA_LEVEL_Y;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = false;
    this.mesh.castShadow = false;
    this.mesh.layers.set(1);
    this.reflectionCamera = new PerspectiveCamera();
    const width = Math.max(16, Math.floor(renderer.domElement.width * scale));
    const height = Math.max(16, Math.floor(renderer.domElement.height * scale));
    this.target = reflections
      ? new WebGLRenderTarget(width, height, {
          type: HalfFloatType,
          depthBuffer: true,
          samples: 0,
        })
      : null;
    if (this.target) {
      this.target.texture.minFilter = LinearFilter;
      this.target.texture.magFilter = LinearFilter;
      this.material.uniforms.uReflection.value = this.target.texture;
    }
  }

  setSun(direction: Vector3): void {
    this.sun.copy(direction);
    (this.material.uniforms.uSun.value as Vector3).copy(direction).normalize();
  }

  setSize(width: number, height: number, scale: number): void {
    (this.material.uniforms.uResolution.value as Vector3).set(width, height, 1);
    if (!this.target || scale <= 0) return;
    this.target.setSize(Math.max(16, Math.floor(width * scale)), Math.max(16, Math.floor(height * scale)));
  }

  update(dt: number, camera: PerspectiveCamera, scene: Scene, enabled: boolean): void {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    (this.material.uniforms.uCamera.value as Vector3).copy(camera.position);
    if (!enabled || !this.target) return;
    const waterY = this.mesh.position.y;
    this.reflectionCamera.fov = camera.fov;
    this.reflectionCamera.aspect = camera.aspect;
    this.reflectionCamera.near = camera.near;
    this.reflectionCamera.far = camera.far;
    this.reflectionCamera.layers.set(0);
    const position = camera.position.clone();
    position.y = waterY - (position.y - waterY);
    this.reflectionCamera.position.copy(position);
    const look = new Vector3();
    camera.getWorldDirection(look);
    look.y = -look.y;
    const target = position.clone().add(look);
    this.reflectionCamera.up.set(0, 1, 0);
    this.reflectionCamera.lookAt(target);
    this.reflectionCamera.updateProjectionMatrix();
    this.reflectionCamera.updateMatrixWorld();
    const clip = new Plane(new Vector3(0, 1, 0), -waterY + 0.4);
    const clipPlane = new Vector4(clip.normal.x, clip.normal.y, clip.normal.z, clip.constant);
    const projection = new Matrix4().multiplyMatrices(
      this.reflectionCamera.projectionMatrix,
      this.reflectionCamera.matrixWorldInverse,
    );
    const q = new Vector4();
    q.x = (Math.sign(clipPlane.x) + projection.elements[8]) / projection.elements[0];
    q.y = (Math.sign(clipPlane.y) + projection.elements[9]) / projection.elements[5];
    q.z = -1;
    q.w = (1 + projection.elements[10]) / projection.elements[14];
    clipPlane.multiplyScalar(2 / clipPlane.dot(q));
    projection.elements[2] = clipPlane.x;
    projection.elements[6] = clipPlane.y;
    projection.elements[10] = clipPlane.z + 1;
    projection.elements[14] = clipPlane.w;
    this.reflectionCamera.projectionMatrix.copy(projection);
    const previous = this.renderer.getRenderTarget();
    const xr = this.renderer.xr.enabled;
    this.renderer.xr.enabled = false;
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    const mask = camera.layers.mask;
    this.renderer.render(scene, this.reflectionCamera);
    camera.layers.mask = mask;
    this.renderer.setRenderTarget(previous);
    this.renderer.xr.enabled = xr;
  }
}
