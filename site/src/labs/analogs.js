// Lab · Moon & Mars on Earth (NASA Space Apps 2026 "Identify Earth Locations that Analog the Permanent Moon Base
// Locations and Mars"). Every 1° land cell is scored for how much it resembles the lunar south pole or Mars,
// from NASA POWER weather, MODIS greenness and ESA WorldCover (pipeline/labs_analogs.py). Click a place to see
// why it matches, then fly to its twin on the Moon or Mars and compare side by side.
import { travel, resetBody, BODIES } from "./planets.js";

const URL_DATA = "/data/labs/analogs/analogs.json";
const RAMPS = { mars: ["#7a1d0b", "#d9471f", "#f59a23", "#ffe39a"], moon: ["#1c3f73", "#2a78d6", "#3987e5", "#9ec5f4"] };
let ctx, D, idx, sorted;
const S = { target: "mars", sel: null, body: null, busy: false, names: new Map() };
const $ = (s) => document.querySelector(s);

function css() {
  if (document.getElementById("an-style")) return;
  const st = document.createElement("style"); st.id = "an-style";
  st.textContent = `
  .an-score { display:flex; align-items:baseline; gap:10px; margin:6px 0 2px; }
  .an-score b { font-size:40px; line-height:1; font-family:var(--mono); }
  .an-score span { color:var(--text-2); font-size:12.5px; }
  .an-bars { display:grid; gap:7px; margin:10px 0 6px; }
  .an-bar { display:grid; grid-template-columns: 1fr 74px; gap:2px 10px; font-size:12px; color:var(--text-2); }
  .an-bar .an-t { color:var(--text); }
  .an-bar .an-v { text-align:right; font-family:var(--mono); font-size:11.5px; }
  .an-bar i { grid-column:1 / -1; height:5px; border-radius:3px; background:rgba(255,255,255,.07); position:relative; overflow:hidden; }
  .an-bar i em { position:absolute; inset:0 auto 0 0; border-radius:3px; }
  .an-legend { display:flex; align-items:center; gap:8px; font-size:11.5px; color:var(--text-3); margin:6px 0 2px; }
  .an-legend i { flex:1; height:8px; border-radius:4px; }
  .an-cond { font-size:12.5px; line-height:1.5; color:var(--text-2); border:1px solid var(--line); border-radius:10px; padding:8px 11px; margin:8px 0; }
  .an-cond div { display:grid; grid-template-columns: 112px 1fr; gap:8px; padding:2px 0; }
  .an-cond div b { color:var(--text); font-weight:600; }
  .an-list tr { cursor:pointer; }
  .an-list tr:hover td { background:rgba(255,255,255,.04); }
  .an-list td.an-n { text-align:right; font-family:var(--mono); }
  .an-pill { display:inline-block; font-size:10.5px; padding:1px 7px; border-radius:999px; background:rgba(56,209,240,.14); color:#8fe3f5; margin-left:4px; }
  .an-twin { display:grid; grid-template-columns: 1fr 1fr 1fr; gap:0; font-size:12.5px; margin:8px 0; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .an-twin > div { padding:6px 9px; border-bottom:1px solid var(--line); }
  .an-twin > div.h { font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--text-3); background:rgba(255,255,255,.03); }
  .an-twin > div.k { color:var(--text-2); }
  .an-btns { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
  .an-go { border-color: rgba(240,138,36,.6) !important; background: var(--ember-soft) !important; }
  .an-src a { color:var(--text-2); }
  `;
  document.head.appendChild(st);
}

