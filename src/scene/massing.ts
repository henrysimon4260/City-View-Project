import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from "three";
import { FEET_TO_METERS } from "../model/floors";
import { LOWER_MANHATTAN, inLowerManhattan } from "../model/bounds";
import type { BuildingRecord } from "../model/types";
import { ellipsoidHeight } from "../model/vertical";
import { SEA_LEVEL_Y, toLocal } from "./geodesy";

interface StudyFeature {
  properties: {
    bin: string;
    heightRoofFt: number | null;
    groundElevationFt: number | null;
  };
  geometry: { type: string; coordinates: number[][][][] };
}

interface MassingSurface {
  role: string;
  ring: [number, number, number][];
}

export interface ContextRecord {
  bin: string;
  heightRoofFt: number | null;
  groundElevationFt: number | null;
  plinth: boolean;
  rings: [number, number][][];
}

interface Bucket {
  positions: number[];
  colors: number[];
  indices: number[];
  faceBins: string[];
}

const stone = new Color("#6a635a");
const glass = new Color("#7f92a1");
const landColor = new Color("#3e4744");
const skirtColor = new Color("#2c3432");

export interface CityMeshes {
  city: Mesh;
  benchmarks: Map<string, Mesh>;
  land: Mesh;
  context: Map<string, ContextRecord>;
  faceBins: string[];
}

export async function buildCity(records: BuildingRecord[]): Promise<CityMeshes> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/study-area-footprints.json`);
  if (!response.ok) throw new Error(`Could not load footprints (${response.status}).`);
  const collection = (await response.json()) as { features: StudyFeature[] };
  const massing = await loadMassing();
  const benchmarkBins = new Set(records.map((record) => record.bin));
  const city: Bucket = { positions: [], colors: [], indices: [], faceBins: [] };
  const context = new Map<string, ContextRecord>();

  for (const feature of collection.features) {
    const bin = feature.properties.bin;
    if (benchmarkBins.has(bin)) continue;
    const rings = outerRings(feature);
    if (rings.length === 0) continue;
    const centroid = ringCentroid(rings[0]);
    if (!inLowerManhattan(centroid[0], centroid[1])) continue;
    const heightFt = feature.properties.heightRoofFt;
    const groundFt = feature.properties.groundElevationFt ?? 0;
    const plinth = heightFt == null || heightFt <= 0;
    const extrudedFt = plinth ? 4 : heightFt;
    const base = ellipsoidHeight(groundFt * FEET_TO_METERS);
    const top = base + extrudedFt * FEET_TO_METERS;
    const tint = facadeColor(extrudedFt * FEET_TO_METERS, bin);
    for (const ring of rings) extrude(city, ring, base, top, tint, bin);
    context.set(bin, {
      bin,
      heightRoofFt: plinth ? null : heightFt,
      groundElevationFt: feature.properties.groundElevationFt,
      plinth,
      rings,
    });
  }

  const benchmarks = new Map<string, Mesh>();
  const benchmarkMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.72,
    metalness: 0.04,
    flatShading: true,
    envMapIntensity: 0.45,
    side: DoubleSide,
  });
  for (const record of records) {
    const bucket: Bucket = { positions: [], colors: [], indices: [], faceBins: [] };
    const surfaces = massing[record.id]?.surfaces ?? [];
    const tint = facadeColor(record.heightRoofFt.value * FEET_TO_METERS, record.bin);
    if (surfaces.length > 0) {
      for (const surface of surfaces) addSurface(bucket, surface, tint, record.bin);
    } else {
      const base = ellipsoidHeight(record.groundElevationFt.value * FEET_TO_METERS);
      const top = base + record.heightRoofFt.value * FEET_TO_METERS;
      for (const ring of record.footprintRings) extrude(bucket, ring, base, top, tint, record.bin);
    }
    const mesh = new Mesh(bucketGeometry(bucket), benchmarkMaterial.clone());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = record.id;
    benchmarks.set(record.id, mesh);
  }

  const cityMaterial = benchmarkMaterial.clone();
  cityMaterial.polygonOffset = true;
  cityMaterial.polygonOffsetFactor = 1;
  cityMaterial.polygonOffsetUnits = 1;
  const cityMesh = new Mesh(bucketGeometry(city), cityMaterial);
  cityMesh.castShadow = true;
  cityMesh.receiveShadow = true;
  cityMesh.name = "lower-manhattan";

  return {
    city: cityMesh,
    benchmarks,
    land: buildLand(),
    context,
    faceBins: city.faceBins,
  };
}

async function loadMassing(): Promise<Record<string, { surfaces: MassingSurface[] }>> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/benchmark-massing.json`);
  if (!response.ok) return {};
  const payload = (await response.json()) as { buildings?: Record<string, { surfaces: MassingSurface[] }> };
  return payload.buildings ?? {};
}

