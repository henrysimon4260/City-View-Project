import * as Cesium from "cesium";

export interface EntityMeta {
  role: "building" | "floor" | "plate" | "context";
  entityId: string;
  buildingId?: string;
  floor?: number;
  unitId?: string | null;
  bin?: string;
  heightRoofFt?: number | null;
  groundElevationFt?: number | null;
  plinth?: boolean;
  tier?: "near" | "far";
  source?: string;
}

export function pickEntity(viewer: Cesium.Viewer, position: Cesium.Cartesian2): Cesium.Entity | null {
  const picked = viewer.scene.pick(position);
  if (!picked || typeof picked !== "object" || !("id" in picked)) return null;
  const id = (picked as { id?: unknown }).id;
  return id instanceof Cesium.Entity ? id : null;
}

export function pickMeta(
  viewer: Cesium.Viewer,
  position: Cesium.Cartesian2,
  meta: Map<string, EntityMeta>,
): EntityMeta | null {
  const picked = viewer.scene.pick(position);
  if (!picked || typeof picked !== "object" || !("id" in picked)) return null;
  const id = (picked as { id?: unknown }).id;
  if (id instanceof Cesium.Entity) return meta.get(id.id) ?? null;
  if (id && typeof id === "object" && "role" in id) return id as EntityMeta;
  return null;
}

/** Pointer hover uses entity ids. Far-field primitives are clickable through pickMeta and do not hover-recolor. */
export function attachPicking(
  viewer: Cesium.Viewer,
  meta: Map<string, EntityMeta>,
  handlers: { onHover: (id: string | null) => void; onPick: (info: EntityMeta) => void },
): void {
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((movement: { endPosition: Cesium.Cartesian2 }) => {
    const entity = pickEntity(viewer, movement.endPosition);
    handlers.onHover(entity?.id ?? null);
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction((click: { position: Cesium.Cartesian2 }) => {
    const info = pickMeta(viewer, click.position, meta);
    if (info) handlers.onPick(info);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}
