import * as Cesium from "cesium";
import { FEET_TO_METERS, floorLevels } from "../../model/floors";
import type { BuildingRecord } from "../../model/types";
import type { Selection } from "../../ui/state";
import { COLOR, hierarchy, paint } from "../colors";
import type { EntityMeta } from "../picking";
import { addUnitPlates, type PlateEntity } from "./units";

export interface FloorEntity {
  floor: number;
  entity: Cesium.Entity;
}

export interface BenchmarkView {
  record: BuildingRecord;
  shells: Cesium.Entity[];
  floors: FloorEntity[];
  plates: PlateEntity[];
  label: Cesium.Entity;
  sphere: Cesium.BoundingSphere;
}

interface MassingSurface {
  role: string;
  ring: [number, number, number][];
}

export async function loadMassingFile(): Promise<Record<string, { surfaces: MassingSurface[] }>> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/benchmark-massing.json`);
  if (!response.ok) return {};
  const payload = (await response.json()) as { buildings?: Record<string, { surfaces: MassingSurface[] }> };
  return payload.buildings ?? {};
}

export function buildBenchmark(
  viewer: Cesium.Viewer,
  record: BuildingRecord,
  meta: Map<string, EntityMeta>,
  massing: { surfaces: MassingSurface[] } | undefined,
): BenchmarkView {
  const levels = floorLevels(record).filter((level) => level.baseMeters != null && level.topMeters != null);
  const points: Cesium.Cartesian3[] = [];
  const shells: Cesium.Entity[] = [];
  const floors: FloorEntity[] = [];
  const plates: PlateEntity[] = [];
  const ground = record.groundElevationFt.value * FEET_TO_METERS;
  const roof = ground + record.heightRoofFt.value * FEET_TO_METERS;
  const shellMaterial = record.massing.kind === "footprint-envelope" ? COLOR.envelope : COLOR.shell;
  const surfaces = massing?.surfaces ?? [];

  if (surfaces.length > 0) {
    surfaces.forEach((surface, part) => {
      for (const [lon, lat, height] of surface.ring) {
        points.push(Cesium.Cartesian3.fromDegrees(lon, lat, height));
      }
      const shellId = `shell:${record.id}:${part}`;
      const shell = viewer.entities.add({
        id: shellId,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(
            surface.ring.map(([lon, lat, height]) => Cesium.Cartesian3.fromDegrees(lon, lat, height)),
          ),
          perPositionHeight: true,
          material: shellMaterial,
          outline: false,
        },
      });
      shells.push(shell);
      meta.set(shellId, { role: "building", entityId: shellId, buildingId: record.id });
    });
  }

  record.footprintRings.forEach((ring, part) => {
    if (surfaces.length === 0) {
      for (const [lon, lat] of ring) {
        points.push(Cesium.Cartesian3.fromDegrees(lon, lat, ground));
        points.push(Cesium.Cartesian3.fromDegrees(lon, lat, roof));
      }
      const shellId = `shell:${record.id}:${part}`;
      const shell = viewer.entities.add({
        id: shellId,
        polygon: {
          hierarchy: hierarchy(ring),
          height: ground,
          extrudedHeight: roof,
          material: shellMaterial,
          outline: false,
        },
      });
      shells.push(shell);
      meta.set(shellId, { role: "building", entityId: shellId, buildingId: record.id });
    }

    for (const level of levels) {
      if (level.baseMeters == null || level.topMeters == null) continue;
      const baseMeters = level.baseMeters;
      const topMeters = level.topMeters;
      if (surfaces.length > 0 && part > 0) return;
      const floorId = `floor:${record.id}:${level.number}:${part}`;
      const floorEntity = viewer.entities.add({
        id: floorId,
        show: false,
        polygon: {
          hierarchy: hierarchy(ring),
          height: baseMeters,
          extrudedHeight: topMeters,
          material: COLOR.floor,
          outline: false,
        },
      });
      floors.push({ floor: level.number, entity: floorEntity });
      meta.set(floorId, { role: "floor", entityId: floorId, buildingId: record.id, floor: level.number });
      plates.push(
        ...addUnitPlates(viewer, record, meta, level.number, part, record.footprintRings.length, topMeters),
      );
    }
  });

  const labelId = `label:${record.id}`;
  const label = viewer.entities.add({
    id: labelId,
    position: Cesium.Cartesian3.fromDegrees(record.centroid[0], record.centroid[1], roof + 6),
    label: {
      text: record.name,
      font: "600 15px Palatino, Georgia, serif",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.fromCssColorString("#1c1915"),
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -4),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2800),
    },
  });
  meta.set(labelId, { role: "building", entityId: labelId, buildingId: record.id });

  return {
    record,
    shells,
    floors,
    plates,
    label,
    sphere: Cesium.BoundingSphere.fromPoints(points),
  };
}

export function shellColor(record: BuildingRecord | undefined, hovered: boolean): Cesium.Color {
  const base = record?.massing.kind === "footprint-envelope" ? COLOR.envelope : COLOR.shell;
  return hovered ? COLOR.shellHover : base;
}

export function floorColor(hovered: boolean, selected: boolean): Cesium.Color {
  if (hovered) return COLOR.floorHover;
  if (selected) return COLOR.floorSelected;
  return COLOR.floor;
}

export function plateColor(unitId: string | null, hovered: boolean): Cesium.Color {
  if (unitId) return hovered ? COLOR.unitHover : COLOR.unit;
  return hovered ? COLOR.plateHover : COLOR.plate;
}

export function applyBenchmarkVisibility(
  benches: Map<string, BenchmarkView>,
  selection: Selection,
  hoverId: string | null,
): void {
  const activeId =
    selection.kind === "building" || selection.kind === "floor" || selection.kind === "view" || selection.kind === "roof"
      ? selection.buildingId
      : null;
  const floorNumber = selection.kind === "floor" || selection.kind === "view" ? selection.floor : null;
  const sliced = selection.kind === "floor" || selection.kind === "view";

  for (const bench of benches.values()) {
    const active = bench.record.id === activeId;
    const floorHasGeometry = sliced && floorNumber != null && bench.floors.some((floor) => floor.floor === floorNumber);
    for (const shell of bench.shells) {
      shell.show = !active || !floorHasGeometry;
      paint(shell, shellColor(bench.record, hoverId === shell.id));
    }
    for (const floor of bench.floors) {
      const above = active && sliced && floorNumber != null && floor.floor > floorNumber;
      const standingInside = selection.kind === "view" && floor.floor === floorNumber;
      floor.entity.show = active && !above && !standingInside;
      paint(floor.entity, floorColor(hoverId === floor.entity.id, floor.floor === floorNumber && sliced));
    }
    for (const plate of bench.plates) {
      plate.entity.show = active && sliced && plate.floor === floorNumber;
      paint(plate.entity, plateColor(plate.unitId, hoverId === plate.entity.id));
    }
  }
}

export function repaintBenchmark(
  entity: Cesium.Entity,
  info: EntityMeta,
  benches: Map<string, BenchmarkView>,
  selection: Selection,
  hoverId: string | null,
): void {
  if (!entity.polygon) return;
  const record = info.buildingId ? benches.get(info.buildingId)?.record : undefined;
  if (info.role === "building") paint(entity, shellColor(record, hoverId === info.entityId));
  if (info.role === "floor" && info.floor) {
    const sliced = selection.kind === "floor" || selection.kind === "view";
    const activeFloor = selection.kind === "floor" || selection.kind === "view" ? selection.floor : null;
    paint(entity, floorColor(hoverId === info.entityId, sliced && info.floor === activeFloor));
  }
  if (info.role === "plate") paint(entity, plateColor(info.unitId ?? null, hoverId === info.entityId));
}
