export interface ListingSource {
  id: string;
  name: string;
  kind: "open-data" | "geocoder" | "publisher-page" | "listing-site";
  enabled: boolean;
  reason: string;
}

/**
 * Runtime catalog of the listings pipeline. Enabled sources are the ones
 * `scripts/fetch-open-data.mjs` is allowed to call. Listing sites stay off.
 */
export const LISTING_SOURCES: ListingSource[] = [
  {
    id: "pluto",
    name: "NYC PLUTO",
    kind: "open-data",
    enabled: true,
    reason: "Public SODA API. Building-level unit counts only.",
  },
  {
    id: "footprints",
    name: "NYC building footprints",
    kind: "open-data",
    enabled: true,
    reason: "Public SODA API. Footprint rings and roof height.",
  },
  {
    id: "dob-now-co",
    name: "DOB NOW certificates of occupancy",
    kind: "open-data",
    enabled: true,
    reason: "Public SODA API. Dwelling-unit totals, not floor plans.",
  },
  {
    id: "dob-legacy-co",
    name: "DOB legacy certificates of occupancy",
    kind: "open-data",
    enabled: true,
    reason: "Public SODA API. Issuance records, no unit column in this dataset.",
  },
  {
    id: "pad-geosearch",
    name: "NYC Planning GeoSearch",
    kind: "geocoder",
    enabled: true,
    reason: "Public geocoder over PAD. One query per address, rate limited.",
  },
  {
    id: "adjaye-130",
    name: "Adjaye Associates project page",
    kind: "publisher-page",
    enabled: true,
    reason: "Single allowed project page for a published claim. Not a listing feed and not a floor plan.",
  },
  {
    id: "slce-1-wall",
    name: "SLCE Architects project page",
    kind: "publisher-page",
    enabled: true,
    reason: "Single allowed project page for a published claim. Not a listing feed and not a floor plan.",
  },
  {
    id: "streeteasy",
    name: "StreetEasy",
    kind: "listing-site",
    enabled: false,
    reason: "robots.txt disallows /building/*/floorplans, /sale/*, and /rental/*. Not fetched.",
  },
  {
    id: "zillow",
    name: "Zillow",
    kind: "listing-site",
    enabled: false,
    reason: "Terms of use restrict automated access. Not fetched.",
  },
  {
    id: "compass",
    name: "Compass",
    kind: "listing-site",
    enabled: false,
    reason: "No official open API is used here. Not fetched.",
  },
];

export function enabledListingSources(): ListingSource[] {
  return LISTING_SOURCES.filter((source) => source.enabled);
}
