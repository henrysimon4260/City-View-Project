import { Matrix4, Vector3 } from "three";
import { Ellipsoid } from "3d-tiles-renderer/three";
import { GEOID_UNDULATION_M } from "../model/vertical";

const FLATTENING = 1 / 298.257223563;
const RADIUS = 6_378_137;
const POLAR = RADIUS * (1 - FLATTENING);

/** Same WGS84 radii 3d-tiles-renderer uses for its globe frame. */
export const ellipsoid = new Ellipsoid(RADIUS, RADIUS, POLAR);

/** Tangent frame origin. Kept near the district so local coordinates stay small. */
export const FRAME_LON_DEG = -74.0102;
export const FRAME_LAT_DEG = 40.7082;

const frame = new Matrix4();
const inverse = new Matrix4();

ellipsoid.getObjectFrame(
  (FRAME_LAT_DEG * Math.PI) / 180,
  (FRAME_LON_DEG * Math.PI) / 180,
  0,
  0,
  0,
  0,
  frame,
);
inverse.copy(frame).invert();

const scratch = new Vector3();

/**
 * Local scene axes after ReorientationPlugin: +X west, +Y up, +Z north.
 * `heightMeters` is an ellipsoid height.
 */
export function toLocal(longitudeDeg: number, latitudeDeg: number, heightMeters: number, target = new Vector3()): Vector3 {
  ellipsoid.getCartographicToPosition(
    (latitudeDeg * Math.PI) / 180,
    (longitudeDeg * Math.PI) / 180,
    heightMeters,
    scratch,
  );
  return target.copy(scratch).applyMatrix4(inverse);
}

export function fromLocal(local: Vector3): { longitude: number; latitude: number; height: number } {
  scratch.copy(local).applyMatrix4(frame);
  const cart = { lat: 0, lon: 0, height: 0 };
  ellipsoid.getPositionToCartographic(scratch, cart);
  return {
    longitude: (cart.lon * 180) / Math.PI,
    latitude: (cart.lat * 180) / Math.PI,
    height: cart.height,
  };
}

export function lookVector(headingRad: number, pitchRad: number, target = new Vector3()): Vector3 {
  const cp = Math.cos(pitchRad);
  const east = Math.sin(headingRad) * cp;
  const north = Math.cos(headingRad) * cp;
  const up = Math.sin(pitchRad);
  return target.set(-east, up, north);
}

/** Screen-right direction along the ground when the camera looks along `headingRad`. */
export function groundRight(headingRad: number, target = new Vector3()): Vector3 {
  const c = Math.cos(headingRad);
  const s = Math.sin(headingRad);
  return target.set(-c, 0, -s);
}

/** Screen-up direction along the ground (north when heading is 0). */
export function groundForward(headingRad: number, target = new Vector3()): Vector3 {
  const c = Math.cos(headingRad);
  const s = Math.sin(headingRad);
  return target.set(-s, 0, c);
}

export const SEA_LEVEL_Y = GEOID_UNDULATION_M;
