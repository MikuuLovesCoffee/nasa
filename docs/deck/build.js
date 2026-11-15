// Ember Atlas hackathon deck. Every number is read from the project's result files at build time.
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");

const ROOT = "C:/Users/Zephyrus/nasa";
const IMG = `${ROOT}/docs/img`;
const OUT = `${ROOT}/docs/Ember_Atlas_pitch.pptx`;
const J = (p) => JSON.parse(fs.readFileSync(`${ROOT}/${p}`, "utf8"));
const meta = J("site/public/data/meta.json");
const cal = meta.calibration;
const fc = J("data/agg/forecast.json");
const M = fc.metrics;
const EXP = J("data/agg/experiments.json");
const LIVE = J("docs/img/live_counts.json"); // counts shown on the Live screenshot

const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n));
const pct = (x, d = 0) => (x * 100).toFixed(d) + "%";

// ---------- theme (dark, ember)
const THEME = {
  name: "Ember Atlas",
  headFontFace: "Arial",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "0B0D12", lt1: "F0EFEC", dk2: "151922", lt2: "C3C2B7",
    accent1: "F08A24", accent2: "D95926", accent3: "3987E5", accent4: "199E70", accent5: "38D1F0", accent6: "C084FC",
    hlink: "F08A24", folHlink: "D95926",
  },
};
const BG = "0B0D12", CARD = "151922", TXT = "F0EFEC", MUTED = "9A998F", EMBER = "F08A24", EMBER2 = "D95926";
const MODIS = "3987E5", VIIRS = "199E70";

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9"; // 10 x 5.625 in
pres.title = "Ember Atlas";
pres.author = "Ember Atlas team";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };

pres.defineSlideMaster({
  title: "EMBER_CONTENT",
  background: { color: BG },
  objects: [
    { text: { text: "Ember Atlas · NASA Space Apps", options: { x: 0.5, y: 5.25, w: 5, h: 0.25, fontSize: 9, color: "5E5D57", isTextBox: true } } },
  ],
  slideNumber: { x: 9.1, y: 5.25, w: 0.4, h: 0.25, fontSize: 9, color: "5E5D57" },
  placeholders: [
    { placeholder: { options: { name: "title", type: "title", x: 0.5, y: 0.35, w: 9, h: 0.7, fontSize: 28, bold: true, color: TXT, fontFace: "Arial", valign: "top" }, text: "" } },
  ],
});
pres.defineSlideMaster({ title: "EMBER_BLANK", background: { color: BG }, objects: [] });

let n = 0;
function slide(sectionTitle, title) {
  if (sectionTitle) pres.addSection({ title: sectionTitle });
  const s = pres.addSlide({ masterName: "EMBER_CONTENT", sectionTitle: sectionTitle || undefined });
  if (title) s.addText(title, { placeholder: "title" });
  n++;
  return s;
}
const T = (s, text, o) => s.addText(text, { isTextBox: true, fontFace: "Calibri", color: TXT, fontSize: 15, margin: 0, valign: "top", ...o });
function stat(s, x, y, w, big, small, color = EMBER, name = "stat") {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 1.15, fill: { color: CARD }, line: { color: "262B36", width: 0.75 }, rectRadius: 0.08, objectName: name + " card" });
  T(s, big, { x: x + 0.2, y: y + 0.12, w: w - 0.4, h: 0.55, fontSize: 30, bold: true, color, fontFace: "Arial", objectName: name + " value" });
  T(s, small, { x: x + 0.2, y: y + 0.68, w: w - 0.4, h: 0.4, fontSize: 11, color: MUTED, objectName: name + " label" });
}
function img(s, file, o) {
  const p = `${IMG}/${file}`;
  if (fs.existsSync(p)) s.addImage({ path: p, ...o });
  else s.addShape(pres.shapes.RECTANGLE, { ...o, fill: { color: CARD }, line: { color: "333333" } });
}
const best = (label) => EXP.runs.find((r) => r.label.startsWith(label));
const base = best("base (Day One");
const final = EXP.runs.find((r) => r.label.startsWith("final")) || base;
const noWx = best("base − weather");
const nowcast = best("base + nowcast");

