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
      <p id="status" class="status-line" hidden></p>
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
      onFirstFrame: () => dismissBoot(bootEl),
      onStatus: (message) => showStatus(message),
    });
    bridge.api = api;
    document.querySelector("#home")?.addEventListener("click", () => void api.home());
    document.querySelector("#compass")?.addEventListener("click", () => api.faceNorth());
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") void api.back();
    });
    if (new URLSearchParams(location.search).has("debug")) window.__cityView = api;
    window.setTimeout(() => dismissBoot(bootEl), 2500);
    window.addEventListener("resize", () => {
      const status = document.querySelector("#status");
      if (status instanceof HTMLElement && !status.hidden) showStatus(status.textContent);
    });
    await api.start();
  } catch (error) {
    dismissBoot(bootEl);
    showStatus(error instanceof Error ? error.message : "The map failed to start.");
  }
}

function dismissBoot(bootEl: HTMLElement): void {
  if (!bootEl.isConnected || bootEl.classList.contains("is-done")) return;
  bootEl.classList.add("is-done");
  window.setTimeout(() => bootEl.remove(), 280);
}

function showStatus(message: string | null): void {
  const status = document.querySelector("#status");
  if (!(status instanceof HTMLElement)) return;
  status.textContent = message ?? "";
  status.hidden = !message;
  const brand = document.querySelector(".brand");
  const top = brand instanceof HTMLElement ? brand.getBoundingClientRect().bottom + 18 : 132;
  document.documentElement.style.setProperty("--chrome-top", `${Math.ceil(top)}px`);
}

declare global {
  interface Window {
    __cityView?: CityViewApi;
  }
}
