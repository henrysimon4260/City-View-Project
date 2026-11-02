import { FEET_TO_METERS } from "./floors";

/**
 * EGM2008 geoid undulation for lower Manhattan, meters.
 * Ellipsoid height ≈ NAVD88 orthometric height + this value.
 * The city archive stores NAVD88-style heights and does not apply a geoid;
 * the viewer adds this single regional constant so open-data massing can sit
 * on the same vertical datum as Google's photorealistic mesh. It is not a
 * new survey and it is not a floor elevation.
 */
export const GEOID_UNDULATION_M = -31.5;

export function ellipsoidHeight(orthometricMeters: number): number {
  return orthometricMeters + GEOID_UNDULATION_M;
}

export function feetAboveGroundToEllipsoid(groundFt: number, aboveGroundFt: number): number {
  return ellipsoidHeight((groundFt + aboveGroundFt) * FEET_TO_METERS);
}
