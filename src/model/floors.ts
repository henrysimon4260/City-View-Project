import type { BuildingRecord, UnitLine } from "./types";

export const FEET_TO_METERS = 0.3048;
export const EYE_HEIGHT_METERS = 1.6;

export interface FloorLevel {
  number: number;
  baseMeters: number;
  topMeters: number;
  elevationStatus: "estimated";
}

export function stackFloors(building: Pick<BuildingRecord, "stories" | "heightRoofFt" | "groundElevationFt">): FloorLevel[] {
  const stories = building.stories.value;
  if (!Number.isInteger(stories) || stories < 1) {
    throw new Error(`Refusing to divide a non-integer story count (${stories}).`);
  }
  const ground = building.groundElevationFt.value * FEET_TO_METERS;
  const roof = ground + building.heightRoofFt.value * FEET_TO_METERS;
  const step = (roof - ground) / stories;
  return Array.from({ length: stories }, (_, index) => ({
    number: index + 1,
    baseMeters: ground + index * step,
    topMeters: ground + (index + 1) * step,
    elevationStatus: "estimated" as const,
  }));
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
