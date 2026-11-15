"""Yearly forest loss per 1-degree cell (Hansen Global Forest Change v1.12).

Forest DENSITY (tree-cover share) comes from ESA WorldCover in pipeline/landcover.py. The Hansen
`treecover2000` tiles turned out to be up to ~435 MB each (7+ hours for the fire-prone tiles on
this connection), so only the much smaller `lossyear` layer is used here.

Source: Hansen/UMD/Google/USGS/NASA, Global Forest Change 2000-2024 (CC BY 4.0),
  https://storage.googleapis.com/earthenginepartners-hansen/GFC-2024-v1.12/
  Hansen_GFC-2024-v1.12_{treecover2000,lossyear}_{LAT}_{LON}.tif  (10x10 deg tiles, 1 arc-second ~30 m)

Only tiles that contain a fire-prone 1-degree cell are fetched. Each tile is downloaded
whole (faster than ranged reads: the files are 1-row strips), sampled every STRIDE-th
row and column, aggregated, and deleted. Progress is kept in data/ext/hansen/done.json,
so the script can be stopped and resumed.

Output: data/agg/forest_1deg.parquet with one row per 1-degree cell:
  loss_YYYY     share of the cell's area that lost tree cover in year YYYY (2001-2024)
Leakage note: train.py uses loss of year Y-1 (and cumulative loss up to Y-1) for year Y.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
from rasterio.windows import Window

ROOT = Path(__file__).resolve().parent.parent
AGG = ROOT / "data" / "agg"
EXT = ROOT / "data" / "ext" / "hansen"
BASE = "https://storage.googleapis.com/earthenginepartners-hansen/GFC-2024-v1.12/Hansen_GFC-2024-v1.12_{lay}_{tile}.tif"
STRIDE = 10            # sample every 10th pixel (~300 m): 360,000 samples per 1-degree cell
ROWS_PER_READ = 2000   # rows per window (keeps RAM under ~100 MB per layer)
YEARS = list(range(2001, 2025))
UA = "ember-atlas/1.0 (fire map research)"
REMOTE = "--remote" in sys.argv


def fire_cells():
    h = pd.read_parquet(AGG / "harmonized_05.parquet", columns=["cell", "h"])
    h["cell1"] = (h.cell // 720 // 2) * 360 + (h.cell % 720) // 2
    g = h.groupby(["cell1"]).h.max()  # any 0.5-deg-month >= 30 is a good proxy; train.py filters exactly
    return np.array(sorted(g.index[g >= 15]))


def tile_name(top, left):
    ns = f"{abs(top):02d}{'N' if top >= 0 else 'S'}"
    ew = f"{abs(left):03d}{'E' if left >= 0 else 'W'}"
    return f"{ns}_{ew}"


def tiles_for(cells):
    t = set()
    for c in cells:
        lat_top = 90 - c // 360          # cell spans [lat_top-1, lat_top]
        lon_left = -180 + c % 360
        top = int(np.ceil(lat_top / 10) * 10) if lat_top % 10 else int(lat_top)
        left = int(np.floor(lon_left / 10) * 10)
        if -50 < top <= 80:
            t.add((top, left))
    return sorted(t, key=lambda x: (-x[0], x[1]))


def download(url, dst):
    for attempt in range(6):
        r = subprocess.run(["curl", "-sfL", "-A", UA, "-m", "1800", "-o", str(dst), url])
        if r.returncode == 0 and dst.exists() and dst.stat().st_size > 1000:
            return True
        if r.returncode == 22:   # HTTP error (404 = no tile there, e.g. open ocean)
            dst.unlink(missing_ok=True)
            return False
        time.sleep(15 * 2 ** attempt)
    raise RuntimeError(f"download failed: {url}")


def aggregate(top, left, ly_path, want):
    """Per 1-degree cell inside this tile: share of the cell's area that lost tree cover, per year."""
    out = {}
    px = 40000 // 10                     # 4000 pixels per degree
    with rasterio.open(ly_path) as ly:
        assert ly.width == 40000
        for r0 in range(0, 40000, ROWS_PER_READ):
            win = Window(0, r0, 40000, ROWS_PER_READ)
            b = ly.read(1, window=win)[::STRIDE, ::STRIDE]
            # which degree rows does this window cover?
            for dr in range(r0 // px, (r0 + ROWS_PER_READ - 1) // px + 1):
                lo = max(dr * px, r0) - r0
                hi = min((dr + 1) * px, r0 + ROWS_PER_READ) - r0
                bb = b[lo // STRIDE: hi // STRIDE]
                lat_top = top - dr
                for dc in range(10):
                    cell = (90 - lat_top) * 360 + (left + dc + 180)
                    if cell not in want:
                        continue
                    sb = bb[:, dc * px // STRIDE:(dc + 1) * px // STRIDE]
                    acc = out.setdefault(cell, {"n": 0, "loss": np.zeros(25, np.int64)})
                    acc["n"] += sb.size
                    acc["loss"] += np.bincount(sb.ravel(), minlength=25)[:25]
    rows = []
    for cell, acc in out.items():
        n = max(acc["n"], 1)
        row = {"cell1": cell}
        for y in YEARS:
            row[f"loss_{y}"] = acc["loss"][y - 2000] / n
        rows.append(row)
    return rows


REMOTE_STRIDE = 40   # remote mode: every 40th row and column (~1.2 km): 10,000 samples per 1-degree cell
GDAL_ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_CHUNK_SIZE="4096",
                VSI_CACHE="FALSE", CPL_VSIL_CURL_CACHE_SIZE="0", GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="3")


def aggregate_remote(top, left, name, want, workers=int(__import__("os").environ.get("FOREST_WORKERS", 12))):
    """Same result as aggregate(), but reads only every REMOTE_STRIDE-th row over HTTP (the tiles are
    1-row LZW strips, so each row is a small range request). Used when full downloads are too slow."""
    import threading
    from concurrent.futures import ThreadPoolExecutor
    url = "/vsicurl/" + BASE.format(lay="lossyear", tile=name)
    st = REMOTE_STRIDE
    px = 4000
    local = threading.local()

    def read(r):
        if not hasattr(local, "env"):
            local.env = rasterio.Env(**GDAL_ENV); local.env.__enter__()
        for attempt in range(6):
            try:
                if getattr(local, "ds", None) is None:
                    local.ds = rasterio.open(url)
                return r, local.ds.read(1, window=Window(0, r, 40000, 1))[0, st // 2::st]
            except Exception:
                local.ds = None          # reopen after a dropped connection
                time.sleep(5 * (attempt + 1))
        raise RuntimeError(f"row {r} of {name} failed")

    out = {}
    with ThreadPoolExecutor(workers) as ex:
        for r, row in ex.map(read, range(st // 2, 40000, st)):
            lat_top = top - r // px
            for dc in range(10):
                cell = (90 - lat_top) * 360 + (left + dc + 180)
                if cell not in want:
                    continue
                sb = row[dc * px // st:(dc + 1) * px // st]
                acc = out.setdefault(cell, {"n": 0, "loss": np.zeros(25, np.int64)})
                acc["n"] += sb.size
                acc["loss"] += np.bincount(sb, minlength=25)[:25]
    rows = []
    for cell, acc in out.items():
        n = max(acc["n"], 1)
        row = {"cell1": cell}
        for y in YEARS:
            row[f"loss_{y}"] = acc["loss"][y - 2000] / n
        rows.append(row)
    return rows


def tile_exists(name):
    r = subprocess.run(["curl", "-sfI", "-A", UA, "-m", "60", BASE.format(lay="lossyear", tile=name)], capture_output=True)
    return r.returncode == 0


def main():
    EXT.mkdir(parents=True, exist_ok=True)
    import os
    sfx = os.environ.get("FOREST_SUFFIX", "")          # a second process keeps its own progress files
    done_f = EXT / f"done{sfx}.json"
    done = json.loads(done_f.read_text()) if done_f.exists() else {}
    part = EXT / f"rows{sfx}.jsonl"

    def done_anywhere():
        d = {}
        for f in EXT.glob("done*.json"):
            try:
                d.update(json.loads(f.read_text()))
            except Exception:
                pass
        return d
    cells = fire_cells()
    want = set(int(c) for c in cells)
    tiles = tiles_for(cells)
    print(f"{len(cells):,} fire-prone cells in {len(tiles)} Hansen tiles; {len(done)} already done", flush=True)
    t0, nbytes = time.time(), 0
    order = list(enumerate(tiles))
    if os.environ.get("FOREST_REVERSE"):
        order = order[::-1]
    for i, (top, left) in order:
        name = tile_name(top, left)
        if name in done or name in done_anywhere():
            continue
        tc, ly = EXT / f"tc_{name}.tif", EXT / f"ly_{name}.tif"
        if REMOTE:
            ok = tile_exists(name)
            rows = aggregate_remote(top, left, name, want) if ok else []
        else:
            ok = download(BASE.format(lay="lossyear", tile=name), ly)
        if ok and not REMOTE:
            nbytes += ly.stat().st_size
            rows = aggregate(top, left, ly, want)
        if ok:
            with open(part, "a", encoding="utf-8") as fh:
                for r in rows:
                    fh.write(json.dumps(r) + "\n")
        tc.unlink(missing_ok=True); ly.unlink(missing_ok=True)
        done[name] = len(rows) if ok else 0
        done_f.write_text(json.dumps(done))
        el = time.time() - t0
        print(f"[{i + 1}/{len(tiles)}] {name}: {done[name]} cells | {nbytes / 1e9:.1f} GB in {el / 60:.0f} min", flush=True)
    if sfx:  # the main process writes the table
        print("part done", flush=True)
        return
    rows = [json.loads(l) for f in sorted(EXT.glob("rows*.jsonl")) for l in open(f, encoding="utf-8")]
    df = pd.DataFrame(rows).drop_duplicates("cell1", keep="last").sort_values("cell1")
    df = df[["cell1"] + [c for c in df.columns if c.startswith("loss_")]]
    df.to_parquet(AGG / "forest_1deg.parquet", index=False)
    print(f"forest_1deg.parquet: {len(df):,} cells, mean yearly loss {df.filter(like='loss_').mean().mean() * 100:.3f}% of area", flush=True)


if __name__ == "__main__":
    sys.exit(main())
