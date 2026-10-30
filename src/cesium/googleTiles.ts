import * as Cesium from "cesium";

const TILESET_URL = "https://tile.googleapis.com/v1/3dtiles/root.json";

export interface GoogleTilesState {
  status: "off" | "loading" | "ready" | "failed";
  note: string;
  tileset: Cesium.Cesium3DTileset | null;
}

/**
 * Photorealistic 3D Tiles from Google's Map Tiles API. The key stays in the
 * environment. Tiles are streamed; they are not saved in this repository.
 */
export async function loadGooglePhotorealisticTiles(viewer: Cesium.Viewer): Promise<GoogleTilesState> {
  const key = import.meta.env.VITE_GOOGLE_MAPS_KEY;
  if (!key) {
    return {
      status: "off",
      note: "Google Photorealistic 3D Tiles are off. Set VITE_GOOGLE_MAPS_KEY to stream them. Open-data near and far geometry stays on.",
      tileset: null,
    };
  }
  try {
    const tileset = await Cesium.Cesium3DTileset.fromUrl(`${TILESET_URL}?key=${encodeURIComponent(key)}`);
    viewer.scene.primitives.add(tileset);
    viewer.scene.globe.show = false;
    return {
      status: "ready",
      note: "Google Photorealistic 3D Tiles are on (Map Tiles API). © Google. Open-data extrusions are hidden so they do not occupy the same space.",
      tileset,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The tileset did not load.";
    return {
      status: "failed",
      note: `Google Photorealistic 3D Tiles did not load (${message}). Open-data geometry stays on.`,
      tileset: null,
    };
  }
}