function outerRings(feature: StudyFeature): [number, number][][] {
  const rings: [number, number][][] = [];
  for (const poly of feature.geometry?.coordinates ?? []) {
    const ring = poly[0];
    if (!ring || ring.length < 4) continue;
    rings.push(ring.map(([lon, lat]) => [lon, lat]));
  }
  return rings;
}

function ringCentroid(ring: [number, number][]): [number, number] {
  const pts = open(ring);
  let lon = 0;
  let lat = 0;
  for (const [x, y] of pts) {
    lon += x;
    lat += y;
  }
  return [lon / pts.length, lat / pts.length];
}

function open(ring: [number, number][]): [number, number][] {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  return ring;
}

function facadeColor(heightMeters: number, bin: string): Color {
  const t = Math.min(1, Math.max(0, heightMeters / 240));
  const n = hash(bin);
  const color = stone.clone().lerp(glass, 0.25 + t * 0.7);
  color.offsetHSL(0, (n - 0.5) * 0.04, (n - 0.5) * 0.035);
  return color;
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function extrude(
  bucket: Bucket,
  ring: [number, number][],
  base: number,
  top: number,
  color: Color,
  bin: string,
): void {
  const pts = open(ring);
  if (pts.length < 3) return;
  const basePts = pts.map(([lon, lat]) => toLocal(lon, lat, base));
  const topPts = pts.map(([lon, lat]) => toLocal(lon, lat, top));
  const roof = triangulate(topPts.map((point) => [point.x, point.z]));
  const roofStart = bucket.positions.length / 3;
  const roofTint = color.clone().multiplyScalar(1.12);
  for (const point of topPts) pushVertex(bucket, point, roofTint);
  for (let i = 0; i < roof.length; i += 3) {
    bucket.indices.push(roofStart + roof[i], roofStart + roof[i + 1], roofStart + roof[i + 2]);
    bucket.faceBins.push(bin);
  }
  for (let i = 0; i < pts.length; i += 1) {
    const next = (i + 1) % pts.length;
    const a = basePts[i];
    const b = basePts[next];
    const c = topPts[next];
    const d = topPts[i];
    const start = bucket.positions.length / 3;
    const shade = color.clone().multiplyScalar(0.62);
    pushVertex(bucket, a, shade);
    pushVertex(bucket, b, shade);
    pushVertex(bucket, c, color);
    pushVertex(bucket, d, color);
    bucket.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    bucket.faceBins.push(bin, bin);
  }
}

function addSurface(bucket: Bucket, surface: MassingSurface, tint: Color, bin: string): void {
  const points = surface.ring.map(([lon, lat, height]) => toLocal(lon, lat, ellipsoidHeight(height)));
  const unique = dropClosing(points);
  if (unique.length < 3) return;
  const flat = triangulate3(unique);
  const color = tint.clone();
  if (surface.role === "roof") color.lerp(new Color("#f2f4f6"), 0.35);
  if (surface.role === "ground") color.multiplyScalar(0.72);
  const start = bucket.positions.length / 3;
  for (const point of unique) pushVertex(bucket, point, color);
  for (let i = 0; i < flat.length; i += 3) {
    bucket.indices.push(start + flat[i], start + flat[i + 1], start + flat[i + 2]);
    bucket.faceBins.push(bin);
  }
}

function dropClosing(points: Vector3[]): Vector3[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first.distanceToSquared(last) < 1e-6) return points.slice(0, -1);
  return points;
}

