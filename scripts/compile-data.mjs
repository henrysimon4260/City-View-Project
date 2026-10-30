/**
 * Build the site dataset from archived NYC open-data responses.
 * Does not invent unit layouts. unitLines stays empty unless a future
 * archive actually contains a sourced footprint ring.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cache = resolve(root, "data/cache");
const RETRIEVED = "2026-10-30";

const FEATURE_LABELS = {
  1000: "Parking",
  1001: "Gas Station Canopy",
  1002: "Storage Tank",
  1003: "Placeholder",
  1004: "Auxiliary Structure",
  1005: "Temporary Structure",
  1006: "Cantilevered Building",
  2100: "Building",
  2110: "Skybridge",
  5100: "Building Under Construction",
  5110: "Garage",
};

const BUILDINGS = [
  {
    id: "15-william",
    name: "15 William Street",
    bin: "1087954",
    bbl: "1000257501",
    geoKeys: ["geo_15w"],
  },
  {
    id: "130-william",
    name: "130 William Street",
    bin: "1090562",
    bbl: "1000777501",
    geoKeys: ["geo_130w"],
  },
  {
    id: "1-wall",
    name: "1 Wall Street",
    bin: "1000815",
    bbl: "1000237501",
    geoKeys: ["geo_1wall"],
  },
  {
    id: "7-dey",
    name: "7 Dey Street",
    bin: "1090952",
    bbl: "1000637501",
    geoKeys: ["geo_7dey"],
  },
  {
    id: "220-water",
    name: "220 Water Street",
    bin: "1001292",
    bbl: "1000957501",
    geoKeys: ["geo_220water", "geo_117beek"],
  },
];

function readJson(name) {
  return JSON.parse(readFileSync(resolve(cache, name), "utf8"));
}

function dp(value, status, sources, note) {
  const point = { value, status, sources };
  if (note) point.note = note;
  return point;
}

function round(n, places) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function asNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function integerField(value) {
  const n = asNumber(value);
  if (n == null) return null;
  return Math.abs(n - Math.round(n)) < 1e-6 ? Math.round(n) : n;
}

function ringsFromGeom(geom) {
  const polys =
    geom.type === "MultiPolygon"
      ? geom.coordinates
      : geom.type === "Polygon"
        ? [geom.coordinates]
        : [];
  return polys.map((poly) => {
    const ring = poly[0].map(([lon, lat]) => [round(lon, 7), round(lat, 7)]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
    return ring;
  });
}

function centroid(ring) {
  const pts =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  let lon = 0;
  let lat = 0;
  for (const [x, y] of pts) {
    lon += x;
    lat += y;
  }
  return [lon / pts.length, lat / pts.length];
}

function dobNowIso(value) {
  const match = String(value ?? "")
    .trim()
    .match(/(\d+)\/(\d+)\/(\d+)/);
  if (!match) return null;
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  return `${year}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function legacyIso(value) {
  const match = String(value ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function addAddress(list, text, role, sources) {
  const normalized = String(text).trim().replace(/\s+/g, " ").toUpperCase();
  if (!normalized) return;
  const existing = list.find((item) => item.text === normalized);
  if (existing) {
    if (!existing.roles.includes(role)) existing.roles.push(role);
    for (const source of sources) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
    }
    return;
  }
  list.push({
    text: normalized,
    roles: [role],
    status: "confirmed",
    sources: [...sources],
  });
}

function padText(feature) {
  const props = feature.properties ?? {};
  if (props.housenumber && props.street) return `${props.housenumber} ${props.street}`;
  return props.name || props.label || "";
}

const plutoRows = readJson("pluto.json");
const footprintRows = readJson("footprints.json");
const dobNowRows = readJson("dobnow-co.json");
const legacyRows = readJson("legacy-co.json");
const geosearch = readJson("geosearch.json");
const claims = readJson("published-claims.json");
const roofTiers = readJson("citygml-roof-tiers.json");
const viewTiers = readJson("view-tiers.json");

const citations = [
  {
    id: "pluto",
    title: "Primary Land Use Tax Lot Output (PLUTO), version 26v2",
    publisher: "NYC Department of City Planning, via NYC Open Data",
    url: "https://data.cityofnewyork.us/City-Government/Primary-Land-Use-Tax-Lot-Output-PLUTO-/64uk-42ks",
    retrieved: RETRIEVED,
    note: "SODA dataset 64uk-42ks. The five billing-lot rows are archived in data/cache/pluto.json.",
  },
  {
    id: "footprints",
    title: "BUILDING (NYC building footprints)",
    publisher: "NYC Office of Technology and Innovation, via NYC Open Data",
    url: "https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue",
    retrieved: RETRIEVED,
    note: "SODA dataset 5zhs-2jue. Benchmark geometries are archived in data/cache/footprints.json. height_roof is feet above ground, not above sea level.",
  },
  {
    id: "footprints-metadata",
    title: "Building Footprints metadata",
    publisher: "NYC Office of Technology and Innovation",
    url: "https://github.com/CityOfNewYork/nyc-geo-metadata/blob/master/Metadata/Metadata_BuildingFootprints.md",
    retrieved: RETRIEVED,
    note: "Defines HEIGHT_ROOF, GROUND_ELEVATION, and FEATURE_CODE. Metadata date on that page: 2025-10-09.",
  },
  {
    id: "dob-legacy-co",
    title: "DOB Certificate of Occupancy",
    publisher: "NYC Department of Buildings, via NYC Open Data",
    url: "https://data.cityofnewyork.us/Housing-Development/DOB-Certificate-Of-Occupancy/bs8b-p36w",
    retrieved: RETRIEVED,
    note: "SODA dataset bs8b-p36w. Issuance rows only; this extract has no floor-by-floor occupancy schedule and no dwelling-unit column.",
  },
  {
    id: "dob-now-co",
    title: "DOB NOW: Certificate of Occupancy",
    publisher: "NYC Department of Buildings, via NYC Open Data",
    url: "https://data.cityofnewyork.us/Housing-Development/DOB-NOW-Certificate-of-Occupancy/pkdm-hqz6",
    retrieved: RETRIEVED,
    note: "SODA dataset pkdm-hqz6. Includes number_of_dwelling_units. It does not include unit lines or floor-plan geometry.",
  },
  {
    id: "pad-geosearch",
    title: "NYC Planning GeoSearch (PAD 26c)",
    publisher: "NYC Department of City Planning, Planning Labs",
    url: "https://geosearch.planninglabs.nyc/",
    retrieved: RETRIEVED,
    note: "Address-to-BIN/BBL matches. The PAD SODA table bc8t-ecyu returned 403 (non-tabular) on this retrieval, so the GeoSearch response is the PAD record used here. Version string in the responses: 26c.",
  },
  {
    id: "adjaye-130",
    title: "130 William project page",
    publisher: "Adjaye Associates",
    url: "https://www.adjaye.com/work/130-william-2/",
    retrieved: RETRIEVED,
    note: "Single project page. robots.txt allows User-agent: * with Crawl-delay: 10. Not a floor plan. Figures that disagree with city measurements are not used in the model.",
  },
  {
    id: "slce-1-wall",
    title: "One Wall Street project page",
    publisher: "SLCE Architects",
    url: "https://www.slcearch.com/project/one-wall-street/",
    retrieved: RETRIEVED,
    note: "Single project page. robots.txt allows User-agent: * with Crawl-delay: 20. Not a floor plan. The page still said Status In-Progress on retrieval.",
  },
  {
    id: "listings-policy",
    title: "Listing-site access decision",
    publisher: "City View Project",
    url: "https://github.com/henrysimon4260/City-View-Project/blob/main/docs/DATA.md",
    retrieved: RETRIEVED,
    note: "StreetEasy robots.txt disallows /building/*/floorplans, /sale/*, and /rental/*. Zillow's terms restrict automated access. Compass was not given an official open API in this pipeline. No listing-site pages were fetched.",
  },
  {
    id: "nyc-3d-citygml",
    title: "NYC 3D Building Model (CityGML)",
    publisher: "NYC Office of Technology and Innovation, distributed by NYC Open Data",
    url: "https://maps.nyc.gov/download/3dmodel/DA_WISE_GML.zip",
    retrieved: RETRIEVED,
    note: "DA_WISE_GMLs/DA12_3D_Buildings_Merged.gml from the 2016 CityGML zip. The model is the 2014 aerial survey. License: NYC Open Data terms, https://www.nyc.gov/home/terms-of-use.page. Roof and wall surfaces are copied. The model has no floor plates. 130 William and 7 Dey are absent because they were built later.",
  },
  {
    id: "wiki-15-william",
    title: "15 William",
    publisher: "Wikipedia, CC BY-SA 4.0",
    url: "https://en.wikipedia.org/wiki/15_William",
    retrieved: RETRIEVED,
    note: "Infobox floor_count 47 and roof 528 ft. The roof matches the city height. The story count does not. Short quoted facts only.",
  },
  {
    id: "wiki-1-wall",
    title: "1 Wall Street",
    publisher: "Wikipedia, CC BY-SA 4.0",
    url: "https://en.wikipedia.org/wiki/1_Wall_Street",
    retrieved: RETRIEVED,
    note: "Infobox floor_count 50, top_floor 52, roof 654 ft. The article says the official count of 50 excludes two dormer floors. PLUTO numfloors is 52.",
  },
  {
    id: "wiki-landmarks",
    title: "Landmark coordinates",
    publisher: "Wikipedia primary coordinates, CC BY-SA 4.0",
    url: "https://en.wikipedia.org/wiki/One_World_Trade_Center",
    retrieved: RETRIEVED,
    note: "Primary coordinates retrieved from the Wikipedia API for the Statue of Liberty, One World Trade Center, and the Brooklyn Bridge. One WTC and Liberty Island angles use the nearby city footprint roof, not a new mesh.",
  },
  {
    id: "osm-simple3d",
    title: "OpenStreetMap building ways, Jersey City waterfront and Lower Manhattan tags",
    publisher: "OpenStreetMap contributors, ODbL 1.0",
    url: "https://www.openstreetmap.org/copyright",
    retrieved: RETRIEVED,
    note: "Jersey City ways with a height tag are simplified far-field extrusions. OSM has no Jersey City ground elevation, so those bases sit at 0 in the same feet-as-ellipsoid frame as the NYC footprints. Buildings without a height tag are omitted. Google Street View was not scraped.",
  },
  {
    id: "google-3d-tiles",
    title: "Photorealistic 3D Tiles",
    publisher: "Google Maps Platform, Map Tiles API",
    url: "https://developers.google.com/maps/documentation/tile/3d-tiles",
    retrieved: RETRIEVED,
    note: "Streamed in Cesium only when VITE_GOOGLE_MAPS_KEY is set. Tiles are not copied into the repository. The headless check ran without a key, so that tier was off.",
  },
  {
    id: "lidar-3dep",
    title: "USGS 3DEP elevation image service",
    publisher: "U.S. Geological Survey, public domain",
    url: "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer",
    retrieved: RETRIEVED,
    note: "An identify request at 1 Wall Street returned NoData. The NYC 2017 topobathymetric point cloud was not downloaded. Near-field heights in this build are footprint height_roof and the 2014 CityGML mesh, not a new lidar sample.",
  },
];

const claimSource = {
  "130-william": "adjaye-130",
  "1-wall": "slce-1-wall",
};

function certificateRecord(bin) {
  const now = dobNowRows.filter((row) => String(row.bin) === bin);
  const legacy = legacyRows.filter((row) => String(row.bin) === bin || String(row.bin_number) === bin);
  const unitValues = [...new Set(now.map((row) => String(row.number_of_dwelling_units)).filter(Boolean))];
  const dated = now
    .map((row) => ({ row, iso: dobNowIso(row.c_of_o_issuance_date) }))
    .filter((item) => item.iso)
    .sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0));
  const latest = dated[0]?.row ?? null;
  const initial = now.find((row) => row.c_of_o_filing_type === "Initial") ?? null;
  const finalNow = now.find((row) => /final/i.test(row.c_of_o_filing_type ?? "")) ?? null;
  const legacyFinal = legacy
    .filter((row) => /final/i.test(row.issue_type ?? ""))
    .map((row) => ({ row, iso: legacyIso(row.c_o_issue_date) }))
    .filter((item) => item.iso)
    .sort((a, b) => (a.iso < b.iso ? 1 : -1))[0]?.row;

  return { now, legacy, unitValues, latest, initial, finalNow, legacyFinal };
}

function buildCertificatePoint(record) {
  const { now, legacy, unitValues, latest, initial, finalNow, legacyFinal } = record;
  if (now.length === 0 && legacy.length === 0) {
    return dp(
      null,
      "unverified",
      ["dob-now-co", "dob-legacy-co"],
      "No certificate of occupancy for this BIN in either open dataset on the retrieval date. Those datasets do not contain every older certificate. No floor schedule was available to read.",
    );
  }

  const parts = [];
  if (finalNow) {
    parts.push(
      `DOB NOW final certificate issued ${dobNowIso(finalNow.c_of_o_issuance_date)} (${finalNow.c_of_o_number}, job ${finalNow.job_filing_name}) records ${finalNow.number_of_dwelling_units} dwelling units.`,
    );
  } else if (initial) {
    parts.push(
      `DOB NOW initial certificate issued ${dobNowIso(initial.c_of_o_issuance_date)} (${initial.c_of_o_number}, job ${initial.job_filing_name}) records ${initial.number_of_dwelling_units} dwelling units.`,
    );
  }
  if (!finalNow && latest && latest !== initial) {
    parts.push(
      `Latest DOB NOW row in this extract: ${dobNowIso(latest.c_of_o_issuance_date)}, type ${latest.c_of_o_filing_type}, ${latest.number_of_dwelling_units} dwelling units (${latest.c_of_o_number}).`,
    );
  }
  if (unitValues.length === 1 && now.length > 1) {
    parts.push(`Every DOB NOW row in this extract for the BIN lists ${unitValues[0]} dwelling units.`);
  }
  if (unitValues.length > 1) {
    parts.push(`DOB NOW dwelling-unit values in this extract are not uniform: ${unitValues.join(", ")}.`);
  }
  if (legacyFinal) {
    parts.push(
      `Legacy DOB certificate dataset final issue date ${legacyIso(legacyFinal.c_o_issue_date)} (job ${legacyFinal.job_number}, item ${legacyFinal.item_number}). That dataset does not publish a dwelling-unit count.`,
    );
  } else if (legacy.length > 0 && now.length === 0) {
    parts.push(
      `Legacy DOB certificate rows exist (${legacy.length}), but none are marked Final in this extract, and the dataset has no dwelling-unit column.`,
    );
  }
  parts.push("Neither certificate dataset includes unit lines or a floor-plan drawing.");

  const sources = [];
  if (now.length) sources.push("dob-now-co");
  if (legacy.length) sources.push("dob-legacy-co");
  return dp(parts.join(" "), "confirmed", sources);
}

function dwellingPoint(record) {
  if (record.unitValues.length === 1) {
    return dp(
      Number(record.unitValues[0]),
      "confirmed",
      ["dob-now-co"],
      "number_of_dwelling_units on the DOB NOW certificate rows for this BIN. This is a building total, not a per-floor or per-line count.",
    );
  }
  if (record.unitValues.length > 1) {
    return dp(
      null,
      "unverified",
      ["dob-now-co"],
      `Conflicting number_of_dwelling_units values in the extract: ${record.unitValues.join(", ")}.`,
    );
  }
  return dp(
    null,
    "unverified",
    record.legacy.length ? ["dob-legacy-co"] : ["dob-now-co", "dob-legacy-co"],
    "No dwelling-unit number was published in the certificate rows retrieved for this BIN.",
  );
}

function considerClaims(buildingId, city, conflicts, corroboration) {
  const published = claims.filter((item) => item.buildingId === buildingId);
  for (const page of published) {
    const source = page.sourceId ?? claimSource[buildingId];
    for (const claim of page.claims) {
      const other = Number(String(claim.value).replace(/,/g, ""));
      if (claim.field === "stories" && city.stories != null) {
        if (other !== city.stories) {
          conflicts.push({
            field: "stories",
            modelValue: `${city.stories} (PLUTO numfloors)`,
            otherValue: String(other),
            status: "unverified",
            sources: [source],
            note: `${page.publisher} says “${claim.quote}”. The 3D model uses the PLUTO story count. The published figure is not used.`,
          });
        }
      } else if (claim.field === "heightFeet" && city.height != null) {
        if (Math.abs(other - city.height) > 1) {
          conflicts.push({
            field: "heightRoofFt",
            modelValue: `${city.height} ft (NYC building footprints height_roof)`,
            otherValue: `${other} ft`,
            status: "unverified",
            sources: [source],
            note: `${page.publisher} says “${claim.quote}”. The extrusion uses the city roof height. The published figure is not used.`,
          });
        }
      } else if ((claim.field === "residences" || claim.field === "units") && city.residential != null) {
        if (other === city.residential) {
          corroboration.push({
            field: claim.field,
            value: String(other),
            sources: [source],
            note: `${page.publisher} also states ${other} (“${claim.quote}”). The confirmed count remains the city figure.`,
          });
        } else {
          conflicts.push({
            field: claim.field,
            modelValue: `${city.residential} residential units (PLUTO unitsres)${city.coUnits != null ? `; ${city.coUnits} dwelling units (DOB NOW CO)` : ""}`,
            otherValue: String(other),
            status: "unverified",
            sources: [source],
            note: `${page.publisher} says “${claim.quote}”. Not used for a unit count or a floor plan.`,
          });
        }
      } else if (claim.field === "areaFt2" && city.area != null && Math.abs(other - city.area) > 1) {
        conflicts.push({
          field: "buildingAreaSqft",
          modelValue: `${city.area} sq ft (PLUTO bldgarea)`,
          otherValue: `${other} sq ft`,
          status: "unverified",
          sources: [source],
          note: `${page.publisher} says “${claim.quote}”. The model does not use gross area. The city area is what the record stores.`,
        });
      }
    }
  }
}

const buildings = BUILDINGS.map((config) => {
  const lot = plutoRows.find((row) => String(Math.round(Number(row.bbl))) === config.bbl);
  if (!lot) throw new Error(`Missing PLUTO row for ${config.bbl}`);
  if (String(lot.version) !== "26v2") {
    throw new Error(`Expected PLUTO 26v2, found ${lot.version}`);
  }
  const footprint = footprintRows.find((row) => String(row.bin) === config.bin);
  if (!footprint) throw new Error(`Missing footprint for BIN ${config.bin}`);
  const rings = ringsFromGeom(footprint.the_geom);
  if (rings.length === 0 || rings[0].length < 4) throw new Error(`Bad ring for ${config.id}`);

  const addresses = [];
  addAddress(addresses, lot.address, "PLUTO tax-lot address", ["pluto"]);
  for (const key of config.geoKeys) {
    const feature = geosearch[key]?.features?.[0];
    if (!feature) throw new Error(`Missing geosearch ${key}`);
    const pad = feature.properties?.addendum?.pad;
    if (!pad || String(pad.bin) !== config.bin || String(pad.bbl) !== config.bbl) {
      throw new Error(`PAD mismatch for ${key}: ${JSON.stringify(pad)}`);
    }
    addAddress(addresses, padText(feature), "PAD address point (GeoSearch, PAD 26c)", ["pad-geosearch"]);
  }

  const co = certificateRecord(config.bin);
  for (const row of co.now) {
    addAddress(addresses, `${row.house_no} ${row.street_name}`, "DOB NOW certificate address", ["dob-now-co"]);
  }
  for (const row of co.legacy) {
    addAddress(addresses, `${row.house_number} ${row.street_name}`, "Legacy DOB certificate address", ["dob-legacy-co"]);
  }

  const stories = integerField(lot.numfloors);
  const height = asNumber(footprint.height_roof);
  const ground = asNumber(footprint.ground_elevation);
  const residential = integerField(lot.unitsres);
  const total = integerField(lot.unitstotal);
  const yearBuilt = integerField(lot.yearbuilt);
  const constructionYear = integerField(footprint.construction_year);
  const yearAlteredRaw = integerField(lot.yearalter1);
  const featureCode = integerField(footprint.feature_code);
  const featureLabel = FEATURE_LABELS[featureCode] ?? "Unlisted feature code";
  const coUnits = co.unitValues.length === 1 ? Number(co.unitValues[0]) : null;

  const conflicts = [];
  const corroboration = [];
  considerClaims(
    config.id,
    { stories, height, residential, coUnits, area: integerField(lot.bldgarea) },
    conflicts,
    corroboration,
  );

  const notes = [];
  if (yearBuilt != null && constructionYear != null && yearBuilt !== constructionYear) {
    notes.push(
      `PLUTO yearbuilt is ${yearBuilt} and the footprint construction_year is ${constructionYear}. Both are kept. They are different city fields, not one completion date.`,
    );
  }
  if (residential != null && coUnits != null && residential !== coUnits) {
    notes.push(
      `PLUTO unitsres is ${residential} and DOB NOW number_of_dwelling_units is ${coUnits}. Both city figures are kept. They are not averaged.`,
    );
  }
  if (featureCode === 1006) {
    notes.push(
      "FEATURE_CODE 1006 is a cantilevered building in the city footprint metadata. The file publishes one ring. Extruding that ring does not reconstruct the cantilever.",
    );
  }
  if (config.id === "220-water") {
    notes.push(
      "PAD lists both 220 WATER STREET and 117 BEEKMAN STREET on BIN 1001292 / BBL 1000957501. PLUTO's tax-lot address for that BBL is 117 BEEKMAN STREET.",
    );
  }
  if (config.id === "7-dey") {
    notes.push(
      "PAD lists 7 DEY STREET on BIN 1090952. PLUTO and the DOB NOW certificates for that BIN use 185 BROADWAY.",
    );
  }
  notes.push("No per-unit footprint, line letter, or floor-plan coordinate was present in the sources archived for this building. unitLines is empty on purpose.");
  notes.push(
    "Floor elevations are not an even split of roof height. No window-row measurement was reliable enough to publish: street-level photos are cropped and foreshortened, and a luminance pass on the distant 15 William photograph did not lock one peak to each floor. Every ordinal floor is unverified and is not drawn.",
  );

  const tierRows = roofTiers.buildings?.[config.id] ?? [];
  const massing = tierRows.length
    ? {
        kind: "citygml",
        status: "confirmed",
        sources: ["nyc-3d-citygml"],
        note: `NYC 3D model mesh, 2014 aerial survey, ${tierRows.length} horizontal roof surfaces. Those surfaces are setbacks and crowns, not floor plates.`,
      }
    : {
        kind: "footprint-envelope",
        status: "confirmed",
        sources: ["footprints", "nyc-3d-citygml"],
        note:
          config.id === "7-dey"
            ? "The 2014 CityGML does not include this building. The cantilever underside elevation is not in the archive, so the single city ring is kept and a separated cantilever is not invented."
            : "The 2014 CityGML does not include this building. Setbacks and the crown are not in the archived mesh, so they are not drawn. The block is the city footprint extruded to height_roof.",
      };
  const floors = Array.from({ length: stories }, (_, index) => ({
    number: index + 1,
    label: null,
    baseFt: null,
    topFt: null,
    elevationStatus: "unverified",
    sources: ["pluto", "dob-now-co", "dob-legacy-co", "nyc-3d-citygml"],
    note: "PLUTO ordinal. Certificate tables and the CityGML mesh do not give this floor's elevation. It is not drawn.",
  }));

  const landmarkText = lot.landmark ? String(lot.landmark) : null;
  const historicText = lot.histdist ? String(lot.histdist) : null;

  return {
    id: config.id,
    name: config.name,
    bin: config.bin,
    bbl: config.bbl,
    footprintRings: rings,
    centroid: centroid(rings[0]).map((n) => round(n, 7)),
    addresses,
    stories: dp(stories, "confirmed", ["pluto"], "PLUTO numfloors on the condominium billing lot."),
    heightRoofFt: dp(
      height,
      "confirmed",
      ["footprints", "footprints-metadata"],
      "height_roof, feet above ground elevation, not above sea level.",
    ),
    groundElevationFt: dp(
      ground,
      "confirmed",
      ["footprints", "footprints-metadata"],
      "ground_elevation, feet. City metadata: lowest ground elevation at the building, NAVD88 when the source supports it. Placing that number on the WGS84 ellipsoid without a geoid model is an estimated absolute altitude.",
    ),
    residentialUnits: dp(residential, "confirmed", ["pluto"], "PLUTO unitsres. Not a floor-by-floor count."),
    totalUnits: dp(total, "confirmed", ["pluto"], "PLUTO unitstotal, including non-residential units on the lot."),
    dwellingUnitsOnCertificate: dwellingPoint(co),
    yearBuilt: dp(yearBuilt, "confirmed", ["pluto"], "PLUTO yearbuilt."),
    constructionYear: dp(constructionYear, "confirmed", ["footprints"], "Footprint construction_year."),
    yearAltered: dp(
      yearAlteredRaw && yearAlteredRaw > 0 ? yearAlteredRaw : null,
      "confirmed",
      ["pluto"],
      yearAlteredRaw && yearAlteredRaw > 0
        ? "PLUTO yearalter1."
        : "PLUTO yearalter1 is 0 in this extract, which records no alteration year in that field.",
    ),
    buildingClass: dp(String(lot.bldgclass), "confirmed", ["pluto"], "PLUTO bldgclass code, stored as published."),
    landUseCode: dp(String(lot.landuse), "confirmed", ["pluto"], "PLUTO landuse code, stored as published."),
    zoning: dp(String(lot.zonedist1), "confirmed", ["pluto"], "PLUTO zonedist1."),
    landmark: dp(
      landmarkText,
      "confirmed",
      ["pluto"],
      landmarkText
        ? "PLUTO landmark field."
        : "The PLUTO row has no landmark value. Socrata omitted the empty field. This is not a Landmarks designation search beyond that column.",
    ),
    historicDistrict: dp(
      historicText,
      "confirmed",
      ["pluto"],
      historicText
        ? "PLUTO histdist."
        : "The PLUTO row has no histdist value. Socrata omitted the empty field.",
    ),
    featureCode: dp(featureCode, "confirmed", ["footprints", "footprints-metadata"], featureLabel),
    buildingAreaSqft: dp(integerField(lot.bldgarea), "confirmed", ["pluto"], "PLUTO bldgarea, square feet."),
    residentialAreaSqft: dp(integerField(lot.resarea), "confirmed", ["pluto"], "PLUTO resarea, square feet."),
    commercialAreaSqft: dp(integerField(lot.comarea), "confirmed", ["pluto"], "PLUTO comarea, square feet."),
    lotAreaSqft: dp(integerField(lot.lotarea), "confirmed", ["pluto"], "PLUTO lotarea, square feet."),
    zipCode: dp(String(lot.zipcode), "confirmed", ["pluto"], "PLUTO zipcode."),
    ownerName: dp(String(lot.ownername), "confirmed", ["pluto"], "PLUTO ownername on the billing lot."),
    certificate: buildCertificatePoint(co),
    unitLines: [],
    floors,
    massing,
    conflicts,
    corroboration,
    notes,
  };
});

const datasetNotes = [
  "Story count and roof height are city fields. Roof height is not divided into equal floors. A floor is drawn only when its elevation is archived. None of the five buildings has a measured window-row elevation in this archive, so every floor is unverified and grey.",
  "15 William, 1 Wall Street, and 220 Water Street use the 2014 NYC CityGML mesh (setbacks and crowns). 130 William and 7 Dey were built later and are the city footprint at height_roof. 7 Dey's cantilever is still one ring because the underside elevation was not found.",
  `Near field is every footprint in the study extract (${viewTiers.studyNearFeatures} buildings), about a half mile around the benchmarks, at the city roof height, drawn grey. Far field is ${viewTiers.farFeatures} simplified stand-ins (${viewTiers.farFootprints} NYC footprints, ${viewTiers.farJersey} OpenStreetMap Jersey City buildings with a height tag, ${viewTiers.farLiberty} Liberty Island footprints).`,
  "Outward views use a 60° horizontal field of view. The illustrative harbor skybox is not used. Google Photorealistic 3D Tiles load only with VITE_GOOGLE_MAPS_KEY and were not on for the headless check.",
  "Absolute height above the WGS84 ellipsoid is an estimate: ground_elevation and height_roof, converted with 0.3048 meters per foot, with no NAVD88 geoid separation applied. The USGS 3DEP identify call at 1 Wall Street returned NoData, so 2017 lidar was not sampled into new heights.",
  "StreetEasy, Zillow, and Compass were not crawled. Google Street View was not scraped. No active listing, rent, or sale price is shown.",
];

const dataset = {
  retrieved: RETRIEVED,
  plutoVersion: "26v2",
  padVersion: "26c",
  citations,
  datasetNotes,
  buildings,
};

const outDir = resolve(root, "src/data");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "benchmarks.json"), `${JSON.stringify(dataset, null, 2)}\n`);

const study = readJson("study-area.geojson");
const studyFeatures = [];
for (const feature of study.features ?? []) {
  const geom = feature.geometry;
  if (!geom) continue;
  const polys =
    geom.type === "MultiPolygon" ? geom.coordinates : geom.type === "Polygon" ? [geom.coordinates] : [];
  if (polys.length === 0) continue;
  const coordinates = polys.map((poly) =>
    poly.map((ring) => ring.map(([lon, lat]) => [round(lon, 6), round(lat, 6)])),
  );
  const props = feature.properties ?? {};
  studyFeatures.push({
    type: "Feature",
    properties: {
      bin: String(props.bin),
      heightRoofFt: asNumber(props.height_roof),
      groundElevationFt: asNumber(props.ground_elevation),
      constructionYear: integerField(props.construction_year),
      featureCode: integerField(props.feature_code),
      bbl: props.mappluto_bbl ? String(props.mappluto_bbl) : null,
    },
    geometry: { type: "MultiPolygon", coordinates },
  });
}
const publicDir = resolve(root, "public/data");
mkdirSync(publicDir, { recursive: true });
writeFileSync(
  resolve(publicDir, "study-area-footprints.json"),
  JSON.stringify({ type: "FeatureCollection", features: studyFeatures }),
);

function chip(point) {
  if (point.value == null || point.value === "") return `— (${point.status})`;
  return `${point.value} (${point.status})`;
}

const lines = [];
lines.push("# Verification status");
lines.push("");
lines.push(`Retrieved ${RETRIEVED}. Generated by \`scripts/compile-data.mjs\` from \`data/cache\`. Do not edit the numbers by hand.`);
lines.push("");
lines.push("Status words mean only this:");
lines.push("");
lines.push("- **confirmed** — the value is copied from a cited public source archived in this repo.");
lines.push("- **estimated** — the value is calculated from confirmed inputs and the calculation is disclosed. The ellipsoid altitude is estimated. A measured window row would be estimated. None are stored for these floors.");
lines.push("- **unverified** — the source does not say, was not available, or a published claim disagrees with the city figure the model uses. Unverified claims are not drawn.");
lines.push("");
lines.push("Unit polygons, line letters, and floor plans are **unverified** for every benchmark building. `unitLines` is an empty array. Floor elevations are unverified too: the map does not draw a sliced floor or a guessed window camera. Grey floor buttons are those unverified ordinals.");
lines.push("");
lines.push("## Summary");
lines.push("");
lines.push("| Building | BIN | BBL | Stories | Roof ft | Residential units | CO dwelling units | Unit footprints |");
lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const building of buildings) {
  lines.push(
    `| ${building.name} | ${building.bin} | ${building.bbl} | ${chip(building.stories)} | ${chip(building.heightRoofFt)} | ${chip(building.residentialUnits)} | ${chip(building.dwellingUnitsOnCertificate)} | unverified — not drawn |`,
  );
}
lines.push("");
lines.push("## Shared limits");
lines.push("");
for (const note of datasetNotes) lines.push(`- ${note}`);
lines.push("");

for (const building of buildings) {
  lines.push(`## ${building.name}`);
  lines.push("");
  lines.push(`BIN ${building.bin}. BBL ${building.bbl}. ZIP ${building.zipCode.value}. Class ${building.buildingClass.value}. Land-use code ${building.landUseCode.value}. Zoning ${building.zoning.value}.`);
  lines.push("");
  lines.push("Addresses:");
  lines.push("");
  for (const address of building.addresses) {
    lines.push(`- ${address.text} — ${address.roles.join("; ")} (${address.status}; ${address.sources.join(", ")})`);
  }
  lines.push("");
  lines.push("| Field | Value | Status | Sources |");
  lines.push("| --- | --- | --- | --- |");
  const fields = [
    ["Stories", building.stories],
    ["Roof height ft", building.heightRoofFt],
    ["Ground elevation ft", building.groundElevationFt],
    ["Residential units", building.residentialUnits],
    ["Total units", building.totalUnits],
    ["CO dwelling units", building.dwellingUnitsOnCertificate],
    ["PLUTO year built", building.yearBuilt],
    ["Footprint construction year", building.constructionYear],
    ["PLUTO year altered", building.yearAltered],
    ["Feature code", building.featureCode],
    ["Building area sq ft", building.buildingAreaSqft],
    ["Residential area sq ft", building.residentialAreaSqft],
    ["Commercial area sq ft", building.commercialAreaSqft],
    ["Lot area sq ft", building.lotAreaSqft],
    ["Landmark", building.landmark],
    ["Historic district", building.historicDistrict],
    ["Owner", building.ownerName],
  ];
  for (const [label, point] of fields) {
    const value = point.value == null ? "—" : String(point.value).replace(/\|/g, "/");
    lines.push(`| ${label} | ${value} | ${point.status} | ${point.sources.join(", ")} |`);
  }
  lines.push("");
  lines.push(`Certificate: ${building.certificate.value ?? "—"} _(${building.certificate.status})_`);
  lines.push("");
  if (building.conflicts.length) {
    lines.push("Published claims that the model does not use:");
    lines.push("");
    for (const conflict of building.conflicts) {
      lines.push(`- **${conflict.field}** — model uses ${conflict.modelValue}; other source says ${conflict.otherValue}. Status: ${conflict.status}. ${conflict.note}`);
    }
    lines.push("");
  }
  if (building.corroboration.length) {
    lines.push("Published claims that match the city count:");
    lines.push("");
    for (const item of building.corroboration) {
      lines.push(`- **${item.field}** ${item.value}. ${item.note}`);
    }
    lines.push("");
  }
  lines.push("Notes:");
  lines.push("");
  for (const note of building.notes) lines.push(`- ${note}`);
  lines.push("");
  lines.push(`Massing: ${building.massing.kind} (${building.massing.status}; ${building.massing.sources.join(", ")}). ${building.massing.note}`);
  lines.push("");
  const tiers = roofTiers.buildings?.[building.id] ?? [];
  if (tiers.length) {
    lines.push("CityGML horizontal roof surfaces. These are massing elevations, not floor plates.");
    lines.push("");
    lines.push("| Absolute ft | Feet above city ground | Area sq ft | Status | Sources |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const tier of tiers) {
      lines.push(`| ${tier.absoluteFt} | ${tier.aboveCityGroundFt} | ${tier.areaSqFt} | ${tier.status} | ${tier.sources.join(", ")} |`);
    }
    lines.push("");
  }
  lines.push("Floor elevations. Base and top are feet above the city ground elevation. Null means the floor is not drawn.");
  lines.push("");
  lines.push("| Floor | Label | Base ft | Top ft | Status | Sources |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const floor of building.floors) {
    lines.push(`| ${floor.number} | ${floor.label ?? "—"} | ${floor.baseFt ?? "—"} | ${floor.topFt ?? "—"} | ${floor.elevationStatus} | ${floor.sources.join(", ")} |`);
  }
  lines.push("");
}

lines.push("## Sources");
lines.push("");
for (const citation of citations) {
  lines.push(`- **${citation.id}** — ${citation.title}. ${citation.publisher}. ${citation.url} Retrieved ${citation.retrieved}. ${citation.note ?? ""}`);
}
lines.push("");

writeFileSync(resolve(root, "docs/VERIFICATION.md"), `${lines.join("\n")}\n`);

console.log(
  `Wrote ${buildings.length} buildings, ${studyFeatures.length} context footprints, ${buildings.reduce((n, b) => n + b.unitLines.length, 0)} unit lines.`,
);
