import * as Cesium from "cesium";
import { FEET_TO_METERS } from "../../model/floors";
import { COLOR, hierarchy } from "../colors";

interface FarFeature {
  id: string;
  bin: string | null;
  source: string;
  heightRoofFt: number | string | null;
  groundElevationFt: number | string | null;
  ring: [number, number][];
}

/** Simplified stand-ins outside the half-mile radius. One primitive, real heights. */
export async function loadFarField(viewer: Cesium.Viewer): Promise<Cesium.Primitive | null> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/far-field.json`);
  if (!response.ok) return null;
  const payload = (await response.json()) as { features: FarFeature[] };
  const instances: Cesium.GeometryInstance[] = [];
  for (const feature of payload.features) {
    const ring = feature.ring;
    if (!ring || ring.length < 4) continue;
    const heightFt = feature.heightRoofFt == null ? null : Number(feature.heightRoofFt);
    const groundFt = feature.groundElevationFt == null ? 0 : Number(feature.groundElevationFt);
    if (!Number.isFinite(heightFt) || heightFt == null || heightFt <= 0) continue;
    const base = (Number.isFinite(groundFt) ? groundFt : 0) * FEET_TO_METERS;
    const top = base + heightFt * FEET_TO_METERS;
    instances.push(
      new Cesium.GeometryInstance({
        geometry: new Cesium.PolygonGeometry({
          polygonHierarchy: hierarchy(ring),
          height: base,
          extrudedHeight: top,
          vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(COLOR.far),
        },
        id: {
          role: "context",
          entityId: feature.id,
          bin: feature.bin ?? feature.id,
          heightRoofFt: heightFt,
          groundElevationFt: Number.isFinite(groundFt) ? groundFt : null,
          plinth: false,
          tier: "far",
          source: feature.source,
        },
      }),
    );
  }
  if (instances.length === 0) return null;
  const primitive = new Cesium.Primitive({
    geometryInstances: instances,
    appearance: new Cesium.PerInstanceColorAppearance({ closed: true, translucent: false }),
    asynchronous: false,
  });
  viewer.scene.primitives.add(primitive);
  return primitive;
}
