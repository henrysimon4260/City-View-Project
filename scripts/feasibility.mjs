/**
 * Load the production build in system Chrome and exercise the benchmark flow.
 * Writes docs/feasibility-run.json and screenshots under /tmp/city-view-shots.
 */
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.CITY_VIEW_URL ?? "http://127.0.0.1:4173/City-View-Project/?debug=1";
const SHOTS = "/tmp/city-view-shots";
mkdirSync(SHOTS, { recursive: true });

function dirSize(root) {
  let bytes = 0;
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else {
        bytes += stat.size;
        files.push({ path, bytes: stat.size });
      }
    }
  };
  walk(root);
  files.sort((a, b) => b.bytes - a.bytes);
  return { bytes, largest: files.slice(0, 12) };
}

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--window-size=1440,900",
  ],
});

const result = {
  url: BASE,
  chrome: await browser.version(),
  startedAt: new Date().toISOString(),
  dist: dirSize("dist"),
  console: [],
  pageErrors: [],
  failedRequests: [],
  steps: [],
};

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
page.on("console", (message) => {
  if (result.console.length < 40) result.console.push({ type: message.type(), text: message.text().slice(0, 300) });
});
page.on("pageerror", (error) => result.pageErrors.push(String(error).slice(0, 500)));
page.on("requestfailed", (request) => {
  if (result.failedRequests.length < 30) {
    result.failedRequests.push({ url: request.url().slice(0, 200), error: request.failure()?.errorText ?? "" });
  }
});

const t0 = Date.now();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__cityView && !document.querySelector("#boot"), { timeout: 45000 });
result.loadMs = Date.now() - t0;
result.webgl = await page.evaluate(() => {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  if (!gl) return null;
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    version: gl.getParameter(gl.VERSION),
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  };
});
result.resources = await page.evaluate(() =>
  performance.getEntriesByType("resource").map((entry) => ({
    name: entry.name.replace(location.origin, ""),
    type: entry.initiatorType,
    transfer: entry.transferSize,
    encoded: entry.encodedBodySize,
    duration: Math.round(entry.duration),
  })),
);

async function shot(name) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

result.steps.push({
  name: "overview-fps",
  fps: await page.evaluate(() => window.__cityView.sampleFps(1500)),
});
await shot("01-overview");

const buildings = ["15-william", "130-william", "1-wall", "7-dey", "220-water"];
for (const id of buildings) {
  await page.evaluate((buildingId) => window.__cityView.selectBuilding(buildingId), id);
  const afterSelect = await page.evaluate(() => window.__cityView.getModel().selection);
  if (afterSelect.kind !== "building" || afterSelect.buildingId !== id) {
    throw new Error(`Select failed for ${id}: ${JSON.stringify(afterSelect)}`);
  }
  const floor = id === "220-water" ? 4 : 12;
  await page.click(`#panel [data-floor="${floor}"]`);
  await page.waitForFunction(
    (expected) => {
      const selection = window.__cityView.getModel().selection;
      return selection.kind === "floor" && selection.floor === expected;
    },
    {},
    floor,
  );
  const panelText = await page.$eval("#panel", (el) => el.innerText);
  if (!/unverified/i.test(panelText)) {
    throw new Error(`Floor panel for ${id} did not describe the unverified floor`);
  }
  const flyCount = await page.$$eval("#panel [data-action='fly']", (nodes) => nodes.length);
  if (flyCount !== 0) {
    throw new Error(`Unverified floor ${id} still offered a fly-in`);
  }
  if (id === "15-william") {
    await page.click("#panel [data-action='roof']");
    await page.waitForFunction(() => window.__cityView.getModel().selection.kind === "roof");
    const camera = await page.evaluate(() => window.__cityView.readCamera());
    if (camera.height < 50 || camera.height > 800) {
      throw new Error(`Roof camera height out of range for ${id}: ${camera.height}`);
    }
    await shot("02-15-william-roof");
    result.steps.push({ name: `${id}-roof`, camera, fps: await page.evaluate(() => window.__cityView.sampleFps(800)) });
  }
  result.steps.push({ name: id, floor, fps: await page.evaluate(() => window.__cityView.sampleFps(400)) });
  await page.evaluate(() => window.__cityView.back());
}

await page.evaluate(() => window.__cityView.setTierVisible("far", false));
result.steps.push({ name: "near-field-fps", fps: await page.evaluate(() => window.__cityView.sampleFps(1200)) });
await page.evaluate(() => window.__cityView.setTierVisible("far", true));
result.steps.push({ name: "near-and-far-fps", fps: await page.evaluate(() => window.__cityView.sampleFps(1200)) });
result.sightlines = await page.evaluate(() => window.__cityView.measureSightlines());
const worst = result.sightlines.aimed.reduce(
  (max, item) => Math.max(max, Math.abs(item.bearingErrorDegrees), Math.abs(item.elevationErrorDegrees)),
  0,
);
if (worst > 1 || Math.abs(result.sightlines.horizonResidualDegrees) > 0.25) {
  throw new Error(`Sightline error too large: ${JSON.stringify(result.sightlines)}`);
}
await shot("03-sightline");

await page.evaluate(() => window.__cityView.home());
await page.evaluate(() => window.__cityView.toggleSun());
result.steps.push({ name: "sun-preview-fps", fps: await page.evaluate(() => window.__cityView.sampleFps(800)) });
await page.evaluate(() => window.__cityView.toggleShadows());
result.steps.push({ name: "shadows-fps", fps: await page.evaluate(() => window.__cityView.sampleFps(800)) });
await shot("03-sun");

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await page.waitForFunction(() => window.__cityView && !document.querySelector("#boot"), { timeout: 45000 });
await page.evaluate(() => window.__cityView.selectBuilding("7-dey"));
await page.click("#panel [data-floor='8']");
await shot("04-mobile-7-dey");
const layout = await page.evaluate(() => {
  const panel = document.querySelector("#panel").getBoundingClientRect();
  const canvas = document.querySelector("#cesium canvas")?.getBoundingClientRect();
  return {
    panel: { top: panel.top, height: panel.height, width: panel.width },
    canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
    mapVisibleAbovePanel: canvas ? panel.top > 120 : false,
  };
});
result.mobile = layout;
if (!layout.mapVisibleAbovePanel) throw new Error(`Mobile layout covers the map: ${JSON.stringify(layout)}`);

result.transferBytes = result.resources.reduce((sum, item) => sum + (item.transfer || item.encoded || 0), 0);
writeFileSync("docs/feasibility-run.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  loadMs: result.loadMs,
  webgl: result.webgl,
  pageErrors: result.pageErrors,
  failed: result.failedRequests.slice(0, 8),
  steps: result.steps.map((step) => ({ name: step.name, fps: Math.round(step.fps ?? 0), floor: step.floor })),
  mobile: result.mobile,
  distMb: Math.round(result.dist.bytes / 1e6),
  largest: result.dist.largest.slice(0, 6),
}, null, 2));
await browser.close();
