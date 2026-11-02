import type { BuildingRecord, FloorRecord, VerificationStatus } from "../model/types";

export interface ArchivedFloor {
  number: number;
  baseFt: number | null;
  topFt: number | null;
  status: VerificationStatus;
  sources: string[];
  method: string | null;
  uncertaintyMeters: number | null;
  note?: string;
}

export interface FloorArchiveFile {
  bin: string;
  buildingId: string;
  floors: ArchivedFloor[];
}

/** Overlay a measured floor file onto the compiled building. Unverified rows stay null. */
export function applyFloorArchive(building: BuildingRecord, archive: FloorArchiveFile | null): BuildingRecord {
  if (!archive) return building;
  const byNumber = new Map(archive.floors.map((floor) => [floor.number, floor]));
  return {
    ...building,
    floors: building.floors.map((floor) => mergeFloor(floor, byNumber.get(floor.number))),
  };
}

function mergeFloor(floor: FloorRecord, measured: ArchivedFloor | undefined): FloorRecord {
  if (!measured || measured.status === "unverified") return floor;
  if (measured.baseFt == null || measured.topFt == null || measured.sources.length === 0) return floor;
  return {
    ...floor,
    baseFt: measured.baseFt,
    topFt: measured.topFt,
    elevationStatus: measured.status,
    sources: measured.sources,
    note: measured.note ?? measured.method ?? floor.note,
  };
}

export async function loadFloorArchives(buildings: BuildingRecord[]): Promise<Map<string, FloorArchiveFile>> {
  const archives = new Map<string, FloorArchiveFile>();
  await Promise.all(
    buildings.map(async (building) => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}data/floors/${building.bin}.json`);
        if (!response.ok) return;
        const payload = (await response.json()) as FloorArchiveFile;
        if (payload.bin === building.bin) archives.set(building.bin, payload);
      } catch {
        // A missing floor file leaves the compiled unverified floors in place.
      }
    }),
  );
  return archives;
}
