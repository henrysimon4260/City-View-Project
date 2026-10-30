import * as Cesium from "cesium";
import { FEET_TO_METERS } from "../../model/floors";
import { COLOR, hierarchy } from "../colors";
import type { EntityMeta } from "../picking";

interface StudyFeature {
  properties: {
    bin: string;
    heightRoofFt: number | null;
    groundElevationFt: number | null;
  };
  geometry: { type: string; coordinates: number[][][][] };
}

/** Full-detail near-field footprints. Benchmark bins are skipped so they are not drawn twice. */
export async function loadContext(
  viewer: Cesium.Viewer,
  benchmarkBins: Set<string>,
  meta: Map<string, EntityMeta>,
): Promise<Cesium.Entity[]> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/study-area-footprints.json`);
  if (!response.ok) throw new Error(`Could not load footprints (${response.status}).`);
  const collection = (await response.json()) as { features: StudyFeature[] };
  const nearEntities: Cesium.Entity[] = [];
  for (const feature of collection.features) {
    const bin = feature.properties.bin;
    if (benchmarkBins.has(bin)) continue;
    const heightFt = feature.properties.heightRoofFt;
    const groundFt = feature.properties.groundElevationFt ?? 0;
    const plinth = heightFt == null || heightFt <= 0;
    const extrudedFt = plinth ? 4 : heightFt;
    const base = (groundFt ?? 0) * FEET_TO_METERS;
    const top = base + extrudedFt * FEET_TO_METERS;
    const polys = feature.geometry?.coordinates ?? [];
    polys.forEach((poly, part) => {
      const ring = poly[0];
      if (!ring || ring.length < 4) return;
      const id = `context:${bin}:${part}`;
      const entity = viewer.entities.add({
        id,
        polygon: {
          hierarchy: hierarchy(ring as [number, number][]),
          height: base,
          extrudedHeight: top,
          material: COLOR.context,
          outline: false,
        },
      });
      nearEntities.push(entity);
      meta.set(id, {
        role: "context",
        entityId: id,
        bin,
        heightRoofFt: plinth ? null : heightFt,
        groundElevationFt: feature.properties.groundElevationFt,
        plinth,
        tier: "near",
        source: "footprints",
      });
    });
  }
  return nearEntities;
}

export function paintContextHover(
  viewer: Cesium.Viewer,
  meta: Map<string, EntityMeta>,
  hoverId: string | null,
  contextHoverId: string | null,
): string | null {
  const next = hoverId && meta.get(hoverId)?.role === "context" ? hoverId : null;
  if (contextHoverId && contextHoverId !== next) {
    const previous = viewer.entities.getById(contextHoverId);
    if (previous?.polygon) previous.polygon.material = new Cesium.ColorMaterialProperty(COLOR.context);
  }
  if (next) {
    const entity = viewer.entities.getById(next);
    if (entity?.polygon) entity.polygon.material = new Cesium.ColorMaterialProperty(COLOR.contextHover);
  }
  return next;
}
