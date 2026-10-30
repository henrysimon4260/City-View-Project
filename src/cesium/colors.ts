import * as Cesium from "cesium";

export const COLOR = {
  context: Cesium.Color.fromCssColorString("#8e9399"),
  contextHover: Cesium.Color.fromCssColorString("#d5d8dc"),
  far: Cesium.Color.fromCssColorString("#6f777f"),
  shell: Cesium.Color.fromCssColorString("#d2be9a"),
  envelope: Cesium.Color.fromCssColorString("#b7b3aa"),
  shellHover: Cesium.Color.fromCssColorString("#f0d48a"),
  floor: Cesium.Color.fromCssColorString("#c9b28a"),
  floorHover: Cesium.Color.fromCssColorString("#f2d48a"),
  floorSelected: Cesium.Color.fromCssColorString("#e09a45"),
  plate: Cesium.Color.fromCssColorString("#8d8a84"),
  plateHover: Cesium.Color.fromCssColorString("#e4e0d8"),
  unit: Cesium.Color.fromCssColorString("#2f6f5e"),
  unitHover: Cesium.Color.fromCssColorString("#3f917c"),
};

export function paint(entity: Cesium.Entity, color: Cesium.Color): void {
  if (entity.polygon) entity.polygon.material = new Cesium.ColorMaterialProperty(color);
}

export function hierarchy(ring: [number, number][]): Cesium.PolygonHierarchy {
  return new Cesium.PolygonHierarchy(ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)));
}
