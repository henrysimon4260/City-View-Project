# City View Project

Explore individual rental and condo units in a 3D downtown Manhattan map, with daylight and views factored in.

The map is limited to Manhattan south of Chambers Street for full-detail blocks, from the Hudson to the Brooklyn Bridge and down to the Battery, including City Hall. Buildings farther out, including the Brooklyn waterfront, Jersey City towers that OpenStreetMap gives a height for, and Liberty Island, are simplified stand-ins at their published heights. Five buildings have a verification record: 15 William Street, 130 William Street, 1 Wall Street, 7 Dey Street, and 220 Water Street. 15 William, 1 Wall Street, and 220 Water use the 2014 NYC 3D model. The other two are the city footprint at the city roof height. Floor elevations are not guessed. Unit rooms are not guessed.

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

Open [http://localhost:5173/City-View-Project/](http://localhost:5173/City-View-Project/). The `/City-View-Project/` path is the Vite `base`, the same path GitHub Pages uses.

Other commands:

```bash
npm test
npm run build
npm run preview
```

The preview server also uses the `/City-View-Project/` base. After `npm run build`, open [http://127.0.0.1:4173/City-View-Project/](http://127.0.0.1:4173/City-View-Project/).

### Cesium ion token

You do not need a Cesium ion token or a Google key. Without them, the globe uses USGS imagery from The National Map, a smooth ellipsoid instead of world terrain, and the NYC footprints for buildings.

Photorealistic 3D Tiles are optional. To stream them from Google's Map Tiles API, add this to `.env.local` and restart:

```bash
VITE_GOOGLE_MAPS_KEY=your_key_here
```

The key is not written into the repository. Tiles are not downloaded into the project. The site shows the Google attribution Cesium reports for that tileset.

To set a token anyway, create `.env.local` in the project root:

```bash
VITE_CESIUM_ION_TOKEN=your_token_here
```

Restart `npm run dev`. The token is optional and is not required for the footprint map. Do not commit `.env.local`.

## How to use the map

- Hover a building to highlight it. On a phone, tap it.
- Click one of the five benchmark buildings.
- Click a floor in the list. Grey buttons have no measured elevation, so the model is not sliced and there is no window camera.
- “Look from the confirmed roof” puts the camera at the city roof height, just outside the harbor-facing edge, with a 60° horizontal field of view. The sky is the globe, not a painted backdrop.
- If a later archive measures a window row, “Look out from this floor” uses that elevation.
- Esc steps back. Reset view returns to the district.

Daylight hours, view quality, and transit proximity are stubs. The sun button only previews Cesium’s light. Unit photos are not wired; a click still notifies `onUnitActivated` in `src/gallery/hook.ts`.

## GitHub Pages

The site is meant to be published at [https://henrysimon4260.github.io/City-View-Project/](https://henrysimon4260.github.io/City-View-Project/).

The deploy workflow is `Deploy GitHub Pages`.

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) runs on pushes to `main`. It installs dependencies, runs the tests, builds with Vite, and deploys the `dist` folder with GitHub’s Pages actions. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions** once. After that, a push to `main` updates the site.

The workflow reads `secrets.CESIUM_ION_TOKEN` if you add one. Leave the secret unset to publish the USGS-and-footprints map.

## Refresh the city archive

The browser does not call the city APIs. To pull a new copy of the open-data cache (rate limited, listing sites excluded) and rebuild the JSON and the verification table:

```bash
npm run data
```

`npm run compile-data` rebuilds `public/data/benchmarks.json` and `docs/VERIFICATION.md` from the cache. `scripts/write-study-footprints.mjs` rebuilds `public/data/study-area-footprints.json` from `data/cache/study-area.geojson`. The browser fetches both. Dev, test, and build run the footprint writer first.
