# Data

The map is a static site. It does not call listing sites or the city APIs in the browser. Numbers on screen come from `src/data/benchmarks.json`, which `scripts/compile-data.mjs` builds from the archived responses in `data/cache/`.

## Status words

- **confirmed** — copied from a cited source in the archive.
- **estimated** — calculated from confirmed inputs and the calculation is disclosed. The WGS84 altitude, with no geoid, is estimated. A roof-edge camera position is estimated in plan and uses a confirmed roof height.
- **unverified** — the archived source does not say, or a published claim disagrees with the city figure the model uses. Unverified floor elevations are not drawn.

`docs/VERIFICATION.md` is the per-building table. It is generated. Change the cache or the compiler, then run `npm run compile-data`.

## What is drawn

Context blocks are NYC building footprints (`5zhs-2jue`) inside a box from the Battery to just north of Chambers Street, and east across the Brooklyn Bridge. `height_roof` is feet above ground. `ground_elevation` is feet. Both are placed on the WGS84 ellipsoid with `0.3048` meters per foot and no geoid model, so the absolute altitude is estimated even when the foot measurements are confirmed.

15 William, 1 Wall Street, and 220 Water are the NYC CityGML mesh from the 2014 aerial survey (`public/data/benchmark-massing.json`). That mesh has setbacks and crowns. It does not have floor plates. 130 William and 7 Dey are later buildings, so they stay the city footprint extruded to `height_roof`. 7 Dey is feature code 1006. The underside of the cantilever is not in the archive, so the ring is not split into a invented overhang.

Roof height is not divided into equal floors. `floors` lists every PLUTO ordinal with a null elevation until a window-row measurement is archived. Selecting one of those floors does not slice the mesh and does not move a camera to a guessed sill.

Near-field context is every study-area footprint, drawn grey, at the city height. Far-field context is `public/data/far-field.json`: simplified rings, published heights, outside a half-mile radius. Jersey City rows come from OpenStreetMap ways that already have a `height` tag (ODbL). Liberty Island uses the city footprints, including BIN 1000002 at 119.11 ft. No statue mesh was added on top.

`scripts/build-view-geometry.py` rebuilds the mesh and the far field from the CityGML extract and the open-data downloads. Google Photorealistic 3D Tiles are optional at runtime (`VITE_GOOGLE_MAPS_KEY`) and are not stored here. Google Street View is not scraped.

Selecting a floor that later has an elevation hides the stories above it and draws one grey plate. Grey still means the unit layout is unverified. `unitLines` is empty. The schema still accepts a line such as “A on floors 5–30” when a later archive includes a ring, a status other than unverified, and at least one source. A ring marked unverified is rejected.

## Pipeline

`scripts/fetch-open-data.mjs` refreshes the cache. It waits at least 1.1 seconds between requests and sends an identifying user agent. It calls:

- PLUTO `64uk-42ks` (version 26v2 in the current archive)
- Building footprints `5zhs-2jue`
- DOB NOW certificates `pkdm-hqz6`
- Legacy DOB certificates `bs8b-p36w`
- NYC Planning GeoSearch for PAD 26c address points

It does not call StreetEasy, Zillow, or Compass. StreetEasy’s robots.txt disallows `/building/*/floorplans`, `/sale/*`, and `/rental/*`. Zillow’s terms restrict automated access. Compass is not used through an open API. No rents, sales, or floor plans from those sites are stored.

Two project pages were retrieved once, because their robots.txt allows the path: Adjaye Associates on 130 William, and SLCE Architects on 1 Wall Street. Where those pages disagree with the city, the disagreement is stored as unverified and is not used for height, story count, area, or polygons. `data/cache/published-claims.json` is curated and is not overwritten by the fetcher.

The PAD SODA table returned 403 (“non-tabular”) on retrieval, so address aliases use GeoSearch’s PAD 26c payload instead.

## Stubs

`src/analysis/daylight.ts`, `viewQuality.ts`, and `transit.ts` return a stub and a null measure. The sun button only moves Cesium’s light. It is not those functions.

`src/gallery/hook.ts` receives a floor-plate click. No photo crossfade is attached.
