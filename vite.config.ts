import { defineConfig } from "vite";
import cesium from "vite-plugin-cesium";

export default defineConfig({
  base: "/City-View-Project/",
  plugins: [cesium()],
  build: {
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});
