# Web feasibility

Checked on 2026-10-30 against the production build (`npm run build`, then `vite preview`) in headless Chrome with SwiftShader. SwiftShader is a software WebGL driver, so the frame rates below are a floor, not what a laptop or phone GPU should do. There were no page errors. The five benchmark buildings all completed select, floor slice, fly-in, and view-from-floor.

## Load size

| Piece | On disk | Notes |
| --- | --- | --- |
| `Cesium.js` | 6.1 MB | About 1.8 MB transferred (gzip). This is most of the first load. |
| App JS | 56 KB | About 16 KB transferred. |
| App CSS | 29 KB | About 7 KB transferred. |
| Study-area footprints | 944 KB | 1,764 buildings. About 156 KB transferred. |
| Cesium workers, textures, WASM | about 14 MB in `dist/cesium` | Loaded as needed, not all on first paint. |
| Harbor sky images | four 512 px PNGs plus a sky gradient | A few kilobytes each. |

First load until the debug hook was ready: about 0.9 s on this machine, then imagery tiles continue to stream. USGS tiles for this view started arriving within a few seconds and lined up with the footprints. Some very high zoom levels are missing from that service; close views fall back to a coarser tile. The globe base color is a muted water tone while tiles are in flight.

## By feature

**Extruded footprints.** 1,764 official footprint polygons, roof height in feet, placed on the WGS84 ellipsoid. Overview frame rate was about 7 fps under SwiftShader. Idle rendering is off (`requestRenderMode`), so a still map does not repaint every frame. Desktop Chrome, Edge, Firefox, and current Safari can run this. Cesium 1.146 needs WebGL 2. The test renderer was `WebGL 2.0` via ANGLE SwiftShader.

**Hover.** A pointer move recolors one building or one floor. Touch has no hover; a tap selects. The extra cost is one pick per move, not more geometry.

**Floor slice.** Choosing a floor hides every story above it and draws one grey plate on the published ring. All five benchmarks did this (floor 12, or floor 4 at 220 Water Street, which has 7 stories). Frame rate while a tower was split into per-floor entities was about 3–4 fps on SwiftShader. The plate is the same ring as the footprint, so it does not add a second downloaded model.

**Unit outlines.** No verified unit rings are in the archive, so nothing beyond that plate is drawn. A future sourced ring would be one more polygon per floor, which is cheap next to Cesium itself.

**Fly-in.** The camera move completed for every benchmark and stayed inside the study rectangle.

**View from the floor.** The eye sits inside the footprint at the estimated floor height. The building above that floor is hidden. Surrounding footprints stay in front of an illustrative skybox (not a photograph). From floor 50 at 130 William Street the frame showed nearby roofs, the East River imagery, and the skybox. From a lower floor the view can be the face of the next building, which is what the footprints say is there. The sky images are small; they are not the performance cost.

**Sun preview and shadows.** Sun lighting stayed around 3 fps on SwiftShader. Shadows dropped to about 1 fps. Both stay off until someone turns them on. They are not a daylight study.

## Mobile and desktop

At 390×844 the map stays full screen and the record panel sits in a bottom sheet (top of the sheet around y=448, so the buildings remain visible above it). The same WebGL path runs. A phone still has to download Cesium, so this is a heavy page for a slow connection. Hover is not available; the floor buttons and the building list are the touch path.

## What not to add lightly

Another copied Cesium build, shadow maps left on, or per-floor geometry for all 1,764 context buildings would move the wrong number. The context layer is one extrusion per footprint. Only the selected benchmark is split into floors.
