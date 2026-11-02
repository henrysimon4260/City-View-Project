import { defineConfig } from "vite";

function basePath(): string {
  const raw = process.env.BASE_PATH ?? "/City-View-Project/";
  if (raw === "" || raw === "/") return "/";
  const withLead = raw.startsWith("/") ? raw : `/${raw}`;
  return withLead.endsWith("/") ? withLead : `${withLead}/`;
}

export default defineConfig({
  base: basePath(),
  build: {
    sourcemap: false,
    target: "es2022",
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});
