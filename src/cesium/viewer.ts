import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { STUDY_RECT, clampLonLat } from "../model/bounds";

const USGS_IMAGERY = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer";

let clampSuspend = 0;

export function suspendCameraClamp(): void {
  clampSuspend += 1;
}

export function resumeCameraClamp(): void {
  clampSuspend = Math.max(0, clampSuspend - 1);
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export async function flyTo(viewer: Cesium.Viewer, options: {
  destination: Cesium.Cartesian3;
  orientation?: { heading: number; pitch: number; roll: number };
  duration?: number;
}): Promise<void> {
  suspendCameraClamp();
  const duration = prefersReducedMotion() ? 0 : (options.duration ?? 1.15);
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resumeCameraClamp();
      viewer.scene.requestRender();
      resolve();
    };
    viewer.camera.flyTo({
      destination: options.destination,
      orientation: options.orientation,
      duration,
      complete: finish,
      cancel: finish,
    });
  });
}

export async function flyToSphere(
  viewer: Cesium.Viewer,
  sphere: Cesium.BoundingSphere,
  offset: Cesium.HeadingPitchRange,
): Promise<void> {
  suspendCameraClamp();
  const duration = prefersReducedMotion() ? 0 : 1.2;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resumeCameraClamp();
      viewer.scene.requestRender();
      resolve();
    };
    viewer.camera.flyToBoundingSphere(sphere, {
      offset,
      duration,
      complete: finish,
      cancel: finish,
    });
  });
}

export interface ViewerHandle {
  viewer: Cesium.Viewer;
  imageryNote: string | null;
}

export async function createViewer(container: HTMLElement): Promise<ViewerHandle> {
  const token = import.meta.env.VITE_CESIUM_ION_TOKEN;
  if (token) Cesium.Ion.defaultAccessToken = token;

  let imageryNote: string | null = null;
  let baseLayer: Cesium.ImageryLayer;
  try {
    const provider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(USGS_IMAGERY, {
      enablePickFeatures: false,
      tileDiscardPolicy: new Cesium.NeverTileDiscardPolicy(),
    });
    baseLayer = new Cesium.ImageryLayer(provider);
  } catch (error) {
    console.warn("USGS imagery failed; using Natural Earth.", error);
    imageryNote = "USGS imagery did not load. The globe is using Cesium's built-in Natural Earth texture. Building footprints are unchanged.";
    baseLayer = Cesium.ImageryLayer.fromProviderAsync(
      Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII")),
    );
  }

  const viewer = new Cesium.Viewer(container, {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    baseLayer,
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    skyBox: false,
    requestRenderMode: true,
    maximumRenderTimeChange: Number.POSITIVE_INFINITY,
    msaaSamples: 2,
    shadows: false,
  });

  viewer.clock.shouldAnimate = false;
  const { scene } = viewer;
  scene.globe.depthTestAgainstTerrain = true;
  scene.globe.baseColor = Cesium.Color.fromCssColorString("#7f9b98");
  scene.globe.enableLighting = false;
  scene.fog.enabled = true;
  scene.fog.density = 0.00008;
  scene.backgroundColor = Cesium.Color.fromCssColorString("#16303a");
  scene.screenSpaceCameraController.enableCollisionDetection = true;
  scene.screenSpaceCameraController.minimumZoomDistance = 8;
  scene.screenSpaceCameraController.maximumZoomDistance = 12000;
  scene.screenSpaceCameraController.inertiaSpin = 0.35;
  scene.screenSpaceCameraController.inertiaTranslate = 0.35;
  scene.screenSpaceCameraController.inertiaZoom = 0.4;

  const widgetHandler = viewer.cesiumWidget.screenSpaceEventHandler;
  widgetHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  viewer.entities.add({
    name: "Study area",
    rectangle: {
      coordinates: Cesium.Rectangle.fromDegrees(STUDY_RECT.west, STUDY_RECT.south, STUDY_RECT.east, STUDY_RECT.north),
      fill: false,
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString("#e0b56a"),
      outlineWidth: 2,
      height: 3,
    },
  });

  scene.preRender.addEventListener(() => {
    if (clampSuspend > 0) return;
    const carto = viewer.camera.positionCartographic;
    const [lon, lat] = clampLonLat(Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude));
    const height = Math.min(4200, Math.max(2, carto.height));
    const lonR = Cesium.Math.toRadians(lon);
    const latR = Cesium.Math.toRadians(lat);
    if (
      Math.abs(lonR - carto.longitude) < 1e-12 &&
      Math.abs(latR - carto.latitude) < 1e-12 &&
      Math.abs(height - carto.height) < 0.05
    ) {
      return;
    }
    viewer.camera.position = Cesium.Cartesian3.fromRadians(lonR, latR, height);
  });

  await setHomeView(viewer);
  return { viewer, imageryNote };
}

export async function setHomeView(viewer: Cesium.Viewer): Promise<void> {
  await flyTo(viewer, {
    destination: Cesium.Cartesian3.fromDegrees(-74.0082, 40.7036, 1550),
    orientation: {
      heading: Cesium.Math.toRadians(18),
      pitch: Cesium.Math.toRadians(-42),
      roll: 0,
    },
    duration: 0,
  });
}

export function readCamera(viewer: Cesium.Viewer): {
  longitude: number;
  latitude: number;
  height: number;
  heading: number;
  pitch: number;
} {
  const carto = viewer.camera.positionCartographic;
  return {
    longitude: Cesium.Math.toDegrees(carto.longitude),
    latitude: Cesium.Math.toDegrees(carto.latitude),
    height: carto.height,
    heading: Cesium.Math.toDegrees(viewer.camera.heading),
    pitch: Cesium.Math.toDegrees(viewer.camera.pitch),
  };
}
