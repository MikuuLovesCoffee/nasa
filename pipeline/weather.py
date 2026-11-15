"""Step 2 - fetch NASA POWER weather for every 10x10 degree box that has ever had fire.

Monthly 2000-2025 (history for training) + daily 2026 (current conditions for the
forecast). POWER regional allows one parameter per request, so we loop params.
Raw responses are cached in data/weather/raw; then aggregated to 1-degree cells
into data/agg/weather_monthly.parquet (cell1, ym, <params>).
"""
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "weather" / "raw"
RAW.mkdir(parents=True, exist_ok=True)
AGG = ROOT / "data" / "agg"
AGG.mkdir(parents=True, exist_ok=True)
PARQ = (ROOT / "data" / "parquet").as_posix()

PARAMS = ["T2M_MAX", "PRECTOTCORR", "RH2M", "WS2M", "GWETROOT"]
BASE = "https://power.larc.nasa.gov/api/temporal"
TODAY = date.today()
DAILY_END = (TODAY - timedelta(days=1)).strftime("%Y%m%d")


def fire_boxes():
    q = f"""SELECT DISTINCT CAST(floor(lat/10)*10 AS INT) la, CAST(floor(lon/10)*10 AS INT) lo
            FROM '{PARQ}/MODIS_*.parquet' WHERE type=0"""
    return duckdb.sql(q).fetchall()


def fetch(job):
    kind, param, la, lo = job
    out = RAW / f"{kind}_{param}_{la}_{lo}.json"
    if out.exists():
        return
    lamax, lomax = min(la + 10, 90), min(lo + 10, 180)
    if kind == "monthly":
        span = "start=2000&end=2025"
    else:
        span = f"start=20260101&end={DAILY_END}"
    url = (f"{BASE}/{kind}/regional?parameters={param}&community=AG&format=JSON&{span}"
           f"&latitude-min={la}&latitude-max={lamax}&longitude-min={lo}&longitude-max={lomax}")
    for attempt in range(6):
        try:
            r = requests.get(url, timeout=300)
            if r.status_code == 200 and '"features"' in r.text[:200]:
                out.write_text(r.text)
                return
            msg = r.text[:200]
        except Exception as e:  # network hiccup
            msg = str(e)
        time.sleep(15 * (attempt + 1))
    print("FAILED", job, msg, flush=True)


def complete_boxes():
    """Boxes whose 10 regional files (5 params x monthly/daily) are all cached."""
    have = {}
    for f in RAW.glob("*.json"):
        if f.name.startswith("pt_"):
            continue
        la, lo = map(int, f.stem.split("_")[-2:])
        have[(la, lo)] = have.get((la, lo), 0) + 1
    return {b for b, n in have.items() if n == 2 * len(PARAMS)}


def fire_cells2():
    """2-degree cells with any vegetation fire (MODIS record)."""
    q = f"""SELECT DISTINCT CAST(floor(lat/2)*2 AS INT) la, CAST(floor(lon/2)*2 AS INT) lo
            FROM '{PARQ}/MODIS_*.parquet' WHERE type=0"""
    return duckdb.sql(q).fetchall()


def fetch_point(job):
    kind, la, lo = job
    out = RAW / f"pt_{kind}_{la}_{lo}.json"
    if out.exists():
        return
    span = "start=2000&end=2025" if kind == "monthly" else f"start=20260101&end={DAILY_END}"
    url = (f"{BASE}/{kind}/point?parameters={','.join(PARAMS)}&community=AG&format=JSON&{span}"
           f"&latitude={la + 1}&longitude={lo + 1}")
    for attempt in range(6):
        try:
            r = requests.get(url, timeout=120)
            if r.status_code == 200 and '"parameter"' in r.text:
                out.write_text(r.text)
                return
            msg = r.text[:200]
        except Exception as e:
            msg = str(e)
        time.sleep(15 * (attempt + 1))
    print("FAILED", job, msg, flush=True)


def refresh_daily(max_age_h=20):
    """Current-year daily files go stale; re-fetch them (same shape) so the forecast sees new weather."""
    stale = [f for f in RAW.glob("*daily_*.json") if time.time() - f.stat().st_mtime > max_age_h * 3600]
    jobs_pt, jobs_reg = [], []
    for f in stale:
        parts = f.stem.split("_")
        la, lo = int(parts[-2]), int(parts[-1])
        if f.name.startswith("pt_"):
            jobs_pt.append(("daily", la, lo))
        else:
            jobs_reg.append(("daily", "_".join(parts[1:-2]), la, lo))
        f.rename(f.with_suffix(".old"))  # keep until the new one arrives
    print(f"refreshing {len(stale)} daily files", flush=True)
    with ThreadPoolExecutor(4) as ex:
        list(ex.map(fetch_point, jobs_pt))
        list(ex.map(fetch, jobs_reg))
    for old in RAW.glob("*.old"):  # restore any that failed to refresh
        new = old.with_suffix(".json")
        old.replace(new) if not new.exists() else old.unlink()


