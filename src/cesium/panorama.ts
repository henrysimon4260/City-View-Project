import * as Cesium from "cesium";

/**
 * Illustrative harbor skybox. It is not a photograph.
 * Cesium draws the skybox behind the building geometry, so the footprints
 * stay in front of it.
 */
export function createHarborSkyBox(): Cesium.SkyBox {
  const base = import.meta.env.BASE_URL;
  const sky = new Cesium.SkyBox({
    show: false,
    sources: {
      positiveX: `${base}panorama/east.png`,
      negativeX: `${base}panorama/west.png`,
      positiveY: `${base}panorama/north.png`,
      negativeY: `${base}panorama/south.png`,
      positiveZ: `${base}panorama/sky.png`,
      negativeZ: `${base}panorama/sky.png`,
    },
  });
  return sky;
}

export function setViewModeSky(viewer: Cesium.Viewer, sky: Cesium.SkyBox, active: boolean): void {
  const { scene } = viewer;
  scene.skyBox = sky;
  sky.show = active;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = !active;
  if (scene.sun) scene.sun.show = !active;
  if (scene.moon) scene.moon.show = !active;
  scene.backgroundColor = Cesium.Color.fromCssColorString(active ? "#c5d7e6" : "#16303a");
  scene.fog.density = active ? 0.00005 : 0.00018;
  scene.requestRender();
}
