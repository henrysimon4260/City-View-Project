export interface TransitQuery {
  buildingId: string;
}

export interface TransitResult {
  status: "stub";
  nearestStation: null;
  walkMinutes: null;
  message: string;
}

/** Transit proximity is not computed. MTA GTFS is the intended later source. */
export function queryTransit(query: TransitQuery): TransitResult {
  return {
    status: "stub",
    nearestStation: null,
    walkMinutes: null,
    message: `Transit proximity is not computed for ${query.buildingId}. No station distance is estimated.`,
  };
}
