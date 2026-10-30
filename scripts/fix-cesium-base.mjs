/**
 * vite-plugin-cesium joins the Vite base into the output directory, so a
 * base of /City-View-Project/ lands Cesium in dist/City-View-Project/cesium.
 * GitHub Pages already serves dist at /City-View-Project/, and the HTML
 * requests /City-View-Project/cesium/. Move the folder up to dist/cesium.
 */
import { existsSync, renameSync, rmSync } from "node:fs";

const nested = "dist/City-View-Project/cesium";
const target = "dist/cesium";
if (!existsSync(nested)) {
  if (existsSync(target)) {
    console.log("Cesium already at dist/cesium");
    process.exit(0);
  }
  console.error("Expected Cesium assets at", nested);
  process.exit(1);
}
if (existsSync(target)) rmSync(target, { recursive: true, force: true });
renameSync(nested, target);
rmSync("dist/City-View-Project", { recursive: true, force: true });
console.log("Moved Cesium assets to dist/cesium");
