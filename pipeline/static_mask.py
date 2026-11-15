"""Step 5b - non-fire heat mask for the live feed (site/public/data/static_mask*.bin).

The FIRMS near-real-time CSVs have no `type` column, so factories, gas flares and
volcanoes show up as "fires". We mark every ~1 km cell (0.01 deg) that is known
non-fire heat, from four sources:

  1. FIRMS archive 2000-2025 (cached in data/agg/mask_archive.npz, ~15 min to build):
     * labeled non-vegetation >= 3 times (type 1 volcano, 2 static land source, 3 offshore)
     * persistently hot: vegetation-labeled but seen on >= 10 days a year in >= 3 years
  2. Gas flares: VIIRS Nightfire upstream flare sites 2012-2025 (EOG / Colorado School of
     Mines, MYC25Q4, CC BY-NC 4.0), data/ext/vnf/annual_flare_site_records.csv
  3. Volcanoes: Smithsonian GVP Holocene volcanoes that erupted since 2000,
     data/ext/gvp/holocene.json. Radius 8 km if erupting in the current/last year, else 4 km.
  4. OpenStreetMap: flare stacks, refineries, steel/cement/smelter works, fossil and
     solar-thermal power plants, data/ext/osm/osm.json (radius ~1.5 km around the site).

Output:
  static_mask.bin       sorted u32 cell ids, cell = row * 36000 + col
  static_mask_kind.bin  u8 per id: 1 volcano, 2 gas flare, 3 industrial
The site also checks the 8 neighbours of each live detection (geolocation jitter).
"""
import csv
import json
import math
import sys
from datetime import date
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
PARQ = (ROOT / "data" / "parquet").as_posix()
EXT = ROOT / "data" / "ext"
CACHE = ROOT / "data" / "agg" / "mask_archive.npz"
OUT = ROOT / "site" / "public" / "data"

GRID, COLS = 0.01, 36000
MIN_TYPED = 3
DAYS_PER_YEAR, MIN_YEARS = 10, 3
VOLCANO, FLARE, INDUSTRIAL = 1, 2, 3  # lower number wins when sources overlap


def cell_of(lat, lon):
    lat, lon = np.asarray(lat, float), np.asarray(lon, float)
    r = np.floor((90 - lat) / GRID).astype(np.int64)
    c = np.floor((lon + 180) / GRID).astype(np.int64) % COLS
    return r * COLS + c


def disk(lat, lon, km):
    """All 0.01 deg cells within `km` of a point."""
    dlat = km / 111.2
    dlon = km / (111.2 * max(math.cos(math.radians(lat)), 0.05))
    lats = np.arange(lat - dlat, lat + dlat + GRID, GRID)
    lons = np.arange(lon - dlon, lon + dlon + GRID, GRID)
    la, lo = np.meshgrid(lats, lons, indexing="ij")
    keep = ((la - lat) / dlat) ** 2 + ((lo - lon) / dlon) ** 2 <= 1
    return cell_of(la[keep], lo[keep])


def archive():
    if CACHE.exists() and "--rebuild" not in sys.argv:
        z = np.load(CACHE)
        return z["volcano"], z["industrial"]
    import duckdb
    print("scanning the FIRMS archive (slow, cached afterwards)...", flush=True)
    cell = f"CAST(floor((90 - lat) / {GRID}) AS BIGINT) * {COLS} + CAST(floor((lon + 180) / {GRID}) AS BIGINT)"
    con = duckdb.connect()
    typed = con.execute(f"""
        SELECT c, arg_max(type, n) t FROM (
          SELECT {cell} c, type, count(*) n FROM '{PARQ}/*.parquet' WHERE type IN (1, 2, 3) GROUP BY 1, 2)
        GROUP BY 1 HAVING sum(n) >= {MIN_TYPED}""").fetchnumpy()
    persistent = con.execute(f"""
        SELECT c FROM (
          SELECT c, year(date) y FROM (
            SELECT DISTINCT {cell} c, date FROM '{PARQ}/*.parquet' WHERE type = 0 AND conf <> 'l')
          GROUP BY 1, 2 HAVING count(*) >= {DAYS_PER_YEAR})
        GROUP BY 1 HAVING count(*) >= {MIN_YEARS}""").fetchnumpy()["c"]
    volcano = typed["c"][typed["t"] == 1]
    industrial = np.union1d(typed["c"][typed["t"] != 1], persistent)
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(CACHE, volcano=volcano, industrial=industrial)
    return volcano, industrial


