"""Step 3 - aggregate detections to grids and harmonize MODIS -> VIIRS-equivalent.

Method
  * keep vegetation fires only (type 0) and drop low-confidence detections
  * aggregate per sensor x month x cell (0.5 deg for the globe, 1 deg for the model)
  * calibration: MODIS and VIIRS S-NPP overlap 2012-2025. For each 5x5 deg block
    and calendar season we fit r = VIIRS / MODIS (shrunk toward the global ratio
    with a pseudo-count, so sparse blocks don't explode)
  * Terra-only months (before Aqua, mid-2002) are scaled by a (Terra+Aqua)/Terra
    factor learned the same way from 2003-2011
  * harmonized activity H (VIIRS-equivalent detections):
        before 2012-02 : MODIS * r
        2012-02 onward : VIIRS
  * validation: fit r on 2012-2018 only, predict VIIRS 2019-2025 from MODIS, report error
"""
import json
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
PARQ = (ROOT / "data" / "parquet").as_posix()
AGG = ROOT / "data" / "agg"
AGG.mkdir(parents=True, exist_ok=True)
VIIRS_START = 201202  # first full month of S-NPP data
ALPHA = 200.0          # shrinkage pseudo-count (MODIS detections)

con = duckdb.connect()
con.execute("PRAGMA threads=8")


def aggregate():
    # 0.5-degree monthly per sensor; the 1-degree grid is derived from it
    con.execute(f"""
      CREATE OR REPLACE TABLE m05 AS
      SELECT sensor,
             CAST(year(date)*100 + month(date) AS INT) ym,
             CAST(LEAST(floor((90-lat)*2),359)*720 + LEAST(floor((lon+180)*2),719) AS INT) cell,
             count(*)::INT n,
             count(DISTINCT date)::SMALLINT fdays,
             sum(frp)::FLOAT frp,
             mode(country) country
      FROM '{PARQ}/*.parquet'
      WHERE type = 0 AND conf <> 'l'
      GROUP BY ALL
    """)
    con.execute(f"COPY m05 TO '{(AGG / 'monthly_05.parquet').as_posix()}' (FORMAT parquet)")
    print("m05 rows", con.execute("select count(*) from m05").fetchone()[0], flush=True)


def calibrate(fit_from, fit_to):
    """ratio table per (block5, season) fit on [fit_from, fit_to]."""
    return con.execute(f"""
      WITH b AS (
        SELECT sensor, (ym % 100 - 1) // 3 season,
               (cell // 720) // 10 * 100 + (cell % 720) // 10 block, sum(n) n
        FROM m05 WHERE ym BETWEEN {fit_from} AND {fit_to}
          AND ym IN (SELECT ym FROM m05 GROUP BY ym HAVING count(DISTINCT sensor) = 2)
        GROUP BY ALL),
      p AS (
        SELECT block, season,
               coalesce(sum(n) FILTER (sensor='MODIS'),0) mo,
               coalesce(sum(n) FILTER (sensor='VIIRS'),0) vi
        FROM b GROUP BY ALL),
      g AS (SELECT sum(vi)/sum(mo) rg FROM p)
      SELECT block, season, (vi + {ALPHA}*rg)/(mo + {ALPHA}) r, mo, vi, rg FROM p, g
    """).df()


AQUA_START = 200207  # Aqua MODIS first data 2002-07-04; before that only Terra flew


def terra_factor():
    """(Terra+Aqua)/Terra per block x season, learned 2003-2011, so Terra-only months
    (2000-11 .. 2002-06) aren't undercounted by the missing second satellite."""
    return con.execute(f"""
      WITH b AS (
        SELECT (CAST(LEAST(floor((90-lat)*2),359) AS INT)) // 10 * 100 + (CAST(LEAST(floor((lon+180)*2),719) AS INT)) // 10 block,
               (month(date) - 1) // 3 season,
               count(*) tot, count(*) FILTER (sat = 'Terra') terra
        FROM '{PARQ}/MODIS_*.parquet'
        WHERE type = 0 AND conf <> 'l' AND year(date) BETWEEN 2003 AND 2011
        GROUP BY ALL),
      g AS (SELECT sum(tot)/sum(terra) gf FROM b)
      SELECT block, season, (tot + {ALPHA}*gf)/(terra + {ALPHA}) f, gf FROM b, g
    """).df()


