# City View Project

Explore individual rental and condo units in a 3D downtown Manhattan map, with daylight and views factored in.

The map shows only Manhattan south of Chambers Street: City Hall, the Brooklyn Bridge anchorage, and the Battery. With `VITE_GOOGLE_MAPS_KEY`, Google Photorealistic 3D Tiles stream through 3DTilesRendererJS and are clipped to that polygon. Without a key, the same district is the open-data massing. The harbor is a rendered water surface. Five buildings have a verification record: 15 William Street, 130 William Street, 1 Wall Street, 7 Dey Street, and 220 Water Street. Floor elevations are not guessed. Unit rooms are not guessed.

The full status table is [docs/VERIFICATION.md](docs/VERIFICATION.md). How the archive was built is [docs/DATA.md](docs/DATA.md). A load-size and frame-rate check is [docs/FEASIBILITY.md](docs/FEASIBILITY.md).

## Run it on macOS

Install Node.js 22 (or any current 20+ release). The installer from [nodejs.org](https://nodejs.org/) works. With Homebrew:

```bash
brew install node
```

Clone the repository and install dependencies:

```bash
git clone https://github.com/henrysimon4260/City-View-Project.git
cd City-View-Project
npm install
```

Start the dev server:

```bash
npm run dev
```

Open [http://localhost:5173/City-View-Project/](http://localhost:5173/City-View-Project/). The `/City-View-Project/` path is the default Vite `base`, the same path GitHub Pages uses. Set `BASE_PATH=/` when building for a host that serves the site at the domain root (Vercel).

Other commands:

```bash
npm test
npm run build
npm run preview
```

The preview server also uses the `/City-View-Project/` base. After `npm run build`, open [http://127.0.0.1:4173/City-View-Project/](http://127.0.0.1:4173/City-View-Project/).

### Google Photorealistic 3D Tiles

You do not need a key to run the map. Without one, lower Manhattan is the open-data massing under the same sun, water, and post stack.

To stream Google's mesh, add this to `.env.local` and restart:

```bash
VITE_GOOGLE_MAPS_KEY=your_key_here
```

The key is read at build time from `import.meta.env`. It is not written into the repository. Tiles are not downloaded into the project. The site keeps the Google attribution the tileset reports.

```bash
BASE_PATH=/ npm run build
```

That build is what you deploy to Vercel. Leave `BASE_PATH` unset for GitHub Pages.

## How to use the map

- Drag to pan, right-drag or two fingers to orbit and tilt, scroll or pinch to zoom. Reset returns to the district. The compass faces north.
- Click one of the five benchmark buildings, or its marker.
- Hover a floor, then click it. Grey buttons have no measured elevation, so the tower is not sliced. The grey line is the city footprint. A measured floor slices at that elevation and draws archived unit rings; missing plans stay grey.
- Roof puts the camera at the city roof height, just outside the harbor-facing edge, with a 60° horizontal field of view.
- Esc steps back.

Daylight hours, view quality, and transit proximity are stubs. The sun in the sky is the real solar position for the current time. Unit photos are not wired; a floor click still notifies `onUnitActivated` in `src/gallery/hook.ts`.

## GitHub Pages

The site is meant to be published at [https://henrysimon4260.github.io/City-View-Project/](https://henrysimon4260.github.io/City-View-Project/).

The deploy workflow is `Deploy GitHub Pages`.

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs on pushes to `main`. It installs dependencies, runs the tests, builds with Vite, and deploys the `dist` folder with GitHub’s Pages actions. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions** once. After that, a push to `main` updates the site.

The workflow reads `secrets.GOOGLE_MAPS_KEY` if you add one. Leave the secret unset to publish the open-data massing.

## Refresh the city archive

The browser does not call the city APIs. To pull a new copy of the open-data cache (rate limited, listing sites excluded) and rebuild the JSON and the verification table:

```bash
npm run data
```

`npm run compile-data` rebuilds `public/data/benchmarks.json` and `docs/VERIFICATION.md` from the cache. `scripts/write-study-footprints.mjs` rebuilds `public/data/study-area-footprints.json` from `data/cache/study-area.geojson`. The browser fetches both. Dev, test, and build run the footprint writer first.
