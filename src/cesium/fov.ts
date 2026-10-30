import * as Cesium from "cesium";
import { frustumFovRadians, verticalFovDegrees } from "../model/sightline";

/** Rectilinear horizontal field of view used for every outward view and for the bearing check. */
export const HORIZONTAL_FOV_DEGREES = 60;

export function applyHorizontalFov(
  viewer: Cesium.Viewer,
  horizontalDegrees = HORIZONTAL_FOV_DEGREES,
): { horizontal: number; vertical: number; aspect: number } {
  const canvas = viewer.scene.canvas;
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const frustum = viewer.camera.frustum;
  if (frustum instanceof Cesium.PerspectiveFrustum) {
    frustum.aspectRatio = aspect;
    frustum.fov = frustumFovRadians(horizontalDegrees, aspect);
  }
  return {
    horizontal: horizontalDegrees,
    vertical: verticalFovDegrees(horizontalDegrees, aspect),
    aspect,
  };
}
