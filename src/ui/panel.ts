import { queryDaylight } from "../analysis/daylight";
import { queryTransit } from "../analysis/transit";
import { queryViewQuality } from "../analysis/viewQuality";
import { getDataset } from "../data/dataset";
import { stackFloors } from "../model/floors";
import type { BuildingRecord, DataPoint } from "../model/types";
import type { UiActions, UiModel } from "./state";

const dataset = getDataset();

export function renderPanel(root: HTMLElement, model: UiModel, actions: UiActions): void {
  const selection = model.selection;
  const building =
    selection.kind === "building" || selection.kind === "floor" || selection.kind === "view"
      ? dataset.buildings.find((item) => item.id === selection.buildingId) ?? null
      : null;

  root.innerHTML = `
    ${model.imageryNote ? `<p class="note">${esc(model.imageryNote)}</p>` : ""}
    ${building ? buildingView(building, model) : selection.kind === "context" ? contextView(selection) : browseView()}
    ${stubs(building, selection.kind === "floor" || selection.kind === "view" ? selection.floor : null)}
    ${sunControls(model)}
    <details class="sources">
      <summary>Sources archived ${esc(dataset.retrieved)}</summary>
      <ul>
        ${dataset.citations
          .map(
            (citation) =>
              `<li><a href="${esc(citation.url)}" target="_blank" rel="noreferrer">${esc(citation.title)}</a> — ${esc(citation.publisher)}</li>`,
          )
          .join("")}
      </ul>
    </details>
  `;

  root.querySelectorAll<HTMLButtonElement>("[data-building-id]").forEach((button) => {
    button.addEventListener("click", () => actions.selectBuilding(button.dataset.buildingId ?? ""));
  });
  root.querySelectorAll<HTMLButtonElement>("[data-floor]").forEach((button) => {
    button.addEventListener("click", () => actions.selectFloor(Number(button.dataset.floor)));
  });
  root.querySelector("[data-action='fly']")?.addEventListener("click", () => actions.flyToFloor());
  root.querySelector("[data-action='view']")?.addEventListener("click", () => actions.enterView());
  root.querySelector("[data-action='back']")?.addEventListener("click", () => actions.back());
  root.querySelector("[data-action='sun']")?.addEventListener("click", () => actions.toggleSun());
  root.querySelector("[data-action='shadows']")?.addEventListener("click", () => actions.toggleShadows());

  const live = document.querySelector("#live");
  if (live) live.textContent = liveText(model);
}

function browseView(): string {
  return `
    <p class="kicker">Five buildings with archived city records</p>
    <h2>Choose a building</h2>
    <p class="lede">Hover a block to highlight it. Click a benchmark to split it into floors. Floors without a verified plan stay one grey plate.</p>
    <div class="building-list">
      ${dataset.buildings.map((building) => buildingButton(building)).join("")}
    </div>
    <ul class="legend">
      <li><span class="swatch shell"></span> Benchmark massing</li>
      <li><span class="swatch context"></span> Other footprints</li>
      <li><span class="swatch plate"></span> Unverified floor plate</li>
      <li><span class="swatch limit"></span> Camera limit</li>
    </ul>
  `;
}

function buildingButton(building: BuildingRecord): string {
  return `
    <button type="button" class="building" data-building-id="${esc(building.id)}">
      <strong>${esc(building.name)}</strong>
      <span>${building.stories.value} stories · ${formatNumber(building.heightRoofFt.value)} ft roof · ${building.residentialUnits.value} residential units</span>
    </button>
  `;
}

function contextView(selection: Extract<UiModel["selection"], { kind: "context" }>): string {
  const height =
    selection.plinth || selection.heightRoofFt == null
      ? "Roof height is missing or zero in the city extract, so this footprint is drawn as a 4 ft plinth (estimated)."
      : `Roof height ${formatNumber(selection.heightRoofFt)} ft (confirmed city footprint). Ground elevation ${selection.groundElevationFt ?? "—"} ft.`;
  return `
    <button type="button" class="text-button" data-action="back">Back</button>
    <h2>Footprint ${esc(selection.bin)}</h2>
    <p>${esc(height)}</p>
    <p>This block is only in the citywide footprint layer. It is not one of the five buildings with a verification record, so no unit count is shown.</p>
  `;
}