// ---------- 1. Title
{
  pres.addSection({ title: "Opening" });
  const s = pres.addSlide({ masterName: "EMBER_BLANK", sectionTitle: "Opening" });
  img(s, "history_globe.jpg", { x: 4.6, y: 0, w: 5.4, h: 5.625, sizing: { type: "cover", w: 5.4, h: 5.625 } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 5.2, h: 5.625, fill: { color: BG }, line: { color: BG }, objectName: "title panel" });
  T(s, "EMBER ATLAS", { x: 0.6, y: 1.1, w: 4.4, h: 0.4, fontSize: 14, bold: true, color: EMBER, charSpacing: 4, fontFace: "Arial" });
  T(s, "One fire record, live fires, and an AI that learned from 25 years", { x: 0.6, y: 1.55, w: 4.4, h: 1.7, fontSize: 30, bold: true, fontFace: "Arial" });
  T(s, `${fmt(meta.stats.detections)} NASA satellite fire detections · ${meta.years[0]}–${meta.years.at(-1)} · on a 3D globe`, { x: 0.6, y: 3.45, w: 4.4, h: 0.6, fontSize: 14, color: "C3C2B7" });
  T(s, "nasa.mikuuloves.coffee", { x: 0.6, y: 4.6, w: 4.4, h: 0.3, fontSize: 12, color: MUTED });
  s.addNotes("Fire is one of the clearest signals of a changing planet, and NASA has watched it from orbit for 25 years. But the record is split across two generations of sensors. Ember Atlas joins them into one record, shows live fires from four satellites with real pictures, and uses 25 years of history, weather, forests and vegetation to forecast where significant fire is likely next.");
  n++;
}

// ---------- 2. The problem
{
  const s = slide("Problem", "Two satellites, two different fire counts");
  const years = meta.years.map(String);
  s.addChart(pres.charts.LINE, [
    { name: "Raw: whichever sensor is newest", labels: years, values: meta.global.naiveYear.map((v) => v / 1e6) },
    { name: "MODIS only", labels: years, values: meta.global.modisYear.map((v) => v / 1e6) },
  ], {
    x: 0.5, y: 1.2, w: 5.6, h: 3.8, chartColors: ["C3C2B7", MODIS], lineSize: 2, lineDataSymbol: "none",
    catAxisLabelColor: MUTED, valAxisLabelColor: MUTED, catAxisLabelFontSize: 9, valAxisLabelFontSize: 9,
    catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt",
    valGridLine: { color: "262B36", size: 0.5 }, catGridLine: { style: "none" },
    showLegend: true, legendPos: "b", legendColor: "C3C2B7", legendFontSize: 10, legendFontFace: "+mn-lt",
    showTitle: true, title: "Global detections per year (millions)", titleColor: TXT, titleFontSize: 12, titleFontFace: "+mn-lt",
    valAxisTitle: "", catAxisLabelFrequency: 4, objectName: "raw vs modis chart",
  });
  T(s, `VIIRS (375 m, from 2012) sees smaller fires than MODIS (1 km) and reports about ${cal.global_ratio.toFixed(1)}× more detections.`, { x: 6.4, y: 1.3, w: 3.1, h: 1.2, fontSize: 15 });
  T(s, "Stitch them together and fire seems to jump in 2012. Nothing happened on the ground.", { x: 6.4, y: 2.55, w: 3.1, h: 1.0, fontSize: 15, color: EMBER, bold: true });
  T(s, "A second gap: before mid-2002 only Terra flew, so MODIS alone undercounts by about 3×.", { x: 6.4, y: 3.65, w: 3.1, h: 1.0, fontSize: 13, color: "C3C2B7" });
  s.addNotes(`NASA's two fire sensor families measure differently. VIIRS has 375 metre pixels against MODIS's one kilometre, so it sees smaller fires and reports about ${cal.global_ratio.toFixed(1)} times more detections. If you just join the records, fire appears to jump in 2012 — a sensor artefact, not a real change. There is a second hidden gap: before Aqua launched in 2002, only Terra flew, so the earliest years are undercounted about three times.`);
}

