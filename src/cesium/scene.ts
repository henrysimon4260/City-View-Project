import * as Cesium from "cesium";
import { activateUnit } from "../gallery/hook";
import { getDataset } from "../data/dataset";
import { FEET_TO_METERS, EYE_HEIGHT_METERS, graphicsForFloor, stackFloors } from "../model/floors";
import type { BuildingRecord } from "../model/types";
import { exteriorApproach, floorVantage } from "../model/viewpoint";
import type { Selection, UiModel } from "../ui/state";
import { applyShadowPreview, applySunPreview } from "./daylightPreview";
import { createHarborSkyBox, setViewModeSky } from "./panorama";
import { flyTo, flyToSphere, readCamera, setHomeView } from "./viewer";

const COLOR = {
  context: Cesium.Color.fromCssColorString("#c4bfb4"),
  contextHover: Cesium.Color.fromCssColorString("#f3ead6"),
  shell: Cesium.Color.fromCssColorString("#d2be9a"),
  shellHover: Cesium.Color.fromCssColorString("#f0d48a"),
  floor: Cesium.Color.fromCssColorString("#c9b28a"),
  floorHover: Cesium.Color.fromCssColorString("#f2d48a"),
  floorSelected: Cesium.Color.fromCssColorString("#e09a45"),
  plate: Cesium.Color.fromCssColorString("#8d8a84"),
  plateHover: Cesium.Color.fromCssColorString("#e4e0d8"),
  unit: Cesium.Color.fromCssColorString("#2f6f5e"),
  unitHover: Cesium.Color.fromCssColorString("#3f917c"),
};

interface EntityMeta {
  role: "building" | "floor" | "plate" | "context";
  entityId: string;
  buildingId?: string;
  floor?: number;
  unitId?: string | null;
  bin?: string;
  heightRoofFt?: number | null;
  groundElevationFt?: number | null;
  plinth?: boolean;
}

interface FloorEntity {
  floor: number;
  entity: Cesium.Entity;
}

interface PlateEntity {
  floor: number;
  unitId: string | null;
  entity: Cesium.Entity;
}

interface BenchmarkView {
  record: BuildingRecord;
  shells: Cesium.Entity[];
  floors: FloorEntity[];
  plates: PlateEntity[];
  label: Cesium.Entity;
  sphere: Cesium.BoundingSphere;
}

interface StudyFeature {
  properties: {
    bin: string;
    heightRoofFt: number | null;
    groundElevationFt: number | null;
  };
  geometry: { type: string; coordinates: number[][][][] };
}

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
}

