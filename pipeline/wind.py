"""Strong-wind data for the fire model (NASA POWER, MERRA-2).

The base weather table only has WS2M: the monthly MEAN wind at 2 m. Fires spread on windy
days, so this adds, at 10 m height:
  WS10M       mean wind speed (m/s)
  WS10M_MAX   strongest daily-max wind of the month (m/s)  [monthly endpoint = max over the month;
              for the 2026 daily files the monthly value is the max of the daily maxima, same meaning]
  windy_days  days in the month with daily-max wind >= 10 m/s (2026 daily only; NaN for history)

Same 2-degree points as weather.py's point fallback (one request per point carries both params),
each spread to its four 1-degree cells. Cached in data/weather/wind_raw; resumable.
Output: data/agg/wind_monthly.parquet (cell1, ym, WS10M, WS10M_MAX)

Usage: PYTHONIOENCODING=utf-8 python pipeline/wind.py [--refresh] [build]
"""
import json
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from weather import fire_cells2  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "weather" / "wind_raw"
RAW.mkdir(parents=True, exist_ok=True)
AGG = ROOT / "data" / "agg"
PARAMS = ["WS10M", "WS10M_MAX"]
BASE = "https://power.larc.nasa.gov/api/temporal"
DAILY_END = (date.today() - timedelta(days=1)).strftime("%Y%m%d")


def fetch(job):
    kind, la, lo = job
    out = RAW / f"{kind}_{la}_{lo}.json"
    if out.exists():
        return
    span = "start=2000&end=2025" if kind == "monthly" else f"start=20260101&end={DAILY_END}"
    url = (f"{BASE}/{kind}/point?parameters={','.join(PARAMS)}&community=AG&format=JSON&{span}"
           f"&latitude={la + 1}&longitude={lo + 1}")
    msg = ""
    tries = 0
    for attempt in range(40):
        try:
            r = requests.get(url, timeout=120)
            if r.status_code == 200 and '"parameter"' in r.text:
                out.write_text(r.text)
                return
            msg = r.text[:200]
            if r.status_code == 429:      # NASA POWER rate limit: wait it out, don't count as a failure
                time.sleep(60 + 30 * random.random())
                continue
        except Exception as e:
            msg = str(e)
        tries += 1
        if tries >= 6:
            break
        time.sleep(15 * tries)
    print("FAILED", job, msg, flush=True)


def download(refresh=False):
    cells = fire_cells2()
    if refresh:  # re-fetch this year's daily files
        for f in RAW.glob("daily_*.json"):
            if time.time() - f.stat().st_mtime > 20 * 3600:
                f.unlink()
    import os
    kinds = {"monthly": ("monthly",), "daily": ("daily",)}.get(os.environ.get("WIND_KIND", ""), ("monthly", "daily"))
    jobs = [(k, la, lo) for la, lo in cells for k in kinds]
    todo = [j for j in jobs if not (RAW / f"{j[0]}_{j[1]}_{j[2]}.json").exists()]
    import os
    if os.environ.get("WIND_REVERSE"):  # a second downloader can work from the other end
        todo = todo[::-1]
    print(f"{len(cells)} points, {len(todo)} of {len(jobs)} requests to do", flush=True)
    done = 0
    with ThreadPoolExecutor(int(os.environ.get("WIND_THREADS", 4))) as ex:
        for _ in ex.map(fetch, todo):
            done += 1
            if done % 200 == 0:
                print(f"{done}/{len(todo)}", flush=True)


def build():
    rows = []
    for f in sorted(RAW.glob("*.json")):
        kind, la, lo = f.stem.split("_")
        la, lo = int(la), int(lo)
        try:
            P = json.loads(f.read_text())["properties"]["parameter"]
        except Exception as e:
            print("bad file", f.name, e)
            continue
        recs = {}
        for p in PARAMS:
            for k, v in P.get(p, {}).items():
                if v == -999 or (kind == "monthly" and k.endswith("13")):
                    continue
                ym = int(k[:6])
                recs.setdefault((ym, p), []).append(v)
        r0, c0 = 90 - (la + 2), lo + 180  # top row / left col of the 2x2 block of 1-deg cells
        for (ym, p), vals in recs.items():
            v = max(vals) if p == "WS10M_MAX" else float(np.mean(vals))
            for dr in (0, 1):
                for dc in (0, 1):
                    rows.append((min(max(r0 + dr, 0), 179) * 360 + min(max(c0 + dc, 0), 359), ym, p, v))
    df = pd.DataFrame(rows, columns=["cell1", "ym", "param", "v"])
    w = df.pivot_table(index=["cell1", "ym"], columns="param", values="v").reset_index()
    w.columns.name = None
    w.to_parquet(AGG / "wind_monthly.parquet", index=False)
    print("wind rows", len(w), "cells", w.cell1.nunique(), "months", w.ym.nunique(),
          "WS10M_MAX median", round(float(w.WS10M_MAX.median()), 2))


if __name__ == "__main__":
    import os
    if "build" not in sys.argv:
        download("--refresh" in sys.argv)
        print("download done", flush=True)
    if not os.environ.get("WIND_NOBUILD"):
        build()