// ---------- 3. The fix
{
  const s = slide("Method", "Our fix: teach MODIS to count like VIIRS");
  T(s, [
    { text: "Ratio VIIRS ÷ MODIS learned for every 5° block and season", options: { bullet: true, breakLine: true } },
    { text: "Sparse blocks pulled toward the global ratio (shrinkage)", options: { bullet: true, breakLine: true } },
    { text: "Terra-only months fixed with a (Terra + Aqua) ÷ Terra factor", options: { bullet: true, breakLine: true } },
    { text: `Honest test: fit on ${cal.fit_period}, predict VIIRS for ${cal.test_period} from MODIS`, options: { bullet: true } },
  ], { x: 0.5, y: 1.25, w: 4.6, h: 2.6, fontSize: 15, paraSpaceAfter: 8 });
  stat(s, 5.4, 1.25, 2.0, pct(cal.global_monthly_mape_regional, 1), "monthly global error, calibrated", EMBER, "error calibrated");
  stat(s, 7.55, 1.25, 1.95, pct(cal.global_monthly_mape_raw_modis), "error with raw MODIS", "8A8A8A", "error raw");
  stat(s, 5.4, 2.6, 2.0, cal.block_month_r2_log_regional.toFixed(2), "regional R² (log), calibrated", EMBER, "r2 calibrated");
  stat(s, 7.55, 2.6, 1.95, cal.block_month_r2_log_raw_modis.toFixed(2), "R² with raw MODIS", "8A8A8A", "r2 raw");
  T(s, "Result: one unit — “VIIRS-equivalent detections” — from 2000 to 2025.", { x: 0.5, y: 4.2, w: 9, h: 0.5, fontSize: 15, color: EMBER, bold: true });
  s.addNotes(`For every 5-degree block and season we learn how many VIIRS detections one MODIS detection is worth, using the overlap years. Where data is thin, we shrink toward the global ratio so noise doesn't create fake regional trends. Then we test it honestly: fit only on ${cal.fit_period}, and predict VIIRS for ${cal.test_period} from MODIS alone. Monthly global error drops from ${pct(cal.global_monthly_mape_raw_modis)} to ${pct(cal.global_monthly_mape_regional, 1)}.`);
}

// ---------- 4. One record
{
  const s = slide(null, "One record, 25 years, one unit");
  img(s, "history_globe.jpg", { x: 0.5, y: 1.15, w: 5.3, h: 3.85, sizing: { type: "cover", w: 5.3, h: 3.85 } });
  stat(s, 6.1, 1.15, 3.4, fmt(meta.stats.detections), "NASA detections, MODIS + VIIRS", EMBER, "detections");
  stat(s, 6.1, 2.45, 3.4, `${meta.years[0]}–${meta.years.at(-1)}`, "monthly, 0.5° grid", EMBER, "years");
  stat(s, 6.1, 3.75, 3.4, "≈15 MB", "whole history in the browser", EMBER, "size");
  s.addNotes(`Every one of the ${fmt(meta.stats.detections)} detections is cleaned — volcanoes, gas flares and industry removed — counted on a half-degree grid per month, and calibrated. The whole 25-year record is packed into about 15 megabytes, so you can scrub through time on the globe and click any place for its history and fire season.`);
}