def download():
    """Regional tiles already cached are kept; everything else goes per 2-deg point
    (all params in one small request - regional JSON is ~1.7 MB per param)."""
    done_boxes = complete_boxes()
    cells = [(la, lo) for la, lo in fire_cells2() if (la // 10 * 10, lo // 10 * 10) not in done_boxes]
    jobs = [(k, la, lo) for la, lo in cells for k in ("monthly", "daily")]
    print(f"{len(done_boxes)} regional boxes cached, {len(cells)} point cells, {len(jobs)} requests", flush=True)
    done = 0
    with ThreadPoolExecutor(4) as ex:
        for _ in ex.map(fetch_point, jobs):
            done += 1
            if done % 200 == 0:
                print(f"{done}/{len(jobs)}", flush=True)


def download_regional():
    boxes = fire_boxes()
    jobs = [(k, p, la, lo) for la, lo in boxes for p in PARAMS for k in ("monthly", "daily")]
    print(f"{len(boxes)} boxes, {len(jobs)} requests", flush=True)
    done = 0
    with ThreadPoolExecutor(6) as ex:
        for _ in ex.map(fetch, jobs):
            done += 1
            if done % 100 == 0:
                print(f"{done}/{len(jobs)}", flush=True)


def _file_monthly(f):
    """One cached response -> DataFrame(cell1, ym, param, v, src) at 1-deg / monthly."""
    point = f.name.startswith("pt_")
    kind = f.stem.split("_")[1 if point else 0]
    d = json.loads(f.read_text())
    feats = [d] if point else d["features"]
    if not point:
        la0, lo0 = map(int, f.stem.split("_")[-2:])
    parts = []
    for ft in feats:
        lo, la = ft["geometry"]["coordinates"][:2]
        if not point and (la >= la0 + 10 or lo >= lo0 + 10):
            continue  # box edge: belongs to the neighbouring box
        for param, series in ft["properties"]["parameter"].items():
            keys = [k for k in series if not (kind == "monthly" and k.endswith("13"))]
            v = np.fromiter((series[k] for k in keys), float, len(keys))
            ym = np.fromiter((int(k[:6]) for k in keys), np.int32, len(keys))
            ok = v != -999
            parts.append(pd.DataFrame({"param": param, "lat": la, "lon": lo, "ym": ym[ok], "v": v[ok]}))
    if not parts:
        return None
    df = pd.concat(parts).groupby(["param", "lat", "lon", "ym"], as_index=False)["v"].mean()  # daily -> monthly
    if point:
        r0 = int(np.floor(90 - (df.lat.iloc[0] + 1)))
        c0 = int(np.floor(df.lon.iloc[0] - 1 + 180))
        out = []
        for dr in (0, 1):
            for dc in (0, 1):
                e = df[["param", "ym", "v"]].copy()
                e["cell1"] = min(max(r0 + dr, 0), 179) * 360 + min(max(c0 + dc, 0), 359)
                out.append(e)
        df = pd.concat(out)
        df["src"] = 1
        return df
    df["cell1"] = np.clip(np.floor(90 - df.lat), 0, 179).astype(int) * 360 + np.clip(np.floor(df.lon + 180), 0, 359).astype(int)
    df = df.groupby(["cell1", "ym", "param"], as_index=False)["v"].mean()
    df["src"] = 0
    return df


def build():
    """Aggregate POWER responses to 1-degree cells, monthly."""
    files = sorted(RAW.glob("*.json"))
    frames = []
    for i, f in enumerate(files):
        try:
            r = _file_monthly(f)
        except Exception as e:
            print("bad file", f.name, e)
            continue
        if r is not None:
            frames.append(r)
        if i % 200 == 0:
            print(f"parsed {i}/{len(files)}", flush=True)
    df = pd.concat(frames)
    # prefer regional (finer) where both exist
    df = df.sort_values("src", kind="stable").drop_duplicates(["cell1", "ym", "param"], keep="first")
    w = df.pivot_table(index=["cell1", "ym"], columns="param", values="v").reset_index()
    w.columns.name = None
    w["ym"] = w["ym"].astype(int)
    w.to_parquet(AGG / "weather_monthly.parquet", index=False)
    print("weather rows", len(w), "cells", w.cell1.nunique(), "months", w.ym.nunique())


if __name__ == "__main__":
    if "--refresh" in sys.argv:
        refresh_daily()
    elif "build" not in sys.argv:
        download()
    build()
