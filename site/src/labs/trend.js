// Lab · Earth System Trend Detective (NASA Space Apps 2026 challenge "Be An Earth System Trend Detective!").
// Pick a variable and an area; see its yearly series 2001–2025, the trend and whether it is significant.
// Globe: twinkling dots (land only) for each 1° square's trend or a year-by-year time-lapse, live wind flow
// (NOAA GFS) and live fires (NASA FIRMS) on top.
// Data: site/public/data/labs/trend/ (pipeline/labs_trend.py). Loaded only when this lab opens.
import { trendStats, tTwoSided } from "./stats.js";
import { createFlow } from "./flow.js";

const BASE = "/data/labs/trend/";
const MISSING = -32768;
const RAMP = [[47, 111, 208], [169, 200, 240], [246, 176, 122], [232, 64, 42]]; // falling .. rising (globe.js RAMPS.trend)
let ctx, meta, cells, cellIdx, land, flow, windMeta;
const vals = {}, trends = {}, anoms = {};
const S = { varId: "t2m_max", view: "trend", yi: 24, playing: false, timer: null, pick: "province", spec: null, area: null, w1: null,
  boxStart: null, list: null, all: null, cmpId: null, wind: true, fires: false };

const DEMOS = [
  { label: "Germany is warming fast", varId: "t2m_max", spec: { kind: "country", key: "Germany" } },
  { label: "India is getting greener", varId: "ndvi", spec: { kind: "country", key: "India" } },
  { label: "Fire in Brazil has halved", varId: "fire", spec: { kind: "country", key: "Brazil" } },
  { label: "Forest loss in Russia has doubled", varId: "forest", spec: { kind: "country", key: "Russia" } },
];

const $ = (s) => document.querySelector(s);
const V = (id = S.varId) => meta.vars.find((v) => v.id === id);
const c05to1 = (k) => Math.floor(Math.floor(k / 720) / 2) * 360 + Math.floor((k % 720) / 2);
const NY = () => meta.years.length;

async function bin(path, Type) {
  const r = await fetch(BASE + path + ctx.v);
  if (!r.ok) throw new Error(path + " " + r.status);
  return new Type(await r.arrayBuffer());
}
async function loadVar(id) {
  if (vals[id]) return;
  const [v, t] = await Promise.all([bin(`${id}.bin`, Int16Array), fetch(BASE + `${id}_trend.bin` + ctx.v).then((r) => r.arrayBuffer())]);
  vals[id] = v;
  trends[id] = { slope: new Int16Array(t, 0, cells.length), p: new Uint8Array(t, cells.length * 2, cells.length) };
}