// ---------- 5. Live
{
  const s = slide("Live", "Live: four satellites, and not everything hot is a fire");
  img(s, "live_categories.jpg", { x: 0.5, y: 1.15, w: 5.6, h: 3.85, sizing: { type: "cover", w: 5.6, h: 3.85 } });
  T(s, `On ${LIVE.date}, last 24 h:`, { x: 6.35, y: 1.15, w: 3.2, h: 0.3, fontSize: 13, color: MUTED });
  const rows = [["38D1F0", `${fmt(LIVE.flares)} gas flares`], ["C084FC", `${LIVE.volcanoes} volcanoes`], ["A9B0BD", `${fmt(LIVE.industrial)} industrial sites`]];
  rows.forEach(([c, t], i) => {
    s.addShape(pres.shapes.OVAL, { x: 6.35, y: 1.62 + i * 0.5, w: 0.22, h: 0.22, fill: { color: c }, line: { color: c }, objectName: "dot " + i });
    T(s, t, { x: 6.7, y: 1.57 + i * 0.5, w: 2.8, h: 0.35, fontSize: 16, bold: true });
  });
  T(s, "taken out of the fire count and drawn in their own colours.", { x: 6.35, y: 3.1, w: 3.2, h: 0.6, fontSize: 13, color: "C3C2B7" });
  T(s, "Sources: 25 years of NASA labels, 26,818 VIIRS Nightfire flare sites, 231 active volcanoes (Smithsonian).", { x: 6.35, y: 3.8, w: 3.2, h: 1.0, fontSize: 11, color: MUTED });
  s.addNotes(`Live mode merges NASA's near-real-time feeds from four satellites, so a fire seen three times counts once. But satellites see heat, not fire. In Fires-only mode we take out gas flares, volcanoes and factories — using 25 years of NASA labels, 26,818 VIIRS Nightfire flare sites and 231 active volcanoes — and draw them in their own colours. On ${LIVE.date} that was ${fmt(LIVE.flares)} flares, ${LIVE.volcanoes} volcanoes and ${fmt(LIVE.industrial)} industrial sites in one day.`);
}

// ---------- 6. See it burning
{
  const s = slide(null, "See it burning: real satellite pictures");
  const cols = [
    ["fire_moment_kalimantan_crop.jpg", "The pass that saw it", "Same satellite, same day (NASA GIBS)"],
    ["meteosat_iodc_uzbekistan.png", "Every 15 minutes", "Meteosat over Central Asia (EUMETSAT)"],
    ["sentinel2_fireview_sirdaryo_2026-10-25.png", "10–20 m “fire view”", "Sentinel-2 infrared, burn scars dark"],
  ];
  cols.forEach(([f, h, c], i) => {
    const x = 0.5 + i * 3.05;
    img(s, f, { x, y: 1.15, w: 2.85, h: 2.6, sizing: { type: "cover", w: 2.85, h: 2.6 } });
    T(s, h, { x, y: 3.85, w: 2.85, h: 0.35, fontSize: 15, bold: true, color: EMBER });
    T(s, c, { x, y: 4.2, w: 2.85, h: 0.5, fontSize: 12, color: "C3C2B7" });
  });
  s.addNotes("Click any fire and you see it. First, the true-colour photo from the very satellite pass that detected it. Second, a loop of the last hours from weather satellites that image every 10 to 15 minutes — Meteosat for Central Asia, GOES for the Americas, Himawari for Asia-Pacific — where smoke plumes move. Third, a sharp Sentinel-2 'fire view' at 10 to 20 metres, before and after, where burn scars show dark. All free, loaded straight from NASA, EUMETSAT and ESA in the browser.");
}

