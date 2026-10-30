/**
 * Refresh data/cache from public NYC sources.
 * Rate limit: at least 1.1 seconds between requests.
 * Does not call listing sites. Does not overwrite data/cache/published-claims.json.
 */
const UA = "CityViewProject/0.1 (public-data research; +https://github.com/henrysimon4260/City-View-Project)";
const CACHE = new URL("../data/cache/", import.meta.url);

const BINS = ["1087954", "1090562", "1000815", "1090952", "1001292"];
const BBLS = ["1000257501", "1000777501", "1000237501", "1000637501", "1000957501"];

let lastRequest = 0;

async function getJson(url) {
  const wait = Math.max(0, 1100 - (Date.now() - lastRequest));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequest = Date.now();
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${url}`);
  }
  return response.json();
}

async function write(name, value) {
  const file = new URL(name, CACHE);
  await import("node:fs/promises").then((fs) => fs.writeFile(file, JSON.stringify(value)));
  console.log("wrote", name);
}

const inList = (values) => values.map((value) => `'${value}'`).join(",");

const pluto = await getJson(
  "https://data.cityofnewyork.us/resource/64uk-42ks.json?" +
    new URLSearchParams({
      $where: `bbl in (${BBLS.map((bbl) => `'${bbl}.00000000'`).join(",")})`,
      $limit: "20",
    }),
);
await write("pluto.json", pluto);

const footprints = await getJson(
  "https://data.cityofnewyork.us/resource/5zhs-2jue.json?" +
    new URLSearchParams({
      $where: `bin in (${inList(BINS)})`,
      $limit: "20",
    }),
);
await write("footprints.json", footprints);

const dobNow = await getJson(
  "https://data.cityofnewyork.us/resource/pkdm-hqz6.json?" +
    new URLSearchParams({
      $where: `bin in (${inList(BINS)})`,
      $limit: "200",
    }),
);
await write("dobnow-co.json", dobNow);

const legacy = await getJson(
  "https://data.cityofnewyork.us/resource/bs8b-p36w.json?" +
    new URLSearchParams({
      $where: `bin in (${inList(BINS)})`,
      $limit: "100",
    }),
);
await write("legacy-co.json", legacy);

const geocodes = {
  geo_15w: "15 William Street, Manhattan, NY",
  geo_130w: "130 William Street, Manhattan, NY",
  geo_1wall: "1 Wall Street, Manhattan, NY",
  geo_7dey: "7 Dey Street, Manhattan, NY",
  geo_220water: "220 Water Street, Manhattan, NY",
  geo_117beek: "117 Beekman Street, Manhattan, NY",
};
const geosearch = {};
for (const [key, text] of Object.entries(geocodes)) {
  geosearch[key] = await getJson(
    "https://geosearch.planninglabs.nyc/v2/search?" + new URLSearchParams({ text, size: "3" }),
  );
}
await write("geosearch.json", geosearch);

const study = await getJson(
  "https://data.cityofnewyork.us/resource/5zhs-2jue.geojson?" +
    new URLSearchParams({
      $select: "bin,height_roof,ground_elevation,construction_year,feature_code,mappluto_bbl,the_geom",
      $where: "within_box(the_geom, 40.7182, -74.0230, 40.6992, -73.9945)",
      $limit: "5000",
    }),
);
await write("study-area.geojson", study);

console.log("Cache refreshed. Run npm run compile-data next. published-claims.json was left as curated.");
