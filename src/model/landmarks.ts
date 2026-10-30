import type { Llh } from "./sightline";

export interface Landmark {
  id: string;
  name: string;
  /** Point the bearing check aims at. This is a published coordinate or a city footprint centroid, not a modeled sculpture. */
  point: Llh;
  tier: "near" | "far";
  sources: string[];
  note: string;
}

/**
 * One WTC uses the city footprint centroid and roof (BIN 1088469), which sits about 15 m
 * from the Wikipedia coordinate. Liberty Island uses footprint BIN 1000002. The city
 * height there is 119.11 ft. That is the footprint the map draws, not a statue mesh.
 * The Brooklyn Bridge value is the Wikipedia primary coordinate. The OSM extract did
 * not tag the stone towers, so they are not given invented positions.
 */
export const LANDMARKS: Landmark[] = [
  {
    id: "one-wtc",
    name: "One World Trade Center",
    point: { longitude: -74.013173, latitude: 40.7130095, heightMeters: (5 + 1408.377901) * 0.3048 },
    tier: "near",
    sources: ["footprints", "wiki-landmarks"],
    note: "Footprint BIN 1088469, roof height 1408.377901 ft above ground elevation 5 ft. Wikipedia's primary coordinate is 40.71305556, -74.01333333.",
  },
  {
    id: "statue-of-liberty",
    name: "Statue of Liberty",
    point: { longitude: -74.0445556667, latitude: 40.6892272222, heightMeters: (16 + 119.11) * 0.3048 },
    tier: "far",
    sources: ["footprints", "wiki-landmarks"],
    note: "Liberty Island footprint BIN 1000002, city roof height 119.11 ft above ground elevation 16 ft. Wikipedia's statue coordinate is 40.68916667, -74.04444444. The map does not add a statue sculpture on top of the city height.",
  },
  {
    id: "brooklyn-bridge",
    name: "Brooklyn Bridge",
    point: { longitude: -73.9964, latitude: 40.7057, heightMeters: 0 },
    tier: "far",
    sources: ["wiki-landmarks"],
    note: "Wikipedia primary coordinate for the bridge. Tower coordinates were not tagged in the archived OpenStreetMap extract, so the check uses this published point at ellipsoid height 0 rather than a guessed tower.",
  },
];