// ---------------------------------------------------------------- data helpers
const latOf = (c) => 90 - (Math.floor(c / 360) + 0.5), lonOf = (c) => -180 + (c % 360) + 0.5;
const ramp01 = (x, full, zero) => (x == null ? null : Math.max(0, Math.min(1, (x - zero) / (full - zero))));
const feat = (i, f) => D.features[f][i];
function fmtF(f, x) {
  if (x == null) return "–";
  const inf = D.featureInfo[f];
  return `${inf.dec ? x.toFixed(inf.dec) : Math.round(x)}${inf.unit && inf.unit !== "0–1" ? " " + inf.unit : ""}`;
}
function pct(target, score) { const a = sorted[target]; let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < score) lo = m + 1; else hi = m; } return (100 * lo) / a.length; }
async function nameOf(lat, lon) {
  const k = `${lat.toFixed(1)},${lon.toFixed(1)}`;
  if (S.names.has(k)) return S.names.get(k);
  const r = await ctx.area.placeAt(lat, lon);
  const n = r ? `${r.name}${r.country && r.country !== r.name ? ", " + ctx.h.prettyCountry(r.country) : ""}` : (lat < -60 ? "Antarctica" : `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`);
  S.names.set(k, n);
  return n;
}
function breakdown(i, target) {
  return D.criteria[target].map((c) => {
    const x = feat(i, c.f), s = ramp01(x, c.full, c.zero);
    return { ...c, x, s, label: D.featureInfo[c.f].label };
  });
}

// ---------------------------------------------------------------- globe
function draw() {
  const g = ctx.globe;
  if (S.body) { ["anLow", "anHigh", "anSites"].forEach((l) => g.hideLayer(l)); return; }
  const sc = D[S.target], lo = [], hi = [];
  for (let i = 0; i < D.cells.length; i++) {
    // near the poles 1° cells crowd together: keep about one per equal-area slot so dots don't form rings
    const c = D.cells[i], la = latOf(c), stride = Math.max(1, Math.round(1 / Math.cos((la * Math.PI) / 180)));
    if (stride > 1 && (c % 360) % stride !== 0) continue;
    (sc[i] >= 50 ? hi : lo).push(i);
  }
  const layer = (name, list, opacity, size, twinkle) => {
    const lats = new Float32Array(list.length), lons = new Float32Array(list.length), vv = new Float32Array(list.length);
    list.forEach((i, j) => { lats[j] = latOf(D.cells[i]); lons[j] = lonOf(D.cells[i]); vv[j] = sc[i] / 100; });
    g.setPoints(name, { lats, lons, values: vv, ramp: S.target === "mars" ? "heat" : "modis", size, minSize: 0.45, opacity, soft: 0.45, blending: ctx.blend.normal, radius: 1.004, twinkle });
  };
  layer("anLow", lo, 0.32, 0.016, 0);
  layer("anHigh", hi, 0.95, 0.02, 0.8);
  const ks = D.known.filter((k) => k.targets.includes(S.target));
  g.setPoints("anSites", {
    lats: Float32Array.from(ks, (k) => k.lat), lons: Float32Array.from(ks, (k) => k.lon), values: new Float32Array(ks.length).fill(1),
    ramp: "flare", size: 0.03, minSize: 1, opacity: 1, soft: 0.25, blending: ctx.blend.additive, radius: 1.006, twinkle: 1,
  });
  if (S.sel != null) g.setMarker(latOf(D.cells[S.sel]), lonOf(D.cells[S.sel]), { lat0: latOf(D.cells[S.sel]) - 0.5, lon0: lonOf(D.cells[S.sel]) - 0.5, size: 1 });
  else g.setMarker(null);
}