// ---------------------------------------------------------------- colours
function ramp(t) {
  t = Math.max(0, Math.min(1, t)) * 3; const i = Math.min(2, Math.floor(t)), f = t - i, a = RAMP[i], b = RAMP[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** per-cell anomaly vs its own 2001–2010 average (fire: log ratio), with a robust colour span */
function anomalies(id) {
  if (anoms[id]) return anoms[id];
  const v = vals[id], ny = NY(), vm = V(id), n = cells.length, base = new Float32Array(n).fill(NaN);
  const rel = id === "fire";
  for (let i = 0; i < n; i++) {
    let s = 0, k = 0;
    for (let y = 0; y < 10; y++) { const x = v[i * ny + y]; if (x !== MISSING) { s += x / vm.scale; k++; } }
    if (k >= 5) base[i] = s / k;
  }
  const at = (i, y) => { const x = v[i * ny + y]; if (x === MISSING || isNaN(base[i])) return null; const val = x / vm.scale; return rel ? Math.log((val + 5) / (base[i] + 5)) : val - base[i]; };
  const sample = [];
  for (let i = 0; i < n; i += 7) if (land[i]) for (let y = 10; y < ny; y += 3) { const a = at(i, y); if (a != null) sample.push(Math.abs(a)); }
  sample.sort((a, b) => a - b);
  return (anoms[id] = { at, span: sample[Math.floor(sample.length * 0.95)] || 1 });
}

function draw() {
  const v = V(), g = ctx.globe, strong = [], weak = [];
  if (S.view === "trend") {
    const t = trends[S.varId];
    for (let i = 0; i < cells.length; i++) {
      if (!land[i]) continue;
      const s = t.slope[i], p = t.p[i];
      if (s === MISSING || p === 255) continue;
      (p / 250 < 0.05 ? strong : weak).push([cells[i], Math.max(0, Math.min(1, 0.5 + (s / v.tscale) / (2 * v.span)))]);
    }
  } else {
    const A = anomalies(S.varId);
    for (let i = 0; i < cells.length; i++) {
      if (!land[i]) continue;
      const a = A.at(i, S.yi); if (a == null) continue;
      const tt = Math.max(0, Math.min(1, 0.5 + a / (2 * A.span)));
      (Math.abs(tt - 0.5) > 0.1 ? strong : weak).push([cells[i], tt]);
    }
  }
  const layer = (name, list, opacity, size, twinkle) => {
    const lats = new Float32Array(list.length), lons = new Float32Array(list.length), vv = new Float32Array(list.length);
    list.forEach(([c, x], j) => { lats[j] = 90 - (Math.floor(c / 360) + 0.5); lons[j] = -180 + (c % 360) + 0.5; vv[j] = x; });
    g.setPoints(name, { lats, lons, values: vv, ramp: "trend", size, minSize: 0.55, opacity, soft: 0.45, blending: ctx.blend.normal, radius: 1.004, twinkle });
  };
  layer("trendNs", weak, 0.2, 0.016, 0);
  layer("trendSig", strong, 0.92, 0.0195, v.id === "fire" ? 1 : 0.55);
  g.setOutline(S.area ? S.area.rings : null);
}

// ---------------------------------------------------------------- live layers: wind flow + fires
async function setWind(on) {
  S.wind = on;
  if (on) {
    if (!flow) {
      windMeta = await (await fetch("/data/labs/wind/meta.json" + ctx.v)).json();
      const buf = await (await fetch("/data/labs/wind/wind.bin" + ctx.v)).arrayBuffer(), n = windMeta.rows * windMeta.cols;
      flow = createFlow(ctx.globe, { ...windMeta, u: new Int16Array(buf, 0, n), v: new Int16Array(buf, n * 2, n) });
    }
    if (S.wind) flow.start();
  } else flow?.stop();
  const b = $("#td-wind"); if (b) b.setAttribute("aria-pressed", S.wind);
}
async function setFires(on) {
  S.fires = on;
  const b = $("#td-fires"); if (b) b.setAttribute("aria-pressed", on);
  if (!on) { ctx.globe.hideLayer("labFires"); return; }
  if (b) b.textContent = "Live fires (loading…)";
  const f = await ctx.liveFires();
  if (b) b.textContent = `Live fires · ${ctx.h.fmt(f.length)} now`;
  if (!S.fires) return;
  const lats = new Float32Array(f.length), lons = new Float32Array(f.length), vv = new Float32Array(f.length);
  f.forEach((d, i) => { lats[i] = d.lat; lons[i] = d.lon; vv[i] = Math.min(1, 0.35 + Math.log10(1 + (d.frp || 5)) / 3); });
  ctx.globe.setPoints("labFires", { lats, lons, values: vv, ramp: "heat", size: 0.0075, minSize: 0.6, opacity: 1, soft: 0.2, blending: ctx.blend.additive, radius: 1.005, twinkle: 1 });
}

// ---------------------------------------------------------------- lifecycle
async function enter(c, params) {
  ctx = c;
  ctx.panel.innerHTML = `<p class="eyebrow">Labs · Trend Detective</p><h2>Loading…</h2>`;
  if (!meta) {
    meta = await (await fetch(BASE + "meta.json" + ctx.v)).json();
    [cells, land] = await Promise.all([bin("cells.bin", Uint16Array), bin("land.bin", Uint8Array)]);
    cellIdx = new Map(); cells.forEach((cc, i) => cellIdx.set(cc, i));
    S.yi = NY() - 1;
  }
  if (params.get("var") && meta.vars.some((v) => v.id === params.get("var"))) S.varId = params.get("var");
  const a = params.get("area");
  if (a) {
    const i = a.indexOf(":"), kind = a.slice(0, i), val = a.slice(i + 1);
    S.spec = kind === "box" ? { kind, box: val.split(",").map(Number) } : { kind, key: val };
  }
  await loadVar(S.varId);
  if (S.spec) await setArea(S.spec, true); else { draw(); panel(); }
  if (S.wind) setWind(true);
  if (S.fires) setFires(true);
}
function exit() {
  stop(); flow?.stop();
  ["trendSig", "trendNs", "labFires"].forEach((l) => ctx.globe.hideLayer(l));
  ctx.globe.setOutline(null); ctx.globe.setMarker(null);
}

async function setVar(id) {
  S.varId = id; S.cmpId = null;
  await loadVar(id);
  draw(); panel(); url();
}

async function setArea(spec, fly = true) {
  S.spec = spec; S.boxStart = null; ctx.globe.setMarker(null);
  const area = await ctx.area.resolveArea(spec);
  if (!area) { S.spec = null; S.area = null; draw(); panel(); return; }
  const w = ctx.area.areaWeights(area), w1 = new Map();
  let sl = 0, so = 0, sw = 0;
  for (let k = 0; k < w.length; k++) if (w[k]) {
    const c1 = c05to1(k); w1.set(c1, (w1.get(c1) || 0) + w[k] / 4);
    sl += (90 - (Math.floor(k / 720) + 0.5) * 0.5) * w[k]; so += (-180 + ((k % 720) + 0.5) * 0.5) * w[k]; sw += w[k];
  }
  S.area = area; S.w1 = w1; S.km2 = ctx.area.areaKm2(w); S.all = null;
  draw(); panel(); url();
  if (fly && sw) ctx.globe.flyTo(sl / sw, so / sw, Math.min(3.2, 1.6 + Math.sqrt(S.km2) / 1500));
}

function url() {
  const p = { var: S.varId, area: null };
  if (S.spec) p.area = S.spec.box ? `box:${S.spec.box.map((v) => +(+v).toFixed(2)).join(",")}` : `${S.spec.kind}:${S.spec.key}`;
  ctx.setParams(p);
}

// ---------------------------------------------------------------- time-lapse
function setYear(yi) {
  S.yi = yi; draw();
  const l = $("#td-year"); if (l) l.textContent = meta.years[yi];
  const r = $("#td-yr"); if (r) r.value = yi;
  if (S.area && S.cur) chart($("#td-chart"), S.cur.ys, S.cur.st, V(), S.view === "year" ? yi : null);
}
function play() {
  if (S.playing) { stop(); return; }
  S.playing = true; if (S.yi >= NY() - 1) S.yi = 0;
  const b = $("#td-play"); if (b) b.textContent = "❚❚";
  setYear(S.yi);
  S.timer = setInterval(() => { if (S.yi >= NY() - 1) { stop(); return; } setYear(S.yi + 1); }, 420);
}
function stop() { S.playing = false; clearInterval(S.timer); const b = $("#td-play"); if (b) b.textContent = "▶"; }

// ---------------------------------------------------------------- area series
/** yearly series for the selected area (area-weighted mean, land only; fire = total) */
function series(id) {
  const v = vals[id], vm = V(id), ny = NY();
  const out = new Array(ny).fill(null), sumW = new Array(ny).fill(0), sum = new Array(ny).fill(0);
  let tot = 0;
  for (const [c1, share] of S.w1) {
    const i = cellIdx.get(c1); if (i == null || !land[i]) continue;
    const lat = 90 - (Math.floor(c1 / 360) + 0.5), wgt = id === "fire" ? share : share * Math.cos((lat * Math.PI) / 180);
    tot += wgt;
    for (let y = 0; y < ny; y++) { const x = v[i * ny + y]; if (x === MISSING) continue; sum[y] += wgt * (x / vm.scale); sumW[y] += wgt; }
  }
  for (let y = 0; y < ny; y++) {
    if (id === "fire") out[y] = sumW[y] > 0 ? sum[y] : 0;
    else out[y] = sumW[y] > 0 && sumW[y] >= 0.3 * tot ? sum[y] / sumW[y] : null; // a year counts if >= 30% of the area has data
  }
  return out;
}

// ---------------------------------------------------------------- formatting
function fmtVal(x, v) {
  if (x == null || !isFinite(x)) return "–";
  if (v.id === "fire") return ctx.h.fmt(x);
  const a = Math.abs(x), d = v.id === "ndvi" || v.id === "soil" ? 3 : v.id === "forest" ? 2 : a >= 100 ? 0 : 1;
  return x.toFixed(d);
}
/** a per-decade change: 2 significant digits for small numbers so slow trends don't show as 0.0 */
function fmtSlope(x, v) {
  const a = Math.abs(x);
  if (v.id === "fire") return ctx.h.fmt(a);
  if (a === 0) return "0";
  return a < 1 ? String(+a.toPrecision(2)) : a < 100 ? a.toFixed(1) : Math.round(a).toString();
}
const perDec = (slope, v) => `${slope >= 0 ? "+" : "−"}${fmtSlope(slope * 10, v)} ${v.unit} per decade`;
const pTxt = (p) => (p < 0.001 ? "&lt; 0.001" : p.toFixed(3));
function verdict(st, v) {
  if (!st) return { cls: "", text: "Not enough years with data here." };
  const total = st.sen * (NY() - 1), rel = st.mean ? (total / Math.abs(st.mean)) * 100 : null;
  const dir = st.sen > 0 ? "rising" : "falling", plural = v.id === "fire";
  const change = `${dir} by about <b>${fmtSlope(st.sen * 10, v)} ${v.unit} per decade</b>${rel != null && v.id !== "t2m_max" && isFinite(rel) && Math.abs(rel) < 1000 ? ` (${rel >= 0 ? "+" : "−"}${Math.abs(rel).toFixed(0)}% over ${NY()} years)` : ""}`;
  if (st.mkP < 0.05) return { cls: st.sen > 0 ? "up" : "down", label: `Significant ${dir}`, text: `${v.name} here ${plural ? "are" : "is"} ${change}. A trend this steady would happen by chance less than ${st.mkP < 0.01 ? "1 time in 100" : "5 times in 100"} (Mann–Kendall p ${st.mkP < 0.001 ? "&lt; 0.001" : "= " + st.mkP.toFixed(3)}).` };
  return { cls: "same", label: "No significant trend", text: `${v.name} here ${plural ? "look" : "looks"} ${change}, but the ups and downs between years are too big to be sure (Mann–Kendall p = ${st.mkP.toFixed(2)}). A longer record might settle it.` };
}

// ---------------------------------------------------------------- charts
function chart(el, ys, st, v, mark = null) {
  if (!el) return;
  const W = el.clientWidth || 400, H = 180, m = { l: 46, r: 10, t: 10, b: 22 }, yrs = meta.years, ok = ys.filter((y) => y != null);
  if (!ok.length) { el.innerHTML = `<p class="muted small">No data for this area.</p>`; return; }
  let lo = Math.min(...ok), hi = Math.max(...ok);
  const zero = v.id === "fire" || v.id === "forest";
  if (zero) lo = Math.min(lo, 0);
  const pad = (hi - lo) * 0.12 || 1; if (!zero) lo -= pad; hi += pad;
  const X = (i) => m.l + (i / (yrs.length - 1)) * (W - m.l - m.r), Y = (y) => m.t + (1 - (y - lo) / (hi - lo)) * (H - m.t - m.b);
  let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${v.name} per year">`;
  [lo, (lo + hi) / 2, hi].forEach((t) => { s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--grid)"/><text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end" class="ax">${fmtVal(t, v)}</text>`; });
  yrs.forEach((y, i) => { if (y % 5 === 1 || i === yrs.length - 1) s += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" class="ax">${y}</text>`; });
  if (mark != null) s += `<line x1="${X(mark)}" x2="${X(mark)}" y1="${m.t}" y2="${H - m.b}" stroke="rgba(255,255,255,.35)" stroke-dasharray="3 3"/>`;
  let d = ""; ys.forEach((y, i) => { if (y != null) d += `${d ? "L" : "M"}${X(i).toFixed(1)},${Y(y).toFixed(1)}`; });
  s += `<path d="${d}" fill="none" stroke="#8fb4ec" stroke-width="1.6"/>`;
  ys.forEach((y, i) => { if (y != null) s += `<circle cx="${X(i)}" cy="${Y(y)}" r="${i === mark ? 4.5 : 2.6}" fill="${i === mark ? "#fff" : "#8fb4ec"}"/>`; });
  if (st) {
    const a = st.senIntercept, b = st.sen;
    s += `<line x1="${X(0)}" y1="${Y(a)}" x2="${X(yrs.length - 1)}" y2="${Y(a + b * (yrs.length - 1))}" stroke="${st.mkP < 0.05 ? "var(--ember)" : "var(--text-3)"}" stroke-width="2.4" stroke-dasharray="${st.mkP < 0.05 ? "0" : "6 5"}"/>`;
  }
  el.innerHTML = s + `</svg>`;
  const svg = el.querySelector("svg");
  svg.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect(), i = Math.round((((e.clientX - r.left) / r.width) * W - m.l) / (W - m.l - m.r) * (yrs.length - 1));
    if (i < 0 || i >= yrs.length || ys[i] == null) { ctx.h.hideTip(); return; }
    ctx.h.showTip(`<b>${yrs[i]}</b><div class="row"><span>${v.name}</span><span>${fmtVal(ys[i], v)} ${v.unit}</span></div>${st ? `<div class="row"><span>Trend line</span><span>${fmtVal(st.senIntercept + st.sen * i, v)}</span></div>` : ""}`, e.clientX, e.clientY);
  });
  svg.addEventListener("pointerleave", ctx.h.hideTip);
}

