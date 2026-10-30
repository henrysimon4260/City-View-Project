import * as Cesium from "cesium";

/** Preview of the sun position only. Not a unit daylight study. */
export function applySunPreview(viewer: Cesium.Viewer, enabled: boolean): void {
  viewer.scene.globe.enableLighting = enabled;
  if (enabled) {
    viewer.scene.light = new Cesium.SunLight();
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-06-21T16:00:00Z");
  }
  viewer.scene.requestRender();
}

export function applyShadowPreview(viewer: Cesium.Viewer, enabled: boolean): void {
  viewer.shadows = enabled;
  if (enabled && viewer.shadowMap) {
    viewer.shadowMap.size = 1024;
  }
  viewer.scene.requestRender();
}
