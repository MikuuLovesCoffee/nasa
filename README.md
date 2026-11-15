# Ember Atlas

One consistent fire record from NASA's MODIS and VIIRS satellites (2000–2025), live fires from four satellites, and an AI fire-risk forecast, all on a 3D globe.

**Live:** https://nasa.mikuuloves.coffee

## The problem

MODIS (1 km pixels, since 2000) and VIIRS (375 m, since 2012) both detect active fires, but their numbers can't be compared directly. VIIRS sees smaller fires and reports about 4× more detections. If you stitch the two records together as they are, fire appears to jump in 2012. A second artefact sits in 2000–2002, when only Terra was flying: Aqua's afternoon pass roughly triples MODIS detections once it starts.

## What we built

| Mode | What it shows |
|---|---|
| **History** | 392.6M detections on a 0.5° grid, monthly from Nov 2000 to Dec 2025, in one VIIRS-equivalent unit. Scrub or play through time. Switch to *Raw* to see each sensor uncalibrated. |
| **Fire Calendar** | Pick a country, a province or draw a box (or use *Fire calendar for …* in a place card). A 25-year × 12-month burning-activity calendar for that area: the **critical period** (fewest months holding 80% of a normal year's fire, plus a "get ready by" month), **unusual months** (≥2 robust spreads from that month's median, log scale), Theil–Sen trend with a Mann–Kendall test, season-timing shift, the AI outlook averaged over the area, CSV download and a shareable link (`?mode=calendar&area=country:Uzbekistan`). Computed in the browser from `history.bin` (`site/src/calendar.js`). |
| **Live** | NASA FIRMS near-real-time feeds from VIIRS (NOAA-21, NOAA-20) and MODIS (Terra, Aqua); Suomi NPP stopped delivering data on 2 Nov 2026 and is no longer used. The same fire seen by several satellites is merged and counted once. Two views: **All heat** (default) shows every detection; **Fires only** takes gas flares, volcanoes and industrial heat out of the count and draws them in their own colours (cyan, purple, grey). |
| **AI Forecast** | The chance of significant fire (≥30 VIIRS-eq. detections) per 1° cell for this month and next, with an explanation for each cell: how often it burned before, the current weather, the past years with the most similar weather, and what pushed the prediction. |

Click any place on the globe to see its exact coordinates and province (Uzbek viloyat names for Uzbekistan), plus 25 years of fire history, the fire season and the AI outlook. Those numbers are for the 1° grid square (about 111 × 85 km) outlined on the globe, and the card lists which provinces that square covers.

## Method

1. **Ingest** (`pipeline/ingest.py`): FIRMS yearly archives are normalized into one schema. MODIS 0–100 confidence is mapped to the VIIRS low/nominal/high classes.
2. **Harmonize** (`pipeline/harmonize.py`):
   - Keep vegetation fires only (no volcanoes, gas flares or industrial heat) and drop low-confidence detections.
   - Count detections per 0.5° cell per month.
   - Learn a VIIRS ÷ MODIS ratio for each 5° block and season from the 2012–2025 overlap, shrunk toward the global ratio where data is sparse.
   - Apply the same idea to Terra-only months, using a (Terra+Aqua) ÷ Terra factor learned from 2003–2011.
   - **Validation:** fit on 2012–2018, then predict VIIRS from MODIS for 2019–2025. Monthly global error is **7.4%** with the calibration vs **76%** with raw MODIS. Regional R² (log) is 0.81 vs 0.50.
3. **Weather** (`pipeline/weather.py`): NASA POWER monthly values for 2000–2025 plus daily values for 2026. Variables: max temperature, rainfall, humidity, wind and root-zone soil moisture, aggregated to 1° cells.
4. **AI** (`pipeline/train.py`, runs locally): XGBoost on about 3.1M cell-months (12,468 fire-prone 1° cells). Each feature uses only information available before the month being predicted:
   - the place's fire history for that calendar month, from earlier years only
   - last month's weather anomalies
   - an **analog score**: how often fire followed when this place's weather looked like this before

   Results on 2023–2025, which the model never saw:

   | Cases | AI | "Same as usual" baseline |
   |---|---|---|
   | All · ROC-AUC | 0.950 | 0.936 |
   | Unusual fires (places/months that burn in <30% of years) · ROC-AUC | 0.869 | 0.813 |
   | Unusual fires · average precision | **0.274** | 0.181 (about 51% higher for the AI) |

5. **Export** (`pipeline/export.py`): compact static files for the site. The history binary is delta-encoded (about 15 MB gzipped), with per-cell detail split into tiles.
6. **Non-fire heat mask for Live** (`pipeline/static_mask.py`): NASA's live feeds don't say what a hot spot is, so every ~1 km cell of known non-fire heat is listed, with its category:
   - from the 2000–2025 archive: spots NASA labelled volcano / static source / offshore at least 3 times, and spots hot 10+ days a year in 3+ years
   - 26,818 gas-flare sites (VIIRS Nightfire 2012–2025)
   - the 231 volcanoes active since 2000 (Smithsonian)
   - OpenStreetMap industry (coded; not yet fetched because the servers were overloaded)

   163,510 cells in total. Output: `static_mask.bin` + `static_mask_kind.bin`.
7. **Province borders** (`pipeline/provinces.sh`): Natural Earth admin-1, simplified to `admin1.json` (530 KB gzipped). The province lookup runs in the browser; no outside geocoding service is used.

## Run it

```bash
pip install duckdb pyarrow pandas numpy xgboost scikit-learn requests
cd site && npm install && cd ..
./run_pipeline.sh           # or run the steps inside it one by one
cd site && npm run dev      # http://localhost:5173 (the /firms proxy is in vite.config.js)
```

The server only hosts static files plus a cached nginx proxy to FIRMS (`deploy/nginx-nasa.conf`). No AI runs on the server.

## Data

- NASA FIRMS: MODIS Collection 6.1 and VIIRS S-NPP Collection 2 standard-processing archives, plus the near-real-time feeds.
- NASA POWER: MERRA-2 based meteorology.
- Gas flares: VIIRS Nightfire upstream flare sites, MYC25Q4, Earth Observation Group, Colorado School of Mines ([doi:10.5281/zenodo.23091822](https://doi.org/10.5281/zenodo.23091822), CC BY-NC 4.0).
- Volcanoes: Smithsonian Global Volcanism Program, Volcanoes of the World.
- Province borders: Natural Earth 1:10m admin-1 (public domain).

The full story of how this was built, with every command, number and decision, is in `EMBER_ATLAS_BOOK.md`.

Known gap: the standard archives end in December 2025. Jan–Oct 2026 history isn't in the History view yet. A free FIRMS MAP_KEY would let us fill it from the FIRMS area API.
