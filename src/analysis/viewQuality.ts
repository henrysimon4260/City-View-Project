export interface ViewQualityQuery {
  buildingId: string;
  floor: number;
  unitId: string | null;
}

export interface ViewQualityResult {
  status: "stub";
  score: null;
  message: string;
}

/** View quality is not scored. The harbor backdrop is illustrative and is not an input. */
export function queryViewQuality(query: ViewQualityQuery): ViewQualityResult {
  return {
    status: "stub",
    score: null,
    message: `View quality is not scored for ${query.buildingId} floor ${query.floor}. No sky-exposure or landmark-view model is connected.`,
  };
}