export async function mountScene(
  viewer: Cesium.Viewer,
  options: { imageryNote: string | null; onChange: (model: UiModel) => void },
): Promise<CityViewApi> {
  const dataset = getDataset();
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

  const model = (): UiModel => ({
    selection,
    sunPreview,
    shadows,
    imageryNote: options.imageryNote,
  });

  const emit = () => {
    if (started) options.onChange(model());
  };

  for (const record of dataset.buildings) {
    benches.set(record.id, buildBenchmark(viewer, record, meta));
  }
  await loadContext(viewer, benchmarkBins, meta);
  applyScene();

  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((movement: { endPosition: Cesium.Cartesian2 }) => {
    const entity = pickEntity(viewer, movement.endPosition);
    const id = entity?.id ?? null;
    if (id === hoverId) return;
    const previous = hoverId;
    hoverId = id;
    repaintById(previous);
    repaintById(hoverId);
    viewer.scene.requestRender();
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  handler.setInputAction((click: { position: Cesium.Cartesian2 }) => {
    const entity = pickEntity(viewer, click.position);
    if (!entity) return;
    const info = meta.get(entity.id);
    if (!info) return;
    void onPick(info);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  function writeHash(): void {
    let hash = "";
    if (selection.kind === "building") hash = selection.buildingId;
    if (selection.kind === "floor") hash = `${selection.buildingId}/floor/${selection.floor}`;
    if (selection.kind === "view") hash = `${selection.buildingId}/view/${selection.floor}`;
    const next = `${location.pathname}${location.search}${hash ? `#${hash}` : ""}`;
    history.replaceState(null, "", next);
  }

  function activeBuildingId(): string | null {
    if (selection.kind === "building" || selection.kind === "floor" || selection.kind === "view") {
      return selection.buildingId;
    }
    return null;
  }

  function activeFloor(): number | null {
    if (selection.kind === "floor" || selection.kind === "view") return selection.floor;
    return null;
  }

  function applyScene(): void {
    const activeId = activeBuildingId();
    const floorNumber = activeFloor();
    const sliced = selection.kind === "floor" || selection.kind === "view";

    for (const bench of benches.values()) {
      const active = bench.record.id === activeId;
      for (const shell of bench.shells) {
        shell.show = !active;
        paint(shell, shellColor(shell.id, active));
      }
      for (const floor of bench.floors) {
        const above = active && sliced && floorNumber != null && floor.floor > floorNumber;
        const standingInside = selection.kind === "view" && floor.floor === floorNumber;
        floor.entity.show = active && !above && !standingInside;
        paint(floor.entity, floorColor(floor.entity.id, floor.floor === floorNumber && sliced));
      }
      for (const plate of bench.plates) {
        plate.entity.show = active && sliced && plate.floor === floorNumber;
        paint(plate.entity, plateColor(plate.entity.id, plate.unitId));
      }
    }

    paintContextHover();

    viewer.scene.requestRender();
  }

  function paintContextHover(): void {
    const next = hoverId && meta.get(hoverId)?.role === "context" ? hoverId : null;
    if (contextHoverId && contextHoverId !== next) {
      const previous = viewer.entities.getById(contextHoverId);
      if (previous?.polygon) previous.polygon.material = new Cesium.ColorMaterialProperty(COLOR.context);
    }
    if (next) {
      const entity = viewer.entities.getById(next);
      if (entity?.polygon) entity.polygon.material = new Cesium.ColorMaterialProperty(COLOR.contextHover);
    }
    contextHoverId = next;
  }

  function repaintById(id: string | null): void {
    if (!id) return;
    const info = meta.get(id);
    const entity = viewer.entities.getById(id);
    if (!info || !entity) return;
    if (info.role === "context") {
      paintContextHover();
      return;
    }
    if (!entity.polygon) return;
    if (info.role === "building") paint(entity, shellColor(id, false));
    if (info.role === "floor" && info.floor) {
      const sliced = selection.kind === "floor" || selection.kind === "view";
      paint(entity, floorColor(id, sliced && info.floor === activeFloor()));
    }
    if (info.role === "plate") paint(entity, plateColor(id, info.unitId ?? null));
  }

  function shellColor(id: string, _active: boolean): Cesium.Color {
    return hoverId === id ? COLOR.shellHover : COLOR.shell;
  }

  function floorColor(id: string, selected: boolean): Cesium.Color {
    if (hoverId === id) return COLOR.floorHover;
    if (selected) return COLOR.floorSelected;
    return COLOR.floor;
  }

  function plateColor(id: string, unitId: string | null): Cesium.Color {
    const hovered = hoverId === id;
    if (unitId) return hovered ? COLOR.unitHover : COLOR.unit;
    return hovered ? COLOR.plateHover : COLOR.plate;
  }

  async function onPick(info: EntityMeta): Promise<void> {
    if (info.role === "context" && info.bin) {
      selection = {
        kind: "context",
        bin: info.bin,
        heightRoofFt: info.heightRoofFt ?? null,
        groundElevationFt: info.groundElevationFt ?? null,
        plinth: Boolean(info.plinth),
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
    const level = stackFloors(bench.record).find((item) => item.number === current.floor);
    if (!level) return;
    activateUnit({
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
    const floor = activeFloor();
    if (!buildingId || floor == null) return;
    const bench = benches.get(buildingId);
    if (!bench) return;
    const level = stackFloors(bench.record).find((item) => item.number === floor);
    if (!level) return;
    const vantage = floorVantage(bench.record.footprintRings[0], level.topMeters, EYE_HEIGHT_METERS);
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
    if (selection.kind === "floor") {
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
    back,
    home,
    toggleSun,
    toggleShadows,
    getModel: model,
    projectBuilding(id: string) {
      const bench = benches.get(id);
      if (!bench) return null;
      const [lon, lat] = bench.record.centroid;
      const roof =
        (bench.record.groundElevationFt.value + bench.record.heightRoofFt.value) * FEET_TO_METERS;
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
  };

  return api;
}

function paint(entity: Cesium.Entity, color: Cesium.Color): void {
  if (entity.polygon) entity.polygon.material = new Cesium.ColorMaterialProperty(color);
}

function pickEntity(viewer: Cesium.Viewer, position: Cesium.Cartesian2): Cesium.Entity | null {
  const picked = viewer.scene.pick(position);
  if (!picked || typeof picked !== "object" || !("id" in picked)) return null;
  const id = (picked as { id?: unknown }).id;
  return id instanceof Cesium.Entity ? id : null;
}

function hierarchy(ring: [number, number][]): Cesium.PolygonHierarchy {
  return new Cesium.PolygonHierarchy(ring.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)));
}

function buildBenchmark(viewer: Cesium.Viewer, record: BuildingRecord, meta: Map<string, EntityMeta>): BenchmarkView {
  const levels = stackFloors(record);
  const points: Cesium.Cartesian3[] = [];
  const shells: Cesium.Entity[] = [];
  const floors: FloorEntity[] = [];
  const plates: PlateEntity[] = [];
  const ground = record.groundElevationFt.value * FEET_TO_METERS;
  const roof = ground + record.heightRoofFt.value * FEET_TO_METERS;

  record.footprintRings.forEach((ring, part) => {
    for (const [lon, lat] of ring) {
      points.push(Cesium.Cartesian3.fromDegrees(lon, lat, ground));
      points.push(Cesium.Cartesian3.fromDegrees(lon, lat, roof));
    }
    const shellId = `shell:${record.id}:${part}`;
    const shell = viewer.entities.add({
      id: shellId,
      polygon: {
        hierarchy: hierarchy(ring),
        height: ground,
        extrudedHeight: roof,
        material: COLOR.shell,
        outline: false,
      },
    });
    shells.push(shell);
    meta.set(shellId, { role: "building", entityId: shellId, buildingId: record.id });

    for (const level of levels) {
      const floorId = `floor:${record.id}:${level.number}:${part}`;
      const floorEntity = viewer.entities.add({
        id: floorId,
        show: false,
        polygon: {
          hierarchy: hierarchy(ring),
          height: level.baseMeters,
          extrudedHeight: level.topMeters,
          material: COLOR.floor,
          outline: false,
        },
      });
      floors.push({ floor: level.number, entity: floorEntity });
      meta.set(floorId, { role: "floor", entityId: floorId, buildingId: record.id, floor: level.number });

      const graphics = graphicsForFloor(record, level.number);
      graphics.forEach((graphic, graphicIndex) => {
        const rings = graphic.kind === "unit" ? [graphic.ring] : graphic.rings;
        rings.forEach((graphicRing, ringIndex) => {
          if (graphic.kind === "unverified-plate" && ringIndex !== part) return;
          if (graphic.kind === "unit" && part !== 0) return;
          const plateId = `plate:${record.id}:${level.number}:${part}:${graphicIndex}:${ringIndex}`;
          const plate = viewer.entities.add({
            id: plateId,
            show: false,
            polygon: {
              hierarchy: hierarchy(graphicRing),
              height: level.topMeters,
              extrudedHeight: level.topMeters + 0.2,
              material: graphic.kind === "unit" ? COLOR.unit : COLOR.plate,
              outline: false,
            },
          });
          const unitId = graphic.kind === "unit" ? graphic.lineId : null;
          plates.push({ floor: level.number, unitId, entity: plate });
          meta.set(plateId, {
            role: "plate",
            entityId: plateId,
            buildingId: record.id,
            floor: level.number,
            unitId,
          });
        });
      });
    }
  });

  const labelId = `label:${record.id}`;
  const label = viewer.entities.add({
    id: labelId,
    position: Cesium.Cartesian3.fromDegrees(record.centroid[0], record.centroid[1], roof + 6),
    label: {
      text: record.name,
      font: "600 15px Palatino, Georgia, serif",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.fromCssColorString("#1c1915"),
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -4),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2800),
    },
  });
  meta.set(labelId, { role: "building", entityId: labelId, buildingId: record.id });

  return {
    record,
    shells,
    floors,
    plates,
    label,
    sphere: Cesium.BoundingSphere.fromPoints(points),
  };
}

async function loadContext(
  viewer: Cesium.Viewer,
  benchmarkBins: Set<string>,
  meta: Map<string, EntityMeta>,
): Promise<void> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/study-area-footprints.json`);
  if (!response.ok) throw new Error(`Could not load footprints (${response.status}).`);
  const collection = (await response.json()) as { features: StudyFeature[] };
  for (const feature of collection.features) {
    const bin = feature.properties.bin;
    if (benchmarkBins.has(bin)) continue;
    const heightFt = feature.properties.heightRoofFt;
    const groundFt = feature.properties.groundElevationFt ?? 0;
    const plinth = heightFt == null || heightFt <= 0;
    const extrudedFt = plinth ? 4 : heightFt;
    const base = (groundFt ?? 0) * FEET_TO_METERS;
    const top = base + extrudedFt * FEET_TO_METERS;
    const polys = feature.geometry?.coordinates ?? [];
    polys.forEach((poly, part) => {
      const ring = poly[0];
      if (!ring || ring.length < 4) return;
      const id = `context:${bin}:${part}`;
      viewer.entities.add({
        id,
        polygon: {
          hierarchy: hierarchy(ring as [number, number][]),
          height: base,
          extrudedHeight: top,
          material: COLOR.context,
          outline: false,
        },
      });
      meta.set(id, {
        role: "context",
        entityId: id,
        bin,
        heightRoofFt: plinth ? null : heightFt,
        groundElevationFt: feature.properties.groundElevationFt,
        plinth,
      });
    });
  }
}
