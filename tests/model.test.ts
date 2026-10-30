import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { queryDaylight } from "../src/analysis/daylight";
import { queryTransit } from "../src/analysis/transit";
import { queryViewQuality } from "../src/analysis/viewQuality";
import { assertDataset } from "../src/data/source";
import { activateUnit, galleryListenerCount, onUnitActivated } from "../src/gallery/hook";
import { LISTING_SOURCES } from "../scripts/lib/sources.mjs";
import { CITY_HALL, containsLonLat } from "../src/model/bounds";
import { assertUnitLines, floorLevels, graphicsForFloor } from "../src/model/floors";
import { horizonDipDegrees, initialBearingDegrees, smallestAngleDegrees } from "../src/model/sightline";
import type { UnitLine } from "../src/model/types";
import { exteriorApproach, floorVantage, pointInRing } from "../src/model/viewpoint";

const dataset = assertDataset(JSON.parse(readFileSync("public/data/benchmarks.json", "utf8")));
const pluto = JSON.parse(readFileSync("data/cache/pluto.json", "utf8")) as Array<Record<string, string>>;

const expected = {
  "15-william": { bin: "1087954", bbl: "1000257501", stories: 44, residential: 320, height: 528.04837283 },
  "130-william": { bin: "1090562", bbl: "1000777501", stories: 61, residential: 240, height: 750 },
  "1-wall": { bin: "1000815", bbl: "1000237501", stories: 52, residential: 566, height: 657.87 },
  "7-dey": { bin: "1090952", bbl: "1000637501", stories: 33, residential: 209, height: 405 },
  "220-water": { bin: "1001292", bbl: "1000957501", stories: 7, residential: 25, height: 104 },
} as const;

describe("archived city records", () => {
  it("keeps five benchmark buildings and no invented unit lines", () => {
    expect(dataset.buildings.map((building) => building.id)).toEqual(Object.keys(expected));
    for (const building of dataset.buildings) {
      expect(building.unitLines).toEqual([]);
      const lock = expected[building.id as keyof typeof expected];
      expect(building.bin).toBe(lock.bin);
      expect(building.bbl).toBe(lock.bbl);
      expect(building.stories.value).toBe(lock.stories);
      expect(building.stories.status).toBe("confirmed");
      expect(building.residentialUnits.value).toBe(lock.residential);
      expect(building.heightRoofFt.value).toBeCloseTo(lock.height, 5);
      expect(building.heightRoofFt.status).toBe("confirmed");
      expect(containsLonLat(building.centroid[0], building.centroid[1])).toBe(true);
      for (const point of [
        building.stories,
        building.heightRoofFt,
        building.residentialUnits,
        building.certificate,
      ]) {
        expect(point.sources.length).toBeGreaterThan(0);
      }
    }
  });

  it("matches PLUTO cache rows instead of a second handwritten table", () => {
    for (const building of dataset.buildings) {
      const row = pluto.find((item) => String(Math.round(Number(item.bbl))) === building.bbl);
      expect(row, building.id).toBeTruthy();
      expect(building.stories.value).toBe(Math.round(Number(row?.numfloors)));
      expect(building.residentialUnits.value).toBe(Math.round(Number(row?.unitsres)));
      expect(building.totalUnits.value).toBe(Math.round(Number(row?.unitstotal)));
    }
  });

  it("records the known city disagreements without adopting them", () => {
    const william = dataset.buildings.find((building) => building.id === "130-william");
    expect(william?.dwellingUnitsOnCertificate.value).toBe(241);
    expect(william?.conflicts.map((conflict) => conflict.field).sort()).toEqual(
      ["buildingAreaSqft", "heightRoofFt", "residences", "stories"].sort(),
    );
    for (const conflict of william?.conflicts ?? []) expect(conflict.status).toBe("unverified");

    const wall = dataset.buildings.find((building) => building.id === "1-wall");
    expect(wall?.dwellingUnitsOnCertificate.value).toBe(566);
    expect(wall?.conflicts.some((conflict) => conflict.field === "stories" && conflict.otherValue === "51")).toBe(true);
    expect(wall?.corroboration.some((item) => item.value === "566")).toBe(true);

    const dey = dataset.buildings.find((building) => building.id === "7-dey");
    expect(dey?.featureCode.value).toBe(1006);
    expect(dey?.addresses.map((address) => address.text)).toEqual(expect.arrayContaining(["7 DEY STREET", "185 BROADWAY"]));

    const water = dataset.buildings.find((building) => building.id === "220-water");
    expect(water?.dwellingUnitsOnCertificate.status).toBe("unverified");
    expect(water?.addresses.map((address) => address.text)).toEqual(
      expect.arrayContaining(["220 WATER STREET", "117 BEEKMAN STREET"]),
    );
  });
});

