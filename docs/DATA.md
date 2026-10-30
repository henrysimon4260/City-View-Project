# Data

The map is a static site. It does not call listing sites or the city APIs in the browser. Numbers on screen come from `src/data/benchmarks.json`, which `scripts/compile-data.mjs` builds from the archived responses in `data/cache/`.

## Status words

- **confirmed** — copied from a cited source in the archive.
- **estimated** — calculated from confirmed inputs. Equal floor heights and the WGS84 altitude are estimated. The eye position in view-from-floor mode is estimated.
- **unverified** — the archived source does not say, or a published claim disagrees with the city figure the model uses. Unverified values are not drawn as geometry.

`docs/VERIFICATION.md` is the per-building table. It is generated. Change the cache or the compiler, then run `npm run compile-data`.

## What is drawn

Context blocks are NYC building footprints (`5zhs-2jue`) inside a box from the Battery to just north of Chambers Street, and east across the Brooklyn Bridge. `height_roof` is feet above ground. `ground_elevation` is feet. Both are placed on the WGS84 ellipsoid with `0.3048` meters per foot and no geoid model, so the absolute altitude is estimated even when the foot measurements are confirmed.

Each benchmark is one ring extruded to the city roof height, then split into `numfloors` equal stories. The footprint file has one ring per benchmark BIN, so setbacks are not reconstructed. 7 Dey Street is feature code 1006, a cantilevered building; the cantilever is not modeled beyond that single ring.

Selecting a floor hides the stories above it and draws one grey plate on the same ring. Grey means the unit layout is unverified. `unitLines` is empty. The schema still accepts a line such as “A on floors 5–30” when a later archive includes a ring, a status other than unverified, and at least one source. A ring marked unverified is rejected.

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
