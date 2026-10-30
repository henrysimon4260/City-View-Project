import { assertFloors, assertUnitLines } from "../model/floors";
import type { CityDataset } from "../model/types";

export interface DataSource {
  load(): Promise<CityDataset>;
}

export function assertDataset(data: CityDataset): CityDataset {
  if (!data || !Array.isArray(data.buildings)) {
    throw new Error("Benchmark dataset is missing its building list.");
  }
  for (const building of data.buildings) {
    assertUnitLines(building.unitLines);
    assertFloors(building.floors);
  }
  return data;
}

/** Fetches the compiled benchmark file. `baseUrl` should be Vite's `import.meta.env.BASE_URL`. */
export function staticSource(baseUrl: string = import.meta.env.BASE_URL): DataSource {
  return {
    async load() {
      const response = await fetch(`${baseUrl}data/benchmarks.json`);
      if (!response.ok) throw new Error(`Could not load benchmarks (${response.status}).`);
      return assertDataset((await response.json()) as CityDataset);
    },
  };
}
