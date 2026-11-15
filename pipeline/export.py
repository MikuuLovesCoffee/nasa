"""Step 5 - export static files for the website (site/public/data)."""
import json
import struct
from collections import defaultdict
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
AGG = ROOT / "data" / "agg"
OUT = ROOT / "site" / "public" / "data"
(OUT / "tiles").mkdir(parents=True, exist_ok=True)


def month_seq(a, b):
    out, y, m = [], a // 100, a % 100
    while y * 100 + m <= b:
        out.append(y * 100 + m)
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def main():
    con = duckdb.connect()
    con.execute(f"CREATE TABLE h AS SELECT * FROM '{(AGG / 'harmonized_05.parquet').as_posix()}'")
    con.execute(f"CREATE TABLE m AS SELECT * FROM '{(AGG / 'monthly_05.parquet').as_posix()}'")
    first, last = con.execute("SELECT min(ym), max(ym) FROM h").fetchone()
    months = month_seq(first, last)
    mi = {m: i for i, m in enumerate(months)}
    # year views start at the first complete year (2000 only has Nov-Dec)
    years = sorted({m // 100 for m in months if (m // 100) * 100 + 1 >= first})

    # ---- per month x 0.5-deg cell: harmonized + raw MODIS + raw VIIRS
    df = con.execute("""
      SELECT coalesce(h.ym, r.ym) ym, coalesce(h.cell, r.cell) cell, coalesce(h.h, 0) h,
             coalesce(r.mo, 0) mo, coalesce(r.vi, 0) vi
      FROM h FULL JOIN (
        SELECT ym, cell, sum(n) FILTER (sensor='MODIS') mo, sum(n) FILTER (sensor='VIIRS') vi
        FROM m GROUP BY ALL) r ON h.ym = r.ym AND h.cell = r.cell
      ORDER BY 1, 2""").df()
    df = df[df.ym.isin(mi)]
    df["mi"] = df.ym.map(mi)
    clip = lambda s: np.clip(np.round(s.values), 0, 65535).astype("<u2")
    counts = np.bincount(df.mi, minlength=len(months))
    offsets = np.concatenate([[0], np.cumsum(counts)]).astype("<u4")
    with open(OUT / "history.bin", "wb") as f:
        f.write(struct.pack("<I", len(months)))
        f.write(offsets.tobytes())
        # cells delta-encoded within each month (sorted), compresses ~3x better under gzip
        cells = df.cell.values.astype(np.int64)
        delta = cells.copy()
        delta[1:] -= cells[:-1]
        delta[offsets[:-1][counts > 0]] = cells[offsets[:-1][counts > 0]]
        f.write(delta.astype("<u4").tobytes())
        f.write(clip(np.maximum(df.h, (df.h > 0) * 1)).tobytes())
        f.write(clip(df.mo).tobytes())
        f.write(clip(df.vi).tobytes())
    print(f"history.bin {len(df):,} entries, {(OUT / 'history.bin').stat().st_size / 1e6:.1f} MB")

    # ---- global series
    g = df.groupby("mi")[["h", "mo", "vi"]].sum().reindex(range(len(months)), fill_value=0)
    gy = df.assign(y=df.ym // 100).groupby("y")[["h", "mo", "vi"]].sum().reindex(years, fill_value=0)
    naive = [float(gy.mo[y]) if y < 2012 else float(gy.vi[y]) for y in years]

    # ---- countries
    cy = con.execute("SELECT country, ym // 100 y, sum(h) h FROM h GROUP BY ALL").df()
    piv = cy.pivot_table(index="country", columns="y", values="h", fill_value=0).reindex(columns=years, fill_value=0)
    countries = [{"name": c, "yearly": [round(float(v)) for v in piv.loc[c].values]} for c in piv.index]
    cent = con.execute("""
      SELECT country, sum(h * (90 - ((cell // 720) + 0.5) * 0.5)) / sum(h) lat,
             sum(h * (-180 + ((cell % 720) + 0.5) * 0.5)) / sum(h) lon
      FROM h GROUP BY ALL""").df()
    centers = {r.country: [round(r.lat, 2), round(r.lon, 2)] for r in cent.itertuples()}

    cal = json.loads((AGG / "calibration.json").read_text())
    cal = {k: (None if isinstance(v, float) and v != v else v) for k, v in cal.items()}
    total = con.execute(f"SELECT count(*) FROM '{(ROOT / 'data' / 'parquet').as_posix()}/*.parquet'").fetchone()[0]
    meta = {
        "months": months, "years": years,
        "global": {
            "harm": [round(float(v)) for v in g.h], "modis": [round(float(v)) for v in g.mo], "viirs": [round(float(v)) for v in g.vi],
            "harmYear": [round(float(v)) for v in gy.h], "modisYear": [round(float(v)) for v in gy.mo],
            "viirsYear": [round(float(v)) for v in gy.vi], "naiveYear": [round(v) for v in naive],
        },
        "countries": countries, "countryCenters": centers, "calibration": cal,
        "stats": {"detections": int(total)},
        "historyBytes": (OUT / "history.bin").stat().st_size,
        "version": pd.Timestamp.now().strftime("%Y%m%d%H%M%S"),  # cache-buster for data URLs
    }
    (OUT / "meta.json").write_text(json.dumps(meta, separators=(",", ":")))

    # ---- forecast
    fc_path = AGG / "forecast.json"
    details = {}
    if fc_path.exists():
        fc = json.loads(fc_path.read_text())
        (OUT / "forecast.json").write_text(json.dumps(fc, separators=(",", ":")))
        details = json.loads((AGG / "forecast_details.json").read_text())

    # ---- per 1-deg cell tiles (10x10 deg)
    d1 = df.assign(cell1=(df.cell // 720 // 2) * 360 + (df.cell % 720) // 2).groupby(["cell1", "mi"])[["h", "mo", "vi"]].sum().reset_index()
    cc = con.execute("SELECT (cell // 720 // 2) * 360 + (cell % 720) // 2 cell1, country, sum(h) h FROM h GROUP BY ALL").df()
    cc = cc.sort_values("h").drop_duplicates("cell1", keep="last").set_index("cell1").country
    tiles = defaultdict(dict)
    nM = len(months)
    for cell1, grp in d1.groupby("cell1"):
        arr = np.zeros((3, nM), np.int64)
        arr[:, grp.mi.values] = np.round(grp[["h", "mo", "vi"]].values.T)
        key = f"{cell1 // 360 // 10}_{(cell1 % 360) // 10}"
        tiles[key][int(cell1)] = {"c": cc.get(cell1, ""), "h": arr[0].tolist(), "mo": arr[1].tolist(), "vi": arr[2].tolist(),
                                  **({"fc": details[str(cell1)]} if str(cell1) in details else {})}
    for key, t in tiles.items():
        (OUT / "tiles" / f"{key}.json").write_text(json.dumps(t, separators=(",", ":")))
    print(f"tiles {len(tiles)}, months {months[0]}..{months[-1]}")


if __name__ == "__main__":
    main()
