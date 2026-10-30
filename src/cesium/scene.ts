import * as Cesium from "cesium";
import type { UnitActivation } from "../model/activation";
import { FEET_TO_METERS, floorLevels, floorWithElevation } from "../model/floors";
import type { CityDataset } from "../model/types";
import { exteriorApproach, floorVantage, parapetVantage } from "../model/viewpoint";
import type { Selection, UiModel } from "../ui/state";
import { applyShadowPreview, applySunPreview } from "./daylightPreview";
import { applyHorizontalFov } from "./fov";
import { loadGooglePhotorealisticTiles } from "./googleTiles";
import { applyBenchmarkVisibility, buildBenchmark, loadMassingFile, repaintBenchmark, type BenchmarkView } from "./layers/benchmarks";
import { loadContext, paintContextHover } from "./layers/context";
import { attachPicking, type EntityMeta } from "./picking";
import { loadFarField } from "./view/farField";
import { createHarborSkyBox, setViewModeSky } from "./view/panorama";
import { measureSightlines, type SightlineReport } from "./view/sightlines";
import { flyTo, flyToSphere, readCamera, setHomeView } from "./viewer";

export type { SightlineReport };

export interface CityViewApi {
  start: () => Promise<void>;
  selectBuilding: (id: string) => Promise<void>;
  selectFloor: (floor: number) => Promise<void>;
  flyToFloor: () => Promise<void>;
  enterView: () => Promise<void>;
  back: () => Promise<void>;
  home: () => Promise<void>;
  toggleSun: () => void;
  toggleShadows: () => void;
  getModel: () => UiModel;
  projectBuilding: (id: string) => { x: number; y: number } | null;
  sampleFps: (ms: number) => Promise<number>;
  readCamera: () => ReturnType<typeof readCamera>;
  enterRoof: () => Promise<void>;
  setTierVisible: (tier: "near" | "far", visible: boolean) => void;
  measureSightlines: () => Promise<SightlineReport>;
}