/** climate stripes: one stripe per year, coloured by how far that year is from the area's average */
function stripes(el, ys, v) {
  const ok = ys.filter((y) => y != null); if (!ok.length) { el.innerHTML = ""; return; }
  const mean = ok.reduce((a, b) => a + b, 0) / ok.length, mx = Math.max(...ok.map((y) => Math.abs(y - mean))) || 1;
  el.innerHTML = `<div class="stripes">${ys.map((y, i) => {
    if (y == null) return `<i style="background:#1a1d24" title="${meta.years[i]}: no data"></i>`;
    const [r, g, b] = ramp(0.5 + (y - mean) / (2 * mx));
    return `<i style="background:rgb(${r | 0},${g | 0},${b | 0})" title="${meta.years[i]}: ${fmtVal(y, v)} ${v.unit}"></i>`;
  }).join("")}</div><div class="stripes-ax"><span>${meta.years[0]}</span><span>blue = lower than usual · red = higher</span><span>${meta.years.at(-1)}</span></div>`;
}

const detrend = (ys) => { const st = trendStats(ys); return st ? ys.map((y, i) => (y == null ? null : y - (st.olsIntercept + st.ols * i))) : ys; };
function pearson(a, b) {
  const pts = []; a.forEach((x, i) => { if (x != null && b[i] != null) pts.push([x, b[i]]); });
  const n = pts.length; if (n < 8) return null;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0; pts.forEach(([x, y]) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; });
  if (!sxx || !syy) return null;
  const r = sxy / Math.sqrt(sxx * syy), t = r * Math.sqrt((n - 2) / Math.max(1e-12, 1 - r * r));
  return { r, p: tTwoSided(Math.abs(t), n - 2), n };
}
function compareHtml() {
  const a = V(), b = V(S.cmpId), ya = S.cur.ys, yb = series(b.id);
  const raw = pearson(ya, yb), yr = pearson(detrend(ya), detrend(yb));
  const z = (ys) => { const ok = ys.filter((y) => y != null), m = ok.reduce((s, x) => s + x, 0) / ok.length, sd = Math.sqrt(ok.reduce((s, x) => s + (x - m) ** 2, 0) / ok.length) || 1; return ys.map((y) => (y == null ? null : (y - m) / sd)); };
  const za = z(ya), zb = z(yb), W = 400, H = 120, X = (i) => 8 + (i / (NY() - 1)) * (W - 16), Y = (v) => H / 2 - v * (H / 6.5);
  const path = (zs) => { let d = ""; zs.forEach((v, i) => { if (v != null) d += `${d ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; }); return d; };
  let msg = "Not enough overlapping years to compare.";
  if (yr) {
    const strong = Math.abs(yr.r) >= 0.5 ? "clearly" : Math.abs(yr.r) >= 0.3 ? "somewhat" : null;
    msg = yr.p < 0.05 && strong
      ? `Year to year, when <b>${a.name.toLowerCase()}</b> is higher, <b>${b.name.toLowerCase()}</b> is ${strong} ${yr.r > 0 ? "higher" : "lower"} too (r = ${yr.r.toFixed(2)}, p = ${yr.p < 0.001 ? "&lt; 0.001" : yr.p.toFixed(3)}).`
      : `No clear year-to-year link between ${a.name.toLowerCase()} and ${b.name.toLowerCase()} here (r = ${yr.r.toFixed(2)}, p = ${yr.p.toFixed(2)}).`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" height="${H}" class="cmp-svg"><line x1="8" x2="${W - 8}" y1="${H / 2}" y2="${H / 2}" stroke="var(--grid)"/>
      <path d="${path(za)}" fill="none" stroke="#8fb4ec" stroke-width="2"/><path d="${path(zb)}" fill="none" stroke="var(--ember)" stroke-width="2"/></svg>
    <div class="legend"><span><i style="background:#8fb4ec"></i>${a.name}</span><span><i style="background:var(--ember)"></i>${b.name}</span><span class="muted">both scaled to their own average</span></div>
    <div class="callout">${msg}${raw ? `<div class="muted small" style="margin-top:4px">Raw correlation r = ${raw.r.toFixed(2)}. The year-to-year number removes both long-term trends first, so two things that simply both grew over time don't look linked. Correlation is a clue, not proof of cause.</div>` : ""}</div>`;
}

// ---------------------------------------------------------------- panel
function legendHtml(v) {
  const isY = S.view === "year";
  return `<div class="seg td-view" role="group" aria-label="Globe view">
      <button data-view="trend" aria-pressed="${!isY}">Trend ${meta.years[0]}–${meta.years.at(-1)}</button>
      <button data-view="year" aria-pressed="${isY}">Year by year</button>
    </div>
    ${isY ? `<div class="td-player"><button class="btn" id="td-play" aria-label="Play">${S.playing ? "❚❚" : "▶"}</button><input id="td-yr" type="range" min="0" max="${NY() - 1}" value="${S.yi}" aria-label="Year"><b id="td-year">${meta.years[S.yi]}</b></div>` : ""}
    <div class="td-legend"><span>${isY ? "below its 2001–10 average" : "falling"}</span><i></i><span>${isY ? "above" : "rising"}</span></div>
    <div class="chips td-live">
      <button id="td-wind" aria-pressed="${S.wind}" title="NOAA GFS 10 m wind${windMeta ? ", model run " + windMeta.run : ""}">Live wind flow</button>
      <button id="td-fires" aria-pressed="${S.fires}" title="NASA FIRMS, last 24 h">Live fires</button>
    </div>
    <p class="muted small" style="margin:4px 0 0">${isY
      ? `Each place compared with its own 2001–2010 average${v.id === "fire" ? " (as a ratio)" : ""}. Press ▶ to watch ${meta.years[0]} → ${meta.years.at(-1)}.`
      : `Each 1° square's trend over 25 years. Bright, twinkling dots = significant (p &lt; 0.05), faint = could be chance. Worldwide <b>${ctx.h.fmt(v.n_up)}</b> squares rise and <b>${ctx.h.fmt(v.n_down)}</b> fall significantly: one variable can move opposite ways in different places.`}</p>`;
}

function panel() {
  stop();
  const v = V(), esc = ctx.h.esc;
  const pickBtn = (k, l) => `<button data-tpick="${k}" aria-pressed="${S.pick === k}">${l}</button>`;
  const hint = S.pick === "box" ? (S.boxStart ? "Now click the opposite corner." : "Click two opposite corners on the globe.") : `Click the globe to pick a ${S.pick === "country" ? "country" : "province or republic"}.`;
  const picker = `
    <h3>${S.area ? "Pick another area" : "Pick an area"}</h3>
    <div class="aoi-pick">
      <input id="td-q" list="td-list" placeholder="Search a country, province or republic…" autocomplete="off" aria-label="Search area">
      <datalist id="td-list"></datalist>
      <div class="seg" role="group">${pickBtn("province", "Click: province")}${pickBtn("country", "Click: country")}${pickBtn("box", "Draw a box")}</div>
      <p class="muted small" id="td-hint" style="margin:0">${hint}</p>
    </div>
    <div class="td-demos">${DEMOS.map((d, i) => `<button class="chip" data-demo="${i}">${esc(d.label)}</button>`).join("")}</div>`;
  let body = `
    <div class="lab-top"><button class="btn" id="lab-back">← Back to Ember Atlas</button><span class="lab-tag">Labs · Hard</span></div>
    <p class="eyebrow">NASA Space Apps · Earth System Trend Detective</p>
    <h2>Is it really changing?</h2>
    <p class="lede small">Eight NASA Earth variables, every year ${meta.years[0]}–${meta.years.at(-1)}. Pick one, then any area: see the trend and whether it is <b>significant</b> or just year-to-year noise.</p>
    <div class="chips td-vars">${meta.vars.map((x) => `<button data-var="${x.id}" aria-pressed="${x.id === S.varId}">${x.name}</button>`).join("")}</div>
    <div class="td-def"><b>${esc(v.name)}</b> (${esc(v.unit)}): ${esc(v.define)}<div class="muted small">Source: ${esc(v.src)}</div></div>
    ${legendHtml(v)}`;
  if (S.area) {
    const ys = series(S.varId), st = trendStats(ys), vd = verdict(st, v);
    S.cur = { ys, st };
    if (!S.cmpId) S.cmpId = S.varId === "fire" ? "soil" : "fire";
    body += `
      <div class="td-result">
      <h3>${esc(v.name)} · ${esc(ctx.h.prettyCountry(S.area.name))}</h3>
      <p class="muted small" style="margin:-6px 0 8px">${esc(S.area.sub)} · ≈ ${ctx.h.fmt(S.km2)} km² · ${v.id === "fire" ? "total for the area" : "area-weighted average, land only"}</p>
      <div id="td-stripes"></div>
      <div id="td-chart" class="td-chart"></div>
      <div class="callout fc-verdict ${vd.cls}">${vd.label ? `<b class="fc-label">${vd.label}</b><br>` : ""}${vd.text}</div>
      ${st ? `<table class="data td-stats">
        <tr><th>Method</th><th>Change</th><th>p-value</th></tr>
        <tr><td>Theil–Sen slope + Mann–Kendall</td><td>${perDec(st.sen, v)}</td><td>${pTxt(st.mkP)}</td></tr>
        <tr><td>Least squares + t-test</td><td>${perDec(st.ols, v)}<div class="muted small">95% CI ${st.ci[0] < 0 ? "−" : ""}${fmtSlope(st.ci[0] * 10, v)} to ${st.ci[1] < 0 ? "−" : ""}${fmtSlope(st.ci[1] * 10, v)}</div></td><td>${pTxt(st.olsP)}</td></tr>
      </table>` : ""}
      <h3>Compare with another variable</h3>
      <div class="chips td-cmp">${meta.vars.filter((x) => x.id !== S.varId).map((x) => `<button data-cmp="${x.id}" aria-pressed="${x.id === S.cmpId}">${x.name}</button>`).join("")}</div>
      <div id="td-cmpbox"></div>
      <h3>What's changing here?</h3>
      <div id="td-all" class="muted small">Checking all ${meta.vars.length} variables…</div>
      <div class="row-ctl" style="margin-top:14px"><button class="btn" id="td-csv">Download CSV</button><button class="btn" id="td-link">Copy link</button></div>
      </div>
      ${picker}`;
  } else {
    body += picker + `<p class="lede small" style="margin-top:12px">Pick an area above, or try one of the examples.</p>`;
  }
  body += `<p class="muted small" style="margin-top:14px"><b>What "significant" means:</b> the Mann–Kendall test asks whether later years are higher (or lower) than earlier ones more often than chance would allow. p &lt; 0.05 means a random series would look this steady less than 5% of the time. The orange line is the Theil–Sen slope (the median of all year-to-year slopes, robust to odd years); dashed grey means not significant.</p>`;
  ctx.panel.innerHTML = body;
  bind();
  if (S.area) {
    stripes($("#td-stripes"), S.cur.ys, v);
    chart($("#td-chart"), S.cur.ys, S.cur.st, v, S.view === "year" ? S.yi : null);
    renderCompare();
    allVars();
  }
}

async function renderCompare() {
  const box = $("#td-cmpbox"); if (!box) return;
  box.innerHTML = `<p class="muted small">Loading…</p>`;
  await loadVar(S.cmpId);
  if ($("#td-cmpbox") === box) box.innerHTML = compareHtml();
}

async function allVars() {
  const box = $("#td-all"); if (!box) return;
  if (!S.all) { await Promise.all(meta.vars.map((x) => loadVar(x.id))); S.all = meta.vars.map((x) => ({ v: x, st: trendStats(series(x.id)) })); }
  if ($("#td-all") !== box) return;
  const rows = [...S.all].sort((a, b) => (a.st?.mkP ?? 2) - (b.st?.mkP ?? 2));
  box.className = "";
  box.innerHTML = `<table class="data td-allt"><tr><th>Variable</th><th>Trend</th><th>p</th></tr>${rows.map(({ v, st }) => {
    if (!st) return `<tr data-var="${v.id}"><td>${v.name}</td><td class="muted">no data</td><td></td></tr>`;
    const sig = st.mkP < 0.05, arrow = st.sen > 0 ? "▲" : "▼";
    return `<tr data-var="${v.id}" class="${v.id === S.varId ? "sel" : ""}"><td>${v.name}</td><td><span class="${sig ? (st.sen > 0 ? "t-up" : "t-down") : "muted"}">${arrow} ${perDec(st.sen, v)}</span></td><td>${sig ? `<b>${st.mkP < 0.001 ? "&lt;0.001" : st.mkP.toFixed(3)}</b>` : st.mkP.toFixed(2)}</td></tr>`;
  }).join("")}</table><p class="muted small">Sorted by significance. Click a row to look at that variable.</p>`;
  box.querySelectorAll("tr[data-var]").forEach((tr) => tr.addEventListener("click", () => setVar(tr.dataset.var)));
}

function bind() {
  const P = ctx.panel;
  $("#lab-back").addEventListener("click", () => ctx.back());
  P.querySelectorAll("button[data-var]").forEach((b) => b.addEventListener("click", () => setVar(b.dataset.var)));
  P.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { S.view = b.dataset.view; draw(); panel(); if (S.view === "year") play(); }));
  $("#td-play")?.addEventListener("click", play);
  $("#td-wind").addEventListener("click", () => setWind(!S.wind));
  $("#td-fires").addEventListener("click", () => setFires(!S.fires));
  $("#td-yr")?.addEventListener("input", (e) => { stop(); setYear(+e.target.value); });
  P.querySelectorAll("[data-cmp]").forEach((b) => b.addEventListener("click", () => {
    S.cmpId = b.dataset.cmp; P.querySelectorAll("[data-cmp]").forEach((x) => x.setAttribute("aria-pressed", x === b)); renderCompare();
  }));
  P.querySelectorAll("[data-tpick]").forEach((b) => b.addEventListener("click", () => {
    S.pick = b.dataset.tpick; S.boxStart = null; ctx.globe.setMarker(null);
    P.querySelectorAll("[data-tpick]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    $("#td-hint").textContent = S.pick === "box" ? "Click two opposite corners on the globe." : `Click the globe to pick a ${S.pick === "country" ? "country" : "province or republic"}.`;
  }));
  P.querySelectorAll("[data-demo]").forEach((b) => b.addEventListener("click", async () => {
    const d = DEMOS[+b.dataset.demo]; S.varId = d.varId; S.cmpId = null; await loadVar(d.varId); setArea(d.spec);
  }));
  const q = $("#td-q");
  const fill = (list) => { const dl = $("#td-list"); if (dl) dl.innerHTML = list.map((o) => `<option value="${ctx.h.esc(o.label)}">${o.kind === "country" ? "Country" : "Province / republic"}</option>`).join(""); };
  if (S.list) fill(S.list); else ctx.area.areaIndex().then((l) => { S.list = l; fill(l); });
  const find = (val, loose) => S.list?.find((o) => o.label.toLowerCase() === val) || (loose ? S.list?.find((o) => o.label.toLowerCase().startsWith(val)) : null);
  q.addEventListener("change", () => { const hit = find(q.value.trim().toLowerCase()); if (hit) setArea({ kind: hit.kind, key: hit.key }); });
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") { const hit = find(q.value.trim().toLowerCase(), true); if (hit) setArea({ kind: hit.kind, key: hit.key }); } });
  $("#td-csv")?.addEventListener("click", async () => {
    await Promise.all(meta.vars.map((x) => loadVar(x.id)));
    const rows = [["area", "year", ...meta.vars.map((x) => `${x.id} (${x.unit})`)]], sers = meta.vars.map((x) => series(x.id));
    meta.years.forEach((y, i) => rows.push([S.area.name, y, ...sers.map((s) => (s[i] == null ? "" : +s[i].toFixed(4)))]));
    const csv = rows.map((r) => r.map((x) => (/[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x)).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `ember-atlas_trends_${String(S.area.name).replace(/[^\w-]+/g, "_")}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $("#td-link")?.addEventListener("click", async (e) => { try { await navigator.clipboard.writeText(location.href); e.target.textContent = "Link copied"; } catch { e.target.textContent = "Copy failed"; } });
}

// ---------------------------------------------------------------- globe input
async function onClick(ll) {
  if (S.pick === "box") {
    if (!S.boxStart) { S.boxStart = ll; ctx.globe.setMarker(ll.lat, ll.lon); const h = $("#td-hint"); if (h) h.textContent = "Now click the opposite corner."; return; }
    const a = S.boxStart; S.boxStart = null; ctx.globe.setMarker(null);
    if (Math.abs(a.lat - ll.lat) < 1 || Math.abs(a.lon - ll.lon) < 1) return;
    setArea({ kind: "box", box: [a.lat, a.lon, ll.lat, ll.lon] });
    return;
  }
  const r = await ctx.area.placeAt(ll.lat, ll.lon);
  if (!r) return;
  setArea(S.pick === "country" ? { kind: "country", key: r.country } : { kind: "province", key: ctx.area.provKey(r) });
}
function onHover(ll, e) {
  if (!ll) { ctx.h.hideTip(); return; }
  const c1 = Math.min(179, Math.floor(90 - ll.lat)) * 360 + Math.min(359, Math.floor(ll.lon + 180));
  const i = cellIdx.get(c1), v = V(), t = trends[S.varId];
  const hint0 = S.pick === "box" ? (S.boxStart ? "Click the opposite corner" : "Click the first corner") : `Click to pick this ${S.pick}`;
  const wnd = S.wind && flow ? flow.speedAt(ll.lat, ll.lon) : null;
  const hint = (wnd ? `Wind now ${wnd.speed.toFixed(1)} m/s from ${["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(wnd.dir / 45) % 8]} · ` : "") + hint0;
  if (i == null || !land[i]) { ctx.h.showTip(`<div class="muted small">${hint}</div>`, e.clientX, e.clientY); return; }
  if (S.view === "year") {
    const x = vals[S.varId][i * NY() + S.yi], A = anomalies(S.varId), a = A.at(i, S.yi);
    ctx.h.showTip(`<b>${v.name} · ${meta.years[S.yi]}</b><div class="row"><span>Value</span><span>${x === MISSING ? "–" : fmtVal(x / v.scale, v) + " " + v.unit}</span></div>${a != null ? `<div class="row"><span>vs 2001–10</span><span>${v.id === "fire" ? `${Math.exp(a).toFixed(2)}×` : `${a >= 0 ? "+" : "−"}${fmtVal(Math.abs(a), v)}`}</span></div>` : ""}<div class="muted small">${hint}</div>`, e.clientX, e.clientY);
    return;
  }
  if (t.slope[i] === MISSING || t.p[i] === 255) { ctx.h.showTip(`<div class="muted small">${hint}</div>`, e.clientX, e.clientY); return; }
  const dec = t.slope[i] / v.tscale, p = t.p[i] / 250;
  ctx.h.showTip(`<b>${v.name}</b><div class="row"><span>Trend</span><span>${dec >= 0 ? "+" : "−"}${fmtSlope(dec, v)} ${v.unit}/decade</span></div><div class="row"><span>p-value</span><span>${p < 0.004 ? "&lt;0.004" : p.toFixed(3)}</span></div><div class="muted small">${p < 0.05 ? "Significant" : "Not significant"} · ${hint}</div>`, e.clientX, e.clientY);
}

export default { id: "trend", enter, exit, onClick, onHover };
