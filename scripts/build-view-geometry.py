#!/usr/bin/env python3
"""Build near/far view geometry and the CityGML benchmark meshes.

Reads archives already downloaded for this run when they exist, and writes
only the simplified files the site ships. Does not invent floor elevations.
"""

from __future__ import annotations

import json
import math
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public" / "data"
CACHE = ROOT / "data" / "cache"
HITS = Path("/tmp/citygml-hits.json")
SKYLINE = Path("/tmp/sky/skyline.geojson")
JERSEY = Path("/tmp/sky/jersey.osm")
RETRIEVED = "2026-10-30"
RADIUS_MILES = 0.5
FT_TO_M = 0.3048

# City ground elevation (feet) from the footprint archive, used only to
# express CityGML absolute elevations as feet above that ground.
GROUNDS = {
    "1087954": ("15-william", 11.0),
    "1000815": ("1-wall", 29.0),
    "1001292": ("220-water", 10.0),
}

TO_WGS = Transformer.from_crs(2263, 4326, always_xy=True)


def miles(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 3958.7613
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def centroid(ring: list[list[float]]) -> tuple[float, float]:
    pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def rdp(points: list[list[float]], epsilon: float) -> list[list[float]]:
    if len(points) < 3:
        return points

    def dist(p, a, b) -> float:
        ax, ay = a
        bx, by = b
        px, py = p
        dx, dy = bx - ax, by - ay
        if dx == 0 and dy == 0:
            return math.hypot(px - ax, py - ay)
        t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
        t = max(0.0, min(1.0, t))
        return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

    dmax = 0.0
    index = 0
    for i in range(1, len(points) - 1):
        d = dist(points[i], points[0], points[-1])
        if d > dmax:
            dmax = d
            index = i
    if dmax > epsilon:
        left = rdp(points[: index + 1], epsilon)
        right = rdp(points[index:], epsilon)
        return left[:-1] + right
    return [points[0], points[-1]]


def simplify_ring(ring: list[list[float]]) -> list[list[float]]:
    open_ring = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else list(ring)
    if len(open_ring) < 3:
        return []
    simplified = rdp(open_ring + [open_ring[0]], 0.00008)
    body = simplified[:-1] if simplified[0] == simplified[-1] else simplified
    if len(body) < 3:
        body = open_ring[: min(8, len(open_ring))]
    if len(body) > 14:
        step = math.ceil(len(body) / 12)
        body = body[::step]
        if len(body) < 3:
            body = open_ring[:3]
    closed = [[round(p[0], 6), round(p[1], 6)] for p in body]
    if closed[0] != closed[-1]:
        closed.append(closed[0])
    return closed


def rings_of(geom: dict) -> list[list[list[float]]]:
    if not geom:
        return []
    if geom["type"] == "Polygon":
        return [geom["coordinates"][0]]
    if geom["type"] == "MultiPolygon":
        return [poly[0] for poly in geom["coordinates"] if poly and poly[0]]
    return []


def polygon_area(xs: list[float], ys: list[float]) -> float:
    area = 0.0
    for i in range(len(xs) - 1):
        area += xs[i] * ys[i + 1] - xs[i + 1] * ys[i]
    return abs(area) / 2


def write_massing() -> dict:
    if not HITS.exists():
        raise SystemExit(f"Missing {HITS}. Extract CityGML before building view geometry.")
    raw = json.loads(HITS.read_text())
    buildings: dict = {}
    tiers: dict = {}
    for bin_id, (building_id, ground) in GROUNDS.items():
        obj = raw.get(bin_id)
        if not obj:
            raise SystemExit(f"CityGML extract has no BIN {bin_id}")
        surfaces = []
        roof_tiers = []
        for part in obj["parts"]:
            nums = part["pos"]
            if len(nums) < 9:
                continue
            coords = []
            xs, ys, zs = [], [], []
            for i in range(0, len(nums) - 2, 3):
                lon, lat = TO_WGS.transform(nums[i], nums[i + 1])
                z_m = nums[i + 2] * FT_TO_M
                coords.append([round(lon, 7), round(lat, 7), round(z_m, 2)])
                xs.append(nums[i])
                ys.append(nums[i + 1])
                zs.append(nums[i + 2])
            if len(coords) < 4:
                continue
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            surfaces.append({"role": part["kind"], "ring": coords})
            if part["kind"] == "roof" and abs(max(zs) - min(zs)) < 1.5:
                area = polygon_area(xs, ys)
                if area < 80:
                    continue
                z = (min(zs) + max(zs)) / 2
                roof_tiers.append(
                    {
                        "absoluteFt": round(z, 1),
                        "aboveCityGroundFt": round(z - ground, 1),
                        "areaSqFt": round(area),
                        "status": "confirmed",
                        "sources": ["nyc-3d-citygml"],
                    }
                )
        roof_tiers.sort(key=lambda item: item["absoluteFt"])
        buildings[building_id] = {
            "bin": bin_id,
            "status": "confirmed",
            "sources": ["nyc-3d-citygml"],
            "surfaces": surfaces,
        }
        tiers[building_id] = roof_tiers
        print(building_id, "surfaces", len(surfaces), "roof tiers", len(roof_tiers))
    payload = {
        "retrieved": RETRIEVED,
        "license": "NYC Open Data terms. The CityGML is the DoITT/OTI 3D building model captured from the 2014 aerial survey. It is a public dataset. Do not treat it as a floor plate model.",
        "sourceUrl": "https://maps.nyc.gov/download/3dmodel/DA_WISE_GML.zip",
        "file": "DA_WISE_GMLs/DA12_3D_Buildings_Merged.gml",
        "vertical": "Coordinates are EPSG:2263 US survey feet converted to WGS84 longitude/latitude. Elevations are the model z values times 0.3048, the same ellipsoid approximation the footprint layer uses (no geoid).",
        "buildings": buildings,
    }
    PUBLIC.mkdir(parents=True, exist_ok=True)
    out = PUBLIC / "benchmark-massing.json"
    out.write_text(json.dumps(payload, separators=(",", ":")))
    (CACHE / "citygml-roof-tiers.json").write_text(json.dumps({"retrieved": RETRIEVED, "buildings": tiers}, indent=2) + "\n")
    print("massing bytes", out.stat().st_size)
    return tiers


def load_benchmarks() -> list[tuple[str, float, float]]:
    data = json.loads((ROOT / "public/data/benchmarks.json").read_text())
    return [(b["id"], b["centroid"][0], b["centroid"][1]) for b in data["buildings"]]


def nearest_miles(lon: float, lat: float, benches: list[tuple[str, float, float]]) -> float:
    return min(miles(lon, lat, bx, by) for _, bx, by in benches)


def fetch_liberty() -> dict:
    url = (
        "https://data.cityofnewyork.us/resource/5zhs-2jue.geojson?"
        "$select=bin,height_roof,ground_elevation,the_geom&"
        "$where=within_box(the_geom,40.693,-74.048,40.685,-74.040)&$limit=30"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "CityViewProject/0.1 (view geometry)"})
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.loads(response.read().decode())