// ---------- 7. The AI inputs
{
  const s = slide("AI", "What the AI looks at — and never peeks at the future");
  const groups = [
    ["Fire history", "How often this place burned in this month in earlier years, how big, last year, years since the last fire"],
    ["Weather", "NASA POWER: heat, rain, humidity, wind, soil moisture, drought memory, vapour-pressure deficit"],
    ["Similar-weather years", "When the weather looked like this before, did it burn? (analog score)"],
    ["Forest & vegetation", "Forest loss (Hansen), land cover (ESA WorldCover), greenness vs normal (MODIS NDVI)"],
  ];
  groups.forEach(([h, d], i) => {
    const x = 0.5 + (i % 2) * 4.6, y = 1.2 + Math.floor(i / 2) * 1.55;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: 4.4, h: 1.35, fill: { color: CARD }, line: { color: "262B36", width: 0.75 }, rectRadius: 0.08, objectName: "group " + i });
    s.addShape(pres.shapes.OVAL, { x: x + 0.2, y: y + 0.22, w: 0.32, h: 0.32, fill: { color: EMBER }, line: { color: EMBER }, objectName: "group dot " + i });
    T(s, h, { x: x + 0.65, y: y + 0.18, w: 3.6, h: 0.4, fontSize: 16, bold: true });
    T(s, d, { x: x + 0.65, y: y + 0.58, w: 3.6, h: 0.7, fontSize: 12, color: "C3C2B7" });
  });
  T(s, "Every input uses only what was known at the end of the month before. Train 2002–2020 · tune on 2021–22 · test on 2023–25, years the model never saw.", { x: 0.5, y: 4.4, w: 9, h: 0.6, fontSize: 13, color: EMBER });
  s.addNotes("For every 1-degree square and month we ask: will significant fire happen? The model sees the place's fire history, last month's weather and how unusual it was, our 'similar-weather years' score — when the weather looked like this before, did it burn — and new forest and vegetation inputs. The key rule: every input uses only what was known at the end of the previous month, and we test on 2023 to 2025, years the model never saw.");
}

// ---------- 8. Results (ablation)
{
  const s = slide(null, "Proof: each input group tested on years the model never saw");
  const runs = EXP.runs.filter((r) => !r.label.includes("all new") && !r.label.includes("− analog"));
  const lab = runs.map((r) => r.label.replace(" (Day One model)", " (Day One)").replace(" (selected on validation)", ""));
  s.addChart(pres.charts.BAR, [{ name: "Unusual-fire precision", labels: [...lab, "“same as usual”"], values: [...runs.map((r) => r.test.unusual_ap), EXP.baseline_same_as_usual.test.unusual_ap] }], {
    x: 0.5, y: 1.15, w: 5.9, h: 3.9, barDir: "bar", chartColors: [EMBER2],
    showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "0.000", dataLabelColor: TXT, dataLabelFontSize: 9, dataLabelFontFace: "+mn-lt",
    catAxisLabelColor: "C3C2B7", valAxisLabelColor: MUTED, catAxisLabelFontSize: 9, valAxisLabelFontSize: 8, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt",
    valGridLine: { color: "262B36", size: 0.5 }, catGridLine: { style: "none" }, showLegend: false, catAxisOrientation: "maxMin",
    showTitle: true, title: "Average precision on unusual fires, test 2023–2025", titleColor: TXT, titleFontSize: 11, titleFontFace: "+mn-lt", objectName: "ablation chart",
  });
  const gain = (final.test.unusual_ap / base.test.unusual_ap - 1) * 100;
  const vsUsual = (final.test.unusual_ap / EXP.baseline_same_as_usual.test.unusual_ap - 1) * 100;
  stat(s, 6.7, 1.15, 2.8, final.test.unusual_ap.toFixed(3), `unusual-fire precision, final model (Day One: ${base.test.unusual_ap.toFixed(3)})`, EMBER, "final uap");
  stat(s, 6.7, 2.45, 2.8, `+${vsUsual.toFixed(0)}%`, "more precise than “same as usual” on unusual fires", EMBER, "vs usual");
  stat(s, 6.7, 3.75, 2.8, final.test.auc.toFixed(3), `ROC-AUC, all cases (Day One ${base.test.auc.toFixed(3)})`, EMBER, "auc");
  s.addNotes(`We don't just add data and hope. Each input group is added alone, with the same settings and seed, and kept only if it improves the 2021-22 validation years; the final numbers are on 2023-25, never seen. Removing weather drops unusual-fire precision from ${base.test.unusual_ap.toFixed(3)} to ${noWx.test.unusual_ap.toFixed(3)}, so weather matters. The final model reaches ${final.test.unusual_ap.toFixed(3)} on unusual fires — ${gain >= 0 ? "+" : ""}${gain.toFixed(0)}% over the Day One model and ${vsUsual.toFixed(0)}% more precise than simply assuming 'same as usual'.${nowcast ? ` Knowing last month's fires would push it to ${nowcast.test.unusual_ap.toFixed(3)}, which is why filling 2026 history is our top next step.` : ""}`);
}

// ---------- 9. Explainability
{
  const s = slide(null, "Every forecast explains itself");
  img(s, "ai_card.jpg", { x: 0.5, y: 1.15, w: 5.3, h: 3.85, sizing: { type: "cover", w: 5.3, h: 3.85 } });
  const ex = JSON.parse(fs.readFileSync(`${IMG}/ai_card.json`, "utf8"));
  T(s, ex.place, { x: 6.1, y: 1.15, w: 3.4, h: 0.4, fontSize: 18, bold: true, color: EMBER });
  T(s, `${ex.month}: ${ex.prob} chance of significant fire`, { x: 6.1, y: 1.6, w: 3.4, h: 0.6, fontSize: 14 });
  T(s, ex.lines.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < ex.lines.length - 1 } })), { x: 6.1, y: 2.3, w: 3.4, h: 2.6, fontSize: 12, color: "C3C2B7", paraSpaceAfter: 6 });
  s.addNotes(`Every square explains itself. Here, ${ex.place}: ${ex.prob} for ${ex.month}. The card shows how often it burned in that month before, the weather going in, the past years with the most similar weather and whether they burned, the land and vegetation, and SHAP bars that show which inputs pushed the prediction up or down.`);
}

