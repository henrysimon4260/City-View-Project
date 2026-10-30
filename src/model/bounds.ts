/** Axis-aligned camera limit for lower Manhattan. */
export const STUDY_RECT = {
  west: -74.0208,
  south: 40.7002,
  east: -73.9955,
  north: 40.7186,
} as const;

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
