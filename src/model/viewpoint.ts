import { HARBOR_AIM, STUDY_RECT, containsLonLat } from "./bounds";

const METERS_PER_DEG_LAT = 111_320;

export interface FloorVantage {
  longitude: number;
  latitude: number;
  heightMeters: number;
  /** Cesium heading: 0 is north, positive toward the east. */
  headingDegrees: number;
  status: "estimated";
  note: string;
}

export interface ExteriorApproach {
  longitude: number;
  latitude: number;
  headingDegrees: number;
}

function metersScale(latitude: number): { lon: number; lat: number } {
  return {
    lat: METERS_PER_DEG_LAT,
    lon: METERS_PER_DEG_LAT * Math.cos((latitude * Math.PI) / 180),
  };
}

function openRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring.slice(0, -1);
  return ring;
}

export function ringCentroid(ring: [number, number][]): [number, number] {
  const pts = openRing(ring);
  let lon = 0;
  let lat = 0;
  for (const [x, y] of pts) {
    lon += x;
    lat += y;
  }
  return [lon / pts.length, lat / pts.length];
}

export function pointInRing(longitude: number, latitude: number, ring: [number, number][]): boolean {
  const pts = openRing(ring);
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    const crosses = yi > latitude !== yj > latitude;
    if (!crosses) continue;
    const xCross = ((xj - xi) * (latitude - yi)) / (yj - yi) + xi;
    if (longitude < xCross) inside = !inside;
  }
  return inside;
}

interface EdgeChoice {
  midpoint: [number, number];
  outward: [number, number];
}

function chooseHarborEdge(ring: [number, number][]): EdgeChoice {
  const pts = openRing(ring);
  const center = ringCentroid(pts);
  const scale = metersScale(center[1]);
  const toLocal = (lon: number, lat: number): [number, number] => [
    (lon - center[0]) * scale.lon,
    (lat - center[1]) * scale.lat,
  ];
  const harbor = toLocal(HARBOR_AIM.longitude, HARBOR_AIM.latitude);
  const harborLen = Math.hypot(harbor[0], harbor[1]) || 1;
  const harborDir: [number, number] = [harbor[0] / harborLen, harbor[1] / harborLen];

  let bestScore = -Infinity;
  let best: EdgeChoice = { midpoint: [0, 0], outward: [0, 1] };
  for (let i = 0; i < pts.length; i += 1) {
    const a = toLocal(pts[i][0], pts[i][1]);
    const b = toLocal(pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1]);
    const midpoint: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const nLen = Math.hypot(nx, ny) || 1;
    nx /= nLen;
    ny /= nLen;
    if (nx * midpoint[0] + ny * midpoint[1] < 0) {
      nx = -nx;
      ny = -ny;
    }
    const score = nx * harborDir[0] + ny * harborDir[1];
    if (score > bestScore) {
      bestScore = score;
      best = { midpoint, outward: [nx, ny] };
    }
  }
  return best;
}

function localToLonLat(center: [number, number], east: number, north: number): [number, number] {
  const scale = metersScale(center[1]);
  return [center[0] + east / scale.lon, center[1] + north / scale.lat];
}

function headingToward(from: [number, number], to: [number, number]): number {
  const scale = metersScale(from[1]);
  const east = (to[0] - from[0]) * scale.lon;
  const north = (to[1] - from[1]) * scale.lat;
  return (Math.atan2(east, north) * 180) / Math.PI;
}

/**
 * Estimated eye position inside the footprint, facing the harbor-side edge.
 * This is not a surveyed window.
 */
export function floorVantage(ring: [number, number][], floorTopMeters: number, eyeHeightMeters: number): FloorVantage {
  const center = ringCentroid(ring);
  const edge = chooseHarborEdge(ring);
  const inward: [number, number] = [edge.midpoint[0] - edge.outward[0] * 3.5, edge.midpoint[1] - edge.outward[1] * 3.5];
  const [longitude, latitude] = localToLonLat(center, inward[0], inward[1]);
  const headingDegrees = (Math.atan2(edge.outward[0], edge.outward[1]) * 180) / Math.PI;
  return {
    longitude,
    latitude,
    heightMeters: floorTopMeters + eyeHeightMeters,
    headingDegrees: (headingDegrees + 360) % 360,
    status: "estimated",
    note: "Eye position is 3.5 m inside the footprint edge that faces the upper bay. No unit window was surveyed.",
  };
}

/** Camera seat outside the footprint, looking back at it, kept inside the study rectangle when possible. */
export function exteriorApproach(ring: [number, number][]): ExteriorApproach {
  const center = ringCentroid(ring);
  const edge = chooseHarborEdge(ring);
  const distances = [70, 48, 32, 20, 12];
  let chosen: [number, number] | null = null;
  for (const distance of distances) {
    const east = edge.midpoint[0] + edge.outward[0] * distance;
    const north = edge.midpoint[1] + edge.outward[1] * distance;
    const candidate = localToLonLat(center, east, north);
    if (pointInRing(candidate[0], candidate[1], ring)) continue;
    if (!containsLonLat(candidate[0], candidate[1])) continue;
    chosen = candidate;
    break;
  }
  if (!chosen) {
    const east = edge.midpoint[0] + edge.outward[0] * 12;
    const north = edge.midpoint[1] + edge.outward[1] * 12;
    const raw = localToLonLat(center, east, north);
    chosen = [
      Math.min(STUDY_RECT.east, Math.max(STUDY_RECT.west, raw[0])),
      Math.min(STUDY_RECT.north, Math.max(STUDY_RECT.south, raw[1])),
    ];
  }
  return {
    longitude: chosen[0],
    latitude: chosen[1],
    headingDegrees: (headingToward(chosen, center) + 360) % 360,
  };
}