// ---------------------------------------------------------------- lifecycle
async function enter(c, params) {
  ctx = c; css();
  resetBody(ctx.globe);
  ctx.panel.innerHTML = `<p class="eyebrow">Labs · Moon &amp; Mars on Earth</p><h2>Loading…</h2>`;
  if (!D) {
    D = await (await fetch(URL_DATA + ctx.v)).json();
    idx = new Map(); D.cells.forEach((cc, i) => idx.set(cc, i));
    sorted = { mars: [...D.mars].sort((a, b) => a - b), moon: [...D.moon].sort((a, b) => a - b) };
  }
  if (params.get("target") === "moon") S.target = "moon";
  const cp = params.get("cell"); if (cp && idx.has(+cp)) S.sel = idx.get(+cp);
  S.body = null;
  draw(); panel();
  if (S.sel != null) ctx.globe.flyTo(latOf(D.cells[S.sel]), lonOf(D.cells[S.sel]), 2.2);
  else ctx.globe.flyTo(S.target === "mars" ? 25 : -60, S.target === "mars" ? 40 : 90, 2.9);
}
function exit() {
  ["anLow", "anHigh", "anSites"].forEach((l) => ctx.globe.hideLayer(l));
  ctx.globe.setMarker(null);
  resetBody(ctx.globe);
  S.body = null; S.busy = false;
}
function url() { ctx.setParams({ target: S.target, cell: S.sel != null ? D.cells[S.sel] : null }); }

function setTarget(t) { S.target = t; draw(); panel(); url(); }
function select(i, fly = true) {
  S.sel = i; draw(); panel(); url();
  if (fly) ctx.globe.flyTo(latOf(D.cells[i]), lonOf(D.cells[i]), 2.2);
}

