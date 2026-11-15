#!/bin/bash
# Full refresh: data -> unified record -> weather -> AI model -> website data -> deploy.
# Each step caches its downloads, so re-running only fetches what's new.
set -euo pipefail
cd "$(dirname "$0")"
export PYTHONIOENCODING=utf-8

data/dl.sh                       # FIRMS yearly archives (MODIS 2000+, VIIRS S-NPP 2012+)
python pipeline/ingest.py        # -> data/parquet/{MODIS,VIIRS}_YYYY.parquet (one schema)
python pipeline/harmonize.py     # -> data/agg/harmonized_05.parquet + calibration.json
python pipeline/weather.py       # NASA POWER -> data/agg/weather_monthly.parquet
python pipeline/vegetation.py    # NASA GIBS monthly NDVI -> data/agg/vegetation_monthly.parquet (~30-90 min first time)
python pipeline/landcover.py     # ESA WorldCover 2021 -> data/agg/landcover_1deg.parquet (~1 h first time)
python pipeline/forest.py        # Hansen forest loss -> data/agg/forest_1deg.parquet (~1-2 h, resumable)
python pipeline/experiments.py   # ablation -> data/agg/experiments.json, feature_choice.json, docs/EXPERIMENTS.md
python pipeline/train.py         # XGBoost (local, chosen features) -> data/agg/forecast*.json
python pipeline/export.py        # -> site/public/data/
python pipeline/static_mask.py   # -> site/public/data/static_mask*.bin (flares, volcanoes, industry; live "fires only")
                                 #    extra inputs in data/ext/{vnf,gvp,osm} (see the script header)
pipeline/provinces.sh            # -> site/public/data/admin1.json (province names for the click card)
deploy/deploy.sh                 # build + upload to nasa.mikuuloves.coffee
