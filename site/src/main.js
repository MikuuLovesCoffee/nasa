import * as THREE from "three";
import { Globe, RAMPS } from "./globe.js";
import { lineChart, barChart, sparkline, fmt, showTip, hideTip } from "./charts.js";
import {
  loadMeta, loadHistory, aggregate, loadCell, loadForecast, loadLive, LIVE_SOURCES,
  cell05ToLatLon, cell1ToLatLon, latLonToCell1, latLonToCell05, ymLabel, COLS05, dataVersion,
} from "./data.js";
import { LABS } from "./labs/registry.js";
import { placeAt, regionsInSquare } from "./places.js";
import { MON, areaIndex, resolveArea, areaWeights, areaSeries, areaKm2, analyse, runLabel, cellColor, HEAT, DIV, toCSV, provKey } from "./calendar.js";
import {
  passImage, geoFrames, dailyStrip, s2Scene, s2Url, worldviewLink, copernicusLink, smokeGlobeUrl, SMOKE_LAYERS, isoDay, fmtUTC,
} from "./imagery.js";

const $ = (s) => document.querySelector(s);
const C = { harm: "#d95926", modis: "#3987e5", viirs: "#199e70" };
// hidden non-fire heat, by mask kind (pipeline/static_mask.py): layer, ramp, legend colour, label
const HIDDEN = [
  { kind: 2, layer: "liveFlare", ramp: "flare", color: "#38d1f0", label: "gas flares" },
  { kind: 1, layer: "liveVolc", ramp: "volcano", color: "#c084fc", label: "volcanoes" },
  { kind: 3, layer: "liveI", ramp: "industrial", color: "#a9b0bd", label: "industrial sites" },
];
const RISK = [
  { max: 0.1, name: "Low", color: "#3a3f4a" },
  { max: 0.25, name: "Moderate", color: "#c98500" },
  { max: 0.5, name: "High", color: "#e66a2c" },
  { max: 0.75, name: "Very high", color: "#ff4d5e" },
  { max: 1.01, name: "Extreme", color: "#ff2d6f" },
];
const riskClass = (p) => RISK.find((r) => p < r.max);
const fmtLat = (lat, lon) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
const fmtExact = (lat, lon) => `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? "E" : "W"}`;
const fmtDeg = (v, pos, neg) => `${Math.abs(v)}°${v >= 0 ? pos : neg}`;
const pct = (p) => `${Math.round(p * 100)}%`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const prettyCountry = (s) => (s || "").replace(/_/g, " ");

const state = { mode: "history", step: "year", src: "harm", idx: 0, playing: false, current: null, live: null, liveRange: "24h", liveColor: "unified", liveFilter: readLiveFilter(), fcMonth: 1, fcOverlay: false, smoke: "off", aoi: readAoiParam(), calColor: "activity", pick: "province", boxStart: null, calMonth: null, fcAoi: null, fcPick: "cell", fcBoxStart: null, fcA: null, lab: null, labId: null, prevMode: "history" };
let globe, meta, hist, forecast;

// ---------------------------------------------------------------- boot
async function boot() {
  globe = new Globe($("#globe"));
  globe.loadBorders("/textures/countries-50m.json");
  meta = await loadMeta();
  hist = await loadHistory((f) => {
    $("#loader .loader-text").textContent = `Loading 25 years of fire data… ${Math.round(f * 100)}%`;
  }, meta.historyBytes);
  forecast = await loadForecast();
  meta.yearIdx = meta.years.map((y) => {
    const a = meta.months.findIndex((m) => Math.floor(m / 100) === y);
    const b = meta.months.length - 1 - [...meta.months].reverse().findIndex((m) => Math.floor(m / 100) === y);
    return [a, b];
  });
  // colour scale references (99th percentile, log space) per time step
  const peakYear = meta.global.harmYear.indexOf(Math.max(...meta.global.harmYear));
  meta.ref = { year: refFor(meta.yearIdx[peakYear]), month: null };
  const peakMonth = meta.global.harm.indexOf(Math.max(...meta.global.harm));
  meta.ref.month = refFor([peakMonth, peakMonth]);

  if (import.meta.env.DEV) window.__ember = { meta, hist, globe, state, openCell: (lat, lon) => openCell(lat, lon), setMode: (m) => setMode(m), setArea: (a) => setArea(a) };
  bindUI();
  setStep("year", true);
  state.idx = meta.years.length - 1;
  const qm = new URLSearchParams(location.search).get("mode");
  const ql = new URLSearchParams(location.search).get("lab");
  if (qm === "forecast" && state.aoi) state.fcAoi = state.aoi;
  if (ql && LABS.some((l) => l.id === ql && l.load)) { const lp = new URLSearchParams(location.search); state.aoi = null; setMode("history"); openLab(ql, lp); }
  else setMode(["history", "calendar", "live", "forecast"].includes(qm) ? qm : state.aoi ? "calendar" : "history");
  $("#loader").classList.add("done");
}

function refFor([a, b]) {
  const vals = [...aggregate(hist, a, b).values()].map((v) => v[0]).sort((x, y) => x - y);
  return Math.log1p(vals[Math.floor(vals.length * 0.995)] || 1);
}

// ---------------------------------------------------------------- UI wiring
function bindUI() {
  document.querySelectorAll(".modes button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  document.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => setStep(b.dataset.step)));
  document.querySelectorAll("[data-src]").forEach((b) => b.addEventListener("click", () => {
    state.src = b.dataset.src;
    document.querySelectorAll("[data-src]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    renderHistory();
  }));
  $("#tl-range").addEventListener("input", (e) => { state.idx = +e.target.value; renderHistory(); });
  $("#play").addEventListener("click", togglePlay);
  $("#cell-close").addEventListener("click", closeCell);
  $("#panel-handle").addEventListener("click", () => $("#panel").classList.toggle("open"));
  $("#btn-about").addEventListener("click", openAbout);
  $("#labs-btn").addEventListener("click", openLabsMenu);
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" && e.target.type !== "range") return;
    if (e.key === "Escape") closeCell();
    if (state.mode !== "history") return;
    if (e.key === " ") { e.preventDefault(); togglePlay(); }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      if (e.target.id === "tl-range") return;
      state.idx = Math.max(0, Math.min(+$("#tl-range").max, state.idx + (e.key === "ArrowRight" ? 1 : -1)));
      renderHistory();
    }
  });
  globe.on("click", (ll) => {
    if (!ll) return;
    if (state.mode === "lab") { state.lab?.onClick?.(ll); return; }
    if (state.mode === "calendar") calendarClick(ll);
    else if (state.mode === "forecast" && state.fcPick !== "cell") forecastClick(ll);
    else openCell(ll.lat, ll.lon);
  });
  globe.on("hover", onHover);
}

function setMode(mode) {
  if (state.lab) leaveLab();
  state.mode = mode;
  document.body.classList.remove("in-lab");
  document.querySelectorAll(".modes button").forEach((b) => b.setAttribute("aria-selected", b.dataset.mode === mode));
  stopPlay();
  globe.hideAll();
  globe.setOutline(null);
  $("#panel").classList.toggle("wide", mode === "calendar" || (mode === "forecast" && !!state.fcAoi));
  $("#timeline").classList.toggle("hidden", mode !== "history");
  globe.setMarker(null);
  state.boxStart = state.fcBoxStart = null;
  writeAoiUrl();
  if (mode === "calendar") { closeCell(); applySmoke(); renderCalendar(); return; }
  if (mode === "history") renderHistory();
  if (mode === "live") renderLive();
  if (mode === "forecast") renderForecast();
  applySmoke();
  if (state.cell) openCell(state.cell.lat, state.cell.lon, false);
}