// ---------------------------------------------------------------- panel (Earth)
function legend() {
  const r = RAMPS[S.target];
  return `<div class="an-legend"><span>not alike</span><i style="background:linear-gradient(90deg, ${r[0]}, ${r[1]} 35%, ${r[2]} 65%, ${r[3]})"></i><span>very alike</span></div>`;
}
function conditions() {
  const t = D.targets[S.target];
  return `<div class="an-cond">${t.conditions.map(([k, v]) => `<div><b>${ctx.h.esc(k)}</b><span>${ctx.h.esc(v)}</span></div>`).join("")}
    <div class="an-src muted small" style="display:block;margin-top:4px">Sources: ${t.sources.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${ctx.h.esc(n)}</a>`).join(" · ")}</div></div>`;
}
function selCard() {
  if (S.sel == null) return `<p class="lede small" style="margin-top:10px">Click any land on the globe, a cyan analog site, or a place in the lists below.</p>`;
  const i = S.sel, c = D.cells[i], sc = D[S.target][i], bd = breakdown(i, S.target), tg = D.targets[S.target];
  const good = bd.filter((b) => b.s != null && b.s >= 0.75).sort((a, b) => b.w - a.w).slice(0, 3);
  const bad = bd.filter((b) => b.s != null && b.s < 0.35).sort((a, b) => b.w - a.w).slice(0, 2);
  const col = RAMPS[S.target][3];
  const twin = twinOf(i);
  return `
    <div class="td-result">
      <h3 id="an-name">${latOf(c).toFixed(1)}°, ${lonOf(c).toFixed(1)}°</h3>
      <div class="an-score"><b style="color:${col}">${sc}</b><span>/ 100 like ${S.target === "mars" ? "Mars" : "the lunar south pole"} · ${pct(S.target, sc) >= 99 ? "in the top 1% of Earth's land" : `more alike than ${pct(S.target, sc).toFixed(0)}% of Earth's land`}</span></div>
      <div class="an-bars">${bd.map((b) => `<div class="an-bar" title="${ctx.h.esc(b.why)}"><span class="an-t">${b.label}</span><span class="an-v">${fmtF(b.f, b.x)}</span>
        <i><em style="width:${Math.round((b.s ?? 0) * 100)}%;background:${b.s == null ? "transparent" : b.s >= 0.75 ? col : b.s >= 0.35 ? RAMPS[S.target][2] : RAMPS[S.target][1]}"></em></i></div>`).join("")}</div>
      <p class="muted small" style="margin:0">Bar = how well each condition matches (hover for why it matters). Weights: ${bd.map((b) => `${b.label.split(" ")[0].toLowerCase()} ${Math.round(b.w * 100)}%`).join(", ")}.</p>
      <div class="callout">${good.length ? `<b>Matches:</b> ${good.map((b) => b.label.toLowerCase()).join(", ")}. ` : ""}${bad.length ? `<b>Falls short:</b> ${bad.map((b) => b.label.toLowerCase()).join(", ")}.` : "No condition falls far short."}</div>
      <div class="an-btns"><button class="btn an-go" id="an-twin">See its twin: ${ctx.h.esc(twin.site)} →</button><button class="btn" id="an-clear">Clear</button></div>
    </div>`;
}
function twinOf(i) {
  const tg = D.targets[S.target];
  if (S.target === "mars" && tg.alt_site && feat(i, "tcold") < -10 && (feat(i, "ice") ?? 0) > 30) return tg.alt_site;
  return { site: tg.site, lat: tg.lat, lon: tg.lon };
}
function topList() {
  const out = [], picked = [];
  for (const t of D.top[S.target]) {
    if (picked.some((p) => Math.hypot(p.lat - t.lat, (p.lon - t.lon) * Math.cos((t.lat * Math.PI) / 180)) < 4)) continue;
    picked.push(t); out.push(t); if (out.length >= 6) break;
  }
  return out;
}
function panel() {
  if (S.body) return twinPanel();
  const esc = ctx.h.esc, isM = S.target === "mars";
  const ks = D.known.filter((k) => k.targets.includes(S.target)).sort((a, b) => b[S.target] - a[S.target]);
  const tops = topList();
  ctx.panel.innerHTML = `
    <div class="lab-top"><button class="btn" id="lab-back">← Back to Ember Atlas</button><span class="lab-tag" style="color:#7fe0b8">Labs · Easy</span></div>
    <p class="eyebrow">NASA Space Apps · Earth analogs for the Moon &amp; Mars</p>
    <h2>Where on Earth is most like ${isM ? "Mars" : "the Moon's south pole"}?</h2>
    <p class="lede small">Every 1° square of land scored from 25 years of NASA climate, vegetation and land-cover data. Bright twinkling dots are the closest matches; cyan stars are analog sites NASA and ESA already use.</p>
    <div class="seg" role="group" aria-label="Target">
      <button data-an-t="mars" aria-pressed="${isM}">Mars</button><button data-an-t="moon" aria-pressed="${!isM}">Moon · south pole</button>
    </div>
    ${legend()}
    ${conditions()}
    ${selCard()}
    <h3>New candidates: highest-scoring places</h3>
    <table class="data an-list" id="an-top">${tops.map((t) => `<tr data-cell="${t.cell}"><td data-ll="${t.lat},${t.lon}">${t.lat.toFixed(1)}°, ${t.lon.toFixed(1)}°</td><td class="an-n">${t.score}</td></tr>`).join("")}</table>
    <p class="muted small">One entry per region (places within 4° of a better one are skipped).</p>
    <h3>Checking against known analog sites</h3>
    <table class="data an-list" id="an-known"><tr><th>Site</th><th>Score</th><th>Rank</th></tr>${ks.map((k) => `<tr data-cell="${k.cell}" title="${esc(k.use)}"><td>${esc(k.name)}${k.near_km ? `<span class="an-pill">nearest data ${k.near_km} km</span>` : ""}<div class="muted small">${esc(k.use)}</div></td><td class="an-n">${k[S.target]}</td><td class="an-n">top ${Math.max(1, Math.round(100 - k[S.target + "_pct"]))}%</td></tr>`).join("")}</table>
    <p class="muted small" style="margin-top:8px"><b>How to read this:</b> the score uses climate and surface only (dryness, cold, bare ground, ice, greenness, altitude, latitude). Sites chosen for their rocks or chemistry, like Rio Tinto's acid river or Pilbara's ancient fossils, score low here even though they are excellent analogs for other reasons. Cells are 1° (about 110 km), so a narrow ice-free valley can be averaged with the ice around it.</p>
    <p class="muted small an-src">Data: ${D.sources.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${esc(n)}</a>`).join(" · ")}. Polar cells missing from the cached weather were filled from NASA POWER's monthly climatology.</p>`;
  bind();
  // place names, filled in when ready
  ctx.panel.querySelectorAll("#an-top td[data-ll]").forEach(async (td) => { const [la, lo] = td.dataset.ll.split(",").map(Number); td.textContent = await nameOf(la, lo); });
  if (S.sel != null) nameOf(latOf(D.cells[S.sel]), lonOf(D.cells[S.sel])).then((n) => { const h = $("#an-name"); if (h) h.textContent = n; });
}

