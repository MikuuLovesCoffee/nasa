#!/bin/bash
# Province / region (admin-1) borders for the click card: "which viloyat did I click?"
# Natural Earth 1:10m admin-1 (public domain) -> simplified TopoJSON, ~530 KB gzipped.
# The site loads it only on the first click.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/ext/admin1
SRC=data/ext/admin1/ne_admin1.geojson
[ -s "$SRC" ] || curl -sL -m 600 -o "$SRC" \
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson
npx -y mapshaper@0.6.102 -i "$SRC" -filter-fields name_en,name,type_en,admin,iso_3166_2 \
  -rename-layers admin1 -simplify 10% keep-shapes \
  -o format=topojson quantization=100000 site/public/data/admin1.json
ls -la site/public/data/admin1.json
