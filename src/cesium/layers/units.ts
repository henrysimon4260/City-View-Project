import * as Cesium from "cesium";
import { graphicsForFloor } from "../../model/floors";
import type { BuildingRecord } from "../../model/types";
import { COLOR, hierarchy } from "../colors";
import type { EntityMeta } from "../picking";

export interface PlateEntity {
  floor: number;
  unitId: string | null;
  entity: Cesium.Entity;
}

/**
 * Unit outlines when a sourced ring exists. Today every benchmark has an empty
 * unitLines list, so this draws the grey unverified plate and nothing else.
 */
export function addUnitPlates(
  viewer: Cesium.Viewer,
  record: BuildingRecord,
  meta: Map<string, EntityMeta>,
  floor: number,
  part: number,
  ringCount: number,
  topMeters: number,
): PlateEntity[] {
  const plates: PlateEntity[] = [];
  const graphics = graphicsForFloor(record, floor);
  graphics.forEach((graphic, graphicIndex) => {
    const rings = graphic.kind === "unit" ? [graphic.ring] : graphic.rings;
    rings.forEach((graphicRing, ringIndex) => {
      if (graphic.kind === "unverified-plate" && ringIndex !== part) return;
      if (graphic.kind === "unit" && part !== 0) return;
      if (graphic.kind === "unverified-plate" && ringIndex >= ringCount) return;
      const plateId = `plate:${record.id}:${floor}:${part}:${graphicIndex}:${ringIndex}`;
      const plate = viewer.entities.add({
        id: plateId,
        show: false,
        polygon: {
          hierarchy: hierarchy(graphicRing),
          height: topMeters,
          extrudedHeight: topMeters + 0.2,
          material: graphic.kind === "unit" ? COLOR.unit : COLOR.plate,
          outline: false,
        },
      });
      const unitId = graphic.kind === "unit" ? graphic.lineId : null;
      plates.push({ floor, unitId, entity: plate });
      meta.set(plateId, {
        role: "plate",
        entityId: plateId,
        buildingId: record.id,
        floor,
        unitId,
      });
    });
  });
  return plates;
}
