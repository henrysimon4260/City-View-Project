/** Axis-aligned camera limit for lower Manhattan. */
export const STUDY_RECT = {
  west: -74.0208,
  south: 40.7002,
  east: -73.9955,
  north: 40.7186,
} as const;

/**
 * Manhattan south of Chambers Street: City Hall and the Brooklyn Bridge
 * anchorage are inside, the Battery shore is the southern edge, and the
 * Hudson and East River stay outside so the harbor can be water rather than
 * discarded mesh. The ring is open; the last edge closes it.
 */
export const LOWER_MANHATTAN: [number, number][] = [
  [-74.01955, 40.71705],
  [-74.0162, 40.71685],
  [-74.0132, 40.71645],
  [-74.0106, 40.71605],
  [-74.008, 40.71575],
  [-74.0059, 40.7154],
  [-74.0042, 40.7147],
  [-74.003, 40.71405],
  [-74.0019, 40.7124],
  [-74.00125, 40.7105],
  [-74.00155, 40.7083],
  [-74.00235, 40.7065],
  [-74.00345, 40.70515],
  [-74.0051, 40.7037],
  [-74.0075, 40.7023],
  [-74.0103, 40.7013],
  [-74.0132, 40.7008],
  [-74.0164, 40.70025],
  [-74.01815, 40.70095],
  [-74.01895, 40.7025],
  [-74.01945, 40.7047],
  [-74.0194, 40.7074],
  [-74.01895, 40.71],
  [-74.01845, 40.7126],
  [-74.0178, 40.7149],
];

export const CITY_HALL = { longitude: -74.005933, latitude: 40.712737 } as const;

/** A point in the upper bay, used only to choose which facade an estimated vantage faces. */
export const HARBOR_AIM = { longitude: -74.0015, latitude: 40.7008 } as const;

export function containsLonLat(longitude: number, latitude: number): boolean {
  return (
    longitude >= STUDY_RECT.west &&
    longitude <= STUDY_RECT.east &&
    latitude >= STUDY_RECT.south &&
    latitude <= STUDY_RECT.north
  );
}

export function clampLonLat(longitude: number, latitude: number): [number, number] {
  return [
    Math.min(STUDY_RECT.east, Math.max(STUDY_RECT.west, longitude)),
    Math.min(STUDY_RECT.north, Math.max(STUDY_RECT.south, latitude)),
  ];
}

export function inLowerManhattan(longitude: number, latitude: number): boolean {
  return pointInRing(longitude, latitude, LOWER_MANHATTAN);
}

/** Pull a point that has left the district back across the boundary, toward the interior. */
export function clampToLowerManhattan(longitude: number, latitude: number): [number, number] {
  if (inLowerManhattan(longitude, latitude)) return [longitude, latitude];
  let cx = 0;
  let cy = 0;
  for (const [lon, lat] of LOWER_MANHATTAN) {
    cx += lon;
    cy += lat;
  }
  cx /= LOWER_MANHATTAN.length;
  cy /= LOWER_MANHATTAN.length;
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 18; step += 1) {
    const t = (lo + hi) / 2;
    const x = longitude + (cx - longitude) * t;
    const y = latitude + (cy - latitude) * t;
    if (inLowerManhattan(x, y)) hi = t;
    else lo = t;
  }
  const t = Math.min(1, hi + 0.015);
  return [longitude + (cx - longitude) * t, latitude + (cy - latitude) * t];
}

function pointInRing(longitude: number, latitude: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > latitude !== yj > latitude;
    if (!crosses) continue;
    const xCross = ((xj - xi) * (latitude - yi)) / (yj - yi) + xi;
    if (longitude < xCross) inside = !inside;
  }
  return inside;
}
