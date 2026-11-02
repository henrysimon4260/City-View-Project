export interface DaylightQuery {
  buildingId: string;
  floor: number;
  unitId: string | null;
  /** ISO date the caller would want evaluated. Stored, not simulated. */
  date: string;
}

export interface DaylightResult {
  status: "stub";
  sunlightHours: null;
  message: string;
}

/**
 * Unit daylight hours are not computed. The map uses {@link solarPosition}
 * for the sun direction; that is the real solar vector, not a sun-hour study.
 */
export function queryDaylight(query: DaylightQuery): DaylightResult {
  return {
    status: "stub",
    sunlightHours: null,
    message: `Daylight hours are not computed for ${query.buildingId} floor ${query.floor}${query.unitId ? ` unit ${query.unitId}` : ""}. The interface is ready for a later sun-hour study.`,
  };
}

export interface SolarPosition {
  /** Degrees clockwise from true north. */
  azimuthDegrees: number;
  /** Degrees above the local horizon. Negative when the sun is down. */
  elevationDegrees: number;
}

/**
 * Solar azimuth and elevation for a UTC instant. This is the NOAA-style
 * approximation (mean elements, one equation of center), accurate to a
 * fraction of a degree. It is not a unit sun-hour total.
 */
export function solarPosition(date: Date, latitudeDeg: number, longitudeDeg: number): SolarPosition {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;
  const jd = date.getTime() / 86_400_000 + 2_440_587.5;
  const n = jd - 2_451_545.0;
  const meanLongitude = wrap360(280.46 + 0.9856474 * n);
  const meanAnomaly = wrap360(357.528 + 0.9856003 * n) * rad;
  const ecliptic = wrap360(meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * rad;
  const obliquity = (23.439 - 0.0000004 * n) * rad;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(ecliptic));
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(ecliptic), Math.cos(ecliptic));
  const gmst = wrap360(280.46061837 + 360.98564736629 * n) * rad;
  const hourAngle = gmst + longitudeDeg * rad - rightAscension;
  const latitude = latitudeDeg * rad;
  const elevation = Math.asin(
    Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle),
  );
  // 0 is south, positive toward the west. Convert to clockwise-from-north.
  const azimuthFromSouth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latitude) - Math.tan(declination) * Math.cos(latitude),
  );
  return {
    azimuthDegrees: wrap360(azimuthFromSouth * deg + 180),
    elevationDegrees: elevation * deg,
  };
}

function wrap360(value: number): number {
  const turned = value % 360;
  return turned < 0 ? turned + 360 : turned;
}
