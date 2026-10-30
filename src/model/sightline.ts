/** WGS84 sightlines. Bearings are degrees clockwise from north. Elevation is degrees above the local horizontal. */

const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);

export interface Llh {
  longitude: number;
  latitude: number;
  heightMeters: number;
}

export function wrapDegrees(value: number): number {
  const turned = value % 360;
  return turned < 0 ? turned + 360 : turned;
}

export function smallestAngleDegrees(from: number, to: number): number {
  const delta = wrapDegrees(to) - wrapDegrees(from);
  return delta > 180 ? delta - 360 : delta < -180 ? delta + 360 : delta;
}

export function initialBearingDegrees(from: Llh, to: Llh): number {
  const φ1 = (from.latitude * Math.PI) / 180;
  const φ2 = (to.latitude * Math.PI) / 180;
  const Δλ = ((to.longitude - from.longitude) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return wrapDegrees((Math.atan2(y, x) * 180) / Math.PI);
}

function enu(from: Llh, to: Llh): { east: number; north: number; up: number } {
  const φ = (from.latitude * Math.PI) / 180;
  const λ = (from.longitude * Math.PI) / 180;
  const sinφ = Math.sin(φ);
  const cosφ = Math.cos(φ);
  const sinλ = Math.sin(λ);
  const cosλ = Math.cos(λ);
  const n1 = A / Math.sqrt(1 - E2 * sinφ * sinφ);
  const p = [
    (n1 + from.heightMeters) * cosφ * cosλ,
    (n1 + from.heightMeters) * cosφ * sinλ,
    (n1 * (1 - E2) + from.heightMeters) * sinφ,
  ];
  const φ2 = (to.latitude * Math.PI) / 180;
  const λ2 = (to.longitude * Math.PI) / 180;
  const sinφ2 = Math.sin(φ2);
  const cosφ2 = Math.cos(φ2);
  const n2 = A / Math.sqrt(1 - E2 * sinφ2 * sinφ2);
  const q = [
    (n2 + to.heightMeters) * cosφ2 * Math.cos(λ2),
    (n2 + to.heightMeters) * cosφ2 * Math.sin(λ2),
    (n2 * (1 - E2) + to.heightMeters) * sinφ2,
  ];
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const dz = q[2] - p[2];
  return {
    east: -sinλ * dx + cosλ * dy,
    north: -sinφ * cosλ * dx - sinφ * sinλ * dy + cosφ * dz,
    up: cosφ * cosλ * dx + cosφ * sinλ * dy + sinφ * dz,
  };
}

export function elevationAngleDegrees(from: Llh, to: Llh): number {
  const { east, north, up } = enu(from, to);
  return (Math.atan2(up, Math.hypot(east, north)) * 180) / Math.PI;
}

/** Geometric dip of the ellipsoid horizon below the horizontal, in degrees. */
export function horizonDipDegrees(heightMeters: number): number {
  if (heightMeters <= 0) return 0;
  return (Math.acos(A / (A + heightMeters)) * 180) / Math.PI;
}

export function distanceMeters(from: Llh, to: Llh): number {
  const { east, north, up } = enu(from, to);
  return Math.hypot(east, north, up);
}

/**
 * Cesium's PerspectiveFrustum.fov is horizontal when the aspect ratio is above 1,
 * and vertical when the canvas is portrait. This returns the fov value that yields
 * the requested horizontal field of view.
 */
export function frustumFovRadians(horizontalDegrees: number, aspect: number): number {
  const horizontal = (horizontalDegrees * Math.PI) / 180;
  if (aspect > 1) return horizontal;
  return 2 * Math.atan(Math.tan(horizontal / 2) / Math.max(aspect, 0.05));
}

export function verticalFovDegrees(horizontalDegrees: number, aspect: number): number {
  const horizontal = (horizontalDegrees * Math.PI) / 180;
  if (aspect > 1) {
    return (Math.atan(Math.tan(horizontal / 2) / aspect) * 2 * 180) / Math.PI;
  }
  return (frustumFovRadians(horizontalDegrees, aspect) * 180) / Math.PI;
}

/** Angle implied by a pixel in a rectilinear view whose center is heading/pitch. */
export function anglesAtPixel(input: {
  headingDegrees: number;
  pitchDegrees: number;
  horizontalFovDegrees: number;
  verticalFovDegrees: number;
  width: number;
  height: number;
  pixelX: number;
  pixelY: number;
}): { bearingDegrees: number; elevationDegrees: number } {
  const nx = (input.pixelX - input.width / 2) / (input.width / 2);
  const ny = (input.height / 2 - input.pixelY) / (input.height / 2);
  const hAngle =
    (Math.atan(nx * Math.tan((input.horizontalFovDegrees * Math.PI) / 360)) * 180) / Math.PI;
  const vAngle = (Math.atan(ny * Math.tan((input.verticalFovDegrees * Math.PI) / 360)) * 180) / Math.PI;
  return {
    bearingDegrees: wrapDegrees(input.headingDegrees + hAngle),
    elevationDegrees: input.pitchDegrees + vAngle,
  };
}
