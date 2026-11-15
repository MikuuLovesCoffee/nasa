"""Step 1 - normalize FIRMS yearly country archives (MODIS C6.1 + VIIRS S-NPP C2)
into one schema, one Parquet file per sensor-year.

Unified schema:
  lat, lon, date, hhmm, sensor ('MODIS'|'VIIRS'), sat, frp, conf ('l'|'n'|'h'),
  daynight, type, pixel_km2, country
MODIS confidence (0-100) is mapped to VIIRS classes the way FIRMS documents it:
  <30 low, 30-79 nominal, >=80 high.
"""
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "parquet"
OUT.mkdir(parents=True, exist_ok=True)


def ingest(zip_path: Path) -> None:
    m = re.match(r"(modis|viirs-snpp)_(\d{4})_all_countries\.zip", zip_path.name)
    if not m:
        return
    sensor = "MODIS" if m.group(1) == "modis" else "VIIRS"
    year = m.group(2)
    out = OUT / f"{sensor}_{year}.parquet"
    if out.exists():
        print("skip", out.name)
        return
    tmp = Path(tempfile.mkdtemp(dir=ROOT / "data"))
    try:
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(tmp)
        glob = (tmp / "**" / "*.csv").as_posix()
        if sensor == "MODIS":
            conf = "CASE WHEN TRY_CAST(confidence AS INT) < 30 THEN 'l' WHEN TRY_CAST(confidence AS INT) < 80 THEN 'n' ELSE 'h' END"
        else:
            conf = "lower(substr(CAST(confidence AS VARCHAR),1,1))"
        con = duckdb.connect()
        con.execute(f"""
            COPY (
              SELECT CAST(latitude AS FLOAT) lat, CAST(longitude AS FLOAT) lon,
                     CAST(acq_date AS DATE) date, CAST(acq_time AS SMALLINT) hhmm,
                     '{sensor}' sensor, CAST(satellite AS VARCHAR) sat,
                     CAST(frp AS FLOAT) frp, {conf} conf,
                     CAST(daynight AS VARCHAR) daynight,
                     CAST("type" AS TINYINT) AS "type",
                     CAST(CAST(scan AS FLOAT) * CAST(track AS FLOAT) AS FLOAT) pixel_km2,
                     regexp_extract(filename, '_\\d{{4}}_(.+)\\.csv$', 1) country
              FROM read_csv('{glob}', filename=true, union_by_name=true, all_varchar=true)
            ) TO '{out.as_posix()}' (FORMAT parquet, COMPRESSION zstd)
        """)
        n = con.execute(f"SELECT count(*) FROM '{out.as_posix()}'").fetchone()[0]
        print(f"{out.name}: {n:,} detections", flush=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    files = [Path(p) for p in sys.argv[1:]] or sorted(RAW.glob("*_all_countries.zip"))
    for f in files:
        ingest(f)