def flares():
    f = EXT / "vnf" / "annual_flare_site_records.csv"
    if not f.exists():
        print("  (no VNF flare file, skipping)"); return np.empty(0, np.int64)
    sites = {}
    with open(f, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if int(r["n_det"] or 0) > 0:
                sites[r["flare_id"]] = (float(r["lat"]), float(r["lon"]))
    lat, lon = np.array(list(sites.values())).T
    print(f"  gas flares: {len(sites):,} VNF sites")
    return np.unique(cell_of(lat, lon))


def volcanoes():
    f = EXT / "gvp" / "holocene.json"
    if not f.exists():
        print("  (no GVP volcano file, skipping)"); return np.empty(0, np.int64)
    this_year = date.today().year
    out, n = [], 0
    for ft in json.loads(f.read_text(encoding="utf-8"))["features"]:
        p = ft["properties"]
        y = p.get("Last_Eruption_Year")
        if y is None or y < 2000:
            continue
        n += 1
        out.append(disk(p["Latitude"], p["Longitude"], 8 if y >= this_year - 1 else 4))
    print(f"  volcanoes: {n} erupted since 2000")
    return np.unique(np.concatenate(out))


def osm():
    f = EXT / "osm" / "osm.json"
    if not f.exists():
        print("  (no OSM file, skipping)"); return np.empty(0, np.int64), np.empty(0, np.int64)
    try:
        elements = json.loads(f.read_text(encoding="utf-8"))["elements"]
    except (ValueError, KeyError):
        print("  (OSM file is not a finished Overpass answer, skipping)")
        return np.empty(0, np.int64), np.empty(0, np.int64)
    fl, ind = [], []
    for e in elements:
        p = e.get("center") or e
        if "lat" not in p:
            continue
        t = e.get("tags", {})
        if t.get("man_made") == "flare":
            fl.append(cell_of(p["lat"], p["lon"]).reshape(1))
        else:
            ind.append(disk(p["lat"], p["lon"], 1.5))
    print(f"  OSM: {len(fl):,} flare stacks, {len(ind):,} industrial sites")
    cat = lambda a: np.unique(np.concatenate(a)) if a else np.empty(0, np.int64)
    return cat(fl), cat(ind)


def main():
    a_volc, a_ind = archive()
    print(f"  archive: {len(a_volc):,} volcano cells, {len(a_ind):,} industrial cells")
    v = np.union1d(a_volc, volcanoes())
    o_fl, o_ind = osm()
    fl = np.union1d(flares(), o_fl)
    ind = np.union1d(a_ind, o_ind)
    kind = {}
    for k, cells in ((INDUSTRIAL, ind), (FLARE, fl), (VOLCANO, v)):  # later wins
        kind.update(dict.fromkeys(cells.tolist(), k))
    ids = np.array(sorted(kind), dtype="<u4")
    kinds = np.array([kind[i] for i in ids.tolist()], dtype="u1")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "static_mask.bin").write_bytes(ids.tobytes())
    (OUT / "static_mask_kind.bin").write_bytes(kinds.tobytes())
    print(f"static mask: {len(ids):,} cells ({ids.nbytes / 1024:.0f} KB) - "
          f"volcano {np.sum(kinds == 1):,}, gas flare {np.sum(kinds == 2):,}, industrial {np.sum(kinds == 3):,}")


if __name__ == "__main__":
    main()
