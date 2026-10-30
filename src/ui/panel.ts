import { queryDaylight } from "../analysis/daylight";
import { queryTransit } from "../analysis/transit";
import { queryViewQuality } from "../analysis/viewQuality";
import { getDataset } from "../data/dataset";
import { floorLevels } from "../model/floors";
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
    ${model.tilesNote ? `<p class="note">${esc(model.tilesNote)}</p>` : ""}
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
  root.querySelector("[data-action='roof']")?.addEventListener("click", () => actions.enterRoof());
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
    <p class="lede">Hover a block to highlight it. Near buildings are full city footprints in grey. Far buildings are simplified stand-ins at their published heights. Floor heights are listed only when a window row was measured.</p>
    <div class="building-list">
      ${dataset.buildings.map((building) => buildingButton(building)).join("")}
    </div>
    <ul class="legend">
      <li><span class="swatch shell"></span> Benchmark massing</li>
      <li><span class="swatch context"></span> Near field, full footprint, grey</li>
      <li><span class="swatch far"></span> Far field, simplified</li>
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
      : `Roof height ${formatNumber(selection.heightRoofFt)} ft. Ground elevation ${selection.groundElevationFt ?? "—"} ft. Source ${selection.source}.`;
  const tier =
    selection.tier === "far"
      ? "Far-field stand-in. The ring is simplified. The height and position are the published values. It sits outside the half-mile full-detail radius."
      : "Near-field block, within about half a mile of a benchmark. The ring is the full city footprint, drawn in grey so the five benchmarks stay distinct.";
  return `
    <button type="button" class="text-button" data-action="back">Back</button>
    <h2>Footprint ${esc(selection.bin)}</h2>
    <p>${esc(height)}</p>
    <p>${esc(tier)}</p>
    <p>This block is not one of the five buildings with a floor record, so no unit count is shown.</p>
  `;
}

function buildingView(building: BuildingRecord, model: UiModel): string {
  const selection = model.selection;
  const floor = selection.kind === "floor" || selection.kind === "view" ? selection.floor : null;
  const levels = floorLevels(building);
  const level = floor == null ? null : levels.find((item) => item.number === floor) ?? null;
  const measured = level != null && level.baseMeters != null && level.topMeters != null;
  const roofView = selection.kind === "roof";

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
    <p class="estimate">${esc(building.massing.note)} Roof height is not split into equal floors.</p>
    ${building.conflicts.length ? `<div class="conflicts"><p>Published claims not used in the model</p><ul>${building.conflicts.map((conflict) => `<li><strong>${esc(conflict.field)}</strong>: city record ${esc(conflict.modelValue)}; other source ${esc(conflict.otherValue)}.</li>`).join("")}</ul></div>` : ""}
    ${
      floor == null
        ? `<p class="prompt">Select a floor. A floor without a measured window elevation stays grey and is not sliced.</p>`
        : measured
          ? `<p class="prompt">Floor ${floor} is open at its measured elevation. Everything above it is hidden. The grey plate is not a unit plan.</p>`
          : `<p class="prompt">Floor ${floor} is unverified. No window-row elevation was archived, so it is not given a height, not sliced, and has no view camera.</p>`
    }
    ${roofView ? `<p class="view-banner">The camera is at the confirmed roof, 2.5 m outside the harbor-facing edge, with a 60° horizontal field of view. This is not a floor window. The sky is the globe atmosphere. Distant blocks are simplified open-data stand-ins.</p>` : ""}
    <div class="floor-actions">
      ${floor == null || !measured ? "" : `<button type="button" data-action="fly">Fly in toward this floor</button>`}
      ${floor == null || !measured ? "" : `<button type="button" data-action="view">${selection.kind === "view" ? "View from this floor" : "Look out from this floor"}</button>`}
      <button type="button" data-action="roof">Look from the confirmed roof</button>
    </div>
    ${
      selection.kind === "view" && level
        ? `<p class="view-banner">The eye is at the measured window-row midpoint inside the footprint, ${level.topMeters == null ? "—" : level.topMeters.toFixed(0)} m above the ellipsoid, with a 60° horizontal field of view. Surrounding buildings stay in front of the atmosphere. This is not a scored view.</p>`
        : ""
    }
    <div class="floors" role="group" aria-label="Floors">
      ${levels
        .map(
          (item) =>
            `<button type="button" data-floor="${item.number}" class="${item.number === floor ? "is-current" : ""} ${item.elevationStatus === "unverified" ? "is-unverified" : ""}" aria-pressed="${item.number === floor}">${item.label ?? item.number}</button>`,
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
  if (selection.kind === "floor") return `${name}, floor ${selection.floor}.`;
  if (selection.kind === "roof") return `${name}, looking out from the confirmed roof.`;
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
