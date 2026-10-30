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
 * Unit daylight is not computed. A separate map control can preview Cesium's
 * sun position; that preview is not this result.
 */
export function queryDaylight(query: DaylightQuery): DaylightResult {
  return {
    status: "stub",
    sunlightHours: null,
    message: `Daylight hours are not computed for ${query.buildingId} floor ${query.floor}${query.unitId ? ` unit ${query.unitId}` : ""}. The interface is ready for a later sun-hour study.`,
  };
}
