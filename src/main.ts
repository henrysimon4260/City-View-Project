import { mountScene, type CityViewApi } from "./scene/engine";
import { staticSource } from "./data/source";
import { renderPanel } from "./ui/panel";
import type { UiActions } from "./ui/state";
import "./styles.css";

const app = document.querySelector("#app");
if (!app) throw new Error("Missing #app");

app.innerHTML = `
  <div id="cesium"></div>
  <header id="topbar">
    <div class="brand">
      <p class="mark">City View</p>
      <p class="tagline">Lower Manhattan, south of Chambers Street.</p>
    </div>
    <button type="button" id="home">Reset</button>
  </header>
  <aside id="panel"></aside>
  <button type="button" id="compass" aria-label="Face north"><span id="needle"></span></button>
  <p id="credits"></p>
  <p id="live" class="sr-only" aria-live="polite"></p>
  <p id="boot">City View</p>
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
  previewFloor: (floor) => bridge.api?.previewFloor(floor),
};

const panel = document.querySelector("#panel");
const boot = document.querySelector("#boot");
if (!(panel instanceof HTMLElement) || !(boot instanceof HTMLElement)) throw new Error("Missing panel");

void bootApp(panel, boot);

async function bootApp(panelEl: HTMLElement, bootEl: HTMLElement): Promise<void> {
  try {
    const host = document.querySelector("#cesium");
    if (!(host instanceof HTMLElement)) throw new Error("Missing map container");
    const dataset = await staticSource().load();
    const api = await mountScene(host, {
      dataset,
      onChange: (next) => renderPanel(panelEl, next, actions, dataset),
    });
    bridge.api = api;
    document.querySelector("#home")?.addEventListener("click", () => void api.home());
    document.querySelector("#compass")?.addEventListener("click", () => api.faceNorth());
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") void api.back();
    });
    if (new URLSearchParams(location.search).has("debug")) window.__cityView = api;
    await api.start();
    await api.settle();
    bootEl.classList.add("is-done");
    window.setTimeout(() => bootEl.remove(), 720);
  } catch (error) {
    bootEl.textContent = error instanceof Error ? error.message : "The map failed to start.";
  }
}

declare global {
  interface Window {
    __cityView?: CityViewApi;
  }
}
