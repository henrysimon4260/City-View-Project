/**
 * The only stored copy of the study-area download is data/cache/study-area.geojson.
 * This writes the browser file public/data/study-area-footprints.json from that cache.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function round(n, places) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function asNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function integerField(value) {
  const n = asNumber(value);
  if (n == null) return null;
  return Math.abs(n - Math.round(n)) < 1e-6 ? Math.round(n) : n;
}

export function writeStudyFootprints() {
  const study = JSON.parse(readFileSync(resolve(root, "data/cache/study-area.geojson"), "utf8"));
  const studyFeatures = [];
  for (const feature of study.features ?? []) {
    const geom = feature.geometry;
    if (!geom) continue;
    const polys =
      geom.type === "MultiPolygon" ? geom.coordinates : geom.type === "Polygon" ? [geom.coordinates] : [];
    if (polys.length === 0) continue;
    const coordinates = polys.map((poly) =>
      poly.map((ring) => ring.map(([lon, lat]) => [round(lon, 6), round(lat, 6)])),
    );
    const props = feature.properties ?? {};
    studyFeatures.push({
      type: "Feature",
      properties: {
        bin: String(props.bin),
        heightRoofFt: asNumber(props.height_roof),
        groundElevationFt: asNumber(props.ground_elevation),
        constructionYear: integerField(props.construction_year),
        featureCode: integerField(props.feature_code),
        bbl: props.mappluto_bbl ? String(props.mappluto_bbl) : null,
      },
      geometry: { type: "MultiPolygon", coordinates },
    });
  }
  const publicDir = resolve(root, "public/data");
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(
    resolve(publicDir, "study-area-footprints.json"),
    JSON.stringify({ type: "FeatureCollection", features: studyFeatures }),
  );
  return studyFeatures.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const count = writeStudyFootprints();
  console.log(`Wrote ${count} study-area footprints.`);
}