describe("floors and plates", () => {
  it("does not invent equal floor heights", () => {
    for (const building of dataset.buildings) {
      const levels = floorLevels(building);
      expect(levels).toHaveLength(building.stories.value);
      expect(levels[0]?.number).toBe(1);
      expect(levels.at(-1)?.number).toBe(building.stories.value);
      for (const level of levels) {
        expect(level.elevationStatus).toBe("unverified");
        expect(level.baseMeters).toBeNull();
        expect(level.topMeters).toBeNull();
      }
      const plate = graphicsForFloor(building, 3)[0];
      expect(plate?.kind).toBe("unverified-plate");
      if (plate?.kind === "unverified-plate") {
        expect(plate.unitStatus).toBe("unverified");
        expect(plate.rings).toEqual(building.footprintRings);
      }
    }
    const mesh = ["15-william", "1-wall", "220-water"];
    for (const id of mesh) {
      expect(dataset.buildings.find((building) => building.id === id)?.massing.kind).toBe("citygml");
    }
    expect(dataset.buildings.find((building) => building.id === "7-dey")?.massing.kind).toBe("footprint-envelope");
    expect(dataset.buildings.find((building) => building.id === "130-william")?.massing.kind).toBe("footprint-envelope");
  });

  it("computes bearings and the ellipsoid horizon", () => {
    const origin = { longitude: 0, latitude: 0, heightMeters: 0 };
    expect(initialBearingDegrees(origin, { longitude: 0, latitude: 1, heightMeters: 0 })).toBeCloseTo(0, 5);
    expect(initialBearingDegrees(origin, { longitude: 1, latitude: 0, heightMeters: 0 })).toBeCloseTo(90, 5);
    expect(smallestAngleDegrees(350, 10)).toBeCloseTo(20, 5);
    expect(horizonDipDegrees(200)).toBeGreaterThan(0.4);
    expect(horizonDipDegrees(200)).toBeLessThan(0.5);
  });

  it("refuses an unverified ring and accepts a sourced line range", () => {
    const bad: UnitLine = {
      lineId: "A",
      floorStart: 5,
      floorEnd: 30,
      ring: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
      ringStatus: "unverified",
      sources: ["example"],
    };
    expect(() => assertUnitLines([bad])).toThrow(/unverified/);

    const good: UnitLine = { ...bad, ringStatus: "confirmed" };
    expect(() => assertUnitLines([good])).not.toThrow();
    const building = {
      ...dataset.buildings[0],
      unitLines: [good],
    };
    const graphic = graphicsForFloor(building, 12)[0];
    expect(graphic?.kind).toBe("unit");
    expect(graphicsForFloor(building, 4)[0]?.kind).toBe("unverified-plate");
    expect(graphicsForFloor(building, 31)[0]?.kind).toBe("unverified-plate");
  });
});

describe("viewpoint", () => {
  it("puts the estimated eye inside the footprint and the approach outside it", () => {
    const ring: [number, number][] = [
      [-74.011, 40.706],
      [-74.01, 40.706],
      [-74.01, 40.707],
      [-74.011, 40.707],
      [-74.011, 40.706],
    ];
    const eye = floorVantage(ring, 40, 1.6);
    expect(eye.status).toBe("estimated");
    expect(eye.heightMeters).toBeCloseTo(41.6, 5);
    expect(pointInRing(eye.longitude, eye.latitude, ring)).toBe(true);
    const approach = exteriorApproach(ring);
    expect(pointInRing(approach.longitude, approach.latitude, ring)).toBe(false);
    expect(containsLonLat(approach.longitude, approach.latitude)).toBe(true);
  });

  it("keeps City Hall inside the camera limit", () => {
    expect(containsLonLat(CITY_HALL.longitude, CITY_HALL.latitude)).toBe(true);
  });
});

describe("stubs and listing policy", () => {
  it("returns empty results from the daylight, view, and transit interfaces", () => {
    expect(queryDaylight({ buildingId: "1-wall", floor: 10, unitId: null, date: "2026-06-21" }).sunlightHours).toBeNull();
    expect(queryViewQuality({ buildingId: "1-wall", floor: 10, unitId: null }).score).toBeNull();
    expect(queryTransit({ buildingId: "1-wall" }).walkMinutes).toBeNull();
  });

  it("leaves listing sites disabled and notifies the gallery hook", () => {
    expect(LISTING_SOURCES.find((source) => source.id === "streeteasy")?.enabled).toBe(false);
    expect(LISTING_SOURCES.find((source) => source.id === "zillow")?.enabled).toBe(false);
    expect(LISTING_SOURCES.find((source) => source.id === "pluto")?.enabled).toBe(true);
    const seen: string[] = [];
    const stop = onUnitActivated((event) => seen.push(event.buildingId));
    activateUnit({ buildingId: "15-william", floor: 8, unitId: null, ringStatus: "unverified" });
    stop();
    expect(seen).toEqual(["15-william"]);
    expect(galleryListenerCount()).toBe(0);
  });
});

describe("context footprints", () => {
  it("covers the study area and includes every benchmark bin", () => {
    const collection = JSON.parse(readFileSync("public/data/study-area-footprints.json", "utf8")) as {
      features: Array<{ properties: { bin: string } }>;
    };
    expect(collection.features.length).toBeGreaterThan(1500);
    const bins = new Set(collection.features.map((feature) => feature.properties.bin));
    for (const building of dataset.buildings) expect(bins.has(building.bin)).toBe(true);
  });
});
