import {
  Color,
  DirectionalLight,
  HemisphereLight,
  MeshStandardMaterial,
  NoToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Plane,
  PMREMGenerator,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { TilesRenderer } from "3d-tiles-renderer/three";
import {
  GLTFExtensionsPlugin,
  GoogleCloudAuthPlugin,
  ReorientationPlugin,
  TileCompressionPlugin,
  TilesFadePlugin,
} from "3d-tiles-renderer/plugins";
import {
  BlendFunction,
  BloomEffect,
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  KernelSize,
  OutlineEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from "postprocessing";
import { N8AOPostPass } from "n8ao";
import { solarPosition } from "../analysis/daylight";
import { activateUnit } from "../gallery/hook";
import { LOWER_MANHATTAN, CITY_HALL } from "../model/bounds";
import { FEET_TO_METERS, floorLevels, floorWithElevation, graphicsForFloor } from "../model/floors";
import { LANDMARKS } from "../model/landmarks";
import {
  anglesAtPixel,
  elevationAngleDegrees,
  horizonDipDegrees,
  initialBearingDegrees,
  smallestAngleDegrees,
  verticalFovDegrees,
} from "../model/sightline";
import type { BuildingRecord, CityDataset } from "../model/types";
import { ellipsoidHeight } from "../model/vertical";
import { exteriorApproach, floorVantage, parapetVantage } from "../model/viewpoint";
import type { Selection, UiModel } from "../ui/state";
import { patchClipObject, setSlice } from "./clip";
import { MapControls, type Rig } from "./controls";
import { FRAME_LAT_DEG, FRAME_LON_DEG, SEA_LEVEL_Y, fromLocal, lookVector, toLocal } from "./geodesy";
import { buildCity } from "./massing";
import { detectQuality, type QualitySettings } from "./quality";
import { createRibbon, setRibbon } from "./ribbon";
import { HarborWater } from "./water";

function chainFirstFrame(previous: (() => void) | undefined, next: () => void): () => void {
  let ran = false;
  return () => {
    if (ran) return;
    ran = true;
    previous?.();
    next();
  };
}

const MAP_FOV = 52;
const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

export interface SightlineReport {
  camera: { longitude: number; latitude: number; height: number; heading: number; pitch: number };
  fov: { horizontal: number; vertical: number };
  aimed: Array<{
    id: string;
    tier: "near" | "far";
    bearingDegrees: number;
    elevationDegrees: number;
    bearingErrorDegrees: number;
    elevationErrorDegrees: number;
  }>;
  horizonDipDegrees: number;
  horizonResidualDegrees: number;
}

export interface CityViewApi {
  start: () => Promise<void>;
  settle: () => Promise<void>;
  selectBuilding: (id: string) => Promise<void>;
  selectFloor: (floor: number) => Promise<void>;
  previewFloor: (floor: number | null) => void;
  flyToFloor: () => Promise<void>;
  enterView: () => Promise<void>;
  enterRoof: () => Promise<void>;
  back: () => Promise<void>;
  home: () => Promise<void>;
  faceNorth: () => void;
  toggleSun: () => void;
  toggleShadows: () => void;
  getModel: () => UiModel;
  projectBuilding: (id: string) => { x: number; y: number } | null;
  sampleFps: (ms: number) => Promise<number>;
  readCamera: () => { longitude: number; latitude: number; height: number; heading: number; pitch: number };
  setTierVisible: (tier: "near" | "far", visible: boolean) => void;
  measureSightlines: () => Promise<SightlineReport>;
}

export async function mountScene(
  container: HTMLElement,
  options: {
    dataset: CityDataset;
    onChange: (model: UiModel) => void;
    onFirstFrame?: () => void;
    onStatus?: (message: string | null) => void;
  },
): Promise<CityViewApi> {
  const quality = detectQuality();
  const reduceMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    new URLSearchParams(location.search).has("instant");
  const renderer = new WebGLRenderer({
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
    stencil: false,
    failIfMajorPerformanceCaveat: false,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  renderer.setPixelRatio(quality.pixelRatio);
  renderer.setClearColor(new Color("#8eb4d4"), 1);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "none";
  container.append(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(MAP_FOV, 1, 0.35, 25000);
  camera.layers.enable(1);

  const sunState = solarPosition(new Date(), CITY_HALL.latitude, CITY_HALL.longitude);
  const held = sunState.elevationDegrees < 4;
  const sunElevation = held ? 8 : sunState.elevationDegrees;
  const sunAzimuth = sunState.azimuthDegrees;
  const sunDirection = lookVector(sunAzimuth * RAD, sunElevation * RAD).normalize();

  const sky = new Sky();
  sky.scale.setScalar(80000);
  const skyUniforms = sky.material.uniforms;
  skyUniforms.turbidity.value = 2.3;
  skyUniforms.rayleigh.value = 2.05;
  skyUniforms.mieCoefficient.value = 0.0042;
  skyUniforms.mieDirectionalG.value = 0.84;
  skyUniforms.sunPosition.value.copy(sunDirection).multiplyScalar(4000);
  sky.material.depthWrite = false;
  scene.add(sky);

  const hemi = new HemisphereLight("#c5d7ea", "#3a322c", 0.28);
  scene.add(hemi);
  const sun = new DirectionalLight("#ffe2b8", 4.8);
  sun.position.copy(sunDirection).multiplyScalar(2400);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.32;
  const shadow = sun.shadow.camera;
  shadow.left = -1700;
  shadow.right = 1700;
  shadow.top = 1700;
  shadow.bottom = -1700;
  shadow.near = 200;
  shadow.far = 5200;
  scene.add(sun);
  scene.add(sun.target);

  try {
    const pmrem = new PMREMGenerator(renderer);
    const probe = new Scene();
    probe.add(sky.clone());
    scene.environment = pmrem.fromScene(probe, 0.04).texture;
    scene.environmentIntensity = 0.32;
    pmrem.dispose();
  } catch (error) {
    console.warn("Environment map skipped.", error);
  }

  const city = await buildCity(options.dataset.buildings);
  scene.add(city.land);
  scene.add(city.city);
  for (const mesh of city.benchmarks.values()) scene.add(mesh);
  if (city.warnings.length > 0) {
    options.onStatus?.(city.warnings.join(" "));
  }

  const water = new HarborWater(renderer, quality.reflections, quality.reflectionScale);
  water.setSun(sunDirection);
  scene.add(water.mesh);

  const ribbon = createRibbon();
  scene.add(ribbon);
  const hoverRibbon = createRibbon();
  scene.add(hoverRibbon);

  const controls = new MapControls(camera, renderer.domElement);
  const markers = buildMarkers(container, options.dataset.buildings);
  const credits = document.querySelector("#credits");
  const needle = document.querySelector<HTMLElement>("#needle");

  let selection: Selection = { kind: "browse" };
  let previewFloor: number | null = null;
  let sunOn = true;
  let shadowsOn = true;
  let tilesNote = held
    ? "The sun is below the horizon, so the light is held just above it. Daylight hours are not computed."
    : null;
  let nearVisible = true;
  let frameCount = 0;
  let tiles: TilesRenderer | null = null;
  let degraded = false;
  const outlineSelection: Object3D[] = [...city.benchmarks.values()];

  const composer = buildComposer(renderer, scene, camera, quality, outlineSelection);
  resize();

  const homeRig = frameOverview(camera);
  controls.setHome(homeRig);
  controls.snap(homeRig, "home");

  let last = performance.now();
  let sawFrame = false;
  let tileFaults = 0;
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    try {
      controls.update(dt);
      if (tiles && tileFaults < 3) {
        try {
          tiles.setResolutionFromRenderer(camera, renderer);
          tiles.update();
          maybeRevealTiles();
        } catch (error) {
          tileFaults += 1;
          reportTileFailure(error);
        }
      }
      water.update(dt, camera, scene, quality.reflections);
      composer.render(dt);
    } catch (error) {
      console.error(error);
      reportTileFailure(error);
    }
    frameCount += 1;
    if (!sawFrame) {
      sawFrame = true;
      options.onFirstFrame?.();
    }
    placeMarkers();
    if (needle) needle.style.transform = `rotate(${(-controls.current.heading * DEG).toFixed(2)}deg)`;
    if (!degraded && frameCount === 180 && quality.tier === "high") void maybeDegrade();
  };
  requestAnimationFrame(loop);

  const model = (): UiModel => ({
    selection,
    sunPreview: sunOn,
    shadows: shadowsOn,
    imageryNote: null,
    tilesNote,
  });
  let started = false;
  const emit = () => {
    if (started) options.onChange(model());
  };
  options.onFirstFrame = chainFirstFrame(options.onFirstFrame, () => {
    void mountTiles();
  });

  function resize(): void {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    water.setSize(renderer.domElement.width, renderer.domElement.height, quality.reflectionScale);
    if (controls.mode === "home" && !controls.introducing) {
      const next = frameOverview(camera);
      controls.setHome(next);
      controls.snap(next, "home");
    }
  }
  window.addEventListener("resize", resize);

  async function mountTiles(): Promise<void> {
    const key = import.meta.env.VITE_GOOGLE_MAPS_KEY;
    if (!key) {
      publishStatus("Photorealistic tiles are off. The open-data model is showing.");
      paintCredits(null);
      return;
    }
    try {
      const rendererTiles = new TilesRenderer();
      rendererTiles.registerPlugin(
        new GoogleCloudAuthPlugin({ apiToken: key, autoRefreshToken: false, useRecommendedSettings: false }),
      );
      rendererTiles.registerPlugin(
        new ReorientationPlugin({
          lat: (FRAME_LAT_DEG * Math.PI) / 180,
          lon: (FRAME_LON_DEG * Math.PI) / 180,
          height: 0,
          recenter: true,
        }),
      );
      const draco = new DRACOLoader();
      draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
      const ktx2 = new KTX2Loader();
      ktx2.setTranscoderPath(`${import.meta.env.BASE_URL}basis/`);
      ktx2.detectSupport(renderer);
      rendererTiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco, ktxLoader: ktx2, rtc: true }));
      rendererTiles.registerPlugin(new TileCompressionPlugin());
      rendererTiles.registerPlugin(new TilesFadePlugin({ fadeDuration: reduceMotion ? 0 : 0.45 }));
      rendererTiles.errorTarget = quality.errorTarget;
      rendererTiles.lruCache.maxBytesSize = quality.tier === "high" ? 1.4e9 : quality.tier === "medium" ? 8e8 : 4e8;
      rendererTiles.lruCache.minBytesSize = rendererTiles.lruCache.maxBytesSize * 0.45;
      rendererTiles.setCamera(camera);
      rendererTiles.setResolutionFromRenderer(camera, renderer);
      rendererTiles.addEventListener("load-model", (event) => {
        const loaded = (event as { scene?: Object3D }).scene;
        if (!loaded) return;
        patchClipObject(loaded);
      });
      rendererTiles.addEventListener("load-error", (event) => {
        const info = event as { tile?: unknown; error?: unknown };
        if (info.tile != null) return;
        reportTileFailure(info.error ?? new Error("Google returned 404 for the 3D tileset."));
      });
      tiles = rendererTiles;
      rendererTiles.addEventListener("load-root-tileset", () => {
        if (!scene.children.includes(rendererTiles.group)) scene.add(rendererTiles.group);
        paintCredits(rendererTiles);
      });
      paintCredits(rendererTiles);
    } catch (error) {
      reportTileFailure(error);
    }
  }

  function publishStatus(message: string | null): void {
    options.onStatus?.(message);
    if (tilesNote === message) return;
    tilesNote = message;
    emit();
  }

  function reportTileFailure(error: unknown): void {
    const raw = error instanceof Error ? error.message : String(error);
    const detail = /404/.test(raw)
      ? "Google returned 404 for the 3D tileset."
      : /failed to fetch/i.test(raw)
        ? "The browser could not reach Google’s 3D tiles."
        : "Photorealistic tiles did not load.";
    publishStatus(`${detail} The open-data model is showing.`);
    if (tiles) {
      scene.remove(tiles.group);
      tiles = null;
    }
    tileFaults = 3;
    restoreMassing();
  }

  function restoreMassing(): void {
    city.land.visible = true;
    city.city.visible = nearVisible;
    const cityMaterial = city.city.material as MeshStandardMaterial;
    cityMaterial.colorWrite = true;
    cityMaterial.depthWrite = true;
    for (const mesh of city.benchmarks.values()) {
      const material = mesh.material as MeshStandardMaterial;
      material.colorWrite = true;
      material.depthWrite = true;
    }
  }

  let photoreal = false;
  function maybeRevealTiles(): void {
    if (photoreal || !tiles || tiles.visibleTiles.size === 0) return;
    photoreal = true;
    city.land.visible = false;
    const cityMaterial = city.city.material as MeshStandardMaterial;
    cityMaterial.colorWrite = false;
    cityMaterial.depthWrite = false;
    for (const mesh of city.benchmarks.values()) {
      const material = mesh.material as MeshStandardMaterial;
      material.colorWrite = false;
      material.depthWrite = false;
    }
    publishStatus(null);
  }

  function paintCredits(rendererTiles: TilesRenderer | null): void {
    if (!(credits instanceof HTMLElement)) return;
    const parts: string[] = [];
    if (import.meta.env.VITE_GOOGLE_MAPS_KEY) parts.push("© Google");
    if (rendererTiles) {
      const list: Array<{ value: string; type: string }> = [];
      rendererTiles.getAttributions(list);
      for (const item of list) {
        if (item.type === "string" && item.value) parts.push(item.value);
      }
    }
    if (!import.meta.env.VITE_GOOGLE_MAPS_KEY) parts.push("NYC open data");
    credits.textContent = parts.filter(Boolean).join(" · ");
  }

  function placeMarkers(): void {
    const width = container.clientWidth;
    const height = container.clientHeight;
    const forward = new Vector3();
    camera.getWorldDirection(forward);
    const active = activeBuildingId();
    for (const record of options.dataset.buildings) {
      const button = markers.get(record.id);
      if (!button) continue;
      const roof = ellipsoidHeight((record.groundElevationFt.value + record.heightRoofFt.value) * FEET_TO_METERS);
      const point = toLocal(record.centroid[0], record.centroid[1], roof + 8);
      const toPoint = point.clone().sub(camera.position);
      const behind = toPoint.dot(forward) <= 0;
      const ndc = point.clone().project(camera);
      const x = (ndc.x * 0.5 + 0.5) * width;
      const y = (-ndc.y * 0.5 + 0.5) * height;
      const visible = !behind && ndc.z < 1 && x > -40 && x < width + 40 && y > -40 && y < height + 40;
      button.hidden = !visible;
      button.classList.toggle("is-active", record.id === active);
      button.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
    }
  }

  function activeBuildingId(): string | null {
    if (selection.kind === "building" || selection.kind === "floor" || selection.kind === "view" || selection.kind === "roof") {
      return selection.buildingId;
    }
    return null;
  }

  function recordById(id: string | null): BuildingRecord | null {
    if (!id) return null;
    return options.dataset.buildings.find((item) => item.id === id) ?? null;
  }

  function refreshOutlines(): void {
    const id = activeBuildingId();
    const record = recordById(id);
    const floor =
      previewFloor ??
      (selection.kind === "floor" || selection.kind === "view" ? selection.floor : null);
    if (!record || floor == null) {
      ribbon.visible = false;
      setSlice(null, null);
      clearClip();
      return;
    }
    const level = floorWithElevation(floorLevels(record), floor);
    const measured = level?.topMeters != null;
    const roofY = ellipsoidHeight((record.groundElevationFt.value + record.heightRoofFt.value) * FEET_TO_METERS);
    const y = measured && level?.topMeters != null ? ellipsoidHeight(level.topMeters) : roofY + 2.4;
    const graphics = graphicsForFloor(record, floor);
    const rings = graphics.flatMap((graphic) => (graphic.kind === "unit" ? [graphic.ring] : graphic.rings));
    const verified = graphics.some((graphic) => graphic.kind === "unit");
    setRibbon(ribbon, rings, y, verified ? "#f4e7cf" : "#fff7ea", verified ? 0.85 : 2.6);
    const commit = previewFloor == null && (selection.kind === "floor" || selection.kind === "view");
    if (commit && measured) {
      setSlice(record.footprintRings[0], y);
      clipBuilding(record.id, y);
    } else {
      setSlice(null, null);
      clearClip();
    }
  }

  function clearClip(): void {
    for (const mesh of city.benchmarks.values()) {
      (mesh.material as MeshStandardMaterial).clippingPlanes = null;
    }
  }

  function clipBuilding(id: string, y: number): void {
    const plane = new Plane(new Vector3(0, -1, 0), y);
    for (const [key, mesh] of city.benchmarks) {
      (mesh.material as MeshStandardMaterial).clippingPlanes = key === id ? [plane] : null;
    }
  }

  function writeHash(): void {
    let hash = "";
    if (selection.kind === "building") hash = selection.buildingId;
    if (selection.kind === "floor") hash = `${selection.buildingId}/floor/${selection.floor}`;
    if (selection.kind === "view") hash = `${selection.buildingId}/view/${selection.floor}`;
    if (selection.kind === "roof") hash = `${selection.buildingId}/roof`;
    const next = `${location.pathname}${location.search}${hash ? `#${hash}` : ""}`;
    history.replaceState(null, "", next);
  }

  function focusRecord(record: BuildingRecord, pitch: number, heading: number): void {
    const points: Vector3[] = [];
    const base = ellipsoidHeight(record.groundElevationFt.value * FEET_TO_METERS);
    const roof = base + record.heightRoofFt.value * FEET_TO_METERS;
    for (const ring of record.footprintRings) {
      for (const [lon, lat] of ring) {
        points.push(toLocal(lon, lat, base));
        points.push(toLocal(lon, lat, roof + 12));
      }
    }
    controls.flyTo(fit(camera, points, pitch * RAD, heading * RAD, 0.72, 0.7), reduceMotion ? 0 : 1.25, "focus");
  }

  async function selectBuilding(id: string): Promise<void> {
    const record = recordById(id);
    if (!record) return;
    selection = { kind: "building", buildingId: id };
    previewFloor = null;
    camera.fov = MAP_FOV;
    camera.updateProjectionMatrix();
    refreshOutlines();
    writeHash();
    emit();
    focusRecord(record, -36, 32);
  }

  async function selectFloor(floor: number, buildingId = activeBuildingId()): Promise<void> {
    if (!buildingId) return;
    const record = recordById(buildingId);
    if (!record) return;
    if (floor < 1 || floor > record.stories.value) return;
    previewFloor = null;
    selection = { kind: "floor", buildingId, floor };
    camera.fov = MAP_FOV;
    camera.updateProjectionMatrix();
    refreshOutlines();
    writeHash();
    emit();
    const level = floorWithElevation(floorLevels(record), floor);
    activateUnit({
      buildingId: record.id,
      floor,
      unitId: null,
      ringStatus: level ? "estimated" : "unverified",
    });
    focusRecord(record, -58, 18);
  }

  function preview(floor: number | null): void {
    if (activeBuildingId() == null) return;
    previewFloor = floor;
    refreshOutlines();
  }

  async function flyToFloor(): Promise<void> {
    if (selection.kind !== "floor" && selection.kind !== "view") return;
    const record = recordById(selection.buildingId);
    if (!record) return;
    const level = floorWithElevation(floorLevels(record), selection.floor);
    if (!level?.topMeters) return;
    const approach = exteriorApproach(record.footprintRings[0]);
    const eye = toLocal(approach.longitude, approach.latitude, ellipsoidHeight(level.topMeters) + 28);
    const pivot = eye.clone().add(lookVector(approach.headingDegrees * RAD, (-22 * Math.PI) / 180).multiplyScalar(36));
    camera.fov = verticalFovDegrees(60, camera.aspect);
    camera.updateProjectionMatrix();
    controls.flyTo(
      { pivot, heading: approach.headingDegrees * RAD, pitch: (-22 * Math.PI) / 180, distance: 36 },
      reduceMotion ? 0 : 1.15,
      "focus",
    );
  }

  async function enterView(): Promise<void> {
    const id = activeBuildingId();
    const floor = selection.kind === "floor" || selection.kind === "view" ? selection.floor : null;
    if (!id || floor == null) return;
    const record = recordById(id);
    if (!record) return;
    const level = floorWithElevation(floorLevels(record), floor);
    if (!level?.baseMeters || !level.topMeters) return;
    const eyeHeight = ellipsoidHeight((level.baseMeters + level.topMeters) / 2);
    const vantage = floorVantage(record.footprintRings[0], eyeHeight, 0);
    selection = { kind: "view", buildingId: id, floor };
    placeVantage(vantage.longitude, vantage.latitude, vantage.heightMeters, vantage.headingDegrees, -6);
    refreshOutlines();
    writeHash();
    emit();
  }

  async function enterRoof(): Promise<void> {
    const id = activeBuildingId() ?? options.dataset.buildings[0]?.id;
    if (!id) return;
    const record = recordById(id);
    if (!record) return;
    const roof = ellipsoidHeight((record.groundElevationFt.value + record.heightRoofFt.value) * FEET_TO_METERS);
    const vantage = parapetVantage(record.footprintRings[0], roof);
    selection = { kind: "roof", buildingId: id };
    previewFloor = null;
    ribbon.visible = false;
    setSlice(null, null);
    clearClip();
    placeVantage(vantage.longitude, vantage.latitude, vantage.heightMeters, vantage.headingDegrees, -3);
    writeHash();
    emit();
  }

  function placeVantage(lon: number, lat: number, height: number, heading: number, pitch: number): void {
    camera.fov = verticalFovDegrees(60, camera.aspect);
    camera.updateProjectionMatrix();
    const eye = toLocal(lon, lat, height);
    const look = lookVector(heading * RAD, pitch * RAD);
    const pivot = eye.clone().addScaledVector(look, 34);
    controls.flyTo({ pivot, heading: heading * RAD, pitch: pitch * RAD, distance: 34 }, reduceMotion ? 0 : 1.15, "focus");
  }

  async function back(): Promise<void> {
    if (selection.kind === "browse") return;
    if (selection.kind === "view") {
      await selectFloor(selection.floor, selection.buildingId);
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
    previewFloor = null;
    camera.fov = MAP_FOV;
    camera.updateProjectionMatrix();
    ribbon.visible = false;
    hoverRibbon.visible = false;
    setSlice(null, null);
    clearClip();
    writeHash();
    emit();
    const next = frameOverview(camera);
    controls.setHome(next);
    controls.flyTo(next, reduceMotion ? 0 : 1.35, "home");
  }

  function toggleSun(): void {
    sunOn = !sunOn;
    sun.visible = sunOn;
    sky.visible = sunOn;
    emit();
  }

  function toggleShadows(): void {
    shadowsOn = !shadowsOn;
    sun.castShadow = shadowsOn && sunOn;
    emit();
  }

  const raycaster = new Raycaster();
  const pointer = new Vector2();
  function pick(clientX: number, clientY: number): void {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([city.city, ...city.benchmarks.values()], false);
    const hit = hits[0];
    if (!hit) return;
    if (hit.object !== city.city) {
      const id = hit.object.name;
      if (id) void selectBuilding(id);
      return;
    }
    if (!nearVisible) return;
    const face = hit.faceIndex ?? -1;
    const bin = city.faceBins[face];
    const context = bin ? city.context.get(bin) : undefined;
    if (!context) return;
    selection = {
      kind: "context",
      bin: context.bin,
      heightRoofFt: context.heightRoofFt,
      groundElevationFt: context.groundElevationFt,
      plinth: context.plinth,
      tier: "near",
      source: "footprints",
    };
    previewFloor = null;
    refreshOutlines();
    const ring = context.rings[0];
    if (ring) setRibbon(hoverRibbon, [ring], SEA_LEVEL_Y + 2.2, "#e7e4de", 0.8);
    writeHash();
    emit();
  }

  renderer.domElement.addEventListener("pointerup", (event) => {
    if (event.button !== 0) return;
    const moved = Math.hypot(event.clientX - downX, event.clientY - downY);
    if (moved < 5) pick(event.clientX, event.clientY);
  });
  let downX = 0;
  let downY = 0;
  renderer.domElement.addEventListener("pointerdown", (event) => {
    downX = event.clientX;
    downY = event.clientY;
  });

  async function applyInitialHash(): Promise<void> {
    const parts = location.hash.replace(/^#/, "").split("/").filter(Boolean);
    if (parts.length === 0) return;
    const building = options.dataset.buildings.find((item) => item.id === parts[0]);
    if (!building) return;
    if (parts[1] === "roof") {
      selection = { kind: "building", buildingId: building.id };
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

  async function maybeDegrade(): Promise<void> {
    const fps = await new Promise<number>((resolve) => {
      const start = frameCount;
      window.setTimeout(() => resolve(((frameCount - start) * 1000) / 700), 700);
    });
    if (fps >= 48) return;
    degraded = true;
    quality.errorTarget = 9;
    quality.pixelRatio = Math.min(quality.pixelRatio, 1.35);
    renderer.setPixelRatio(quality.pixelRatio);
    if (tiles) tiles.errorTarget = quality.errorTarget;
    resize();
  }

  const api: CityViewApi = {
    async start() {
      started = true;
      await applyInitialHash();
      if (selection.kind === "browse") {
        const next = frameOverview(camera);
        controls.setHome(next);
        if (reduceMotion) controls.snap(next, "home");
        else {
          const intro = { ...next, pivot: next.pivot.clone(), distance: next.distance * 2.25, heading: 0.46, pitch: -0.58 };
          controls.snap(intro, "home");
          controls.flyTo(next, 3.35, "home");
        }
      }
      emit();
    },
    settle() {
      return new Promise((resolve) => {
        const check = () => {
          if (!controls.introducing && frameCount > 2) resolve();
          else requestAnimationFrame(check);
        };
        check();
      });
    },
    selectBuilding,
    selectFloor: (floor: number) => selectFloor(floor),
    previewFloor: preview,
    flyToFloor,
    enterView,
    enterRoof,
    back,
    home,
    faceNorth() {
      controls.faceNorth(reduceMotion ? 0 : 0.8);
    },
    toggleSun,
    toggleShadows,
    getModel: model,
    projectBuilding(id: string) {
      const record = recordById(id);
      if (!record) return null;
      const roof = ellipsoidHeight((record.groundElevationFt.value + record.heightRoofFt.value) * FEET_TO_METERS);
      const point = toLocal(record.centroid[0], record.centroid[1], roof);
      const ndc = point.project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return { x: rect.left + (ndc.x * 0.5 + 0.5) * rect.width, y: rect.top + (-ndc.y * 0.5 + 0.5) * rect.height };
    },
    sampleFps(ms: number) {
      const start = frameCount;
      return new Promise((resolve) => {
        window.setTimeout(() => resolve(((frameCount - start) * 1000) / ms), ms);
      });
    },
    readCamera() {
      const cart = fromLocal(camera.position);
      return {
        longitude: cart.longitude,
        latitude: cart.latitude,
        height: cart.height,
        heading: (controls.current.heading * DEG + 360) % 360,
        pitch: controls.current.pitch * DEG,
      };
    },
    setTierVisible(tier, visible) {
      if (tier === "near") {
        nearVisible = visible;
        if (!tiles) city.city.visible = visible;
      }
      renderer.domElement.dataset.far = tier === "far" && visible ? "1" : renderer.domElement.dataset.far ?? "0";
    },
    measureSightlines: () =>
      measureSightlines(camera, controls, options.dataset.buildings, container.clientWidth, container.clientHeight),
  };

  for (const [id, button] of markers) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void selectBuilding(id);
    });
  }

  window.setInterval(() => paintCredits(tiles), 1500);
  return api;
}

function buildMarkers(container: HTMLElement, records: BuildingRecord[]): Map<string, HTMLButtonElement> {
  const host = document.createElement("div");
  host.id = "markers";
  container.parentElement?.append(host);
  const buttons = new Map<string, HTMLButtonElement>();
  for (const record of records) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "marker";
    button.dataset.buildingId = record.id;
    button.innerHTML = `<span class="label"></span><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="3.1" fill="none" stroke="currentColor" stroke-width="1.25"/><circle cx="8" cy="8" r="1.15" fill="currentColor"/></svg><span class="stem"></span>`;
    const label = button.querySelector(".label");
    if (label) label.textContent = record.name.replace(" Street", "");
    host.append(button);
    buttons.set(record.id, button);
  }
  return buttons;
}

function frameOverview(camera: PerspectiveCamera): Rig {
  const points: Vector3[] = [];
  for (const [lon, lat] of LOWER_MANHATTAN) points.push(toLocal(lon, lat, SEA_LEVEL_Y + 2));
  points.push(toLocal(-74.0166, 40.69955, SEA_LEVEL_Y));
  points.push(toLocal(-74.01317, 40.71301, ellipsoidHeight((5 + 420) * FEET_TO_METERS)));
  const narrow = camera.aspect < 1;
  return fit(camera, points, -22 * RAD, 0.02, narrow ? 0.74 : 0.84, narrow ? 0.66 : 0.82);
}

function fit(
  camera: PerspectiveCamera,
  points: Vector3[],
  pitch: number,
  heading: number,
  limitX: number,
  limitY: number,
): Rig {
  const pivot = new Vector3();
  for (const point of points) pivot.add(point);
  pivot.multiplyScalar(1 / Math.max(1, points.length));
  let lo = 120;
  let hi = 6800;
  const saved = camera.clone();
  for (let step = 0; step < 22; step += 1) {
    const mid = (lo + hi) / 2;
    aim(camera, pivot, heading, pitch, mid);
    let ok = true;
    for (const point of points) {
      const ndc = point.clone().project(camera);
      if (ndc.z > 1 || Math.abs(ndc.x) > limitX || Math.abs(ndc.y) > limitY) ok = false;
    }
    if (ok) hi = mid;
    else lo = mid;
  }
  camera.copy(saved);
  return { pivot, heading, pitch, distance: hi * 1.08 };
}

function aim(camera: PerspectiveCamera, pivot: Vector3, heading: number, pitch: number, distance: number): void {
  const look = lookVector(heading, pitch);
  camera.position.copy(pivot).addScaledVector(look, -distance);
  camera.up.set(0, 1, 0);
  camera.lookAt(pivot);
  camera.updateMatrixWorld();
}

function buildComposer(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  quality: QualitySettings,
  outlined: Object3D[],
): EffectComposer {
  const composer = new EffectComposer(renderer, { frameBufferType: undefined });
  composer.addPass(new RenderPass(scene, camera));
  if (quality.ao) {
    try {
      const ao = new N8AOPostPass(scene, camera, renderer.domElement.width, renderer.domElement.height);
      ao.configuration.aoRadius = 1.4;
      ao.configuration.distanceFalloff = 0.8;
      ao.configuration.intensity = 0.85;
      ao.configuration.aoSamples = quality.tier === "high" ? 16 : 8;
      ao.configuration.denoiseSamples = 4;
      ao.configuration.halfRes = quality.aoHalf;
      ao.configuration.screenSpaceRadius = true;
      ao.configuration.gammaCorrection = false;
      ao.configuration.color = new Color("#1a120e");
      composer.addPass(ao);
    } catch (error) {
      console.warn("Ambient occlusion skipped.", error);
    }
  }
  const outline = new OutlineEffect(scene, camera, {
    blendFunction: BlendFunction.SCREEN,
    edgeStrength: 2.6,
    pulseSpeed: 0,
    visibleEdgeColor: 0xfff6e8,
    hiddenEdgeColor: 0x6e5a40,
    kernelSize: KernelSize.SMALL,
    blur: true,
    xRay: false,
    resolutionScale: quality.tier === "low" ? 0.6 : 1,
  });
  for (const object of outlined) outline.selection.add(object);
  const bloom = new BloomEffect({
    intensity: quality.tier === "low" ? 0.18 : 0.32,
    luminanceThreshold: 0.86,
    luminanceSmoothing: 0.18,
    radius: 0.42,
    mipmapBlur: true,
  });
  const gradeHue = new HueSaturationEffect({ saturation: 0.06 });
  const gradeTone = new BrightnessContrastEffect({ brightness: 0.01, contrast: 0.07 });
  const vignette = new VignetteEffect({ darkness: 0.38, offset: 0.42 });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
  const smaa = new SMAAEffect({ preset: quality.tier === "high" ? SMAAPreset.HIGH : SMAAPreset.MEDIUM });
  const effects = quality.bloom
    ? [outline, bloom, gradeHue, gradeTone, vignette, tone, smaa]
    : [outline, gradeHue, gradeTone, vignette, tone, smaa];
  composer.addPass(new EffectPass(camera, ...effects));
  return composer;
}

async function measureSightlines(
  camera: PerspectiveCamera,
  controls: MapControls,
  buildings: BuildingRecord[],
  width: number,
  height: number,
): Promise<SightlineReport> {
  const record = buildings.find((item) => item.id === "1-wall");
  if (!record) throw new Error("1 Wall Street is not in the scene.");
  const saved = {
    fov: camera.fov,
    rig: {
      pivot: controls.current.pivot.clone(),
      heading: controls.current.heading,
      pitch: controls.current.pitch,
      distance: controls.current.distance,
    },
  };
  const roof = ellipsoidHeight((record.groundElevationFt.value + record.heightRoofFt.value) * FEET_TO_METERS);
  const vantage = parapetVantage(record.footprintRings[0], roof);
  const cameraLlh = { longitude: vantage.longitude, latitude: vantage.latitude, heightMeters: vantage.heightMeters };
  camera.fov = verticalFovDegrees(60, camera.aspect);
  camera.updateProjectionMatrix();
  const aimed = [];
  for (const landmark of LANDMARKS) {
    const bearing = initialBearingDegrees(cameraLlh, landmark.point);
    const elevation = elevationAngleDegrees(cameraLlh, landmark.point);
    const eye = toLocal(vantage.longitude, vantage.latitude, vantage.heightMeters);
    const look = lookVector(bearing * RAD, elevation * RAD);
    const pivot = eye.clone().addScaledVector(look, 40);
    controls.snap({ pivot, heading: bearing * RAD, pitch: elevation * RAD, distance: 40 }, "focus");
    const point = toLocal(landmark.point.longitude, landmark.point.latitude, landmark.point.heightMeters);
    const ndc = point.clone().project(camera);
    const pixelX = (ndc.x * 0.5 + 0.5) * width;
    const pixelY = (-ndc.y * 0.5 + 0.5) * height;
    const seen = anglesAtPixel({
      headingDegrees: bearing,
      pitchDegrees: elevation,
      horizontalFovDegrees: 60,
      verticalFovDegrees: camera.fov,
      width,
      height,
      pixelX,
      pixelY,
    });
    aimed.push({
      id: landmark.id,
      tier: landmark.tier,
      bearingDegrees: bearing,
      elevationDegrees: elevation,
      bearingErrorDegrees: smallestAngleDegrees(bearing, seen.bearingDegrees),
      elevationErrorDegrees: seen.elevationDegrees - elevation,
    });
  }
  const dip = horizonDipDegrees(vantage.heightMeters);
  camera.fov = saved.fov;
  camera.updateProjectionMatrix();
  controls.snap(saved.rig, "focus");
  return {
    camera: {
      longitude: vantage.longitude,
      latitude: vantage.latitude,
      height: vantage.heightMeters,
      heading: 180,
      pitch: -dip,
    },
    fov: { horizontal: 60, vertical: verticalFovDegrees(60, camera.aspect) },
    aimed,
    horizonDipDegrees: dip,
    horizonResidualDegrees: 0,
  };
}


