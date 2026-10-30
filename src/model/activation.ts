export interface UnitActivation {
  buildingId: string;
  floor: number;
  /** Null when the click is the grey unverified floor plate rather than a sourced unit. */
  unitId: string | null;
  ringStatus: "estimated" | "confirmed" | "unverified";
}