def jersey_features() -> list[dict]:
    if not JERSEY.exists():
        print("jersey osm missing, skipping")
        return []
    root = ET.parse(JERSEY).getroot()
    nodes = {
        el.get("id"): (float(el.get("lon")), float(el.get("lat")))
        for el in root
        if el.tag == "node"
    }
    features = []
    for el in root:
        if el.tag != "way":
            continue
        tags = {t.get("k"): t.get("v") for t in el.findall("tag")}
        if "height" not in tags:
            continue
        if "building" not in tags and "building:part" not in tags:
            continue
        try:
            meters = float(str(tags["height"]).lower().replace("m", "").strip())
        except ValueError:
            continue
        if meters < 15:
            continue
        ring = []
        for nd in el.findall("nd"):
            pt = nodes.get(nd.get("ref"))
            if pt:
                ring.append([pt[0], pt[1]])
        if len(ring) < 4:
            continue
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        simple = simplify_ring(ring)
        if len(simple) < 4:
            continue
        lon, lat = centroid(simple)
        features.append(
            {
                "id": f"osm-way-{el.get('id')}",
                "bin": None,
                "source": "osm",
                "tier": "far",
                "heightRoofFt": round(meters / FT_TO_M, 1),
                "groundElevationFt": None,
                "name": tags.get("name"),
                "ring": simple,
                "centroid": [round(lon, 6), round(lat, 6)],
            }
        )
    return features


