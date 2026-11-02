import { BufferGeometry, Color, Float32BufferAttribute, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { toLocal } from "./geodesy";

const material = new MeshBasicMaterial({
  color: new Color("#e7e4de"),
  transparent: true,
  opacity: 0.95,
  depthTest: true,
  toneMapped: false,
  polygonOffset: true,
  polygonOffsetFactor: -3,
  polygonOffsetUnits: -3,
});

export function createRibbon(): Mesh {
  const mesh = new Mesh(new BufferGeometry(), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.visible = false;
  return mesh;
}

export function setRibbon(
  mesh: Mesh,
  rings: [number, number][][],
  ellipsoidHeight: number,
  color: string,
  width: number,
): void {
  const positions: number[] = [];
  for (const ring of rings) {
    const points = open(ring).map(([lon, lat]) => toLocal(lon, lat, ellipsoidHeight));
    if (points.length < 3) continue;
    appendRibbon(positions, points, width);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  mesh.geometry.dispose();
  mesh.geometry = geometry;
  material.color.set(color);
  mesh.visible = positions.length > 0;
}

function open(ring: [number, number][]): [number, number][] {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  return ring;
}

function appendRibbon(positions: number[], points: Vector3[], width: number): void {
  const half = width / 2;
  const count = points.length;
  const miter: Vector3[] = [];
  for (let i = 0; i < count; i += 1) {
    const prev = points[(i + count - 1) % count];
    const curr = points[i];
    const next = points[(i + 1) % count];
    const inDir = curr.clone().sub(prev);
    inDir.y = 0;
    inDir.normalize();
    const outDir = next.clone().sub(curr);
    outDir.y = 0;
    outDir.normalize();
    const normalIn = new Vector3(-inDir.z, 0, inDir.x);
    const normalOut = new Vector3(-outDir.z, 0, outDir.x);
    const normal = normalIn.add(normalOut);
    if (normal.lengthSq() < 1e-6) normal.copy(normalOut);
    normal.normalize();
    miter.push(normal);
  }
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    const a = points[i];
    const b = points[next];
    const na = miter[i];
    const nb = miter[next];
    const aL = a.clone().addScaledVector(na, half);
    const aR = a.clone().addScaledVector(na, -half);
    const bL = b.clone().addScaledVector(nb, half);
    const bR = b.clone().addScaledVector(nb, -half);
    pushTri(positions, aL, bL, bR);
    pushTri(positions, aL, bR, aR);
  }
}

function pushTri(positions: number[], a: Vector3, b: Vector3, c: Vector3): void {
  positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}
