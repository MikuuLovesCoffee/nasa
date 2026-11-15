"""Land-cover mix per 1-degree cell (ESA WorldCover 10 m, 2021, v200).

Source: ESA WorldCover 2021 v200 (CC BY 4.0), via Microsoft Planetary Computer STAC
(collection `esa-worldcover`, anonymous access, assets signed with `planetary-computer`).
The 3x3-degree COG tiles have overviews; we read the 1/64 overview (~600 m pixels), which
is plenty for 1-degree fractions, so each tile costs about one second and a few hundred KB.

Output: data/agg/landcover_1deg.parquet  (cell1, lc_tree, lc_shrub, lc_grass, lc_crop,
  lc_built, lc_bare, lc_wet, lc_water, lc_snow) as shares of the cell (0..1).
Static map (2021): used as-is for every year (stated in the docs as a limitation).
"""
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import planetary_computer as pc
import pystac_client
import rasterio

ROOT = Path(__file__).resolve().parent.parent
AGG = ROOT / "data" / "agg"
OUT = AGG / "landcover_1deg.parquet"
CLASSES = {"lc_tree": [10, 95], "lc_shrub": [20], "lc_grass": [30], "lc_crop": [40], "lc_built": [50],
           "lc_bare": [60, 100], "lc_wet": [90], "lc_water": [80], "lc_snow": [70]}


def fire_cells():
    h = pd.read_parquet(AGG / "harmonized_05.parquet", columns=["cell", "h"])
    h["cell1"] = (h.cell // 720 // 2) * 360 + (h.cell % 720) // 2
    g = h.groupby("cell1").h.max()
    return set(int(c) for c in g.index[g >= 15])


def main():
    want = fire_cells()
    cat = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1", modifier=pc.sign_inplace)
    # WorldCover tiles are named by their SW corner on a 3-degree grid
    tiles = set()
    for c in want:
        lat0 = 89 - c // 360
        lon0 = -180 + c % 360
        tiles.add((int(np.floor(lat0 / 3) * 3), int(np.floor(lon0 / 3) * 3)))
    print(f"{len(want):,} cells in {len(tiles)} WorldCover tiles", flush=True)
    acc = {}
    t0 = time.time()
    for k, (la, lo) in enumerate(sorted(tiles)):
        items = []
        for attempt in range(5):
            try:
                items = [it for it in cat.search(collections=["esa-worldcover"], bbox=[lo + 0.5, la + 0.5, lo + 2.5, la + 2.5]).items()
                         if "2021_v200" in it.id]
                break
            except Exception as e:  # noqa: BLE001
                time.sleep(5 * 2 ** attempt)
        for it in items:
            try:
                with rasterio.open(it.assets["map"].href) as d:
                    f = 64
                    a = d.read(1, out_shape=(d.height // f, d.width // f))
                    west, north = d.bounds.left, d.bounds.top
                    res = (d.bounds.right - d.bounds.left) / a.shape[1]
            except Exception as e:  # noqa: BLE001
                print("  read failed", it.id, e, flush=True)
                continue
            rr, cc = np.indices(a.shape)
            lat = north - (rr + 0.5) * res
            lon = west + (cc + 0.5) * res
            cell = (np.floor(90 - lat).astype(np.int64) * 360 + np.floor(lon + 180).astype(np.int64)).ravel()
            v = a.ravel()
            for c in np.unique(cell):
                if int(c) not in want:
                    continue
                vv = v[cell == c]
                vv = vv[vv > 0]
                if not len(vv):
                    continue
                s = acc.setdefault(int(c), np.zeros(256, np.int64))
                s += np.bincount(vv, minlength=256)[:256]
        if k % 25 == 0:
            print(f"[{k + 1}/{len(tiles)}] {len(acc):,} cells so far, {(time.time() - t0) / 60:.0f} min", flush=True)
    rows = []
    for c, s in acc.items():
        n = s.sum()
        rows.append({"cell1": c, **{k: float(s[v].sum() / n) for k, v in CLASSES.items()}})
    df = pd.DataFrame(rows).sort_values("cell1")
    df.to_parquet(OUT, index=False)
    print(f"landcover_1deg.parquet: {len(df):,} cells; mean tree {df.lc_tree.mean():.2f}, crop {df.lc_crop.mean():.2f}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