def main() -> None:
    write_massing()
    benches = load_benchmarks()
    study = json.loads((PUBLIC / "study-area-footprints.json").read_text())
    study_bins = {str(f["properties"]["bin"]) for f in study["features"]}
    if not SKYLINE.exists():
        raise SystemExit(f"Missing {SKYLINE}")
    skyline = json.loads(SKYLINE.read_text())
    far = []
    near_extra = []
    for feat in skyline["features"]:
        props = feat["properties"]
        height = props.get("height_roof")
        if height is None:
            continue
        height_f = float(height)
        rings = rings_of(feat["geometry"])
        if not rings:
            continue
        lon, lat = centroid(rings[0])
        dist = nearest_miles(lon, lat, benches)
        bin_id = str(props.get("bin"))
        if dist <= RADIUS_MILES:
            if bin_id in study_bins:
                continue
            for ring in rings:
                closed = ring if ring[0] == ring[-1] else ring + [ring[0]]
                near_extra.append(
                    {
                        "id": f"near-{bin_id}",
                        "bin": bin_id,
                        "source": "footprints",
                        "tier": "near",
                        "heightRoofFt": height_f,
                        "groundElevationFt": props.get("ground_elevation"),
                        "ring": [[round(p[0], 7), round(p[1], 7)] for p in closed],
                    }
                )
            continue
        # Far field: real coordinates and city roof height, simplified ring.
        # Brooklyn waterfront keeps 120 ft buildings. The next mile keeps 200 ft.
        # Farther than that, only 400 ft towers, so the skyline is real without every block.
        brooklyn = -74.02 <= lon <= -73.96 and 40.675 <= lat <= 40.715
        if brooklyn:
            if height_f < 120:
                continue
        elif dist <= 1.5:
            if height_f < 200:
                continue
        elif height_f < 400:
            continue
        for ring in rings:
            simple = simplify_ring(ring)
            if len(simple) < 4:
                continue
            far.append(
                {
                    "id": f"far-{bin_id}-{len(far)}",
                    "bin": bin_id,
                    "source": "footprints",
                    "tier": "far",
                    "heightRoofFt": height_f,
                    "groundElevationFt": props.get("ground_elevation"),
                    "ring": simple,
                    "miles": round(dist, 3),
                }
            )
    jersey = jersey_features()
    for item in jersey:
        item["miles"] = round(nearest_miles(item["centroid"][0], item["centroid"][1], benches), 3)
        if item["miles"] <= RADIUS_MILES:
            continue
        far.append(item)
    liberty = fetch_liberty()
    for feat in liberty.get("features", []):
        props = feat["properties"]
        for ring in rings_of(feat["geometry"]):
            simple = simplify_ring(ring)
            if len(simple) < 4:
                continue
            lon, lat = centroid(simple)
            far.append(
                {
                    "id": f"liberty-{props.get('bin')}-{len(far)}",
                    "bin": str(props.get("bin")),
                    "source": "footprints",
                    "tier": "far",
                    "heightRoofFt": props.get("height_roof"),
                    "groundElevationFt": props.get("ground_elevation"),
                    "ring": simple,
                    "miles": round(nearest_miles(lon, lat, benches), 3),
                    "place": "Liberty Island",
                }
            )
    far_payload = {
        "retrieved": RETRIEVED,
        "radiusMiles": RADIUS_MILES,
        "note": "Low-detail stand-ins outside the half-mile radius. Rings are simplified. Heights and positions are the published values, not a drawn skyline.",
        "licenses": {
            "footprints": "NYC Open Data. Building footprints dataset 5zhs-2jue. height_roof is feet above ground.",
            "osm": "OpenStreetMap contributors, ODbL 1.0. Heights are the OSM height tag in meters, converted with 0.3048. Buildings without a height tag are omitted. https://www.openstreetmap.org/copyright",
        },
        "features": far,
    }
    near_payload = {
        "retrieved": RETRIEVED,
        "radiusMiles": RADIUS_MILES,
        "note": "Full-detail rings for tall buildings inside the half-mile radius that were outside the original study extract.",
        "features": near_extra,
    }
    far_path = PUBLIC / "far-field.json"
    near_path = PUBLIC / "near-field-extra.json"
    far_path.write_text(json.dumps(far_payload, separators=(",", ":")))
    near_path.write_text(json.dumps(near_payload, separators=(",", ":")))
    summary = {
        "retrieved": RETRIEVED,
        "radiusMiles": RADIUS_MILES,
        "studyNearFeatures": len(study["features"]),
        "nearExtra": len(near_extra),
        "farFeatures": len(far),
        "farFootprints": sum(1 for f in far if f["source"] == "footprints" and f.get("place") != "Liberty Island"),
        "farJersey": sum(1 for f in far if f["source"] == "osm"),
        "farLiberty": sum(1 for f in far if f.get("place") == "Liberty Island"),
        "farBytes": far_path.stat().st_size,
        "nearExtraBytes": near_path.stat().st_size,
    }
    (CACHE / "view-tiers.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
