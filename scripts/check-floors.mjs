/**
 * Checks public/data/floors/<bin>.json against the compiled benchmark story
 * counts and roof heights. A floor with an elevation must name its sources.
 * Confirmed rows need at least two sources and an uncertainty of 0.3 m or less.
 * Unverified rows must not carry a height. Nothing here invents a story height.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const benchmarks = JSON.parse(readFileSync(resolve(root, "public/data/benchmarks.json"), "utf8"));
const dir = resolve(root, "public/data/floors");
const files = new Set(readdirSync(dir).filter((name) => name.endsWith(".json")));
const FEET_TO_METERS = 0.3048;
const errors = [];

for (const building of benchmarks.buildings) {
  const name = `${building.bin}.json`;
  if (!files.has(name)) {
    errors.push(`${building.id} is missing public/data/floors/${name}`);
    continue;
  }
  files.delete(name);
  const archive = JSON.parse(readFileSync(resolve(dir, name), "utf8"));
  if (archive.bin !== building.bin) errors.push(`${name} bin is ${archive.bin}`);
  if (archive.floors.length !== building.stories.value) {
    errors.push(`${building.id} has ${archive.floors.length} floors, PLUTO says ${building.stories.value}`);
  }
  let previousTop = 0;
  let measuredSpan = 0;
  let measured = 0;
  for (const floor of archive.floors) {
    if (!Number.isInteger(floor.number) || floor.number < 1) {
      errors.push(`${building.id} floor number ${floor.number} is not a positive integer`);
      continue;
    }
    if (floor.status === "unverified") {
      if (floor.baseFt != null || floor.topFt != null) {
        errors.push(`${building.id} floor ${floor.number} is unverified and still has an elevation`);
      }
      continue;
    }
    if (floor.baseFt == null || floor.topFt == null) {
      errors.push(`${building.id} floor ${floor.number} is ${floor.status} without a base and top`);
      continue;
    }
    if (!Array.isArray(floor.sources) || floor.sources.length === 0) {
      errors.push(`${building.id} floor ${floor.number} has an elevation without sources`);
    }
    if (!(floor.topFt > floor.baseFt)) {
      errors.push(`${building.id} floor ${floor.number} does not rise`);
    }
    if (floor.baseFt < previousTop - 0.2) {
      errors.push(`${building.id} floor ${floor.number} overlaps the floor below`);
    }
    if (floor.status === "confirmed") {
      if (floor.sources.length < 2) errors.push(`${building.id} floor ${floor.number} is confirmed with one source`);
      if (!(floor.uncertaintyMeters <= 0.3)) {
        errors.push(`${building.id} floor ${floor.number} is confirmed with uncertainty above 0.3 m`);
      }
    }
    if (floor.topFt > building.heightRoofFt.value + 1) {
      errors.push(`${building.id} floor ${floor.number} rises above the city roof`);
    }
    previousTop = floor.topFt;
    measuredSpan += floor.topFt - floor.baseFt;
    measured += 1;
  }
  if (measured === building.stories.value) {
    const roofM = building.heightRoofFt.value * FEET_TO_METERS;
    const spanM = measuredSpan * FEET_TO_METERS;
    if (Math.abs(spanM - roofM) > 1) {
      errors.push(`${building.id} measured rows span ${spanM.toFixed(2)} m against a ${roofM.toFixed(2)} m roof`);
    }
  }
}

for (const extra of files) errors.push(`unexpected floor file ${extra}`);

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Checked ${benchmarks.buildings.length} floor archives against PLUTO story counts and roof heights.`);