function pushVertex(bucket: Bucket, point: Vector3, color: Color): void {
  bucket.positions.push(point.x, point.y, point.z);
  bucket.colors.push(color.r, color.g, color.b);
}

function bucketGeometry(bucket: Bucket): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(bucket.positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(bucket.colors, 3));
  geometry.setIndex(bucket.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildLand(): Mesh {
  const local = LOWER_MANHATTAN_LOCAL();
  const top = SEA_LEVEL_Y + 1.7;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const tris = triangulate(local);
  for (const [x, z] of local) {
    positions.push(x, top, z);
    colors.push(landColor.r, landColor.g, landColor.b);
  }
  indices.push(...tris);
  const count = local.length;
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    const a = local[i];
    const b = local[next];
    const start = positions.length / 3;
    positions.push(a[0], top, a[1], b[0], top, b[1], b[0], SEA_LEVEL_Y, b[1], a[0], SEA_LEVEL_Y, a[1]);
    for (let k = 0; k < 4; k += 1) colors.push(skirtColor.r, skirtColor.g, skirtColor.b);
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new Mesh(
    geometry,
    new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0,
      flatShading: true,
      side: DoubleSide,
    }),
  );
  mesh.receiveShadow = true;
  mesh.name = "land";
  return mesh;
}

function LOWER_MANHATTAN_LOCAL(): [number, number][] {
  return LOWER_MANHATTAN.map(([lon, lat]) => {
    const point = toLocal(lon, lat, 0);
    return [point.x, point.z];
  });
}

function triangulate(points: [number, number][]): number[] {
  const contour = points;
  const n = contour.length;
  if (n < 3) return [];
  if (n === 3) return [0, 1, 2];
  let area = 0;
  for (let i = 0; i < n; i += 1) {
    const [x1, y1] = contour[i];
    const [x2, y2] = contour[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  const order = contour.map((_, index) => index);
  if (area < 0) order.reverse();
  const remaining = order.slice();
  const result: number[] = [];
  let guard = 0;
  while (remaining.length > 3 && guard < 8000) {
    guard += 1;
    let clipped = false;
    for (let i = 0; i < remaining.length; i += 1) {
      const i0 = remaining[(i + remaining.length - 1) % remaining.length];
      const i1 = remaining[i];
      const i2 = remaining[(i + 1) % remaining.length];
      if (!isEar(contour, remaining, i0, i1, i2)) continue;
      result.push(i0, i1, i2);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (remaining.length === 3) result.push(remaining[0], remaining[1], remaining[2]);
  if (result.length === 0) {
    for (let i = 1; i < n - 1; i += 1) result.push(0, i, i + 1);
  }
  return result;
}

function isEar(contour: [number, number][], remaining: number[], i0: number, i1: number, i2: number): boolean {
  const a = contour[i0];
  const b = contour[i1];
  const c = contour[i2];
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (cross <= 1e-10) return false;
  for (const index of remaining) {
    if (index === i0 || index === i1 || index === i2) continue;
    if (pointInTriangle(contour[index], a, b, c)) return false;
  }
  return true;
}

function pointInTriangle(p: [number, number], a: [number, number], b: [number, number], c: [number, number]): boolean {
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function sign(p: [number, number], a: [number, number], b: [number, number]): number {
  return (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
}

function triangulate3(points: Vector3[]): number[] {
  const normal = new Vector3();
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    normal.x += (a.y - b.y) * (a.z + b.z);
    normal.y += (a.z - b.z) * (a.x + b.x);
    normal.z += (a.x - b.x) * (a.y + b.y);
  }
  normal.normalize();
  const tangent = new Vector3();
  if (Math.abs(normal.y) < 0.9) tangent.crossVectors(normal, new Vector3(0, 1, 0)).normalize();
  else tangent.crossVectors(normal, new Vector3(1, 0, 0)).normalize();
  const bitangent = new Vector3().crossVectors(normal, tangent);
  const flat = points.map((point) => [point.dot(tangent), point.dot(bitangent)] as [number, number]);
  return triangulate(flat);
}