def harmonize():
    ratios = calibrate(VIIRS_START, 202512)
    con.register("ratios", ratios)
    tf = terra_factor()
    con.register("tf", tf)
    print(f"Terra->Terra+Aqua global factor {tf.gf.iloc[0]:.2f}", flush=True)
    con.execute(f"""
      CREATE OR REPLACE TABLE h05 AS
      WITH mo AS (
        SELECT m.ym, m.cell,
               m.n * coalesce(r.r, (SELECT any_value(rg) FROM ratios))
                   * CASE WHEN m.ym < {AQUA_START} THEN coalesce(t.f, (SELECT any_value(gf) FROM tf)) ELSE 1 END h,
               m.country
        FROM m05 m
        LEFT JOIN ratios r
          ON r.block = (m.cell // 720) // 10 * 100 + (m.cell % 720) // 10
         AND r.season = (m.ym % 100 - 1) // 3
        LEFT JOIN tf t
          ON t.block = (m.cell // 720) // 10 * 100 + (m.cell % 720) // 10
         AND t.season = (m.ym % 100 - 1) // 3
        WHERE m.sensor='MODIS' AND m.ym < {VIIRS_START}),
      vi AS (SELECT ym, cell, n::DOUBLE h, country FROM m05 WHERE sensor='VIIRS' AND ym >= {VIIRS_START})
      SELECT * FROM mo UNION ALL SELECT * FROM vi
    """)
    con.execute(f"COPY h05 TO '{(AGG / 'harmonized_05.parquet').as_posix()}' (FORMAT parquet)")
    rg = float(ratios.rg.iloc[0])
    print(f"global VIIRS/MODIS ratio {rg:.2f}", flush=True)
    return rg


def validate():
    """Fit on 2012-2018, predict VIIRS from MODIS on 2019-2025 at block x month level."""
    rt = calibrate(VIIRS_START, 201812)
    con.register("rt", rt)
    df = con.execute("""
      WITH b AS (
        SELECT sensor, ym, (cell // 720) // 10 * 100 + (cell % 720) // 10 block, sum(n) n
        FROM m05 WHERE ym BETWEEN 201901 AND 202512
          AND ym IN (SELECT ym FROM m05 GROUP BY ym HAVING count(DISTINCT sensor) = 2)
        GROUP BY ALL),
      p AS (SELECT block, ym,
                   coalesce(sum(n) FILTER (sensor='MODIS'),0) mo,
                   coalesce(sum(n) FILTER (sensor='VIIRS'),0) vi FROM b GROUP BY ALL)
      SELECT p.*, p.mo * coalesce(rt.r, (SELECT any_value(rg) FROM rt)) pred,
             p.mo * (SELECT any_value(rg) FROM rt) pred_global
      FROM p LEFT JOIN rt ON rt.block = p.block AND rt.season = (p.ym % 100 - 1)//3
    """).df()
    df = df[(df.mo + df.vi) > 0]

    def r2(y, yhat):
        y, yhat = np.log1p(y), np.log1p(yhat)
        return 1 - ((y - yhat) ** 2).sum() / ((y - y.mean()) ** 2).sum()

    tot = df.groupby("ym")[["vi", "pred", "mo"]].sum()
    res = {
        "test_period": "2019-2025",
        "fit_period": "2012-2018",
        "block_month_r2_log_regional": round(float(r2(df.vi, df.pred)), 3),
        "block_month_r2_log_global_ratio": round(float(r2(df.vi, df.pred_global)), 3),
        "block_month_r2_log_raw_modis": round(float(r2(df.vi, df.mo)), 3),
        "global_monthly_mape_regional": round(float((abs(tot.pred - tot.vi) / tot.vi).mean()), 3),
        "global_monthly_mape_raw_modis": round(float((abs(tot.mo - tot.vi) / tot.vi).mean()), 3),
    }
    print(res, flush=True)
    return res


if __name__ == "__main__":
    import sys
    if "--skip-aggregate" in sys.argv:
        con.execute(f"CREATE TABLE m05 AS SELECT * FROM '{(AGG / 'monthly_05.parquet').as_posix()}'")
    else:
        aggregate()
    rg = harmonize()
    res = validate()
    res["global_ratio"] = round(rg, 3)
    (AGG / "calibration.json").write_text(json.dumps(res, indent=2))
