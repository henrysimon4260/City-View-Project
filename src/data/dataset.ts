import raw from "./benchmarks.json";
import type { CityDataset } from "../model/types";
import { assertUnitLines } from "../model/floors";

const dataset = raw as unknown as CityDataset;

for (const building of dataset.buildings) {
  assertUnitLines(building.unitLines);
}

export function getDataset(): CityDataset {
  return dataset;
}

export function buildingById(id: string) {
  return dataset.buildings.find((building) => building.id === id) ?? null;
}