// ---------- 10. How it runs
{
  const s = slide("Build", "How it runs: free data, local AI, static website");
  const steps = [["NASA & ESA data", "FIRMS, POWER, MODIS NDVI, Hansen, WorldCover"], ["Local PC", "calibrate, train XGBoost, test, explain"], ["Static files", "≈15 MB history + forecast + tiles"], ["Browser", "3D globe; live feeds + satellite pictures loaded directly"]];
  steps.forEach(([h, d], i) => {
    const x = 0.5 + i * 2.32;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.6, w: 2.05, h: 1.9, fill: { color: CARD }, line: { color: "262B36", width: 0.75 }, rectRadius: 0.08, objectName: "step " + i });
    T(s, String(i + 1), { x: x + 0.2, y: 1.75, w: 0.5, h: 0.5, fontSize: 24, bold: true, color: EMBER, fontFace: "Arial" });
    T(s, h, { x: x + 0.2, y: 2.3, w: 1.7, h: 0.4, fontSize: 15, bold: true });
    T(s, d, { x: x + 0.2, y: 2.72, w: 1.7, h: 0.75, fontSize: 11, color: "C3C2B7" });
    if (i < 3) s.addShape(pres.shapes.RIGHT_TRIANGLE, { x: x + 2.1, y: 2.45, w: 0.15, h: 0.2, fill: { color: EMBER }, line: { color: EMBER }, rotate: 90, objectName: "arrow " + i });
  });
  T(s, "No AI runs on the server and no API keys are needed: anyone can reproduce it from free public data.", { x: 0.5, y: 3.9, w: 9, h: 0.6, fontSize: 15, color: EMBER });
  s.addNotes("Everything comes from free public data. The heavy work — calibration, training, testing and explanations — runs on one PC. The website is just static files plus a cached proxy for NASA's live feeds. Satellite pictures load straight from NASA, EUMETSAT and ESA in the visitor's browser. No API keys, no AI on the server: anyone can reproduce it.");
}

