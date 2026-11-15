"""Monthly vegetation greenness (NDVI) per 1-degree cell, 2001 -> latest month.

Source: NASA MODIS Terra MOD13C2-based monthly NDVI, served by NASA GIBS as the layer
`MODIS_Terra_L3_NDVI_Monthly` (public domain, no key). GIBS returns a colour image, but
its colour map (colormaps/v1.3/MODIS_L3_NDVI.xml) gives every colour a unique NDVI bin
of ~0.005-0.0075, so the image decodes back to values exactly (tested: 100 % of land
pixels decode). One global request per month at 0.1 deg instead of tens of thousands
of tile reads.

Output: data/agg/vegetation_monthly.parquet  (cell1, ym, ndvi, ndvi_px)
  ndvi     mean NDVI of the cell's land pixels that month (0..1)
  ndvi_px  how many 0.1-deg pixels had data (of 100)
Leakage note: train.py uses month m-1 (and earlier) to predict month m.
Re-runs only fetch months not yet in the parquet (the latest month is always refreshed).
"""
import io
import re
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
AGG = ROOT / "data" / "agg"
EXT = ROOT / "data" / "ext" / "gibs_ndvi"
OUT = AGG / "vegetation_monthly.parquet"
LAYER = "MODIS_Terra_L3_NDVI_Monthly"
CMAP = "https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_L3_NDVI.xml"
WMS = ("https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0"
       f"&LAYERS={LAYER}&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=3600&HEIGHT=1800&FORMAT=image/png&TIME={{d}}")
UA = "ember-atlas/1.0 (fire map research)"


def curl(url):
    for attempt in range(6):
        r = subprocess.run(["curl", "-sfL", "-A", UA, "-m", "300", url], capture_output=True)
        if r.returncode == 0 and len(r.stdout) > 1000:
            return r.stdout
        if r.returncode == 22:
            return None
        time.sleep(10 * 2 ** attempt)
    return None


def lut():
    xml = curl(CMAP).decode("utf-8")
    keys, vals = [], []
    for rgb, lo, hi, rest in re.findall(r'rgb="([\d,]+)"[^>]*?value="\[([-\d.]+),([-\d.]+)\)"([^>]*)', xml):
        if "nodata" in rest:
            continue
        r, g, b = map(int, rgb.split(","))
        keys.append((r << 16) | (g << 8) | b)
        vals.append((float(lo) + float(hi)) / 2)
    o = np.argsort(keys)
    return np.array(keys)[o], np.array(vals)[o]


def decode(png, keys, vals):
    im = np.array(Image.open(io.BytesIO(png)).convert("RGBA"))
    key = (im[..., 0].astype(np.int64) << 16) | (im[..., 1].astype(np.int64) << 8) | im[..., 2]
    i = np.clip(np.searchsorted(keys, key), 0, len(keys) - 1)
    ok = (keys[i] == key) & (im[..., 3] > 0)
    return np.where(ok, vals[i], np.nan).astype(np.float32)   # (1800, 3600), row 0 = 90N


def to_1deg(nd):
    blk = nd.reshape(180, 10, 360, 10)
    n = np.isfinite(blk).sum(axis=(1, 3))
    with np.errstate(invalid="ignore"):
        m = np.nanmean(blk, axis=(1, 3))
    return m, n


def months_available():
    # GIBS time ranges for this layer (from WMTSCapabilities, 2026-11-14):
    # 2000-03-01/2025-03-01/P1M and 2025-05-01/<latest>/P1M. We simply try every month and skip 404s.
    out, d = [], pd.Timestamp("2001-01-01")
    last = pd.Timestamp.today().normalize().replace(day=1) - pd.offsets.MonthBegin(1)
    while d <= last:
        out.append(d)
        d += pd.offsets.MonthBegin(1)
    return out


def main():
    keys, vals = lut()
    print(f"colour map: {len(keys)} classes", flush=True)
    have = pd.read_parquet(OUT) if OUT.exists() else pd.DataFrame(columns=["cell1", "ym", "ndvi", "ndvi_px"])
    done = set(have.ym.unique().tolist())
    months = months_available()
    if done:
        done.discard(max(done))   # refresh the most recent month (may have been partial)
    frames = [have[have.ym.isin(done)]]
    cells = np.arange(180 * 360)
    for d in months:
        ym = d.year * 100 + d.month
        if ym in done:
            continue
        png = curl(WMS.format(d=d.strftime("%Y-%m-%d")))
        if png is None:
            print(f"{ym}: no image (gap in GIBS)", flush=True)
            continue
        m, n = to_1deg(decode(png, keys, vals))
        ok = n.ravel() >= 5
        frames.append(pd.DataFrame({"cell1": cells[ok], "ym": ym, "ndvi": m.ravel()[ok], "ndvi_px": n.ravel()[ok]}))
        print(f"{ym}: {ok.sum():,} land cells", flush=True)
        time.sleep(0.5)
    df = pd.concat(frames, ignore_index=True).astype({"cell1": "int32", "ym": "int32", "ndvi": "float32", "ndvi_px": "int16"})
    df.sort_values(["cell1", "ym"]).to_parquet(OUT, index=False)
    print(f"vegetation_monthly.parquet: {len(df):,} rows, {df.ym.nunique()} months, {df.ym.min()}-{df.ym.max()}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