export async function mountScene(
  viewer: Cesium.Viewer,
  options: {
    dataset: CityDataset;
    imageryNote: string | null;
    onChange: (model: UiModel) => void;
    onUnitActivate?: (event: UnitActivation) => void;
  },
): Promise<CityViewApi> {
  const dataset = options.dataset;
  const benchmarkBins = new Set(dataset.buildings.map((building) => building.bin));
  const meta = new Map<string, EntityMeta>();
  const benches = new Map<string, BenchmarkView>();
  const harborSky = createHarborSkyBox();

  let selection: Selection = { kind: "browse" };
  let hoverId: string | null = null;
  let contextHoverId: string | null = null;
  let sunPreview = false;
  let shadows = false;
  let started = false;
  let tilesNote =
    "Google Photorealistic 3D Tiles are off. Set VITE_GOOGLE_MAPS_KEY to stream them. Open-data near and far geometry stays on.";
  let nearEntities: Cesium.Entity[] = [];
  let farPrimitive: Cesium.Primitive | null = null;

  const model = (): UiModel => ({
    selection,
    sunPreview,
    shadows,
    imageryNote: options.imageryNote,
    tilesNote,
  });

  const emit = () => {
    if (started) options.onChange(model());
  };

  const massing = await loadMassingFile();
  for (const record of dataset.buildings) {
    benches.set(record.id, buildBenchmark(viewer, record, meta, massing[record.id]));
  }
  nearEntities = await loadContext(viewer, benchmarkBins, meta);
  farPrimitive = await loadFarField(viewer);
  applyScene();

  attachPicking(viewer, meta, {
    onHover(id) {
      if (id === hoverId) return;
      const previous = hoverId;
      hoverId = id;
      repaintById(previous);
      repaintById(hoverId);
      viewer.scene.requestRender();
    },
    onPick(info) {
      void onPick(info);
    },
  });

  function writeHash(): void {
    let hash = "";
    if (selection.kind === "building") hash = selection.buildingId;
    if (selection.kind === "floor") hash = `${selection.buildingId}/floor/${selection.floor}`;
    if (selection.kind === "view") hash = `${selection.buildingId}/view/${selection.floor}`;
    if (selection.kind === "roof") hash = `${selection.buildingId}/roof`;
    const next = `${location.pathname}${location.search}${hash ? `#${hash}` : ""}`;
    history.replaceState(null, "", next);
  }

  function activeBuildingId(): string | null {
    if (selection.kind === "building" || selection.kind === "floor" || selection.kind === "view" || selection.kind === "roof") {
      return selection.buildingId;
    }
    return null;
  }

  function applyScene(): void {
    applyBenchmarkVisibility(benches, selection, hoverId);
    contextHoverId = paintContextHover(viewer, meta, hoverId, contextHoverId);
    viewer.scene.requestRender();
  }

  function repaintById(id: string | null): void {
    if (!id) return;
    const info = meta.get(id);
    const entity = viewer.entities.getById(id);
    if (!info || !entity) return;
    if (info.role === "context") {
      contextHoverId = paintContextHover(viewer, meta, hoverId, contextHoverId);
      return;
    }
    repaintBenchmark(entity, info, benches, selection, hoverId);
  }

  async function onPick(info: EntityMeta): Promise<void> {
    if (info.role === "context" && info.bin) {
      selection = {
        kind: "context",
        bin: info.bin,
        heightRoofFt: info.heightRoofFt ?? null,
        groundElevationFt: info.groundElevationFt ?? null,
        plinth: Boolean(info.plinth),
        tier: info.tier ?? "near",
        source: info.source ?? "footprints",
      };
      setViewModeSky(viewer, harborSky, false);
      applyScene();
      writeHash();
      emit();
      return;
    }
    if (!info.buildingId) return;
    if (info.role === "building") {
      await selectBuilding(info.buildingId);
      return;
    }
    if (info.role === "floor" && info.floor) {
      await selectFloor(info.floor, info.buildingId);
      return;
    }
    if (info.role === "plate" && info.floor) {
      if (selection.kind !== "floor" && selection.kind !== "view") {
        await selectFloor(info.floor, info.buildingId);
      }
      await flyToFloor();
    }
  }

  async function selectBuilding(id: string): Promise<void> {
    const bench = benches.get(id);
    if (!bench) return;
    selection = { kind: "building", buildingId: id };
    setViewModeSky(viewer, harborSky, false);
    applyScene();
    writeHash();
    emit();
    await flyToSphere(
      viewer,
      bench.sphere,
      new Cesium.HeadingPitchRange(Cesium.Math.toRadians(35), Cesium.Math.toRadians(-32), Math.max(bench.sphere.radius * 2.4, 180)),
    );
  }

  async function selectFloor(floor: number, buildingId = activeBuildingId()): Promise<void> {
    if (!buildingId) return;
    const bench = benches.get(buildingId);
    if (!bench) return;
    if (floor < 1 || floor > bench.record.stories.value) return;
    const entering = selection.kind !== "floor" || selection.buildingId !== buildingId || selection.floor !== floor;
    selection = { kind: "floor", buildingId, floor };
    setViewModeSky(viewer, harborSky, false);
    applyScene();
    writeHash();
    emit();
    if (entering) {
      await flyToSphere(
        viewer,
        bench.sphere,
        new Cesium.HeadingPitchRange(Cesium.Math.toRadians(28), Cesium.Math.toRadians(-28), Math.max(bench.sphere.radius * 1.35, 90)),
      );
    }
  }

  async function flyToFloor(): Promise<void> {
    if (selection.kind !== "floor" && selection.kind !== "view") return;
    const bench = benches.get(selection.buildingId);
    if (!bench) return;
    const approach = exteriorApproach(bench.record.footprintRings[0]);
    const current = selection;
    const level = floorWithElevation(floorLevels(bench.record), current.floor);
    if (!level || level.topMeters == null) return;
    options.onUnitActivate?.({
      buildingId: bench.record.id,
      floor: current.floor,
      unitId: null,
      ringStatus: "unverified",
    });
    await flyTo(viewer, {
      destination: Cesium.Cartesian3.fromDegrees(approach.longitude, approach.latitude, level.topMeters + 28),
      orientation: {
        heading: Cesium.Math.toRadians(approach.headingDegrees),
        pitch: Cesium.Math.toRadians(-22),
        roll: 0,
      },
    });
  }

  async function enterView(): Promise<void> {
    const buildingId = activeBuildingId();
    const floor = selection.kind === "floor" || selection.kind === "view" ? selection.floor : null;
    if (!buildingId || floor == null) return;
    const bench = benches.get(buildingId);
    if (!bench) return;
    const level = floorWithElevation(floorLevels(bench.record), floor);
    if (!level || level.baseMeters == null || level.topMeters == null) return;
    const windowMeters = (level.baseMeters + level.topMeters) / 2;
    const vantage = floorVantage(bench.record.footprintRings[0], windowMeters, 0);
    selection = { kind: "view", buildingId, floor };
    setViewModeSky(viewer, harborSky, true);
    applyScene();
    writeHash();
    emit();
    await flyTo(viewer, {
      destination: Cesium.Cartesian3.fromDegrees(vantage.longitude, vantage.latitude, vantage.heightMeters),
      orientation: {
        heading: Cesium.Math.toRadians(vantage.headingDegrees),
        pitch: Cesium.Math.toRadians(-6),
        roll: 0,
      },
    });
  }

  async function enterRoof(): Promise<void> {
    const buildingId = activeBuildingId() ?? dataset.buildings[0]?.id;
    if (!buildingId) return;
    const bench = benches.get(buildingId);
    if (!bench) return;
    const roof = (bench.record.groundElevationFt.value + bench.record.heightRoofFt.value) * FEET_TO_METERS;
    const vantage = parapetVantage(bench.record.footprintRings[0], roof);
    selection = { kind: "roof", buildingId };
    setViewModeSky(viewer, harborSky, false);
    applyHorizontalFov(viewer);
    applyScene();
    writeHash();
    emit();
    await flyTo(viewer, {
      destination: Cesium.Cartesian3.fromDegrees(vantage.longitude, vantage.latitude, vantage.heightMeters),
      orientation: {
        heading: Cesium.Math.toRadians(vantage.headingDegrees),
        pitch: Cesium.Math.toRadians(-3),
        roll: 0,
      },
    });
  }

  function setTierVisible(tier: "near" | "far", visible: boolean): void {
    if (tier === "near") {
      for (const entity of nearEntities) entity.show = visible;
    }
    if (tier === "far" && farPrimitive) farPrimitive.show = visible;
    viewer.scene.requestRender();
  }

  async function back(): Promise<void> {
    if (selection.kind === "browse") return;
    if (selection.kind === "view") {
      selection = { kind: "floor", buildingId: selection.buildingId, floor: selection.floor };
      setViewModeSky(viewer, harborSky, false);
      applyScene();
      writeHash();
      emit();
      const bench = benches.get(selection.buildingId);
      if (bench) {
        await flyToSphere(
          viewer,
          bench.sphere,
          new Cesium.HeadingPitchRange(Cesium.Math.toRadians(28), Cesium.Math.toRadians(-28), Math.max(bench.sphere.radius * 1.35, 90)),
        );
      }
      return;
    }
    if (selection.kind === "floor" || selection.kind === "roof") {
      await selectBuilding(selection.buildingId);
      return;
    }
    await home();
  }

  async function home(): Promise<void> {
    selection = { kind: "browse" };
    setViewModeSky(viewer, harborSky, false);
    applyScene();
    writeHash();
    emit();
    await setHomeView(viewer);
  }

  function toggleSun(): void {
    sunPreview = !sunPreview;
    applySunPreview(viewer, sunPreview);
    emit();
  }

  function toggleShadows(): void {
    shadows = !shadows;
    if (shadows && !sunPreview) {
      sunPreview = true;
      applySunPreview(viewer, true);
    }
    applyShadowPreview(viewer, shadows);
    emit();
  }

  async function applyInitialHash(): Promise<void> {
    const parts = location.hash.replace(/^#/, "").split("/").filter(Boolean);
    if (parts.length === 0) return;
    const building = dataset.buildings.find((item) => item.id === parts[0]);
    if (!building) return;
    if (parts[1] === "roof") {
      await enterRoof();
      return;
    }
    if ((parts[1] === "floor" || parts[1] === "view") && parts[2]) {
      const floor = Number(parts[2]);
      if (Number.isInteger(floor)) await selectFloor(floor, building.id);
      if (parts[1] === "view") await enterView();
      return;
    }
    await selectBuilding(building.id);
  }

  const api: CityViewApi = {
    async start() {
      started = true;
      await applyInitialHash();
      emit();
    },
    selectBuilding,
    selectFloor: (floor: number) => selectFloor(floor),
    flyToFloor,
    enterView,
    enterRoof,
    back,
    home,
    toggleSun,
    toggleShadows,
    getModel: model,
    projectBuilding(id: string) {
      const bench = benches.get(id);
      if (!bench) return null;
      const [lon, lat] = bench.record.centroid;
      const roof = (bench.record.groundElevationFt.value + bench.record.heightRoofFt.value) * FEET_TO_METERS;
      const position = Cesium.Cartesian3.fromDegrees(lon, lat, roof);
      const windowPos = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, position);
      if (!windowPos) return null;
      const rect = viewer.scene.canvas.getBoundingClientRect();
      return { x: rect.left + windowPos.x, y: rect.top + windowPos.y };
    },
    async sampleFps(ms: number) {
      const previous = viewer.scene.requestRenderMode;
      viewer.scene.requestRenderMode = false;
      let frames = 0;
      const remove = viewer.scene.postRender.addEventListener(() => {
        frames += 1;
      });
      await new Promise((resolve) => setTimeout(resolve, ms));
      remove();
      viewer.scene.requestRenderMode = previous;
      viewer.scene.requestRender();
      return (frames * 1000) / ms;
    },
    readCamera: () => readCamera(viewer),
    setTierVisible,
    measureSightlines: () => measureSightlines(viewer, benches),
  };

  void loadGooglePhotorealisticTiles(viewer).then((tiles) => {
    tilesNote = tiles.note;
    if (tiles.status === "ready") {
      setTierVisible("near", false);
      setTierVisible("far", false);
    }
    emit();
  });

  return api;
}
