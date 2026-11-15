# 🔥 Ember Atlas

**One fire record for the whole planet.** Ember Atlas unifies 25 years of NASA's MODIS and VIIRS active-fire data into a single, consistent record. On top of that record it builds a burning-activity calendar for any area, live fire maps and an AI fire-risk forecast, all on a 3D globe in the browser.

**▶ Live site:** https://nasa.mikuuloves.coffee
**▶ 30-second demo:** [`video/ember_atlas_30s.mp4`](video/ember_atlas_30s.mp4)
**▶ Slides (7):** [`slides/ember_atlas_slides.pdf`](slides/ember_atlas_slides.pdf) · [PowerPoint](slides/ember_atlas_slides.pptx)

Team **Ainexa** (Uzbekistan): Mikuu · Infectuz · BNull · Chimera · CyberScorpion
NASA Space Apps Challenge · challenge: *MODIS + VIIRS hot spots*

---

## The problem: two satellites, two rulers

| | MODIS | VIIRS |
|---|---|---|
| Flying since | 2000 | 2012 |
| Pixel size | 1 km | 375 m |
| Fires detected | fewer | about **4×** more (it sees smaller fires) |

Put the two records together as they are, and global fire seems to **quadruple overnight in 2012**. It never did: the instrument changed. Until the records are on one scale, nobody can honestly ask *"when does my area burn, and is this year unusual?"*

## The solution: one record, one scale

1. **392.6 million** detections (Nov 2000 – Dec 2025) from the NASA FIRMS archives. Vegetation fires only (no volcanoes, gas flares or factories), counted on a 0.5° grid every month.
2. For every **5° region and season**, we learn how many VIIRS detections one MODIS detection stands for, using the years both satellites flew. The years before VIIRS are then expressed in VIIRS-equivalent units.
3. **Honest test:** we fit on 2012–2018 only, then predicted VIIRS for 2019–2025 from MODIS alone.

| Held-out test, 2019–2025 | Raw MODIS | Ember Atlas |
|---|---|---|
| Monthly global error vs real VIIRS | 76 % | **7.4 %** |
| Regional fit, R² (log) | 0.50 | **0.81** |

## What you can do with it

| Mode | What it gives you |
|---|---|
| **History** | 25 years of fire on one scale. Play through time, or switch to *Raw* to see the 2012 jump disappear. |
| **Fire Calendar** | Pick a country, province or republic, or draw a box. You get a year × month **burning-activity calendar** with the **critical period**, a "get ready by" month, **unusual months** compared with that month's own normal, the trend, CSV download and a shareable link. |
| **Live** | Near-real-time fires from four satellites (VIIRS NOAA-20/21, MODIS Terra/Aqua). The same fire is **counted once**, and gas flares, volcanoes and industrial heat can be filtered out. Click a fire for the satellite picture of it. |
| **AI Forecast** | Chance of significant fire per 1° square for this month and next, **with an explanation**. Pick any area to see whether it looks **higher or lower than usual** and which provinces are most at risk. |

Example: **Uzbekistan** burns mostly **March–October** (90 % of a normal year's fire), so responders should be ready by **February**. July 2003 had three times the usual fire.

## The AI, in one table

XGBoost trained **locally** on 3.1 million cell-months: fire history, NASA POWER weather, wind, vegetation greenness (MODIS NDVI), land cover and forest loss. Tested on **2023–2025, years it never saw**:

| Test set | AI | "Same as usual" baseline |
|---|---|---|
| All cases · ROC-AUC | 0.954 | 0.936 |
| Unusual fires · ROC-AUC | 0.885 | 0.813 |
| Unusual fires · average precision | **0.314** | 0.181 → **+73 %** |

*Unusual fires* = places and months that burn in fewer than 30 % of years: the cases where early warning matters most.

## Run it yourself

```bash
# website (uses the data files already in site/public/data)
cd site
npm install
npm run dev          # → http://localhost:5173

# rebuild the data and the AI model (Python 3.10+, several hours, ~7 GB of downloads)
pip install duckdb pyarrow pandas numpy xgboost scikit-learn requests
./run_pipeline.sh
```

The server only hosts static files plus a small cached proxy for the NASA FIRMS live feeds. No AI runs on the server.

## Project layout

```
site/        the website (Vite + three.js); data files in site/public/data
pipeline/    Python: ingest → harmonize → weather → wind/forest/vegetation → train → export
video/       30-second demo video
slides/      7-slide presentation (PDF and PowerPoint)
run_pipeline.sh, forecast.sh   full rebuild / monthly forecast refresh
```

## Data

**NASA:** FIRMS MODIS C6.1 and VIIRS 375 m archives and near-real-time feeds · NASA POWER (MERRA-2) weather · MODIS NDVI and satellite imagery via NASA GIBS.
**Partners and others:** Hansen Global Forest Change (UMD/Google/USGS/NASA, CC BY 4.0) · ESA WorldCover 2021 (CC BY 4.0) · Copernicus Sentinel-2 via Microsoft Planetary Computer · EUMETSAT Meteosat imagery · VIIRS Nightfire gas flares, Earth Observation Group, Colorado School of Mines (CC BY-NC 4.0) · Smithsonian Global Volcanism Program · Natural Earth borders.

**Known gap:** the FIRMS standard archives end in December 2025, so January–October 2026 is not in History yet. A free FIRMS API key would fill it.

## Use of AI tools (SI)

We used **Claude (Anthropic)** as a coding and writing assistant: for the code in `site/` and `pipeline/`, the data-processing scripts, the documentation, the slides and the demo video. The video's narration is a **synthetic text-to-speech voice**; this is stated here and in the video file's metadata. The team chose the approach, checked the results and ran every step. The data is real NASA and partner data, not generated. No NASA logos or branding are used.
