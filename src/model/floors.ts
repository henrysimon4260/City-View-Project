import type { BuildingRecord, FloorRecord, UnitLine } from "./types";

export const FEET_TO_METERS = 0.3048;
export const EYE_HEIGHT_METERS = 1.6;

export interface FloorLevel {
  number: number;
  label: string | null;
  baseMeters: number | null;
  topMeters: number | null;
  elevationStatus: "confirmed" | "estimated" | "unverified";
  sources: string[];
  note?: string;
}

/**
 * Floor elevations come only from the archived record. Roof height is not divided
 * into equal stories. A floor with no measured elevation stays null and is not drawn.
 */
export function floorLevels(building: Pick<BuildingRecord, "floors" | "groundElevationFt">): FloorLevel[] {
  const ground = building.groundElevationFt.value * FEET_TO_METERS;
  return building.floors.map((floor) => {
    if (floor.elevationStatus === "unverified" && (floor.baseFt != null || floor.topFt != null)) {
      throw new Error(`Floor ${floor.number} is unverified and still has an elevation.`);
    }
    if (floor.elevationStatus !== "unverified" && (floor.baseFt == null || floor.topFt == null || floor.sources.length === 0)) {
      throw new Error(`Floor ${floor.number} claims an elevation without a complete measurement.`);
    }
    return {
      number: floor.number,
      label: floor.label,
      baseMeters: floor.baseFt == null ? null : ground + floor.baseFt * FEET_TO_METERS,
      topMeters: floor.topFt == null ? null : ground + floor.topFt * FEET_TO_METERS,
      elevationStatus: floor.elevationStatus,
      sources: floor.sources,
      note: floor.note,
    };
  });
}

export function floorWithElevation(levels: FloorLevel[], floor: number): FloorLevel | null {
  const level = levels.find((item) => item.number === floor);
  if (!level || level.baseMeters == null || level.topMeters == null) return null;
  return level;
}

export interface UnverifiedPlate {
  kind: "unverified-plate";
  rings: [number, number][][];
  /** The ring is the city footprint reused at an estimated floor elevation. */
  ringStatus: "estimated";
  unitStatus: "unverified";
}

export interface VerifiedUnitOutline {
  kind: "unit";
  lineId: string;
  ring: [number, number][];
  ringStatus: "confirmed" | "estimated";
  sources: string[];
}

export type FloorGraphic = UnverifiedPlate | VerifiedUnitOutline;

/**
 * Draw sourced unit rings when they exist. Otherwise one grey plate on the
 * published footprint. Never synthesize a ring.
 */
export function graphicsForFloor(building: BuildingRecord, floor: number): FloorGraphic[] {
  const units = building.unitLines.filter((line) => lineCoversFloor(line, floor) && drawableRing(line));
  if (units.length === 0) {
    return [
      {
        kind: "unverified-plate",
        rings: building.footprintRings,
        ringStatus: "estimated",
        unitStatus: "unverified",
      },
    ];
  }
  return units.map((line) => ({
    kind: "unit",
    lineId: line.lineId,
    ring: line.ring as [number, number][],
    ringStatus: line.ringStatus as "confirmed" | "estimated",
    sources: line.sources,
  }));
}

function lineCoversFloor(line: UnitLine, floor: number): boolean {
  return floor >= line.floorStart && floor <= line.floorEnd;
}

function drawableRing(line: UnitLine): boolean {
  return Boolean(line.ring && line.ring.length >= 4 && line.ringStatus !== "unverified" && line.sources.length > 0);
}

export function assertFloors(floors: FloorRecord[]): void {
  const numbers = new Set<number>();
  for (const floor of floors) {
    if (!Number.isInteger(floor.number) || floor.number < 1) {
      throw new Error("Floor number must be a positive integer.");
    }
    if (numbers.has(floor.number)) throw new Error(`Duplicate floor ${floor.number}.`);
    numbers.add(floor.number);
    if (floor.elevationStatus === "unverified" && (floor.baseFt != null || floor.topFt != null)) {
      throw new Error(`Unverified floor ${floor.number} must not carry an elevation.`);
    }
  }
}

export function assertUnitLines(lines: UnitLine[]): void {
  for (const line of lines) {
    if (!line.lineId || !Number.isInteger(line.floorStart) || !Number.isInteger(line.floorEnd)) {
      throw new Error("Unit line is missing an id or an integer floor range.");
    }
    if (line.floorEnd < line.floorStart) {
      throw new Error(`Unit line ${line.lineId} has a reversed floor range.`);
    }
    if (line.ring && line.ringStatus === "unverified") {
      throw new Error(`Unit line ${line.lineId} has a ring marked unverified. It will not be drawn.`);
    }
    if (line.ring && line.sources.length === 0) {
      throw new Error(`Unit line ${line.lineId} has a ring without sources.`);
    }
  }
}
