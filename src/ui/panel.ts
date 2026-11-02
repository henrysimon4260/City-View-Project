import { floorLevels } from "../model/floors";
import type { BuildingRecord, CityDataset, DataPoint } from "../model/types";
import type { UiActions, UiModel } from "./state";

export function renderPanel(root: HTMLElement, model: UiModel, actions: UiActions, dataset: CityDataset): void {
  const selection = model.selection;
  const building =
    selection.kind === "building" || selection.kind === "floor" || selection.kind === "view" || selection.kind === "roof"
      ? dataset.buildings.find((item) => item.id === selection.buildingId) ?? null
      : null;

  root.innerHTML = building
    ? buildingView(building, model)
    : selection.kind === "context"
      ? contextView(selection)
      : browseView(dataset, model.tilesNote);

  root.querySelectorAll<HTMLButtonElement>("[data-building-id]").forEach((button) => {
    button.addEventListener("click", () => actions.selectBuilding(button.dataset.buildingId ?? ""));
  });
  root.querySelectorAll<HTMLButtonElement>("[data-floor]").forEach((button) => {
    const floor = Number(button.dataset.floor);
    button.addEventListener("click", () => actions.selectFloor(floor));
    button.addEventListener("pointerenter", () => {
      button.classList.add("is-preview");
      actions.previewFloor(floor);
    });
    button.addEventListener("pointerleave", () => {
      button.classList.remove("is-preview");
      actions.previewFloor(null);
    });
  });
  root.querySelector("[data-action='fly']")?.addEventListener("click", () => actions.flyToFloor());
  root.querySelector("[data-action='view']")?.addEventListener("click", () => actions.enterView());
  root.querySelector("[data-action='roof']")?.addEventListener("click", () => actions.enterRoof());
  root.querySelector("[data-action='back']")?.addEventListener("click", () => actions.back());
  root.querySelector("[data-action='sun']")?.addEventListener("click", () => actions.toggleSun());
  root.querySelector("[data-action='shadows']")?.addEventListener("click", () => actions.toggleShadows());
  const live = document.querySelector("#live");
  if (live) live.textContent = liveText(model, dataset);
}

function browseView(dataset: CityDataset, tilesNote: string | null): string {
  return `
    <p class="kicker">South of Chambers</p>
    <p class="lede">Five buildings with a city record. Floor heights appear only when a window row was measured.</p>
    <div class="building-list">
      ${dataset.buildings.map((building) => buildingButton(building)).join("")}
    </div>
    ${tilesNote ? `<p class="fine">${esc(tilesNote)}</p>` : ""}
  `;
}

function buildingButton(building: BuildingRecord): string {
  return `
    <button type="button" class="building" data-building-id="${esc(building.id)}">
      <strong>${esc(shortName(building.name))}</strong>
      <span>${building.stories.value} fl · ${formatNumber(building.heightRoofFt.value)} ft</span>
    </button>
  `;
}

function contextView(selection: Extract<UiModel["selection"], { kind: "context" }>): string {
  const height =
    selection.plinth || selection.heightRoofFt == null
      ? "No roof height in the city extract. Drawn as a 4 ft plinth."
      : `${formatNumber(selection.heightRoofFt)} ft roof.`;
  return `
    <button type="button" class="text-button" data-action="back">All buildings</button>
    <h2>Block ${esc(selection.bin)}</h2>
    <p class="lede">${esc(height)} Not one of the five recorded buildings.</p>
  `;
}

function buildingView(building: BuildingRecord, model: UiModel): string {
  const selection = model.selection;
  const floor = selection.kind === "floor" || selection.kind === "view" ? selection.floor : null;
  const levels = floorLevels(building);
  const level = floor == null ? null : levels.find((item) => item.number === floor) ?? null;
  const measured = level != null && level.baseMeters != null && level.topMeters != null;
  return `
    <button type="button" class="text-button" data-action="back">${selection.kind === "view" ? "Leave the floor" : "All buildings"}</button>
    <h2>${esc(shortName(building.name))}</h2>
    <p class="meta">${esc(building.addresses[0]?.text ?? "")} · ${building.stories.value} floors · ${formatNumber(building.heightRoofFt.value)} ft</p>
    ${
      selection.kind === "roof"
        ? `<p class="prompt">At the confirmed roof, 2.5 m outside the harbor-facing edge. 60° field of view. Not a floor window.</p>`
        : floor == null
          ? `<p class="prompt">Hover a floor, then click it. Without a measured window elevation the tower is not sliced. The outline is the real footprint.</p>`
          : measured
            ? `<p class="prompt">Floor ${floor} is open at its measured elevation. Unit plans that were not archived stay grey.</p>`
            : `<p class="prompt">Floor ${floor} is unverified. No window-row elevation was archived, so the building is not sliced. The light outline is the city footprint, not a guessed plan.</p>`
    }
    <div class="floor-actions">
      ${floor != null && measured ? `<button type="button" data-action="fly">Approach</button>` : ""}
      ${floor != null && measured ? `<button type="button" data-action="view">${selection.kind === "view" ? "At the window" : "Window"}</button>` : ""}
      <button type="button" data-action="roof">Roof</button>
    </div>
    <div class="floors" role="group" aria-label="Floors">
      ${levels
        .map((item) => {
          const current = item.number === floor;
          const unverified = item.elevationStatus === "unverified";
          return `<button type="button" data-floor="${item.number}" class="${current ? "is-current" : ""} ${unverified ? "is-unverified" : ""}" aria-pressed="${current}">${item.label ?? item.number}</button>`;
        })
        .join("")}
    </div>
    <div class="toggles">
      <button type="button" data-action="sun" aria-pressed="${model.sunPreview}">Sun</button>
      <button type="button" data-action="shadows" aria-pressed="${model.shadows}">Shadows</button>
    </div>
    <details>
      <summary>Record</summary>
      <p>BIN ${esc(building.bin)} · BBL ${esc(building.bbl)} · ${building.residentialUnits.value} residential units</p>
      <p>${esc(building.massing.note)}</p>
      ${building.conflicts.length ? `<p>${building.conflicts.length} published claims are not used.</p>` : ""}
      <p class="fine">${factLine(building.stories)} ${factLine(building.heightRoofFt)}</p>
    </details>
  `;
}

function factLine(point: DataPoint<unknown>): string {
  return `<span class="status ${point.status}">${point.status}</span>`;
}

function liveText(model: UiModel, dataset: CityDataset): string {
  const selection = model.selection;
  if (selection.kind === "browse") return "No building selected.";
  if (selection.kind === "context") return `Footprint ${selection.bin} selected.`;
  const building = dataset.buildings.find((item) => item.id === selection.buildingId);
  const name = building?.name ?? selection.buildingId;
  if (selection.kind === "building") return `${name} selected.`;
  if (selection.kind === "floor") return `${name}, floor ${selection.floor}.`;
  if (selection.kind === "roof") return `${name}, roof.`;
  return `${name}, floor ${selection.floor}.`;
}

function shortName(name: string): string {
  return name.replace(" Street", "");
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 10) / 10);
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
