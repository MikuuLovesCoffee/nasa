#!/bin/bash
# Monthly AI forecast refresh (runs the AI locally, uploads only the results).
#   1. fetch the latest NASA POWER weather (this year's daily files)
#   2. add the newest vegetation month, retrain + predict this month and next
#   3. export website data and deploy
set -euo pipefail
cd "$(dirname "$0")"
export PYTHONIOENCODING=utf-8
python pipeline/weather.py --refresh   # re-fetch stale daily files + rebuild table
python pipeline/vegetation.py          # adds the newest monthly NDVI (only fetches missing months)
python pipeline/train.py               # uses the feature groups in data/agg/feature_choice.json
python pipeline/export.py
deploy/deploy.sh
