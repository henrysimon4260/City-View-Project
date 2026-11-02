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

export async function fetchJson(url: string, label: string): Promise<unknown> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Could not load ${label} (${response.status}).`);
      return await response.json();
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  const detail = last instanceof Error ? last.message : "Failed to fetch";
  throw new Error(detail.startsWith("Could not load") ? detail : `Could not load ${label} (${detail}).`);
}

/** Fetches the compiled benchmark file. `baseUrl` should be Vite's `import.meta.env.BASE_URL`. */
export function staticSource(baseUrl: string = import.meta.env.BASE_URL): DataSource {
  return {
    async load() {
      const payload = await fetchJson(`${baseUrl}data/benchmarks.json`, "benchmark buildings");
      return assertDataset(payload as CityDataset);
    },
  };
}
