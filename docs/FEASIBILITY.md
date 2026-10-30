# Web feasibility

Checked on 2026-10-30 against the production build (`npm run build`, then `vite preview`) in headless Chrome with SwiftShader. SwiftShader is a software WebGL driver, so the frame rates below are a floor, not what a laptop or phone GPU should do. There were no page errors. Load until the debug hook was ready was about 1.6 s.

Google Photorealistic 3D Tiles were off. No `VITE_GOOGLE_MAPS_KEY` was set, so that tier added no bytes and no frames. The open-data tiers are what this check measured.

## Payload

| Piece | On disk | Transferred |
| --- | --- | --- |
| `Cesium.js` | 6.1 MB | Most of the first load, same as before (gzip around 1.8 MB). |
| App JS | 39 KB | About 13 KB gzip. Benchmark records are fetched separately, not bundled. |
| App CSS | 29 KB | About 7 KB gzip. |
| Near field, `study-area-footprints.json` | 944 KB | 156 KB. 1,764 full footprint rings. |
| Benchmark mesh, `benchmark-massing.json` | 120 KB | 14 KB. CityGML surfaces for 15 William, 1 Wall, and 220 Water. |
| Far field, `far-field.json` | 277 KB | 59 KB. 968 simplified stand-ins. |
| Cesium workers, textures, WASM | about 14 MB in `dist/cesium` | Loaded as needed. |

The near field is every footprint in the study rectangle, which is about a half mile around the five benchmarks. The far field keeps published positions and roof heights and drops ring detail: Brooklyn waterfront buildings at or above 120 ft, buildings out to 1.5 miles at or above 200 ft, and towers beyond that at or above 400 ft, plus 47 OpenStreetMap Jersey City buildings that already had a height tag and 10 Liberty Island footprints.

## Frame rate by tier

All rates are SwiftShader, `requestRenderMode` off only while sampling.

| View | fps |
| --- | --- |
| Overview, both tiers | 6 |
| Near field only | 3 |
| Near and far together | 3 |
| Roof camera at 15 William | 3 |
| Sun preview | 1 |
| Shadows | 4 |

A 400 ms sample while 1 Wall Street was selected recorded 0 fps. That building's CityGML mesh is 407 surfaces, and the short sample caught a stall. The longer near-field and combined samples stayed at 3 fps. Idle rendering is still off, so a still map does not repaint every frame.

Far-field polygons are one batched primitive. Hiding them did not raise the frame rate above the near field, so the 1,764 full extrusions plus the benchmark meshes are the cost, not the simplified skyline. Google tiles were not in this run. They would replace those extrusions when a key is present, and their frame rate was not measured.

## Sightline check

The camera sat at the confirmed roof of 1 Wall Street, 209.4 m above the ellipsoid in this app's no-geoid frame, 2.5 m outside the harbor-facing edge. Horizontal field of view was 60° (vertical 39.7° at 1440×900). The page aimed at each landmark and compared the projected pixel with the geodesic bearing and elevation angle.

| Landmark | Tier | Bearing error | Elevation error |
| --- | --- | --- | --- |
| One World Trade Center, footprint roof | near | −0.042° | 0.00001° |
| Statue of Liberty, Liberty Island footprint roof (119.11 ft, not a statue mesh) | far | 0.105° | 0.00001° |
| Brooklyn Bridge, Wikipedia coordinate at height 0 | far | −0.027° | 0.000002° |

The geometric horizon dip at that camera height is 0.464°. The pitch where a ray from the camera last hits the ellipsoid differed by −0.001°.

Floor buttons for all five buildings stayed unverified. Fly-in and view-from-floor were not offered, because no window elevation is archived. The roof camera is the outward view that does run.

## Mobile

At 390×844 the map stays full screen and the record panel sits in a bottom sheet (top of the sheet around y=448). Hover is not available. Floor buttons and the roof button are the touch path.

## What not to add lightly

Another copied Cesium build, shadow maps left on, or full-detail footprints for all of Brooklyn and Jersey City would move the wrong number. The far tier is simplified on purpose. Photorealistic tiles stay behind the env var and are not stored in the repository.