function bind() {
  $("#lab-back").addEventListener("click", () => ctx.back());
  ctx.panel.querySelectorAll("[data-an-t]").forEach((b) => b.addEventListener("click", () => setTarget(b.dataset.anT)));
  ctx.panel.querySelectorAll(".an-list tr[data-cell]").forEach((tr) => tr.addEventListener("click", () => { const i = idx.get(+tr.dataset.cell); if (i != null) select(i); }));
  $("#an-twin")?.addEventListener("click", goTwin);
  $("#an-clear")?.addEventListener("click", () => { S.sel = null; draw(); panel(); url(); });
}

// ---------------------------------------------------------------- the twin on the Moon / Mars
async function goTwin() {
  if (S.busy || S.sel == null) return;
  S.busy = true;
  const tw = twinOf(S.sel), kind = S.target;
  S.body = kind; S.twin = tw;
  ctx.globe.setMarker(null);
  draw();
  ctx.panel.innerHTML = `<p class="eyebrow">Leaving Earth…</p><h2>Flying to ${kind === "mars" ? "Mars" : "the Moon"}</h2>`;
  const viewLat = Math.max(-80, Math.min(80, tw.lat));
  await travel(ctx.globe, kind, { lat: viewLat, lon: tw.lon, dist: 2.1 });
  if (S.body !== kind) { S.busy = false; return; }
  ctx.globe.setMarker(tw.lat, tw.lon);
  S.busy = false;
  twinPanel();
}
async function backToEarth() {
  if (S.busy) return;
  S.busy = true;
  const i = S.sel, la = latOf(D.cells[i]), lo = lonOf(D.cells[i]);
  ctx.globe.setMarker(null);
  ctx.panel.innerHTML = `<p class="eyebrow">Heading home…</p><h2>Back to Earth</h2>`;
  await travel(ctx.globe, "earth", { lat: la, lon: lo, dist: 2.2 });
  S.body = null; S.busy = false;
  draw(); panel();
}
function twinPanel() {
  const i = S.sel, kind = S.body, tg = D.targets[kind], tw = S.twin, esc = ctx.h.esc;
  const elev = feat(i, "elev") ?? 0, pEarth = 101.3 * Math.exp(-elev / 8400);
  const cmp = tg.compare;
  const row = (k, a, b) => `<div class="k">${k}</div><div>${a}</div><div>${b}</div>`;
  const earthName = S.names.get(`${latOf(D.cells[i]).toFixed(1)},${lonOf(D.cells[i]).toFixed(1)}`) || "Earth site";
  const tGrav = kind === "mars" ? "3.71 m/s²" : "1.62 m/s²";
  ctx.panel.innerHTML = `
    <div class="lab-top"><button class="btn" id="an-home">← Back to Earth</button><span class="lab-tag" style="color:#7fe0b8">Labs · Easy</span></div>
    <p class="eyebrow">You are on ${kind === "mars" ? "Mars" : "the Moon"}</p>
    <h2>${esc(tw.site)}</h2>
    <p class="lede small">${kind === "mars"
      ? (tw.site.startsWith("Phoenix") ? "Flat northern plains where NASA's Phoenix lander scraped up water ice and found perchlorate salts in 2008." : "An ancient lake with a river delta, where NASA's Perseverance rover collects rock samples that may hold signs of past life.")
      : "The rim of Shackleton crater at the lunar south pole: ridges in near-constant sunlight next to craters that have not seen the Sun for billions of years and hold water ice. Artemis astronauts are headed for this region."}</p>
    <div class="an-twin">
      <div class="h">Condition</div><div class="h">${esc(earthName)}</div><div class="h">${esc(tw.site)}</div>
      ${row("Daily high (avg)", fmtF("tmax", feat(i, "tmax")), kind === "mars" ? "about −20 °C" : "about −100 °C")}
      ${row("Coldest month", fmtF("tcold", feat(i, "tcold")), kind === "mars" ? "about −80 °C" : "−170 °C, −230 °C in dark craters")}
      ${row("Rain + snow", fmtF("rain", feat(i, "rain")), "none")}
      ${row("Humidity", fmtF("rh", feat(i, "rh")), kind === "mars" ? "near 0%" : "no air")}
      ${row("Greenness (NDVI)", fmtF("ndvi", feat(i, "ndvi")), "0 (no life seen)")}
      ${row("Bare ground", fmtF("bare", feat(i, "bare")), "100%")}
      ${row("Ice", fmtF("ice", feat(i, "ice")), esc(cmp.ice))}
      ${row("Air pressure", `${pEarth.toFixed(0)} kPa`, kind === "mars" ? "0.6 kPa" : "0 (vacuum)")}
      ${row("Gravity", "9.81 m/s²", tGrav)}
    </div>
    <div class="callout">What a crew could rehearse here: ${kind === "mars"
      ? "driving rovers over dry, bare terrain, searching for traces of life in salty soils, running dust-tolerant equipment and long dry-climate operations."
      : "working in extreme cold and long polar nights, drilling into frozen ground for water ice, and navigating with the Sun low on the horizon."}
      What Earth can't give: ${kind === "mars" ? "the thin CO₂ air, low gravity and radiation." : "the vacuum, low gravity and radiation."}</div>
    <p class="muted small">Map: ${esc(BODIES[kind].credit)}. Target conditions: ${tg.sources.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${esc(n)}</a>`).join(" · ")}.</p>`;
  $("#an-home").addEventListener("click", backToEarth);
}

// ---------------------------------------------------------------- globe input
function cellAt(ll) { const c1 = Math.min(179, Math.floor(90 - ll.lat)) * 360 + Math.min(359, Math.floor(ll.lon + 180)); return idx.get(c1); }
function onClick(ll) {
  if (!D || S.body || S.busy) return;
  // a known site within ~1.5° wins over the cell under the cursor
  const k = D.known.filter((x) => x.targets.includes(S.target)).find((x) => Math.hypot(x.lat - ll.lat, (x.lon - ll.lon) * Math.cos((ll.lat * Math.PI) / 180)) < 1.5);
  const i = k ? idx.get(k.cell) : cellAt(ll);
  if (i != null) select(i, false);
}
function onHover(ll, e) {
  if (!ctx) return;
  if (!D || !ll || S.body) { ctx.h.hideTip(); return; }
  const k = D.known.filter((x) => x.targets.includes(S.target)).find((x) => Math.hypot(x.lat - ll.lat, (x.lon - ll.lon) * Math.cos((ll.lat * Math.PI) / 180)) < 1.5);
  if (k) { ctx.h.showTip(`<b>${ctx.h.esc(k.name)}</b><div class="row"><span>Score</span><span>${k[S.target]}</span></div><div class="muted small">${ctx.h.esc(k.use)}</div>`, e.clientX, e.clientY); return; }
  const i = cellAt(ll);
  if (i == null) { ctx.h.hideTip(); return; }
  ctx.h.showTip(`<b>${S.target === "mars" ? "Mars" : "Moon"}-likeness</b><div class="row"><span>Score</span><span>${D[S.target][i]} / 100</span></div><div class="muted small">Click for why</div>`, e.clientX, e.clientY);
}

export default { id: "analogs", enter, exit, onClick, onHover };