// ---------- 11. Limits & next
{
  const s = slide("Close", "Honest limits, and what comes next");
  const lim = ["1° squares (~110 km): risk per region, not per field", "Mostly predicts “the usual”; unusual fires remain hard", "History ends Dec 2025 (FIRMS archives)", "Clouds hide fires in normal photos; free imagery is daily or sharp, not both"];
  const next = [`Fill 2026 with a FIRMS MAP_KEY → “last month's fire” input${nowcast ? ` (unusual precision ${nowcast.test.unusual_ap.toFixed(3)} in tests)` : ""}`, "Finer grid (0.25°) where data allows", "Fire-danger alerts by email/Telegram per viloyat", "FireSat-class small-fire satellites as they come online"];
  [["Limits", lim, "C3C2B7"], ["Next", next, EMBER]].forEach(([h, items, c], i) => {
    const x = 0.5 + i * 4.6;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.2, w: 4.4, h: 3.7, fill: { color: CARD }, line: { color: "262B36", width: 0.75 }, rectRadius: 0.08, objectName: h + " card" });
    T(s, h, { x: x + 0.25, y: 1.35, w: 3.9, h: 0.45, fontSize: 18, bold: true, color: c });
    T(s, items.map((t, k) => ({ text: t, options: { bullet: true, breakLine: k < items.length - 1 } })), { x: x + 0.25, y: 1.9, w: 3.9, h: 2.9, fontSize: 14, paraSpaceAfter: 8 });
  });
  s.addNotes("We are honest about limits: one-degree squares give regional risk, not field-level; most of the skill is knowing the usual season; our history stops at December 2025; and clouds hide fires in normal photos. Next: a FIRMS key to fill 2026, which our tests show is the single biggest boost; a finer grid; alerts per province; and new small-fire satellites like FireSat as they come online.");
}

// ---------- 12. Thank you
{
  const s = pres.addSlide({ masterName: "EMBER_BLANK", sectionTitle: "Close" });
  img(s, "live_categories.jpg", { x: 0, y: 0, w: 10, h: 5.625, sizing: { type: "cover", w: 10, h: 5.625 }, transparency: 70 });
  T(s, "Thank you", { x: 0.6, y: 1.4, w: 8.8, h: 0.9, fontSize: 40, bold: true, fontFace: "Arial" });
  T(s, "nasa.mikuuloves.coffee", { x: 0.6, y: 2.35, w: 8.8, h: 0.5, fontSize: 20, color: EMBER, bold: true });
  T(s, "Data: NASA FIRMS (MODIS, VIIRS) · NASA POWER · NASA MODIS NDVI via GIBS · Hansen Global Forest Change (CC BY 4.0) · ESA WorldCover (CC BY 4.0) · VIIRS Nightfire, Colorado School of Mines (CC BY-NC 4.0) · Smithsonian GVP · EUMETSAT · Copernicus Sentinel-2 via Microsoft Planetary Computer · Natural Earth",
    { x: 0.6, y: 3.6, w: 8.8, h: 1.2, fontSize: 11, color: "C3C2B7" });
  s.addNotes("Thank you. The site is live at nasa.mikuuloves.coffee — try clicking your own region. All data credits are on this slide.");
  n++;
}

pres.writeFile({ fileName: OUT }).then(async () => {
  try {
    const { applyTheme } = require("C:/Users/Zephyrus/.claude/skills/synced/3b9a0c09-6b9f-466c-a355-191764cef67d_0328f474-51e2-41bb-901b-de46dfe92703/pptx/scripts/apply_theme.js");
    await applyTheme(OUT, THEME);
  } catch (e) { console.log("theme not applied:", e.message); }
  console.log("wrote", OUT, n, "slides");
});
