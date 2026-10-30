import * as Cesium from "cesium";
import { FEET_TO_METERS } from "../../model/floors";
import { LANDMARKS } from "../../model/landmarks";
import {
  anglesAtPixel,
  elevationAngleDegrees,
  horizonDipDegrees,
  initialBearingDegrees,
  smallestAngleDegrees,
} from "../../model/sightline";
import { parapetVantage } from "../../model/viewpoint";
import { applyHorizontalFov } from "../fov";
import type { BenchmarkView } from "../layers/benchmarks";
import { resumeCameraClamp, suspendCameraClamp } from "../viewer";

export interface SightlineReport {
  camera: { longitude: number; latitude: number; height: number; heading: number; pitch: number };
  fov: { horizontal: number; vertical: number };
  aimed: Array<{
    id: string;
    tier: "near" | "far";
    bearingDegrees: number;
    elevationDegrees: number;
    bearingErrorDegrees: number;
    elevationErrorDegrees: number;
  }>;
  horizonDipDegrees: number;
  horizonResidualDegrees: number;
}

export async function measureSightlines(
  viewer: Cesium.Viewer,
  benches: Map<string, BenchmarkView>,
): Promise<SightlineReport> {
  const bench = benches.get("1-wall");
  if (!bench) throw new Error("1 Wall Street is not in the scene.");
  const roof = (bench.record.groundElevationFt.value + bench.record.heightRoofFt.value) * FEET_TO_METERS;
  const vantage = parapetVantage(bench.record.footprintRings[0], roof);
  const fov = applyHorizontalFov(viewer);
  suspendCameraClamp();
  const place = (headingDegrees: number, pitchDegrees: number) => {
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(vantage.longitude, vantage.latitude, vantage.heightMeters),
      orientation: {
        heading: Cesium.Math.toRadians(headingDegrees),
        pitch: Cesium.Math.toRadians(pitchDegrees),
        roll: 0,
      },
    });
    viewer.scene.render();
  };
  const cameraLlh = {
    longitude: vantage.longitude,
    latitude: vantage.latitude,
    heightMeters: vantage.heightMeters,
  };
  const aimed = [];
  for (const landmark of LANDMARKS) {
    const bearing = initialBearingDegrees(cameraLlh, landmark.point);
    const elevation = elevationAngleDegrees(cameraLlh, landmark.point);
    place(bearing, elevation);
    const canvas = viewer.scene.canvas;
    const windowPos = Cesium.SceneTransforms.worldToWindowCoordinates(
      viewer.scene,
      Cesium.Cartesian3.fromDegrees(landmark.point.longitude, landmark.point.latitude, landmark.point.heightMeters),
    );
    const pixelX = windowPos ? windowPos.x : Number.NaN;
    const pixelY = windowPos ? windowPos.y : Number.NaN;
    const seen = anglesAtPixel({
      headingDegrees: bearing,
      pitchDegrees: elevation,
      horizontalFovDegrees: fov.horizontal,
      verticalFovDegrees: fov.vertical,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      pixelX,
      pixelY,
    });
    aimed.push({
      id: landmark.id,
      tier: landmark.tier,
      bearingDegrees: bearing,
      elevationDegrees: elevation,
      bearingErrorDegrees: smallestAngleDegrees(bearing, seen.bearingDegrees),
      elevationErrorDegrees: seen.elevationDegrees - elevation,
    });
  }
  const dip = horizonDipDegrees(vantage.heightMeters);
  let lo = -3;
  let hi = 0.5;
  for (let step = 0; step < 18; step += 1) {
    const mid = (lo + hi) / 2;
    place(180, mid);
    const ray = viewer.camera.getPickRay(
      new Cesium.Cartesian2(viewer.scene.canvas.clientWidth / 2, viewer.scene.canvas.clientHeight / 2),
    );
    const hit = ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
    if (hit) lo = mid;
    else hi = mid;
  }
  const graze = (lo + hi) / 2;
  resumeCameraClamp();
  viewer.scene.requestRender();
  return {
    camera: {
      longitude: vantage.longitude,
      latitude: vantage.latitude,
      height: vantage.heightMeters,
      heading: 180,
      pitch: graze,
    },
    fov: { horizontal: fov.horizontal, vertical: fov.vertical },
    aimed,
    horizonDipDegrees: dip,
    horizonResidualDegrees: graze - -dip,
  };
}
