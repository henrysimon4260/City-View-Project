import { mountScene, type CityViewApi } from "./cesium/scene";
import { createViewer } from "./cesium/viewer";
import { renderPanel } from "./ui/panel";
import type { UiActions } from "./ui/state";
import "./styles.css";

const app = document.querySelector("#app");
if (!app) throw new Error("Missing #app");

app.innerHTML = `
  <header id="topbar">
    <div class="brand">
      <p class="mark">City View Project</p>
      <p class="tagline">Explore individual rental and condo units in a 3D downtown Manhattan map, with daylight and views factored in.</p>
    </div>
    <button type="button" id="home">Reset view</button>
  </header>
  <div id="cesium"></div>
  <aside id="panel"></aside>
  <p id="live" class="sr-only" aria-live="polite"></p>
  <p id="boot" class="boot">Loading downtown Manhattan footprints…</p>
`;

const bridge: { api: CityViewApi | null } = { api: null };
const actions: UiActions = {
  selectBuilding: (id) => void bridge.api?.selectBuilding(id),
  selectFloor: (floor) => void bridge.api?.selectFloor(floor),
  flyToFloor: () => void bridge.api?.flyToFloor(),
  enterView: () => void bridge.api?.enterView(),
  enterRoof: () => void bridge.api?.enterRoof(),
  back: () => void bridge.api?.back(),
  home: () => void bridge.api?.home(),
  toggleSun: () => bridge.api?.toggleSun(),
  toggleShadows: () => bridge.api?.toggleShadows(),
};

const panel = document.querySelector("#panel");
const boot = document.querySelector("#boot");
if (!panel || !boot) throw new Error("Missing panel");

void bootApp(panel, boot as HTMLElement);

async function bootApp(panelEl: Element, bootEl: HTMLElement): Promise<void> {
  try {
    const host = document.querySelector("#cesium");
    if (!(host instanceof HTMLElement)) throw new Error("Missing map container");
    const { viewer, imageryNote } = await createViewer(host);
    const api = await mountScene(viewer, {
      imageryNote,
      onChange: (next) => renderPanel(panelEl as HTMLElement, next, actions),
    });
    bridge.api = api;
    document.querySelector("#home")?.addEventListener("click", () => void api.home());
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") void api.back();
    });
    if (new URLSearchParams(location.search).has("debug")) {
      window.__cityView = api;
    }
    await api.start();
    bootEl.remove();
  } catch (error) {
    bootEl.textContent = error instanceof Error ? error.message : "The map failed to start.";
  }
}

declare global {
  interface Window {
    __cityView?: CityViewApi;
  }
}