function setStep(step, silent) {
  const prev = state.step;
  state.step = step;
  document.querySelectorAll("[data-step]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.step === step));
  const range = $("#tl-range");
  if (step === "year") {
    range.max = meta.years.length - 1;
    if (prev === "month") state.idx = meta.years.indexOf(Math.floor(meta.months[state.idx] / 100));
    sparkline($("#tl-spark"), meta.years.map((_, i) => meta.global.harmYear[i]));
  } else {
    range.max = meta.months.length - 1;
    if (prev === "year" && !silent) state.idx = meta.yearIdx[state.idx][0] + 7;
    sparkline($("#tl-spark"), meta.global.harm);
  }
  state.idx = Math.max(0, Math.min(+range.max, state.idx));
  if (!silent) renderHistory();
}

function togglePlay() { state.playing ? stopPlay() : startPlay(); }
function startPlay() {
  state.playing = true;
  $("#play-icon").setAttribute("d", "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z");
  $("#play").setAttribute("aria-label", "Pause");
  const max = +$("#tl-range").max;
  if (state.idx >= max) state.idx = 0;
  const tick = () => {
    if (!state.playing) return;
    state.idx = state.idx >= max ? 0 : state.idx + 1;
    renderHistory(true);
    state.timer = setTimeout(tick, state.step === "year" ? 900 : 260);
  };
  state.timer = setTimeout(tick, 200);
}
function stopPlay() {
  state.playing = false;
  clearTimeout(state.timer);
  $("#play-icon").setAttribute("d", "M8 5v14l11-7z");
  $("#play").setAttribute("aria-label", "Play");
}

// ---------------------------------------------------------------- hover
function onHover(ll, e) {
  if (state.mode === "lab") { if (state.lab?.onHover) state.lab.onHover(ll, e); else hideTip(); return; }
  if (!ll) { hideTip(); return; }
  let html = null;
  if (state.mode === "history" && state.current) {
    const v = state.current.get(latLonToCell05(ll.lat, ll.lon));
    if (v) {
      html = `<b>${fmtLat(ll.lat, ll.lon)}</b><div class="row"><span>Unified (VIIRS-eq.)</span><span>${fmt(v[0])}</span></div>`;
      if (v[1]) html += `<div class="row"><span><i class="sw" style="background:${C.modis}"></i>MODIS raw</span><span>${fmt(v[1])}</span></div>`;
      if (v[2]) html += `<div class="row"><span><i class="sw" style="background:${C.viirs}"></i>VIIRS raw</span><span>${fmt(v[2])}</span></div>`;
    }
  } else if (state.mode === "calendar") {
    html = state.pick === "box" ? `<b>${fmtLat(ll.lat, ll.lon)}</b><div class="muted small">${state.boxStart ? "Click the opposite corner" : "Click the first corner of the box"}</div>` : `<div class="muted small">Click to pick this ${state.pick}</div>`;
  } else if (state.mode === "forecast" && forecast) {
    const f = forecast.byCell?.get(latLonToCell1(ll.lat, ll.lon));
    const pk = state.fcPick;
    const hint = pk === "cell" ? "Click for why" : pk === "box" ? (state.fcBoxStart ? "Click the opposite corner" : "Click the first corner of the box") : `Click for this ${pk}'s forecast`;
    if (f) {
      const p = f[1 + state.fcMonth] / 1000, rc = riskClass(p);
      html = `<b>${fmtLat(ll.lat, ll.lon)}</b><div class="row"><span><i class="sw" style="background:${rc.color}"></i>${rc.name} risk</span><span>${pct(p)}</span></div><div class="muted small">${hint}</div>`;
    } else if (pk !== "cell") html = `<b>${fmtLat(ll.lat, ll.lon)}</b><div class="muted small">${hint}</div>`;
  }
  if (html) { showTip(html, e.clientX, e.clientY); $("#globe").style.cursor = "pointer"; }
  else { hideTip(); $("#globe").style.cursor = ""; }
}

// ---------------------------------------------------------------- HISTORY
function periodRange() {
  return state.step === "year" ? meta.yearIdx[state.idx] : [state.idx, state.idx];
}
function periodLabel() {
  return state.step === "year" ? String(meta.years[state.idx]) : ymLabel(meta.months[state.idx]);
}

function renderHistory(fromPlay) {
  if (state.mode !== "history") return;
  $("#tl-range").value = state.idx;
  $("#tl-label").textContent = periodLabel();
  const [a, b] = periodRange();
  const agg = aggregate(hist, a, b);
  state.current = agg;
  const ref = state.step === "year" ? meta.ref.year : meta.ref.month;
  const n = agg.size;
  if (state.src === "harm") {
    const lats = new Float32Array(n), lons = new Float32Array(n), vals = new Float32Array(n);
    let i = 0;
    for (const [c, v] of agg) {
      const ll = cell05ToLatLon(c);
      lats[i] = ll.lat; lons[i] = ll.lon; vals[i] = Math.min(1, Math.log1p(v[0]) / ref); i++;
    }
    globe.hideLayer("modis"); globe.hideLayer("viirs");
    globe.setPoints("hist", { lats, lons, values: vals, ramp: "heat", size: 0.0105, minSize: 0.3, opacity: 0.95, soft: 0.35, blending: THREE.NormalBlending });
  } else {
    // raw: each sensor drawn separately in its own colour, uncalibrated
    globe.hideLayer("hist");
    for (const [k, idx, off] of [["modis", 1, -0.12], ["viirs", 2, 0.12]]) {
      const pts = [...agg].filter(([, v]) => v[idx] > 0);
      const lats = new Float32Array(pts.length), lons = new Float32Array(pts.length), vals = new Float32Array(pts.length);
      pts.forEach(([c, v], i) => {
        const ll = cell05ToLatLon(c);
        lats[i] = ll.lat; lons[i] = ll.lon + off; vals[i] = Math.min(1, Math.log1p(v[idx]) / ref);
      });
      if (pts.length) globe.setPoints(k, { lats, lons, values: vals, ramp: k, size: 0.008, minSize: 0.3, opacity: 0.9, soft: 0.35, blending: THREE.NormalBlending });
      else globe.hideLayer(k);
    }
  }
  if (!fromPlay || state.step === "year" || state.idx % 3 === 0) historyPanel(agg);
}

function historyPanel(agg) {
  const year = state.step === "year" ? meta.years[state.idx] : Math.floor(meta.months[state.idx] / 100);
  const yi = meta.years.indexOf(year);
  let tot = 0, totM = 0, totV = 0;
  for (const v of agg.values()) { tot += v[0]; totM += v[1]; totV += v[2]; }
  const avg = meta.global.harmYear.reduce((s, v) => s + v, 0) / meta.years.length;
  const yearTot = meta.global.harmYear[yi];
  const ranks = meta.countries.map((c) => ({ name: c.name, v: c.yearly[yi] })).sort((x, y) => y.v - x.v).slice(0, 8);
  const cal = meta.calibration;
  const sensorsNote = year < 2012
    ? `Only <b>MODIS</b> existed in ${year}. Its counts are converted to VIIRS-equivalent with region × season ratios learned from 2012–2025, when both sensors flew together.`
    : `<b>VIIRS</b> (375 m) is the reference from 2012. MODIS (1 km) still flies and is shown in <b>Raw</b> mode for comparison.`;

  $("#panel-body").innerHTML = `
    <p class="eyebrow">Fire history</p>
    <h2>${periodLabel()}</h2>
    <p class="lede">${sensorsNote}</p>
    <div class="stats">
      <div class="stat"><div class="v">${fmt(tot)}</div><div class="k">Fire detections, VIIRS-equivalent</div></div>
      <div class="stat"><div class="v">${fmt(agg.size)}</div><div class="k">Burning 0.5° cells</div></div>
      ${state.step === "year" ? `<div class="stat"><div class="v">${yearTot > avg ? "+" : ""}${Math.round((yearTot / avg - 1) * 100)}%</div><div class="k">vs ${meta.years[0] + 1}–${meta.years.at(-1)} average</div></div>` : ""}
      <div class="stat"><div class="v">${totM ? fmt(totM) : "–"} / ${totV ? fmt(totV) : "–"}</div><div class="k">Raw MODIS / VIIRS</div></div>
    </div>
    <h3>One record, not two</h3>
    <div id="ch-global"></div>
    <div class="callout">Plotting raw detections makes fire look like it <b>jumped ~${Math.round(cal.global_ratio * 10) / 10}×</b> in 2012 — that's just VIIRS seeing smaller fires. The unified line removes that artefact. Held-out test (${cal.test_period}): error vs real VIIRS drops from <b>${Math.round(cal.global_monthly_mape_raw_modis * 100)}%</b> (raw MODIS) to <b>${Math.round(cal.global_monthly_mape_regional * 100)}%</b>.</div>
    <h3>Most active countries · ${year}</h3>
    <ul class="rank">${ranks.map((r, i) => `<li data-country="${esc(r.name)}"><span class="i">${i + 1}</span><span>${esc(prettyCountry(r.name))}<div class="bar" style="width:${(r.v / ranks[0].v) * 100}%"></div></span><span class="n">${fmt(r.v)}</span></li>`).join("")}</ul>
    <details class="table-view"><summary>Table view</summary>${yearTable()}</details>
  `;
  const naive = meta.years.map((_, i) => meta.global.naiveYear[i]);
  lineChart($("#ch-global"), {
    labels: meta.years.map(String),
    series: [
      { name: "Raw, whichever sensor", color: "#8b8a83", values: naive, width: 1.5 },
      { name: "MODIS only", color: C.modis, values: meta.global.modisYear, width: 1.5 },
      { name: "Unified (VIIRS-eq.)", color: C.harm, values: meta.global.harmYear },
    ],
    xTicks: (i, l) => (i % 5 === 0 || i === meta.years.length - 1 ? l : null),
    marker: yi,
    onPick: (i) => { setStep("year", true); state.idx = i; renderHistory(); },
    height: 150,
  });
  document.querySelectorAll(".rank li").forEach((li) => li.addEventListener("click", () => {
    const c = meta.countryCenters[li.dataset.country];
    if (c) globe.flyTo(c[0], c[1], 2.2);
  }));
}

function yearTable() {
  return `<table class="data"><tr><th>Year</th><th>Unified</th><th>MODIS</th><th>VIIRS</th></tr>${meta.years.map((y, i) => `<tr><td>${y}</td><td>${fmt(meta.global.harmYear[i])}</td><td>${fmt(meta.global.modisYear[i])}</td><td>${meta.global.viirsYear[i] ? fmt(meta.global.viirsYear[i]) : "–"}</td></tr>`).join("")}</table>`;
}

// ---------------------------------------------------------------- LABS ("wanna see cool shiyt")
// Mini-apps for other Space Apps challenges. Each lab is its own code chunk, loaded on demand; it
// borrows the globe and the side panel and gives them back on exit.
function openLabsMenu() {
  const d = $("#labs");
  $("#labs-body").innerHTML = `
    <p class="eyebrow">Labs · other NASA Space Apps 2026 challenges</p>
    <h2>Wanna see cool shiyt?</h2>
    <p class="lede small">Six mini-apps built on the same globe. The fire atlas stays exactly as it is; a lab only loads when you open it.</p>
    <div class="lab-grid">${LABS.map((l) => `
      <button class="lab-card" data-lab="${l.id}" ${l.load ? "" : "disabled"}>
        <span class="lab-level ${l.level.toLowerCase()}">${l.level}</span>
        <b>${esc(l.title)}</b>
        <span>${esc(l.blurb)}</span>
        <i>${l.load ? "Open →" : "Coming soon"}</i>
      </button>`).join("")}</div>`;
  d.querySelectorAll("[data-lab]").forEach((b) => b.addEventListener("click", () => { d.close(); openLab(b.dataset.lab); }));
  d.showModal();
}

function labParams(p) {
  try {
    const u = new URL(location.href);
    for (const k of [...u.searchParams.keys()]) if (!["lab", "v"].includes(k)) u.searchParams.delete(k);
    u.searchParams.set("lab", state.labId);
    for (const [k, v] of Object.entries(p || {})) if (v != null && v !== "") u.searchParams.set(k, v); else u.searchParams.delete(k);
    history.replaceState(null, "", u);
  } catch {}
}

async function openLab(id, initParams) {
  const def = LABS.find((l) => l.id === id);
  if (!def?.load) return;
  if (state.lab) leaveLab();
  if (state.mode !== "lab") state.prevMode = state.mode;
  stopPlay(); closeCell(); hideTip();
  globe.hideAll(); globe.setOutline(null); globe.setMarker(null);
  state.mode = "lab"; state.labId = id;
  document.body.classList.add("in-lab");
  document.querySelectorAll(".modes button").forEach((b) => b.setAttribute("aria-selected", "false"));
  $("#timeline").classList.add("hidden");
  $("#panel").classList.add("wide", "open");
  $("#panel-body").innerHTML = `<p class="eyebrow">Labs</p><h2>Loading ${esc(def.title)}…</h2>`;
  const params = initParams || new URLSearchParams();
  labParams({});
  const mod = (await def.load()).default;
  if (state.labId !== id) return;
  state.lab = mod;
  await mod.enter({
    globe, blend: { normal: THREE.NormalBlending, additive: THREE.AdditiveBlending }, panel: $("#panel-body"), meta, hist, forecast, v: dataVersion(),
    h: { fmt, esc, showTip, hideTip, ymLabel, prettyCountry },
    area: { areaIndex, resolveArea, areaWeights, areaKm2, placeAt, provKey },
    setParams: labParams,
    liveFires: async () => { if (!state.live) state.live = await loadLive(state.liveRange); return state.live.firesUnified; },
    back: () => setMode(state.prevMode || "history"),
  }, params);
}

function leaveLab() {
  try { state.lab?.exit?.(); } catch (e) { console.error(e); }
  state.lab = null; state.labId = null;
  globe.hideAll(); globe.setOutline(null); globe.setMarker(null); globe.setDataCanvas(null); hideTip();
  if (globe.bodyKind) globe.setBody(null); // a Moon / Mars lab hands the Earth back
  document.querySelectorAll("div[data-lab-veil]").forEach((v) => (v.style.opacity = "0"));
  try { const u = new URL(location.href); for (const k of [...u.searchParams.keys()]) u.searchParams.delete(k); history.replaceState(null, "", u); } catch {}
}

// ---------------------------------------------------------------- FIRE CALENDAR (area of interest)
// URL: ?mode=calendar&area=country:Uzbekistan | province:<iso>|<name> | box:lat0,lon0,lat1,lon1
function readAoiParam() {
  const q = new URLSearchParams(location.search).get("area");
  if (!q) return null;
  const i = q.indexOf(":"), kind = q.slice(0, i), v = q.slice(i + 1);
  if (kind === "box" || kind === "square") {
    const b = v.split(",").map(Number);
    return b.length === 4 && b.every(Number.isFinite) ? { kind, box: b } : null;
  }
  return kind === "country" || kind === "province" ? { kind, key: v } : null;
}
function writeAoiUrl() {
  try {
    const u = new URL(location.href);
    const a = state.mode === "calendar" ? state.aoi : state.mode === "forecast" ? state.fcAoi : null;
    if (a) {
      u.searchParams.set("mode", state.mode);
      u.searchParams.set("area", a.box ? `${a.kind}:${a.box.map((v) => +(+v).toFixed(2)).join(",")}` : `${a.kind}:${a.key}`);
    } else {
      u.searchParams.delete("area");
      if (u.searchParams.get("mode") !== state.mode) u.searchParams.delete("mode");
    }
    history.replaceState(null, "", u);
  } catch {}
}

function setArea(spec) {
  state.aoi = spec;
  state.calMonth = null;
  state.boxStart = null;
  if (state.mode !== "calendar") setMode("calendar");
  else renderCalendar();
}

async function calendarClick(ll) {
  if (state.pick === "box") {
    if (!state.boxStart) {
      state.boxStart = ll;
      globe.setMarker(ll.lat, ll.lon);
      const h = $("#pick-hint");
      if (h) h.textContent = "Now click the opposite corner of the box.";
      return;
    }
    const a = state.boxStart;
    globe.setMarker(null);
    if (Math.abs(a.lat - ll.lat) < 0.2 || Math.abs(a.lon - ll.lon) < 0.2) { state.boxStart = null; return; }
    setArea({ kind: "box", box: [a.lat, a.lon, ll.lat, ll.lon] });
    return;
  }
  const r = await placeAt(ll.lat, ll.lon);
  if (!r) return; // sea
  setArea(state.pick === "country" ? { kind: "country", key: r.country } : { kind: "province", key: provKey(r) });
}

function bindCalBtn() {
  const b = $("#cell-body .cal-btn");
  if (b) b.addEventListener("click", () => setArea({ kind: "province", key: b.dataset.key }));
  const f = $("#cell-body .fc-btn");
  if (f) f.addEventListener("click", () => setFcArea({ kind: "province", key: f.dataset.key }));
}

async function renderCalendar() {
  if (!state.aoi) state.aoi = { kind: "country", key: "Uzbekistan" };
  const spec = state.aoi;
  let fresh = false;
  if (!state.cal || state.cal.spec !== spec) {
    $("#panel-body").innerHTML = `<p class="eyebrow">Fire calendar</p><h2>Building the calendar…</h2><p class="lede">Adding up 25 years of unified MODIS + VIIRS detections inside the area.</p>`;
    const area = await resolveArea(spec);
    if (state.aoi !== spec) return;
    if (!area) {
      state.aoi = { kind: "country", key: "Uzbekistan" };
      return renderCalendar();
    }
    const w = areaWeights(area);
    const S = areaSeries(hist, w);
    const A = analyse(meta.months, meta.years, S);
    // area centre (weighted) for the camera
    let sl = 0, so = 0, sw = 0;
    for (let k = 0; k < w.length; k++) if (w[k]) { const ll = cell05ToLatLon(k); sl += ll.lat * w[k]; so += ll.lon * w[k]; sw += w[k]; }
    state.cal = { spec, area, w, S, A, km2: areaKm2(w), center: sw ? [sl / sw, so / sw] : null };
    fresh = true;
  }
  if (state.mode !== "calendar") return;
  drawCalendarGlobe();
  calendarPanel();
  writeAoiUrl();
  const c = state.cal.center;
  if (fresh && c) globe.flyTo(c[0], c[1], Math.min(3.2, 1.55 + Math.sqrt(state.cal.km2) / 1500));
}

function drawCalendarGlobe() {
  const { w, area } = state.cal;
  const m0 = state.calMonth ?? 0, m1 = state.calMonth ?? hist.nM - 1;
  const tot = new Map();
  for (let m = m0; m <= m1; m++) {
    for (let i = hist.offsets[m]; i < hist.offsets[m + 1]; i++) {
      const c = hist.cells[i], ww = w[c];
      if (ww) tot.set(c, (tot.get(c) || 0) + hist.harm[i] * ww);
    }
  }
  const n = tot.size, lats = new Float32Array(n), lons = new Float32Array(n), vals = new Float32Array(n);
  let mx = 1;
  for (const v of tot.values()) mx = Math.max(mx, v);
  let i = 0;
  for (const [c, v] of tot) {
    const ll = cell05ToLatLon(c);
    lats[i] = ll.lat; lons[i] = ll.lon; vals[i] = Math.log1p(v) / Math.log1p(mx); i++;
  }
  globe.hideAll();
  if (n) globe.setPoints("cal", { lats, lons, values: vals, ramp: "heat", size: 0.0105, minSize: 0.3, opacity: 0.95, soft: 0.35, blending: THREE.NormalBlending });
  globe.setOutline(area.rings);
}

/** AI outlook averaged over the area (1° forecast cells weighted by how much of them is inside). */
function areaOutlook(w) {
  if (!forecast) return null;
  const w1 = new Map();
  for (let k = 0; k < w.length; k++) if (w[k]) {
    const r = Math.floor(k / 720), c = k % 720, c1 = Math.floor(r / 2) * 360 + Math.floor(c / 2);
    w1.set(c1, (w1.get(c1) || 0) + w[k] / 4);
  }
  return forecast.months.map((ym, k) => {
    let sp = 0, sw = 0, high = 0, top = 0;
    for (const row of forecast.cells) {
      const ww = w1.get(row[0]);
      if (!ww) continue;
      const p = row[1 + k] / 1000;
      sp += p * ww; sw += ww; top = Math.max(top, p);
      if (p >= 0.5 && ww >= 0.25) high++;
    }
    return { ym, mean: sw ? sp / sw : 0, top, high, covered: sw };
  });
}

function calendarPanel() {
  const { area, A, km2, w } = state.cal;
  const mode = state.calColor;
  const Y = meta.years;
  const critMass = [...A.crit].reduce((s, mo) => s + A.norm[mo].mean, 0);
  const pctCrit = A.annualNormal ? Math.round((critMass / A.annualNormal) * 100) : 0;
  const tr = A.trend, rel = tr && A.annMed ? (tr.slope / A.annMed) * 100 : 0;
  const last = A.annual.at(-1);
  const lastX = last && A.annMed ? last.h / A.annMed : null;
  const highs = A.flagged.filter((c) => c.flag === "high");
  const ymOf = (c) => meta.months[c.i];
  const runMass = ([a, b]) => { let s = 0; for (let k = a; ; k = (k + 1) % 12) { s += A.norm[k].mean; if (k === b) break; } return s; };
  const mainRun = A.runs.length ? A.runs.reduce((best, r) => (runMass(r) > runMass(best) ? r : best), A.runs[0]) : null;
  const prepMonth = mainRun ? MON[(mainRun[0] + 11) % 12] : null;
  const empty = A.total < 5;

  // narrative: what a fire manager would write in a briefing
  const story = empty ? `Almost no vegetation fire has been detected here since ${Y[0]}.` : [
    `In a normal year this area has about <b>${fmt(A.annualNormal)}</b> fire detections (VIIRS-equivalent), <b>${pctCrit}%</b> of them in <b>${listJoin(A.runs.map(runLabel))}</b>. Peak month: <b>${MON[A.peak]}</b>, which had fire in ${A.norm[A.peak].burned} of ${A.norm[A.peak].n} years.`,
    tr ? (tr.p < 0.05 ? `Burning has been <b>${rel > 0 ? "rising" : "falling"} by about ${Math.abs(rel).toFixed(1)}% a year</b> (Theil–Sen slope, Mann–Kendall p = ${tr.p.toFixed(3)}).` : `No clear long-term trend (Mann–Kendall p = ${tr.p.toFixed(2)}).`) : "",
    A.timing.shiftDays != null && Math.abs(A.timing.shiftDays) >= 10 ? `The season's centre has moved <b>${Math.abs(A.timing.shiftDays)} days ${A.timing.shiftDays < 0 ? "earlier" : "later"}</b> (${A.timing.first} vs ${A.timing.second}).` : "",
    highs.length ? `${highs.length} month${highs.length > 1 ? "s were" : " was"} unusually active; the biggest was <b>${ymLabel(ymOf(highs[0]))}</b> (${highs[0].x ? highs[0].x.toFixed(1) + "×" : "far above"} the ${MON[(ymOf(highs[0]) % 100) - 1]} average).` : "No month stands out as unusually active.",
  ].filter(Boolean).join(" ");

  const outlook = areaOutlook(w);
  const sel = state.calMonth;
  $("#panel-body").innerHTML = `
    <p class="eyebrow">Fire calendar · area of interest</p>
    <h2>${esc(prettyCountry(area.name))}</h2>
    <p class="muted" style="margin:-2px 0 10px">${esc(area.sub)} · ≈ ${fmt(km2)} km²</p>
    <div class="aoi-pick">
      <input id="aoi-q" list="aoi-list" placeholder="Search a country or province…" autocomplete="off" aria-label="Search area">
      <datalist id="aoi-list"></datalist>
      <div class="seg" role="group" aria-label="Click on the globe picks">
        <button data-pick="province" aria-pressed="${state.pick === "province"}">Click: province</button>
        <button data-pick="country" aria-pressed="${state.pick === "country"}">Click: country</button>
        <button data-pick="box" aria-pressed="${state.pick === "box"}">Draw a box</button>
      </div>
      <p class="muted small" id="pick-hint" style="margin:0">${state.pick === "box" ? "Click two opposite corners on the globe." : `Click anywhere on the globe to switch to that ${state.pick}.`}</p>
    </div>
    <h3>Burning activity calendar, ${Y[0]}–${Y.at(-1)}</h3>
    <div class="seg" role="group" aria-label="Colour" style="margin-bottom:8px">
      <button data-cc="activity" aria-pressed="${mode === "activity"}">Activity</button>
      <button data-cc="anomaly" aria-pressed="${mode === "anomaly"}">Compared with normal</button>
    </div>
    <div id="cal-grid" class="calgrid" role="grid" aria-label="Fire detections per month and year">${calGridHtml(A, mode)}</div>
    ${mode === "activity"
      ? `<div class="ramp" style="background:linear-gradient(90deg,${HEAT.join(",")})"></div><div class="ramp-labels"><span>none</span><span>${fmt(A.max)} detections / month</span></div>`
      : `<div class="ramp" style="background:linear-gradient(90deg,${DIV.join(",")})"></div><div class="ramp-labels"><span>much quieter</span><span>normal</span><span>much more fire</span></div>`}
    <div class="legend"><span><i class="sq cal-key hi"></i>unusually active</span><span><i class="sq cal-key lo"></i>unusually quiet</span><span><i class="sq cal-key crit"></i>critical months</span></div>
    ${sel != null ? `<p class="small" style="margin:6px 0 0">Globe shows <b>${ymLabel(meta.months[sel])}</b>. <a href="#" id="cal-all">Show all years</a></p>` : `<p class="muted small" style="margin:6px 0 0">Hover a month for numbers; click it to see it on the globe.</p>`}
    ${empty ? "" : `<div class="stats">
      <div class="stat"><div class="v">${A.runs.map(runLabel).join(", ") || "–"}</div><div class="k">Critical period (${pctCrit}% of burning)</div></div>
      <div class="stat"><div class="v">${prepMonth || "–"}</div><div class="k">Get ready by (before the main season${mainRun ? ", " + runLabel(mainRun) : ""})</div></div>
      <div class="stat"><div class="v">${tr ? `${rel > 0 ? "+" : ""}${rel.toFixed(1)}%/yr` : "–"}</div><div class="k">Trend since ${A.annual[0]?.y ?? ""}${tr ? (tr.p < 0.05 ? " · significant" : " · not significant") : ""}</div></div>
      <div class="stat"><div class="v">${lastX != null ? `${lastX.toFixed(2)}×` : "–"}</div><div class="k">${last ? last.y : ""} vs a typical year</div></div>
    </div>`}
    <div class="callout">${story}</div>
    ${empty ? "" : `<h3>When to watch: the normal fire year</h3>
    <div id="ch-cal-season"></div>
    <p class="muted small" style="margin-top:4px">Bars = average detections in each calendar month; highlighted = critical period. "Normal" in the calendar is the median for that month over all ${Y.length} years.</p>
    <h3>Unusual months</h3>
    ${A.flagged.length ? `<ul class="rank">${A.flagged.slice(0, 8).map((c) => `<li data-i="${c.i}"><span class="i">${c.flag === "high" ? "▲" : "▼"}</span><span>${ymLabel(meta.months[c.i])}<div class="muted small">${c.flag === "high" ? "more" : "less"} fire than usual · normal ≈ ${fmt(A.norm[(meta.months[c.i] % 100) - 1].med)}</div></span><span class="n">${fmt(c.h)} · ${c.x != null ? c.x.toFixed(1) + "×" : "–"}</span></li>`).join("")}</ul>` : `<p class="lede">No month was far outside its normal range.</p>`}
    <h3>Year by year (unified, VIIRS-equivalent)</h3>
    <div id="ch-cal-years"></div>
    ${outlook ? `<h3>AI outlook for this area</h3>
    <table class="data"><tr><th>Month</th><th>Avg chance</th><th>Highest cell</th><th>High-risk cells</th></tr>
      ${outlook.map((o) => `<tr><td>${ymLabel(o.ym)}</td><td>${o.covered ? pct(o.mean) : "–"}</td><td>${o.covered ? pct(o.top) : "–"}</td><td>${o.high}</td></tr>`).join("")}</table>
    <p class="muted small">Chance of ≥${forecast.threshold} detections per 1° cell (AI Forecast tab), issued ${forecast.issued}. A normal ${outlook.map((o) => MON[(o.ym % 100) - 1]).join(" / ")} here has ${outlook.map((o) => fmt(A.norm[(o.ym % 100) - 1].mean)).join(" / ")} detections.</p>` : ""}`}
    <div class="row-ctl" style="margin-top:16px">
      ${forecast ? `<button class="btn" id="cal-fc">AI forecast for this area →</button>` : ""}
      <button class="btn" id="cal-csv">Download CSV</button>
      <button class="btn" id="cal-link">Copy link</button>
    </div>
    <p class="muted small" style="margin-top:12px">How: each 0.5° grid cell is weighted by the share of it inside the area, then monthly unified detections are added up. Before 2012 only MODIS existed; its counts are calibrated to VIIRS-equivalent (see About), so all ${Y.length} years are on one scale. "Unusual" = at least 2 robust standard deviations (median/MAD, log scale) from that calendar month's normal. Record: ${ymLabel(meta.months[0])} – ${ymLabel(meta.months.at(-1))}.</p>
  `;
  // area search
  areaIndex().then((list) => {
    const dl = $("#aoi-list");
    if (!dl) return;
    state.areaList = list;
    dl.innerHTML = list.map((o) => `<option value="${esc(o.label)}">${o.kind === "country" ? "Country" : "Province"}</option>`).join("");
  });
  const q = $("#aoi-q");
  const find = (v, loose) => state.areaList?.find((o) => o.label.toLowerCase() === v) || (loose ? state.areaList?.find((o) => o.label.toLowerCase().startsWith(v)) : null);
  q.addEventListener("change", () => { const hit = find(q.value.trim().toLowerCase()); if (hit) setArea({ kind: hit.kind, key: hit.key }); });
  q.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const hit = find(q.value.trim().toLowerCase(), true);
    if (hit) setArea({ kind: hit.kind, key: hit.key });
  });
  document.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
    state.pick = b.dataset.pick; state.boxStart = null; globe.setMarker(null); calendarPanel();
  }));
  document.querySelectorAll("[data-cc]").forEach((b) => b.addEventListener("click", () => { state.calColor = b.dataset.cc; calendarPanel(); }));
  const pickMonth = (i) => { state.calMonth = state.calMonth === i ? null : i; drawCalendarGlobe(); calendarPanel(); };
  const grid = $("#cal-grid");
  grid.addEventListener("pointermove", (e) => {
    const t = e.target.closest("[data-i]");
    if (!t) { hideTip(); return; }
    const i = +t.dataset.i, ym = meta.months[i], mo = (ym % 100) - 1;
    const c = A.grid[meta.years.indexOf(Math.floor(ym / 100))][mo];
    showTip(`<b>${ymLabel(ym)}</b>
      <div class="row"><span><i class="sw" style="background:${C.harm}"></i>Unified</span><span>${fmt(c.h)}</span></div>
      <div class="row"><span>Normal ${MON[mo]} (median)</span><span>${fmt(A.norm[mo].med)}</span></div>
      <div class="row"><span>vs ${MON[mo]} average</span><span>${c.x != null ? c.x.toFixed(2) + "×" : "–"}</span></div>
      <div class="row"><span><i class="sw" style="background:${C.modis}"></i>MODIS raw</span><span>${fmt(c.m)}</span></div>
      <div class="row"><span><i class="sw" style="background:${C.viirs}"></i>VIIRS raw</span><span>${ym >= 201201 ? fmt(c.v) : "not flying"}</span></div>
      ${c.flag ? `<div class="muted small">${c.flag === "high" ? "Unusually active" : "Unusually quiet"} for ${MON[mo]}</div>` : ""}`, e.clientX, e.clientY);
  });
  grid.addEventListener("pointerleave", hideTip);
  grid.addEventListener("click", (e) => { const t = e.target.closest("[data-i]"); if (t) pickMonth(+t.dataset.i); });
  document.querySelectorAll("#panel-body .rank li[data-i]").forEach((li) => li.addEventListener("click", () => pickMonth(+li.dataset.i)));
  $("#cal-all")?.addEventListener("click", (e) => { e.preventDefault(); pickMonth(state.calMonth); });
  $("#cal-fc")?.addEventListener("click", () => setFcArea(state.aoi));
  $("#cal-csv").addEventListener("click", () => {
    const blob = new Blob([toCSV(area, A)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ember-atlas_fire-calendar_${String(area.name).replace(/[^\w-]+/g, "_")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $("#cal-link").addEventListener("click", async (e) => {
    try { await navigator.clipboard.writeText(location.href); e.target.textContent = "Link copied"; } catch { e.target.textContent = "Copy failed"; }
  });
  if (!empty) {
    barChart($("#ch-cal-season"), {
      values: A.norm.map((n) => n.mean), labels: MON, color: "rgba(217,89,38,.35)",
      highlight: A.crit, highlightColor: C.harm, xTicks: (i, l) => l[0], tipLabel: "Normal (avg)", height: 96,
    });
    const big = new Set(A.annual.map((a, i) => (a.h > 1.5 * A.annMed ? i : -1)).filter((i) => i >= 0));
    barChart($("#ch-cal-years"), {
      values: A.annual.map((a) => a.h), labels: A.annual.map((a) => String(a.y)), color: "rgba(217,89,38,.45)",
      highlight: big, highlightColor: "#ff4d3d", xTicks: (i, l) => (i % 5 === 0 ? l : null), tipLabel: "Detections", height: 96,
    });
  }
}

const listJoin = (a) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`);

function calGridHtml(A, mode) {
  const sel = state.calMonth;
  let h = `<div class="cg-row cg-head"><span></span>${MON.map((m, mo) => `<span class="${A.crit.has(mo) ? "crit" : ""}">${m[0]}</span>`).join("")}</div>`;
  A.grid.forEach((row, yi) => {
    const y = meta.years[yi];
    h += `<div class="cg-row"><span class="cg-y">${y % 5 === 0 || yi === 0 || yi === A.grid.length - 1 ? y : ""}</span>${row.map((c) =>
      c ? `<span data-i="${c.i}" class="cg-c${c.flag ? " " + c.flag : ""}${sel === c.i ? " sel" : ""}" style="background:${cellColor(c, A.max, mode)}"></span>` : `<span class="cg-c na"></span>`).join("")}</div>`;
  });
  h += `<div class="cg-row cg-norm"><span class="cg-y">normal</span>${A.norm.map((n) => `<span class="cg-c" title="Normal ${MON[A.norm.indexOf(n)]}: ${fmt(n.mean)}" style="background:${cellColor({ h: n.mean, z: 0 }, A.max, "activity")}"></span>`).join("")}</div>`;
  return h;
}

// ---------------------------------------------------------------- LIVE
// Old/new switch: "all" = every heat detection (original behaviour), "fires" = industrial heat removed.
// Default stays "all"; ?filter=fires|all in the URL or the panel switch overrides it (remembered per browser).
function readLiveFilter() {
  const q = new URLSearchParams(location.search).get("filter");
  if (q === "fires" || q === "all") return q === "fires";
  try { return localStorage.getItem("liveFilter") === "fires"; } catch { return false; }
}
function liveView() {
  const L = state.live;
  if (!state.liveFilter || !L.hasMask) return L;
  const bySource = {};
  for (const id in L.bySource) bySource[id] = L.bySource[id] && L.fires.filter((d) => d.src === id);
  return { ...L, bySource, all: L.fires, unified: L.firesUnified };
}

async function renderLive(reload) {
  if (!state.live || reload) {
    $("#panel-body").innerHTML = `<p class="eyebrow">Live</p><h2>Fetching satellites…</h2><p class="lede">Pulling the last ${state.liveRange} of detections from 4 satellites via NASA FIRMS.</p>`;
    state.live = await loadLive(state.liveRange);
  }
  if (state.mode !== "live") return;
  if (!Object.values(state.live.bySource).some(Boolean)) {
    // every feed failed (network/DNS hiccup, or FIRMS down): say so, don't cache the empty result
    state.live = null;
    globe.hideLayer("live"); globe.hideLayer("liveM"); globe.hideLayer("liveV"); HIDDEN.forEach((h) => globe.hideLayer(h.layer));
    $("#panel-body").innerHTML = `<p class="eyebrow">Live</p><h2>Couldn't reach NASA FIRMS</h2>
      <p class="lede">None of the 4 satellite feeds answered. It's usually a short network or DNS hiccup, or FIRMS is busy.</p>
      <button id="live-retry" class="btn" style="margin-top:10px">Try again</button>`;
    $("#live-retry").addEventListener("click", () => renderLive(true));
    return;
  }
  drawLive();
  livePanel();
}

function drawLive() {
  const L = liveView();
  globe.hideLayer("live"); globe.hideLayer("liveM"); globe.hideLayer("liveV"); HIDDEN.forEach((h) => globe.hideLayer(h.layer));
  const ptsFrom = (arr, val) => {
    const lats = new Float32Array(arr.length), lons = new Float32Array(arr.length), vals = new Float32Array(arr.length);
    arr.forEach((d, i) => { lats[i] = d.lat; lons[i] = d.lon; vals[i] = val(d); });
    return { lats, lons, values: vals };
  };
  const frpV = (d) => Math.min(1, Math.log1p(d.frp) / Math.log1p(400));
  if (state.liveColor === "unified") {
    globe.setPoints("live", { ...ptsFrom(L.unified, frpV), ramp: "heat", size: 0.0065, minSize: 0.45, opacity: 0.95 });
  } else {
    const isM = (d) => d.src === "MODIS";
    globe.setPoints("liveV", { ...ptsFrom(L.all.filter((d) => !isM(d)), frpV), ramp: "viirs", size: 0.005, minSize: 0.45, opacity: 0.8 });
    globe.setPoints("liveM", { ...ptsFrom(L.all.filter(isM), frpV), ramp: "modis", size: 0.008, minSize: 0.45, opacity: 0.8 });
  }
  if (state.liveFilter && L.hasMask) for (const h of HIDDEN) {
    const pts = L.industrial.filter((f) => f.kind === h.kind);
    if (pts.length) globe.setPoints(h.layer, { ...ptsFrom(pts, frpV), ramp: h.ramp, size: 0.0045, minSize: 0.5, opacity: 0.85 });
  }
}

function applySmoke() {
  if (state.mode !== "live" || state.smoke === "off") { globe.setOverlayImage(null); return; }
  globe.setOverlayImage(smokeGlobeUrl(state.smoke, isoDay(new Date(Date.now() - 864e5))), state.smoke === "co" ? 1 : 0);
}

function livePanel() {
  const L = liveView();
  const hottest = [...L.unified].sort((a, b) => b.frp - a.frp).slice(0, 8);
  const multi = L.unified.filter((f) => f.srcs.size > 1).length;
  $("#panel-body").innerHTML = `
    <p class="eyebrow"><span class="live-dot" style="display:inline-block;margin-right:6px"></span>Live · last ${state.liveRange}</p>
    <h2>${fmt(L.unified.length)} active fires</h2>
    <p class="lede">${fmt(L.all.length)} raw detections from 4 satellites, merged into unique fire locations (~4 km). ${fmt(multi)} fires were seen by more than one satellite and are counted once.</p>
    <div class="seg" role="group" aria-label="Filter" style="margin-bottom:6px">
      <button data-lf="all" aria-pressed="${!state.liveFilter}">All heat (old)</button>
      <button data-lf="fires" aria-pressed="${state.liveFilter}">Fires only (new)</button>
    </div>
    ${state.liveFilter ? (L.hasMask ? `<p class="muted small" style="margin:0 0 4px">${fmt(L.industrial.length)} non-fire heat sources taken out of the count, still shown in their own colour:</p>
      <div class="legend" style="margin:0 0 10px">${HIDDEN.map((h) => `<span><i class="sq" style="background:${h.color}"></i>${fmt(L.hiddenByKind[h.kind])} ${h.label}</span>`).join("")}</div>` : `<p class="muted small" style="margin:0 0 10px">Industrial mask not published yet. Showing all heat.</p>`) : ""}
    <div class="seg" role="group" aria-label="Smoke" style="margin-bottom:6px">
      <button data-smoke="off" aria-pressed="${state.smoke === "off"}">No smoke layer</button>
      <button data-smoke="smoke" aria-pressed="${state.smoke === "smoke"}">Smoke</button>
      <button data-smoke="co" aria-pressed="${state.smoke === "co"}">Carbon monoxide</button>
    </div>
    ${state.smoke !== "off" ? `<p class="muted small" style="margin:0 0 10px">${SMOKE_LAYERS[state.smoke].name}, yesterday (UTC), from NASA GIBS. Click a fire on the globe to see its satellite pictures.</p>` : `<p class="muted small" style="margin:0 0 10px">Click a fire on the globe to see the satellite picture of the moment it was detected.</p>`}
    <div class="seg" role="group" aria-label="Range" style="margin-bottom:10px">
      ${["24h", "48h"].map((r) => `<button data-range="${r}" aria-pressed="${state.liveRange === r}">${r}</button>`).join("")}
    </div>
    <div class="seg" role="group" aria-label="Colour" style="margin-bottom:6px">
      <button data-lc="unified" aria-pressed="${state.liveColor === "unified"}">Unified fires</button>
      <button data-lc="sensor" aria-pressed="${state.liveColor === "sensor"}">By sensor</button>
    </div>
    ${state.liveColor === "sensor" ? `<div class="legend"><span><i class="sq" style="background:${C.modis}"></i>MODIS (1 km)</span><span><i class="sq" style="background:${C.viirs}"></i>VIIRS (375 m)</span></div>` : `<div class="ramp" style="background:linear-gradient(90deg,${RAMPS.heat.join(",")})"></div><div class="ramp-labels"><span>Fire radiative power</span><span>400+ MW</span></div>`}
    <div class="stats">
      ${LIVE_SOURCES.map((s) => `<div class="stat"><div class="v">${L.bySource[s.id] ? fmt(L.bySource[s.id].length) : "n/a"}</div><div class="k">${s.name}</div></div>`).join("")}
    </div>
    <h3>Most intense right now</h3>
    <ul class="rank">${hottest.map((f, i) => `<li data-lat="${f.lat}" data-lon="${f.lon}"><span class="i">${i + 1}</span><span>${fmtLat(f.lat, f.lon)}<div class="muted small">${f.t} · ${f.srcs.size} sat${f.srcs.size > 1 ? "s" : ""}</div></span><span class="n">${fmt(f.frp)} MW</span></li>`).join("")}</ul>
    <p class="muted small" style="margin-top:14px">Source: NASA FIRMS near-real-time feeds, ~3 h latency. Low-confidence detections removed.${state.liveFilter && L.hasMask ? " Non-fire heat removed using NASA's archive labels (type 1–3), spots hot on many days every year, VIIRS Nightfire gas-flare sites 2012–2025 (EOG, Colorado School of Mines), volcanoes active since 2000 (Smithsonian GVP) and OpenStreetMap industry." : ""}</p>
  `;
  document.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => { state.liveRange = b.dataset.range; renderLive(true); }));
  document.querySelectorAll("[data-lf]").forEach((b) => b.addEventListener("click", () => {
    state.liveFilter = b.dataset.lf === "fires";
    try { localStorage.setItem("liveFilter", b.dataset.lf); } catch {}
    drawLive(); livePanel();
  }));
  document.querySelectorAll("[data-lc]").forEach((b) => b.addEventListener("click", () => { state.liveColor = b.dataset.lc; drawLive(); livePanel(); }));
  document.querySelectorAll("[data-smoke]").forEach((b) => b.addEventListener("click", () => { state.smoke = b.dataset.smoke; applySmoke(); livePanel(); }));
  document.querySelectorAll(".rank li").forEach((li) => li.addEventListener("click", () => { globe.flyTo(+li.dataset.lat, +li.dataset.lon, 1.7); globe.setMarker(+li.dataset.lat, +li.dataset.lon); }));
}

// ---------------------------------------------------------------- FORECAST
async function renderForecast() {
  if (!forecast) {
    $("#panel-body").innerHTML = `<p class="eyebrow">AI forecast</p><h2>Not available yet</h2><p class="lede">The model output hasn't been published.</p>`;
    return;
  }
  if (!forecast.byCell) forecast.byCell = new Map(forecast.cells.map((r) => [r[0], r]));
  let fresh = false;
  if (state.fcAoi && state.fcA?.spec !== state.fcAoi) {
    const spec = state.fcAoi;
    $("#panel-body").innerHTML = `<p class="eyebrow">AI forecast · area</p><h2>Adding up the forecast…</h2><p class="lede">Collecting the AI's 1° squares inside the area and comparing them with 25 years of fire there.</p>`;
    const A = await buildFcArea(spec);
    if (state.fcAoi !== spec || state.mode !== "forecast") return;
    if (!A) { state.fcAoi = null; state.fcA = null; return renderForecast(); }
    state.fcA = A;
    fresh = true;
  }
  if (state.mode !== "forecast") return;
  const A = state.fcAoi ? state.fcA : null;
  $("#panel").classList.toggle("wide", !!A);
  drawForecast();
  if (state.fcOverlay) {
    if (!state.live) state.live = await loadLive("24h");
    if (state.mode !== "forecast") return;
    const u = liveView().unified;
    globe.setPoints("overlay", { lats: Float32Array.from(u, (d) => d.lat), lons: Float32Array.from(u, (d) => d.lon), values: new Float32Array(u.length).fill(1), ramp: "heat", size: 0.004, minSize: 1, opacity: 0.9, radius: 1.006 });
  } else globe.hideLayer("overlay");
  if (A) fcAreaPanel(); else forecastPanel();
  writeAoiUrl();
  if (fresh && A.center) globe.flyTo(A.center[0], A.center[1], Math.min(3.2, 1.55 + Math.sqrt(A.km2) / 1500));
}

function drawForecast() {
  const k = state.fcMonth, A = state.fcAoi ? state.fcA : null;
  const rows = forecast.cells.filter((r) => r[1 + k] >= 100);
  const layer = (name, list, opacity) => {
    const lats = new Float32Array(list.length), lons = new Float32Array(list.length), vals = new Float32Array(list.length);
    // snap to the legend's classes: Moderate=0, High=1/3, Very high=2/3, Extreme=1
    list.forEach((r, i) => { const ll = cell1ToLatLon(r[0]); lats[i] = ll.lat; lons[i] = ll.lon; vals[i] = (RISK.indexOf(riskClass(r[1 + k] / 1000)) - 1) / 3; });
    globe.setPoints(name, { lats, lons, values: vals, ramp: "risk", size: 0.02, minSize: 0.55, opacity, soft: 0.55, blending: THREE.NormalBlending, radius: 1.003 });
  };
  if (!A) {
    layer("risk", rows, 0.55);
    globe.hideLayer("riskDim");
    globe.setOutline(null);
    return;
  }
  // area picked: its squares bright, the rest of the world faded for context
  layer("risk", rows.filter((r) => A.w1.has(r[0])), 0.8);
  layer("riskDim", rows.filter((r) => !A.w1.has(r[0])), 0.13);
  globe.setOutline(A.area.rings);
}

function forecastPanel() {
  const F = forecast, k = state.fcMonth, mlabel = ymLabel(F.months[k]);
  const counts = RISK.map(() => 0);
  F.cells.forEach((r) => counts[RISK.indexOf(riskClass(r[1 + k] / 1000))]++);
  const byCountry = new Map();
  F.cells.forEach((r) => { const c = F.countries[r[3]]; if (!c) return; const a = byCountry.get(c) || []; a.push(r[1 + k]); byCountry.set(c, a); });
  const top = [...byCountry].map(([c, a]) => ({ c, n: a.filter((p) => p >= 500).length, p: Math.max(...a) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 8);
  const M = F.metrics;
  $("#panel-body").innerHTML = `
    <p class="eyebrow">AI forecast · issued ${F.issued}</p>
    <h2>Fire risk, ${mlabel}</h2>
    <p class="lede">Chance of significant fire activity (≥${F.threshold} VIIRS-eq. detections) in each 1° cell. The model learned when <b>a place</b> and <b>its weather</b> lined up with fire in the past 25 years, and looks for that pattern again in the latest NASA POWER weather.</p>
    <h3 style="margin-top:4px">Forecast for an area</h3>
    ${fcPickerHtml()}
    <div class="seg" role="group" aria-label="Forecast month" style="margin:10px 0">
      ${F.months.map((m, i) => `<button data-fm="${i}" aria-pressed="${i === k}">${ymLabel(m)}${i === 0 ? " (now)" : ""}</button>`).join("")}
    </div>
    <div class="classes">${RISK.map((r, i) => `<div><span style="background:${r.color}"></span>${r.name}<br><b style="color:var(--text-2)">${fmt(counts[i])}</b></div>`).join("")}</div>
    <label class="chip" style="margin-top:14px" aria-pressed="${state.fcOverlay}" id="fc-overlay"><span class="sw" style="background:#ffe39a"></span>Overlay live fires (24h) to check</label>
    <h3>Tested on years it never saw (${M.test_years})</h3>
    <p class="lede small">Baseline = "same as usual": how often this place burned in this month before. Fire seasons are regular, so the baseline is strong. The AI's value is in <b>unusual</b> fires, in places and months that burn in fewer than 30% of years.</p>
    <table class="data">
      <tr><th></th><th>AI</th><th>Baseline</th></tr>
      <tr><td>All cases · ROC-AUC</td><td>${M.auc.toFixed(3)}</td><td>${M.baseline_auc.toFixed(3)}</td></tr>
      <tr><td>All cases · avg precision</td><td>${M.ap.toFixed(3)}</td><td>${M.baseline_ap.toFixed(3)}</td></tr>
      ${M.unusual_auc ? `<tr><td>Unusual fires · ROC-AUC</td><td>${M.unusual_auc.toFixed(3)}</td><td>${M.unusual_baseline_auc.toFixed(3)}</td></tr>
      <tr><td>Unusual fires · avg precision</td><td><b>${M.unusual_ap.toFixed(3)}</b></td><td>${M.unusual_baseline_ap.toFixed(3)}</td></tr>` : ""}
    </table>
    ${M.unusual_ap ? `<div class="callout">On ${fmt(M.unusual_events)} unexpected fire events, the AI's precision is <b>${Math.round((M.unusual_ap / M.unusual_baseline_ap - 1) * 100)}% higher</b> than "same as usual". That gain comes from the weather: places that burned before under similar conditions.</div>` : ""}
    <h3>Most high-risk cells (≥50%)</h3>
    <ul class="rank">${top.map((r, i) => `<li data-country="${esc(r.c)}"><span class="i">${i + 1}</span><span>${esc(prettyCountry(r.c))}<div class="bar" style="width:${(r.n / top[0].n) * 100}%;background:${RISK[3].color}"></div></span><span class="n">${r.n} cells</span></li>`).join("")}</ul>
    <p class="muted small" style="margin-top:14px">Model: gradient-boosted trees (XGBoost), trained locally on ${fmt(M.train_rows)} cell-months. Weather: NASA POWER (MERRA-2). Click any cell to see why.</p>
  `;
  document.querySelectorAll("[data-fm]").forEach((b) => b.addEventListener("click", () => { state.fcMonth = +b.dataset.fm; renderForecast(); }));
  $("#fc-overlay").addEventListener("click", () => { state.fcOverlay = !state.fcOverlay; renderForecast(); });
  document.querySelectorAll(".rank li").forEach((li) => li.addEventListener("click", () => setFcArea({ kind: "country", key: li.dataset.country })));
  bindFcPicker();
}

// ---------------------------------------------------------------- FORECAST · area of interest
// Same areas as the Fire Calendar (country / republic / province / drawn box).
// URL: ?mode=forecast&area=country:Uzbekistan | province:<iso>|<name> | box:lat0,lon0,lat1,lon1
const c05to1 = (k) => Math.floor(Math.floor(k / COLS05) / 2) * 360 + Math.floor((k % COLS05) / 2);

/** 1° forecast square -> share of it inside the area (0..1). */
function squaresOf(w) {
  const m = new Map();
  for (let k = 0; k < w.length; k++) if (w[k]) { const c1 = c05to1(k); m.set(c1, (m.get(c1) || 0) + w[k] / 4); }
  return m;
}

/**
 * "Same as usual" for one calendar month: for each 1° square, the share of past years in which it
 * had ≥ threshold detections (the AI's baseline), plus the area's total detections in each year.
 */
function usualFor(w, w1, mo) {
  const hits = new Map(), years = [];
  for (let m = 0; m < hist.nM; m++) {
    if (meta.months[m] % 100 !== mo) continue;
    const sq = new Map();
    let t = 0;
    for (let i = hist.offsets[m]; i < hist.offsets[m + 1]; i++) {
      const k = hist.cells[i], c1 = c05to1(k), v = hist.harm[i];
      if (w1.has(c1)) sq.set(c1, (sq.get(c1) || 0) + v);
      if (w[k]) t += w[k] * v;
    }
    for (const [c1, v] of sq) if (v >= forecast.threshold) hits.set(c1, (hits.get(c1) || 0) + 1);
    years.push({ y: Math.floor(meta.months[m] / 100), t });
  }
  const n = years.length;
  const rate = new Map([...w1.keys()].map((c1) => [c1, n ? (hits.get(c1) || 0) / n : 0]));
  const sorted = years.map((y) => y.t).sort((a, b) => a - b);
  const median = n ? (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : 0;
  return { rate, years, median, last: years.at(-1) || null };
}

/** AI vs usual over a set of squares, for forecast month k. */
function fcSummary(w1, rate, k) {
  let sw = 0, eAI = 0, eU = 0, high = 0, top = null;
  for (const [c1, ww] of w1) {
    const row = forecast.byCell.get(c1), p = row ? row[1 + k] / 1000 : 0, u = rate.get(c1) || 0;
    sw += ww; eAI += p * ww; eU += u * ww;
    if (ww >= 0.25) {
      if (p >= 0.5) high++;
      if (!top || p > top.p) top = { c1, p, u };
    }
  }
  return { sw, mean: sw ? eAI / sw : 0, usual: sw ? eU / sw : 0, eAI, eU, high, top };
}

async function buildFcArea(spec) {
  const area = await resolveArea(spec);
  if (!area) return null;
  const w = areaWeights(area), w1 = squaresOf(w);
  const usual = forecast.months.map((ym) => usualFor(w, w1, ym % 100));
  let sl = 0, so = 0, sw = 0;
  for (let k = 0; k < w.length; k++) if (w[k]) { const ll = cell05ToLatLon(k); sl += ll.lat * w[k]; so += ll.lon * w[k]; sw += w[k]; }
  const A = { spec, area, w, w1, usual, km2: areaKm2(w), center: sw ? [sl / sw, so / sw] : null, provs: null };
  // a country: rank its provinces / republics by the AI's chance (each scored with the same baseline)
  if (spec.kind === "country" && area.parts.length > 1 && area.parts.length <= 150) {
    A.provs = area.parts.map((r) => {
      const pw1 = squaresOf(areaWeights({ parts: [r] }));
      return { r, by: forecast.months.map((_, k) => fcSummary(pw1, usual[k].rate, k)) };
    }).filter((p) => p.by[0].sw >= 0.1);
  }
  // the hottest squares, named after the province at their centre
  A.hot = forecast.months.map((_, k) => [...A.w1].filter(([, ww]) => ww >= 0.25)
    .map(([c1]) => ({ c1, p: (forecast.byCell.get(c1)?.[1 + k] || 0) / 1000, u: usual[k].rate.get(c1) || 0 }))
    .filter((h) => h.p >= 0.1).sort((a, b) => b.p - a.p || (b.p - b.u) - (a.p - a.u)).slice(0, 6));
  const names = new Map();
  await Promise.all([...new Set(A.hot.flat().map((h) => h.c1))].map(async (c1) => {
    const ll = cell1ToLatLon(c1), r = await placeAt(ll.lat, ll.lon);
    names.set(c1, r ? r.name : fmtLat(ll.lat, ll.lon));
  }));
  A.names = names;
  return A;
}

function setFcArea(spec) {
  state.fcAoi = spec;
  state.fcBoxStart = null;
  globe.setMarker(null);
  if (spec) closeCell();
  if (state.mode !== "forecast") setMode("forecast");
  else renderForecast();
}

async function forecastClick(ll) {
  if (state.fcPick === "box") {
    if (!state.fcBoxStart) {
      state.fcBoxStart = ll;
      globe.setMarker(ll.lat, ll.lon);
      const h = $("#fc-pick-hint");
      if (h) h.textContent = "Now click the opposite corner of the box.";
      return;
    }
    const a = state.fcBoxStart;
    state.fcBoxStart = null;
    globe.setMarker(null);
    if (Math.abs(a.lat - ll.lat) < 0.5 || Math.abs(a.lon - ll.lon) < 0.5) return; // forecast squares are 1°
    setFcArea({ kind: "box", box: [a.lat, a.lon, ll.lat, ll.lon] });
    return;
  }
  const r = await placeAt(ll.lat, ll.lon);
  if (!r) return; // sea
  setFcArea(state.fcPick === "country" ? { kind: "country", key: r.country } : { kind: "province", key: provKey(r) });
}

function fcHint() {
  const p = state.fcPick;
  return p === "cell" ? "Clicking the globe opens one 1° square. Search above or switch the click to pick a whole area."
    : p === "box" ? (state.fcBoxStart ? "Now click the opposite corner of the box." : "Click two opposite corners on the globe.")
    : `Click anywhere on the globe to get the forecast for that ${p === "country" ? "country" : "province or republic"}.`;
}

function fcPickerHtml() {
  const p = state.fcPick, hint = fcHint();
  const opts = [["cell", "Click: square"], ["province", "Click: province / republic"], ["country", "Click: country"], ["box", "Draw a box"]];
  return `<div class="aoi-pick">
      <input id="fc-q" list="fc-list" placeholder="Search a country, province or republic…" autocomplete="off" aria-label="Search area">
      <datalist id="fc-list"></datalist>
      <div class="seg" role="group" aria-label="Click on the globe picks">
        ${opts.map(([k, l]) => `<button data-fpick="${k}" aria-pressed="${p === k}">${l}</button>`).join("")}
      </div>
      <p class="muted small" id="fc-pick-hint" style="margin:0">${hint}</p>
    </div>`;
}

function bindFcPicker() {
  areaIndex().then((list) => {
    const dl = $("#fc-list");
    if (!dl) return;
    state.areaList = list;
    dl.innerHTML = list.map((o) => `<option value="${esc(o.label)}">${o.kind === "country" ? "Country" : "Province / republic"}</option>`).join("");
  });
  const q = $("#fc-q");
  const find = (v, loose) => state.areaList?.find((o) => o.label.toLowerCase() === v) || (loose ? state.areaList?.find((o) => o.label.toLowerCase().startsWith(v)) : null);
  q.addEventListener("change", () => { const hit = find(q.value.trim().toLowerCase()); if (hit) setFcArea({ kind: hit.kind, key: hit.key }); });
  q.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const hit = find(q.value.trim().toLowerCase(), true);
    if (hit) setFcArea({ kind: hit.kind, key: hit.key });
  });
  document.querySelectorAll("[data-fpick]").forEach((b) => b.addEventListener("click", () => {
    state.fcPick = b.dataset.fpick;
    state.fcBoxStart = null;
    if (!state.cell) globe.setMarker(null);
    $("#fc-pick-hint").textContent = fcHint();
    document.querySelectorAll("[data-fpick]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.fpick === state.fcPick));
  }));
}

const fewSquares = (v) => (v < 0.05 ? "0" : v < 10 ? v.toFixed(1) : fmt(Math.round(v)));

function fcVerdict(s, mon) {
  if (s.eAI < 0.05 && s.eU < 0.05) return { cls: "", text: `Quiet: almost no significant fire is expected here in ${mon}, and there usually is none.` };
  if (Math.max(s.mean, s.usual) < 0.1) return { cls: "same", label: "Low", text: `Little significant fire is expected here in ${mon}: an average chance of <b>${pct(s.mean)}</b> per square (usually ${pct(s.usual)}).` };
  const r = s.eU >= 0.05 ? s.eAI / s.eU : Infinity;
  if (Math.abs(s.mean - s.usual) < 0.05) return { cls: "same", label: "About usual", text: `The AI gives an average chance of <b>${pct(s.mean)}</b> per square here; a usual ${mon} is <b>${pct(s.usual)}</b>.` };
  const vs = `Average chance <b>${pct(s.mean)}</b> per square (usually ${pct(s.usual)}). The AI expects about <b>${fewSquares(s.eAI)}</b> fire-active 1° square${s.eAI >= 0.95 && s.eAI < 1.05 ? "" : "s"} here; a usual ${mon} has <b>${fewSquares(s.eU)}</b>.`;
  if (r >= 1.25) return { cls: "up", label: r === Infinity ? "Fire where there's usually none" : `Higher than usual · +${Math.round((r - 1) * 100)}%`, text: vs };
  if (r <= 0.8) return { cls: "down", label: `Lower than usual · −${Math.round((1 - r) * 100)}%`, text: vs };
  return { cls: "same", label: "About usual", text: vs };
}

function fcAreaPanel() {
  const F = forecast, A = state.fcA, k = state.fcMonth, area = A.area;
  const mon = MON[(F.months[k] % 100) - 1], U = A.usual[k];
  const S = F.months.map((_, i) => fcSummary(A.w1, A.usual[i].rate, i));
  const s = S[k], v = fcVerdict(s, mon);
  const top = s.top;
  const provs = A.provs ? [...A.provs].sort((a, b) => b.by[k].mean - a.by[k].mean).slice(0, 10) : null;
  const hot = A.hot[k];
  const ratioTxt = (x) => (Math.max(x.mean, x.usual) < 0.1 ? "low" : x.eU >= 0.05 ? `${(x.eAI / x.eU).toFixed(1)}×` : "new");
  $("#panel-body").innerHTML = `
    <p class="eyebrow">AI forecast · area of interest · issued ${F.issued}</p>
    <h2>${esc(prettyCountry(area.name))}</h2>
    <p class="muted" style="margin:-2px 0 10px">${esc(area.sub)} · ≈ ${fmt(A.km2)} km² · ${fmt(Math.round([...A.w1.values()].reduce((a, b) => a + b, 0)))} forecast squares</p>
    ${fcPickerHtml()}
    <div class="row-ctl" style="margin:10px 0">
      <div class="seg" role="group" aria-label="Forecast month">
        ${F.months.map((m, i) => `<button data-fm="${i}" aria-pressed="${i === k}">${ymLabel(m)}${i === 0 ? " (now)" : ""}</button>`).join("")}
      </div>
      <button class="btn" id="fc-world">← World view</button>
    </div>
    <div class="callout fc-verdict ${v.cls}">${v.label ? `<b class="fc-label">${v.label}</b><br>` : ""}${v.text}
      ${top && top.p >= 0.1 ? ` Highest: <b>${pct(top.p)}</b> near ${esc(A.names.get(top.c1) || "")} (usually ${pct(top.u)}).` : ""}
      ${U.years.length ? ` A normal ${mon} here has <b>${fmt(U.median)}</b> detections; ${mon} ${U.last.y} had <b>${fmt(U.last.t)}</b>.` : ""}</div>
    <table class="data">
      <tr><th>Month</th><th>AI chance</th><th>Usual</th><th>Active squares (AI / usual)</th><th>High-risk squares</th></tr>
      ${S.map((x, i) => `<tr${i === k ? ' class="sel"' : ""}><td>${ymLabel(F.months[i])}</td><td><b>${pct(x.mean)}</b></td><td>${pct(x.usual)}</td><td>${fewSquares(x.eAI)} / ${fewSquares(x.eU)} <span class="muted">(${ratioTxt(x)})</span></td><td>${x.high}</td></tr>`).join("")}
    </table>
    <p class="muted small">AI chance = average chance of ≥${F.threshold} VIIRS-eq. detections per 1° square, weighted by how much of each square lies inside the area. Usual = how often those squares reached that level in the same month, ${meta.years[0]}–${meta.years.at(-1)} (the "same as usual" baseline). High-risk = ≥50%.</p>
    ${provs && provs.length ? `<h3>${provs.length < A.provs.length ? `Top ${provs.length} of ${A.provs.length}` : "All"} provinces / republics, ${ymLabel(F.months[k])}</h3>
      <ul class="rank">${provs.map((p, i) => { const x = p.by[k]; return `<li data-pkey="${esc(provKey(p.r))}"><span class="i">${i + 1}</span><span>${esc(p.r.name)}<span class="muted small"> · ${esc(p.r.type || "Province")}</span><div class="bar" style="width:${provs[0].by[k].mean ? (x.mean / provs[0].by[k].mean) * 100 : 0}%;background:${riskClass(x.mean).color}"></div></span><span class="n">${pct(x.mean)} <span class="muted">${ratioTxt(x)}</span></span></li>`; }).join("")}</ul>
      <p class="muted small">Click a province or republic to see its own forecast. "×" = AI vs usual.</p>` : ""}
    <h3>Hottest squares, ${ymLabel(F.months[k])}</h3>
    ${hot.length ? `<ul class="rank">${hot.map((h, i) => `<li data-c1="${h.c1}"><span class="i">${i + 1}</span><span>${esc(A.names.get(h.c1) || "")}<span class="muted small"> · ${fmtLat(cell1ToLatLon(h.c1).lat, cell1ToLatLon(h.c1).lon)}</span><div class="bar" style="width:${(h.p / hot[0].p) * 100}%;background:${riskClass(h.p).color}"></div></span><span class="n">${pct(h.p)} <span class="muted">usually ${pct(h.u)}</span></span></li>`).join("")}</ul>
      <p class="muted small">Click a square to see why the AI rates it this way.</p>` : `<p class="lede small">No square in this area is above 10% this month.</p>`}
    <div class="row-ctl" style="margin-top:16px">
      <button class="btn" id="fc-cal">Fire calendar for this area →</button>
      <button class="btn" id="fc-csv">Download CSV</button>
      <button class="btn" id="fc-link">Copy link</button>
    </div>
    <label class="chip" style="margin-top:14px" aria-pressed="${state.fcOverlay}" id="fc-overlay"><span class="sw" style="background:#ffe39a"></span>Overlay live fires (24h) to check</label>
    <p class="muted small" style="margin-top:12px">Model: gradient-boosted trees (XGBoost) on NASA POWER weather, wind, vegetation and forest data; on unusual fires it is ${F.metrics.unusual_ap ? `${Math.round((F.metrics.unusual_ap / F.metrics.unusual_baseline_ap - 1) * 100)}%` : "much"} more precise than "same as usual" (tested on ${F.metrics.test_years}). Squares are 1° (≈ 110 km), so small provinces share squares with their neighbours.</p>`;

  document.querySelectorAll("[data-fm]").forEach((b) => b.addEventListener("click", () => { state.fcMonth = +b.dataset.fm; renderForecast(); }));
  $("#fc-world").addEventListener("click", () => setFcArea(null));
  $("#fc-overlay").addEventListener("click", () => { state.fcOverlay = !state.fcOverlay; renderForecast(); });
  document.querySelectorAll("#panel-body li[data-pkey]").forEach((li) => li.addEventListener("click", () => setFcArea({ kind: "province", key: li.dataset.pkey })));
  document.querySelectorAll("#panel-body li[data-c1]").forEach((li) => li.addEventListener("click", () => { const ll = cell1ToLatLon(+li.dataset.c1); openCell(ll.lat, ll.lon); }));
  $("#fc-cal").addEventListener("click", () => setArea(state.fcAoi));
  $("#fc-link").addEventListener("click", async (e) => {
    try { await navigator.clipboard.writeText(location.href); e.target.textContent = "Link copied"; } catch { e.target.textContent = "Copy failed"; }
  });
  $("#fc-csv").addEventListener("click", () => {
    const rows = [["area", "month", "lat", "lon", "share_inside", "province", "ai_chance", "usual_chance"]];
    F.months.forEach((ym, i) => {
      for (const [c1, ww] of A.w1) {
        const ll = cell1ToLatLon(c1), p = (F.byCell.get(c1)?.[1 + i] || 0) / 1000;
        rows.push([area.name, ym, ll.lat, ll.lon, ww.toFixed(2), A.names.get(c1) || "", p.toFixed(3), (A.usual[i].rate.get(c1) || 0).toFixed(3)]);
      }
    });
    const csv = rows.map((r) => r.map((x) => (/[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x)).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `ember-atlas_ai-forecast_${String(area.name).replace(/[^\w-]+/g, "_")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  bindFcPicker();
}

// ---------------------------------------------------------------- CELL CARD
async function openCell(lat, lon, fly = true) {
  const c1 = latLonToCell1(lat, lon);
  const center = cell1ToLatLon(c1);
  const sq = { lat0: center.lat - 0.5, lon0: center.lon - 0.5, size: 1 };
  state.cell = { lat, lon };
  globe.setMarker(lat, lon, sq);
  globe.pinned = true;
  globe.controls.autoRotate = false;
  const card = $("#cell"), body = $("#cell-body");
  card.classList.remove("hidden");
  body.innerHTML = `<p class="eyebrow">${fmtExact(lat, lon)}</p><h2>Loading…</h2>`;
  const [d, place, inSq] = await Promise.all([loadCell(c1), placeAt(lat, lon), regionsInSquare(sq.lat0, sq.lon0, 1)]);
  if (state.cell?.lat !== lat) return;
  const det = state.mode === "live" ? nearestLive(lat, lon) : null;
  // Where exactly: the clicked point's region, then the grid square the numbers below come from.
  const kmNS = 111, kmEW = Math.round(111.3 * Math.cos((center.lat * Math.PI) / 180));
  const sqName = `${fmtDeg(sq.lat0, "N", "S")}–${fmtDeg(sq.lat0 + 1, "N", "S")}, ${fmtDeg(sq.lon0, "E", "W")}–${fmtDeg(sq.lon0 + 1, "E", "W")}`;
  const covers = inSq?.list.filter((r) => r.share >= 0.02) || [];
  const head = `
    <p class="eyebrow">${fmtExact(lat, lon)}</p>
    <h2>${esc(place ? place.name : d ? prettyCountry(d.c) || "Unknown" : "Open water")}</h2>
    ${place ? `<p class="muted" style="margin:-4px 0 10px">${esc(place.country)}${place.type && !/viloyati|shahri|Respublikasi/.test(place.name) ? ` · ${esc(place.type)}` : ""}</p>` : ""}
    <div class="sqnote">
      <p class="small" style="margin:0"><b>Fire numbers below are for the outlined square</b> ${sqName}, about ${kmNS} × ${kmEW} km. That's the grid the 25-year record and the AI use, so it can span more than one province (viloyat).</p>
      ${covers.length ? `<p class="small muted" style="margin:6px 0 0">The square covers: ${covers.map((r) => `${esc(r.name)}${r.country !== place?.country ? ` (${esc(r.country)})` : ""} ${pct(r.share)}`).join(" · ")}${inSq.sea >= 0.02 ? ` · water ${pct(inSq.sea)}` : ""}</p>` : ""}
    </div>
    ${place?.country ? `<div class="row-ctl"><button class="btn cal-btn" data-key="${esc(provKey(place))}">Fire calendar for ${esc(place.name)} →</button>${state.mode === "forecast" && forecast ? `<button class="btn fc-btn" data-key="${esc(provKey(place))}">AI forecast for ${esc(place.name)} →</button>` : ""}</div>` : ""}
    ${det ? fireMomentHtml(det) : ""}`;
  if (!d) {
    body.innerHTML = `${head}<h3>No fire on record</h3><p class="lede">No vegetation fire was detected in this square by MODIS or VIIRS since 2000.</p>${SAT_SLOT}`;
    mountImagery(lat, lon, sq, det);
    bindCalBtn();
    return;
  }
  const years = meta.years;
  const yearly = (arr) => years.map((_, yi) => { const [a, b] = meta.yearIdx[yi]; let s = 0; for (let i = a; i <= b; i++) s += arr[i] || 0; return s; });
  const hY = yearly(d.h), mY = yearly(d.mo), vY = yearly(d.vi).map((v, i) => (years[i] >= 2012 ? v : null));
  const total = hY.reduce((s, v) => s + v, 0);
  const peak = hY.indexOf(Math.max(...hY));
  const season = Array(12).fill(0);
  meta.months.forEach((m, i) => (season[(m % 100) - 1] += (d.h[i] || 0) / years.length));
  const fc = d.fc;
  const fcRow = forecast?.byCell?.get(c1) || forecast?.cells.find((r) => r[0] === c1);

  let fcHtml = "";
  if (fc && fcRow) {
    const p = fcRow[1 + state.fcMonth] / 1000, rc = riskClass(p);
    const fm = forecast.months[state.fcMonth];
    const f = fc[state.fcMonth];
    fcHtml = `
      <h3>AI outlook · ${ymLabel(fm)}</h3>
      <div class="prob"><span class="big">${pct(p)}</span><span class="badge"><i style="background:${rc.color}"></i>${rc.name} risk</span></div>
      <p class="lede" style="margin-top:6px">In ${ymLabel(fm).split(" ")[0]}, fire happened here in <b>${f.hist[0]} of ${f.hist[1]}</b> past years. Weather going into it: <b>${f.wx_text}</b>.</p>
      ${f.analogs.length ? `<p class="eyebrow" style="margin-top:12px">Past years with the most similar weather</p>
      <div class="analogs">${f.analogs.map(([y, fired, h]) => `<div class="analog ${fired ? "fire" : ""}"><b>${y}</b> · ${fired ? `fire (${fmt(h)})` : "no fire"}</div>`).join("")}</div>` : ""}
      <p class="eyebrow" style="margin-top:14px">What pushed the prediction</p>
      <ul class="drivers">${f.drivers.map(([name, v]) => {
        const w = Math.min(45, Math.abs(v) * 30);
        return `<li><span>${esc(name)}</span><span class="dbar"><span style="${v >= 0 ? `left:50%;width:${w}%;background:${C.harm}` : `right:50%;width:${w}%;background:${C.modis}`}"></span></span></li>`;
      }).join("")}</ul>
      <div class="legend"><span><i class="sq" style="background:${C.harm}"></i>raises risk</span><span><i class="sq" style="background:${C.modis}"></i>lowers risk</span></div>`;
  }
  const landHtml = landBlock(fc?.[state.fcMonth] || fc?.[0]);

  body.innerHTML = `
    ${head}
    <div class="stats">
      <div class="stat"><div class="v">${fmt(total)}</div><div class="k">Detections since ${years[0]} (unified)</div></div>
      <div class="stat"><div class="v">${years[peak]}</div><div class="k">Worst year</div></div>
    </div>
    ${state.mode === "forecast" ? fcHtml : ""}
    <h3>Every year on one scale</h3>
    <div id="ch-cell-y"></div>
    <h3>Fire season (monthly average)</h3>
    <div id="ch-cell-s"></div>
    ${landHtml}
    ${state.mode !== "forecast" ? fcHtml : ""}
    ${SAT_SLOT}
  `;
  mountImagery(lat, lon, sq, det);
  bindCalBtn();
  lineChart($("#ch-cell-y"), {
    labels: years.map(String),
    series: [ // unified drawn last so it sits on top where it equals VIIRS (2012+)
      { name: "MODIS raw", color: C.modis, values: mY, width: 1.5 },
      { name: "VIIRS raw", color: C.viirs, values: vY, width: 1.5 },
      { name: "Unified", color: C.harm, values: hY },
    ],
    xTicks: (i, l) => (i % 5 === 0 ? l : null),
    height: 130,
  });
  const peakM = season.indexOf(Math.max(...season));
  barChart($("#ch-cell-s"), {
    values: season, labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    color: "rgba(217,89,38,.45)", highlight: new Set([peakM]), highlightColor: C.harm,
    xTicks: (i, l) => l[0], tipLabel: "Avg detections", height: 90,
  });
  if (fly) globe.flyTo(lat, lon, Math.min(globe.camera.position.length(), 2.4));
}

function closeCell() {
  stopLoop();
  $("#cell").classList.add("hidden");
  state.cell = null;
  globe.setMarker(null);
  globe.pinned = false;
}

// ---------------------------------------------------------------- LAND & VEGETATION (click card)
function landBlock(f) {
  if (!f || (!f.land && !f.veg)) return "";
  const L = f.land || {};
  const lcNames = { tree: "trees", shrub: "shrubs", grass: "grassland", crop: "cropland", built: "built-up", bare: "bare ground" };
  const lcColors = { tree: "#2f8f4e", shrub: "#8a9a3b", grass: "#c6b04a", crop: "#d9822b", built: "#9aa0a6", bare: "#6b5a4a" };
  const lc = L.lc ? Object.entries(L.lc).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]) : [];
  return `
    <h3>Land &amp; vegetation in this square</h3>
    ${L.lc || L.loss_recent != null ? `<div class="stats">
      ${L.lc ? `<div class="stat"><div class="v">${Math.round(L.lc.tree)}%</div><div class="k">Covered by trees (ESA WorldCover 2021)</div></div>` : ""}
      ${L.loss_recent != null ? `<div class="stat"><div class="v">${L.loss_recent}%</div><div class="k">Of the square lost tree cover ${L.loss_years}</div></div>` : ""}
    </div>` : ""}
    ${lc.length ? `<div class="lcbar">${lc.map(([k, v]) => `<span style="width:${v}%;background:${lcColors[k]}" title="${lcNames[k]} ${v}%"></span>`).join("")}</div>
      <div class="legend">${lc.slice(0, 4).map(([k, v]) => `<span><i class="sq" style="background:${lcColors[k]}"></i>${lcNames[k]} ${Math.round(v)}%</span>`).join("")}</div>` : ""}
    ${f.veg ? `<p class="lede" style="margin-top:8px">Vegetation last month: <b>${esc(f.veg.text)}</b> (NDVI ${f.veg.ndvi}).</p>` : ""}
    <p class="muted small">Sources: Hansen Global Forest Change (UMD/Google), ESA WorldCover 2021, NASA MODIS NDVI.</p>`;
}

// ---------------------------------------------------------------- SATELLITE PICTURES (click card)
const SAT_SLOT = `<div id="sat" class="sat"></div>`;
let loopTimer = null;
function stopLoop() { if (loopTimer) { clearInterval(loopTimer); loopTimer = null; } }

/** Nearest live detection to a click (within ~10 km), from what the Live view currently shows. */
function nearestLive(lat, lon) {
  if (!state.live) return null;
  const L = liveView();
  let best = null, bd = 0.1 * 0.1;
  const k = Math.cos((lat * Math.PI) / 180) ** 2;
  for (const d of L.all) {
    const dd = (d.lat - lat) ** 2 + k * (d.lon - lon) ** 2;
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}
function fireMomentHtml(det) {
  const P = passImage(det);
  return `
    <h3>The moment a satellite saw it</h3>
    <figure class="satfig"><img src="${P.url}" alt="Satellite picture of the fire" loading="lazy" onerror="this.closest('figure').classList.add('noimg')"><span class="noimg-msg">No image for this pass yet (NASA usually publishes within ~3 h).</span>
      <figcaption>${esc(P.caption)}</figcaption></figure>
    <div class="stats">
      <div class="stat"><div class="v">${esc(det.t.slice(11))}</div><div class="k">${esc(det.t.slice(0, 10))} · ${esc(P.sat)}${det.dn === "N" ? " · night" : ""}</div></div>
      <div class="stat"><div class="v">${fmt(det.frp)} MW</div><div class="k">Fire radiative power${det.kind ? ` · flagged as ${["", "volcano", "gas flare", "industrial"][det.kind]}` : ""}</div></div>
    </div>`;
}

function mountImagery(lat, lon, sq, det) {
  stopLoop();
  const el = $("#sat");
  if (!el) return;
  const day = det ? det.t.slice(0, 10) : isoDay(new Date(Date.now() - 864e5));
  el.innerHTML = `
    <h3>Satellite pictures of this place</h3>
    <div class="seg sat-tabs" role="tablist">
      <button data-st="daily" aria-pressed="true">Daily photos</button>
      <button data-st="loop" aria-pressed="false">Last hours</button>
      <button data-st="sharp" aria-pressed="false">Sharp (Sentinel-2)</button>
    </div>
    <div id="sat-body"></div>
    <p class="small" style="margin-top:8px"><a href="${worldviewLink(lat, lon, day)}" target="_blank" rel="noopener">Open in NASA Worldview ↗</a> · <a href="${copernicusLink(lat, lon)}" target="_blank" rel="noopener">Copernicus Browser ↗</a></p>
    <p class="muted small">Clouds hide fires in normal photos; at night only heat/infrared views work. Daily NASA photos are 250–375 m per pixel; the 10–15-minute weather satellites are 1–3 km (they see big fires and smoke, not single fields); Sentinel-2 is 10–20 m but only every 2–5 days. No free source is both daily and sharp.</p>`;
  const tabs = el.querySelectorAll("[data-st]");
  const show = (k) => {
    stopLoop();
    tabs.forEach((b) => b.setAttribute("aria-pressed", b.dataset.st === k));
    if (k === "daily") showDaily(sq);
    else if (k === "loop") showLoop(lat, lon);
    else showSharp(lat, lon, det);
  };
  tabs.forEach((b) => b.addEventListener("click", () => show(b.dataset.st)));
  show("daily");
}

function showDaily(sq) {
  const strip = dailyStrip(sq, 7);
  const body = $("#sat-body");
  body.innerHTML = `
    <figure class="satfig"><img id="sat-main" alt="Daily satellite photo" src="${strip.at(-1).url}" onerror="this.closest('figure').classList.add('noimg')"><span class="noimg-msg">No image for this day.</span>
      <figcaption id="sat-cap">NOAA-20 VIIRS true colour + fire pixels (red), ${strip.at(-1).day}, the outlined 1° square. Source: NASA GIBS.</figcaption></figure>
    <div class="thumbs">${strip.map((s, i) => `<button data-i="${i}" aria-pressed="${i === strip.length - 1}"><img src="${s.url}" alt="${s.day}" loading="lazy"><span>${s.day.slice(5)}</span></button>`).join("")}</div>`;
  body.querySelectorAll(".thumbs button").forEach((b) => b.addEventListener("click", () => {
    const s = strip[+b.dataset.i];
    const fig = body.querySelector(".satfig");
    fig.classList.remove("noimg");
    $("#sat-main").src = s.url;
    $("#sat-cap").textContent = `NOAA-20 VIIRS true colour + fire pixels (red), ${s.day}, the outlined 1° square. Source: NASA GIBS.`;
    body.querySelectorAll(".thumbs button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  }));
}

function showLoop(lat, lon) {
  const { sat, frames } = geoFrames(lat, lon, 12, 2);
  const body = $("#sat-body");
  body.innerHTML = `
    <figure class="satfig loop"><img id="loop-img" alt="Weather-satellite loop"><span class="noimg-msg">Loading frames…</span>
      <figcaption><b id="loop-t">–</b> · ${esc(sat.name)}${sat.night ? " (night: infrared, colours = cold cloud tops)" : ""}, every ${sat.step} min, 4° box around the point (centre).
        ${sat.kind === "eum" ? "Red/orange pixels = EUMETSAT's own fire detections." : "Big fires show as smoke plumes; this view has no fire overlay."} Source: ${sat.kind === "eum" ? "EUMETSAT" : "NASA GIBS"}.</figcaption></figure>
    <div class="row-ctl"><button class="btn" id="loop-play">Pause</button><input type="range" id="loop-pos" min="0" max="${frames.length - 1}" value="${frames.length - 1}"></div>`;
  const imgs = frames.map((f) => { const im = new Image(); im.src = f.url; return im; });
  const pic = $("#loop-img"), lab = $("#loop-t"), pos = $("#loop-pos"), fig = body.querySelector(".satfig");
  let i = 0, playing = true;
  const draw = () => {
    const im = imgs[i];
    if (im.complete && im.naturalWidth) { pic.src = im.src; fig.classList.remove("noimg"); }
    else fig.classList.add("noimg");
    lab.textContent = fmtUTC(frames[i].time);
    pos.value = i;
  };
  const tick = () => { i = (i + 1) % frames.length; draw(); };
  loopTimer = setInterval(tick, 700);
  $("#loop-play").addEventListener("click", (e) => {
    playing = !playing;
    e.target.textContent = playing ? "Pause" : "Play";
    if (playing) loopTimer = setInterval(tick, 700); else stopLoop();
  });
  pos.addEventListener("input", () => { i = +pos.value; draw(); });
  draw();
}

async function showSharp(lat, lon, det) {
  const body = $("#sat-body");
  body.innerHTML = `<p class="muted small">Searching Sentinel-2 scenes (Microsoft Planetary Computer)…</p>`;
  const now = new Date();
  const ref = det ? new Date(det.t.slice(0, 10) + "T00:00:00Z") : now;
  const day = 864e5;
  const [before, after] = await Promise.all([
    s2Scene(lat, lon, new Date(ref - 75 * day), new Date(ref - day)),
    det ? s2Scene(lat, lon, ref, now) : Promise.resolve(null),
  ]);
  if (!$("#sat-body") || body !== $("#sat-body")) return;
  if (!before && !after) {
    body.innerHTML = `<p class="lede">No cloud-free Sentinel-2 scene found here in the last ~2.5 months.</p>`;
    return;
  }
  const cap = (s) => `${s.date} · ${s.cloud}% cloud`;
  const legend = `<p class="muted small">"Fire view" uses short-wave infrared (bands 12, 8A, 4): active flames show bright orange/yellow, fresh burn scars dark red-brown, healthy plants green. It sees through thin smoke. Source: ESA Copernicus Sentinel-2 via Microsoft Planetary Computer.</p>`;
  if (before && after) {
    body.innerHTML = `
      <div class="ba" id="ba">
        <img src="${s2Url(after.id, lat, lon)}" alt="After">
        <div class="ba-top" id="ba-top"><img src="${s2Url(before.id, lat, lon)}" alt="Before"></div>
        <span class="ba-l">Before · ${cap(before)}</span><span class="ba-r">After · ${cap(after)}</span>
      </div>
      <input type="range" id="ba-pos" min="0" max="100" value="50" aria-label="Before/after">
      ${legend}`;
    const top = $("#ba-top"), pos = $("#ba-pos");
    const set = () => (top.style.clipPath = `inset(0 ${100 - pos.value}% 0 0)`);
    pos.addEventListener("input", set);
    set();
  } else {
    const s = before || after;
    body.innerHTML = `
      <figure class="satfig"><img id="s2img" src="${s2Url(s.id, lat, lon)}" alt="Sentinel-2 fire view" onerror="this.closest('figure').classList.add('noimg')"><span class="noimg-msg">Image could not be rendered.</span>
        <figcaption>${det ? (before ? `Before the fire: ${cap(s)}. No clear scene since the fire yet (Sentinel-2 passes every 2–5 days; clouds).` : `After the fire: ${cap(s)}.`) : `Clearest recent scene: ${cap(s)}`}, about 15 × 15 km around the point.</figcaption></figure>
      <div class="seg"><button data-m="fire" aria-pressed="true">Fire view</button><button data-m="true" aria-pressed="false">True colour</button></div>
      ${legend}`;
    body.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => {
      $("#s2img").src = s2Url(s.id, lat, lon, 0.07, b.dataset.m);
      body.querySelectorAll("[data-m]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    }));
  }
}

// ---------------------------------------------------------------- ABOUT
function openAbout() {
  const cal = meta.calibration, M = forecast?.metrics;
  $("#about-body").innerHTML = `
    <h2>How Ember Atlas works</h2>
    <p>NASA's MODIS (Terra 1999, Aqua 2002) and VIIRS (Suomi NPP 2012, NOAA-20 2017, NOAA-21 2022) both detect fires from orbit, but they don't measure the same way. VIIRS pixels are 375 m against MODIS's 1 km, so VIIRS sees smaller fires and reports about <b>${cal.global_ratio.toFixed(1)}×</b> more detections. If you stitch the two records together as they are, fire seems to jump in 2012.</p>
    <h3>1 · Unify</h3>
    <ul>
      <li>${fmt(meta.stats.detections)} detections, ${meta.years[0]}–${meta.years.at(-1)}, from NASA FIRMS standard archives, put into one schema.</li>
      <li>Only vegetation fires kept (volcanoes, gas flares and industrial heat removed). Low-confidence detections dropped. MODIS 0–100 confidence mapped to the VIIRS low/nominal/high classes.</li>
      <li>Counted on a 0.5° grid per month. Raw dot counts can't be compared across pixel sizes; grid totals can.</li>
      <li><b>Calibration:</b> for every 5° block and season, a VIIRS÷MODIS ratio is learned from the overlap years (2012–2025), pulled toward the global ratio where data is sparse. MODIS-only years (2000–2011) are then expressed in VIIRS-equivalent units.</li>
      <li><b>Validation:</b> ratios fitted on 2012–2018 only, then used to predict VIIRS 2019–2025 from MODIS. Monthly global error ${Math.round(cal.global_monthly_mape_regional * 100)}% (raw MODIS: ${Math.round(cal.global_monthly_mape_raw_modis * 100)}%). Block-level R² (log): ${cal.block_month_r2_log_regional} vs ${cal.block_month_r2_log_raw_modis}.</li>
    </ul>
    <h3>Fire Calendar</h3>
    <p>Pick any country or province (Natural Earth borders), or draw a box. Each 0.5° cell is weighted by the share of it inside the area, and the unified monthly counts become a year × month calendar. "Normal" for a month is its median over all years; a month is <b>unusual</b> when it is more than 2 robust spreads (median absolute deviation, log scale) above or below that. The <b>critical period</b> is the smallest set of months that holds 80% of a normal year's fire. Trends use the Theil–Sen slope with a Mann–Kendall test. Everything downloads as CSV.</p>
    <h3>AI forecast for an area</h3>
    <p>In the AI Forecast tab, search or click a country, province or republic, or draw a box. The 1° forecast squares inside it are weighted by how much of each lies inside the area. The panel compares the AI's chance with the <b>"same as usual" baseline</b> (how often those squares reached ≥30 detections in that month since 2001), ranks a country's provinces, lists the hottest squares, and downloads as CSV. Shareable link: <code>?mode=forecast&amp;area=country:Uzbekistan</code>.</p>
    <h3>2 · Live</h3>
    <p>Near-real-time FIRMS feeds from 4 satellites: VIIRS on NOAA-21 and NOAA-20, MODIS on Terra and Aqua (Suomi NPP stopped delivering data on 2 Nov 2026). Detections of the same fire seen by different satellites are merged, so each fire counts once. <b>Fires only</b> takes gas flares (VIIRS Nightfire sites), volcanoes (Smithsonian) and industrial heat (25 years of NASA labels) out of the count and draws them in their own colours.</p>
    <p>Click any fire to see <b>real satellite pictures</b>: the photo from the very pass that detected it, a 10–15-minute weather-satellite loop of the last hours (GOES, Meteosat, Himawari), daily NASA photos, and a sharp Sentinel-2 "fire view" before/after. A smoke or carbon-monoxide layer can be draped over the globe.</p>
    <h3>3 · Predict</h3>
    <p>For each 1° cell and month: did significant fire happen? The model only uses what was known at the end of the month before:</p>
    <ul>
      <li><b>Place history:</b> how often the cell burned in that calendar month in earlier years, how big, and whether last year.</li>
      <li><b>Weather</b> (NASA POWER): max temperature, rainfall, humidity, wind, root-zone soil moisture and their anomalies, plus drought memory and vapour-pressure deficit.</li>
      <li><b>Analog score:</b> how often fire followed when this cell's weather looked like this year's.</li>
      <li><b>Forest &amp; vegetation</b> (tested one by one; kept only if they helped): years since the last fire, forest loss (Hansen), land cover (ESA WorldCover), vegetation greenness (MODIS NDVI).</li>
    </ul>
    <p>A gradient-boosted model (XGBoost) is trained offline on ${M ? M.train_years : "past years"} and tested on ${M ? M.test_years : "held-out years"}${M?.feature_sets ? ` with ${M.n_features} inputs` : ""}. ${M ? `Test score: ROC-AUC ${M.auc.toFixed(3)} (vs ${M.baseline_auc.toFixed(3)} for "same as usual")${M.unusual_ap ? `; on unusual fires, average precision ${M.unusual_ap.toFixed(3)} vs ${M.unusual_baseline_ap.toFixed(3)}` : ""}.` : ""}</p>
    <p class="muted small">Data: NASA FIRMS (MODIS C6.1, VIIRS C2), NASA POWER, NASA MODIS NDVI (GIBS), Hansen Global Forest Change (CC BY 4.0), ESA WorldCover (CC BY 4.0), VIIRS Nightfire gas flares (EOG, CC BY-NC 4.0), Smithsonian GVP, EUMETSAT, Copernicus Sentinel-2 via Microsoft Planetary Computer, Natural Earth. Built for the NASA Space Apps Challenge.</p>
  `;
  $("#about").showModal();
  $("#about").scrollTop = 0; // showModal focuses the Close button at the bottom
}

boot().catch((e) => {
  console.error(e);
  $("#loader .loader-text").textContent = "Failed to load data: " + e.message;
});