function buildingView(building: BuildingRecord, model: UiModel): string {
  const selection = model.selection;
  const floor = selection.kind === "floor" || selection.kind === "view" ? selection.floor : null;
  const levels = stackFloors(building);
  const level = floor == null ? null : levels.find((item) => item.number === floor) ?? null;
  const perFloor = building.heightRoofFt.value / building.stories.value;

  return `
    <button type="button" class="text-button" data-action="back">${selection.kind === "view" ? "Leave the floor" : "All buildings"}</button>
    <h2>${esc(building.name)}</h2>
    <p class="addr">${building.addresses.map((address) => esc(address.text)).join(" · ")}</p>
    <p class="meta">BIN ${esc(building.bin)} · BBL ${esc(building.bbl)} · ${esc(building.zoning.value)} · class ${esc(building.buildingClass.value)}</p>
    <dl class="facts">
      ${fact("Stories", String(building.stories.value), building.stories)}
      ${fact("Roof height", `${formatNumber(building.heightRoofFt.value)} ft`, building.heightRoofFt)}
      ${fact("Residential units", String(building.residentialUnits.value), building.residentialUnits)}
      ${fact("Certificate dwelling units", building.dwellingUnitsOnCertificate.value == null ? "Not in the extract" : String(building.dwellingUnitsOnCertificate.value), building.dwellingUnitsOnCertificate)}
    </dl>
    <p class="estimate">Equal floor spacing is estimated: about ${perFloor.toFixed(1)} ft if ${building.heightRoofFt.value} ft is divided by ${building.stories.value} stories. Setbacks are not in the footprint and are not guessed.</p>
    ${building.conflicts.length ? `<div class="conflicts"><p>Published claims not used in the model</p><ul>${building.conflicts.map((conflict) => `<li><strong>${esc(conflict.field)}</strong>: city record ${esc(conflict.modelValue)}; other source ${esc(conflict.otherValue)}.</li>`).join("")}</ul></div>` : ""}
    ${
      floor == null
        ? `<p class="prompt">Select a floor. The building stays whole until you do.</p>`
        : `<p class="prompt">Floor ${floor} is open. Everything above it is hidden. The grey plate is the city footprint at an estimated height, not a unit plan.</p>`
    }
    <div class="floor-actions">
      ${floor == null ? "" : `<button type="button" data-action="fly">Fly in toward this floor</button>`}
      ${floor == null ? "" : `<button type="button" data-action="view">${selection.kind === "view" ? "View from this floor" : "Look out from this floor"}</button>`}
    </div>
    ${
      selection.kind === "view" && level
        ? `<p class="view-banner">View-from-floor is estimated. The eye is inside the footprint, ${level.topMeters.toFixed(0)} m above the ellipsoid plus eye height. The sky is an illustrative harbor backdrop, not a photograph and not a scored view.</p>`
        : ""
    }
    <div class="floors" role="group" aria-label="Floors">
      ${levels
        .map(
          (item) =>
            `<button type="button" data-floor="${item.number}" class="${item.number === floor ? "is-current" : ""}" aria-pressed="${item.number === floor}">${item.number}</button>`,
        )
        .join("")}
    </div>
    <details>
      <summary>Record and certificate</summary>
      <p>${esc(building.certificate.value ?? "No certificate text.")}</p>
      <p>Feature code ${building.featureCode.value}: ${esc(building.featureCode.note ?? "")}.</p>
      <p>Owner on the billing lot: ${esc(building.ownerName.value)}. ZIP ${esc(building.zipCode.value)}. Landmark: ${esc(building.landmark.value ?? "not flagged in this PLUTO row")}. Historic district: ${esc(building.historicDistrict.value ?? "not flagged in this PLUTO row")}.</p>
      <ul>${building.notes.map((note) => `<li>${esc(note)}</li>`).join("")}</ul>
    </details>
  `;
}

function fact(label: string, value: string, point: DataPoint<unknown>): string {
  return `<div><dt>${esc(label)}</dt><dd>${esc(value)} <span class="status ${point.status}">${point.status}</span></dd></div>`;
}

function stubs(building: BuildingRecord | null, floor: number | null): string {
  if (!building || floor == null) {
    return `<section class="stubs"><h3>Not computed yet</h3><p>Daylight hours, view quality, and transit proximity have interfaces and no results. Nothing is estimated in their place.</p></section>`;
  }
  const daylight = queryDaylight({ buildingId: building.id, floor, unitId: null, date: "2026-06-21" });
  const view = queryViewQuality({ buildingId: building.id, floor, unitId: null });
  const transit = queryTransit({ buildingId: building.id });
  return `
    <section class="stubs">
      <h3>Not computed yet</h3>
      <p><span class="status stub">stub</span> ${esc(daylight.message)}</p>
      <p><span class="status stub">stub</span> ${esc(view.message)}</p>
      <p><span class="status stub">stub</span> ${esc(transit.message)}</p>
      <p class="hook">Unit photos are on hold. Choosing a floor plate still notifies a gallery hook so a crossfade can be added later.</p>
    </section>
  `;
}

function sunControls(model: UiModel): string {
  return `
    <div class="toggles">
      <button type="button" data-action="sun" aria-pressed="${model.sunPreview}">${model.sunPreview ? "Sun preview on" : "Preview sun position"}</button>
      <button type="button" data-action="shadows" aria-pressed="${model.shadows}">${model.shadows ? "Shadows on" : "Preview shadows"}</button>
    </div>
    <p class="fine">The sun control moves Cesium's light. It is not the daylight study.</p>
  `;
}

function liveText(model: UiModel): string {
  const selection = model.selection;
  if (selection.kind === "browse") return "No building selected.";
  if (selection.kind === "context") return `Footprint ${selection.bin} selected.`;
  const building = dataset.buildings.find((item) => item.id === selection.buildingId);
  const name = building?.name ?? selection.buildingId;
  if (selection.kind === "building") return `${name} selected.`;
  if (selection.kind === "floor") return `${name}, floor ${selection.floor}. Upper floors hidden.`;
  return `${name}, looking out from floor ${selection.floor}.`;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
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
