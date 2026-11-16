// Lab · Dancing with the SARs (NASA Space Apps 2026). NISAR L-band radar time series for three study areas:
// savanna fires (Central Africa), cotton & wheat fields (Uzbekistan), Aral Sea & Amu Darya delta.
// Data: public NISAR L2 GCOV browse images via ASF (pipeline/labs_sar.py → site/public/data/labs/sar/).
// The radar image is draped on its own curved patch above the globe, so it stays sharp when zoomed in.
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, CanvasTexture, SRGBColorSpace, DoubleSide } from "three";
import { latLonToVec3 } from "../globe.js";

const BASE = "/data/labs/sar/";
let ctx, meta, patch, tex, canvas, styleEl, timer = null;
const imgs = {}, fires = {};
const S = { ai: 0, t: 0, view: "radar", pol: "rgb", fires: true, playing: false };
const $ = (s) => document.querySelector(s);
const A = () => meta.areas[S.ai];
const fmtDate = (d) => new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });

const CSS = `
.sar-areas { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 8px 0 10px; }
.sar-areas button { text-align: left; border: 1px solid var(--line-strong); background: rgba(255,255,255,.03); border-radius: 10px; padding: 8px 9px; cursor: pointer; color: var(--text-2); font-size: 11.5px; line-height: 1.35; }
.sar-areas button b { display: block; color: var(--text); font-size: 12.5px; margin-bottom: 2px; }
.sar-areas button[aria-pressed="true"] { border-color: var(--ember); background: var(--ember-soft); }
.sar-player { display: flex; align-items: center; gap: 10px; margin: 8px 0 2px; }
.sar-player .btn { width: 38px; padding: 6px 0; text-align: center; }
.sar-player input { flex: 1; accent-color: var(--ember); }
.sar-date { font-family: var(--mono); font-size: 13px; min-width: 96px; text-align: right; }
.sar-ticks { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 10px; color: var(--text-3); margin: 0 4px 6px 48px; }
.sar-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 6px 0; }
.sar-legend { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--text-3); margin: 4px 0; }
.sar-legend i { flex: 1; height: 8px; border-radius: 4px; }
.sar-key { display: grid; grid-template-columns: 14px 1fr; gap: 4px 8px; font-size: 12px; color: var(--text-2); margin: 6px 0; }
.sar-key span { width: 12px; height: 12px; border-radius: 3px; margin-top: 2px; }
.sar-chart .ax { fill: var(--text-3); font-size: 10.5px; font-family: var(--mono); }
.sar-explain { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin: 6px 0; }
.sar-explain div { border: 1px solid var(--line); border-radius: 10px; padding: 8px; font-size: 11.5px; color: var(--text-2); line-height: 1.4; }
.sar-explain b { display: block; color: var(--text); font-size: 12px; margin-bottom: 2px; }
.sar-ids { font-family: var(--mono); font-size: 10px; color: var(--text-3); word-break: break-all; max-height: 120px; overflow: auto; border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; }
.sar-badge { display: inline-block; font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; background: rgba(57,135,229,.18); color: #9ec5f4; margin-left: 6px; vertical-align: middle; }
`;

function loadImg(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
}
async function loadArea(a) {
  if (imgs[a.id]) return;
  const list = await Promise.all(a.dates.map((d) => loadImg(`${BASE}${a.id}/${d.date}.jpg${ctx.v}`)));
  const change = await loadImg(`${BASE}${a.id}/change.png${ctx.v}`);
  imgs[a.id] = { list, change };
  if (a.fires) fires[a.id] = (await (await fetch(`${BASE}${a.id}/fires.json${ctx.v}`)).json()).points;
}

// ---------------------------------------------------------------- the draped patch
function buildPatch(bounds) {
  const [w, s, e, n] = bounds, N = 48, pos = [], uv = [], idx = [], v = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const lat = n - (n - s) * (i / N), lon = w + (e - w) * (j / N);
    latLonToVec3(lat, lon, 1.0026, v); pos.push(v.x, v.y, v.z); uv.push(j / N, 1 - i / N);
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const a = i * (N + 1) + j, b = a + 1, c = a + N + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
function ensurePatch() {
  const a = A();
  if (!canvas) { canvas = document.createElement("canvas"); tex = new CanvasTexture(canvas); tex.colorSpace = SRGBColorSpace; tex.anisotropy = 8; }
  canvas.width = a.size[0]; canvas.height = a.size[1];
  if (!patch) {
    patch = new Mesh(buildPatch(a.bounds), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: DoubleSide }));
    patch.renderOrder = -1; // under the FIRMS fire dots
    ctx.globe.scene.add(patch);
  } else { patch.geometry.dispose(); patch.geometry = buildPatch(a.bounds); }
  patch.visible = true;
}

/** draw the current date (crossfade between neighbours), polarization and view into the patch texture */
function render() {
  const a = A(), I = imgs[a.id]; if (!I || !canvas) return;
  const g = canvas.getContext("2d", { willReadFrequently: true }), W = canvas.width, H = canvas.height;
  if (!isFinite(S.t)) S.t = a.dates.length - 1;
  S.t = Math.max(0, Math.min(a.dates.length - 1, S.t));
  const i0 = Math.floor(S.t), i1 = Math.min(a.dates.length - 1, i0 + 1), f = S.t - i0;
  if (!I.list[i0]) return;
  g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, W, H);
  g.drawImage(I.list[i0], 0, 0, W, H);
  if (f > 0.001 && i1 !== i0) { g.globalAlpha = f; g.drawImage(I.list[i1], 0, 0, W, H); g.globalAlpha = 1; }
  if (S.pol !== "rgb") { // single polarization: HH lives in red/blue, HV in green
    const d = g.getImageData(0, 0, W, H), p = d.data, ch = S.pol === "hh" ? 0 : 1;
    for (let k = 0; k < p.length; k += 4) { const v = p[k + ch]; p[k] = p[k + 1] = p[k + 2] = v; }
    g.putImageData(d, 0, 0);
  }
  if (S.view === "change") {
    g.fillStyle = "rgba(6,8,12,0.62)"; g.fillRect(0, 0, W, H);
    g.drawImage(I.change, 0, 0, W, H);
  }
  // fade the edge of the swath crop so it blends into the globe
  const d2 = g.getImageData(0, 0, W, H), p2 = d2.data;
  for (let k = 0; k < p2.length; k += 4) if (p2[k] + p2[k + 1] + p2[k + 2] < 9) p2[k + 3] = 0;
  g.putImageData(d2, 0, 0);
  tex.needsUpdate = true;
  const dl = $("#sar-date"); if (dl) dl.textContent = fmtDate(a.dates[Math.round(S.t)].date);
  const rg = $("#sar-t"); if (rg && +rg.value !== S.t) rg.value = S.t;
  const mk = $("#sar-mark"); if (mk) { const x = mk.dataset.x0 * 1 + (S.t / (a.dates.length - 1)) * mk.dataset.w; mk.setAttribute("x1", x); mk.setAttribute("x2", x); }
}

function drawFires() {
  const a = A(), pts = fires[a.id];
  if (!S.fires || !pts) { ctx.globe.hideLayer("sarFires"); return; }
  const n = pts.length, lats = new Float32Array(n), lons = new Float32Array(n), vv = new Float32Array(n);
  pts.forEach((p, i) => { lats[i] = p[0]; lons[i] = p[1]; vv[i] = Math.min(1, 0.4 + Math.log10(1 + p[3]) / 3); });
  ctx.globe.setPoints("sarFires", { lats, lons, values: vv, ramp: "heat", size: 0.00045, minSize: 0.7, opacity: 0.9, soft: 0.35, blending: ctx.blend.normal, radius: 1.0032, twinkle: 0.8 });
}

// ---------------------------------------------------------------- lifecycle
async function enter(c, params) {
  ctx = c;
  if (!styleEl) { styleEl = document.createElement("style"); styleEl.textContent = CSS; document.head.appendChild(styleEl); }
  ctx.panel.innerHTML = `<p class="eyebrow">Labs · Dancing with the SARs</p><h2>Loading NISAR radar…</h2>`;
  meta = meta || (await (await fetch(BASE + "areas.json" + ctx.v)).json());
  const want = params.get("area"); const k = meta.areas.findIndex((x) => x.id === want); if (k >= 0) S.ai = k;
  ctx.globe.controls.minDistance = 1.04; // let the camera come down to the radar scene
  await setArea(S.ai, true);
}
function exit() {
  stop();
  if (patch) patch.visible = false;
  ctx.globe.hideLayer("sarFires"); ctx.globe.setOutline(null);
  ctx.globe.controls.minDistance = 1.25;
}

async function setArea(i, first = false) {
  stop();
  S.ai = i; const a = A();
  S.t = a.dates.length - 1;
  ctx.panel.querySelector(".sar-areas")?.classList.add("loading");
  await loadArea(a);
  ensurePatch(); render(); drawFires(); panel();
  const [w, s, e, n] = a.bounds;
  ctx.globe.setOutline([[[w, s], [e, s], [e, n], [w, n], [w, s]]]);
  ctx.globe.flyTo((s + n) / 2, (w + e) / 2, 1.075);
  ctx.setParams({ area: a.id });
}

function play() {
  if (S.playing) { stop(); return; }
  const a = A(); S.playing = true; if (S.t >= a.dates.length - 1) S.t = 0;
  const b = $("#sar-play"); if (b) b.textContent = "❚❚";
  const t0 = performance.now(), from = S.t, span = Math.max(1, (a.dates.length - 1 - from) * 1100);
  const tick = (now) => {
    if (!S.playing) return;
    S.t = Math.min(a.dates.length - 1, from + ((now - t0) / span) * (a.dates.length - 1 - from));
    render();
    if (S.t >= a.dates.length - 1) { stop(); return; }
    timer = requestAnimationFrame(tick);
  };
  timer = requestAnimationFrame(tick);
}
function stop() { S.playing = false; if (timer) cancelAnimationFrame(timer); timer = null; const b = $("#sar-play"); if (b) b.textContent = "▶"; }

// ---------------------------------------------------------------- panel
function chartHtml(a) {
  const W = 400, H = 150, m = { l: 48, r: 8, t: 10, b: 20 }, n = a.dates.length;
  const X = (i) => m.l + (i / (n - 1)) * (W - m.l - m.r);
  let series, label;
  if (a.fire_series) {
    series = [{ name: "Where fires burn this week", color: "#ff8a4a", v: a.fire_series.map((d) => d.fire_hv) }, { name: "Rest of the scene", color: "#8fb4ec", v: a.fire_series.map((d) => d.other_hv) }];
    label = "HV vs scene median (dB)";
  } else {
    series = [{ name: "HH", color: "#e9a3e0", v: a.dates.map((d) => (d.hh / 255) * 25) }, { name: "HV", color: "#7fe0a0", v: a.dates.map((d) => (d.hv / 255) * 25) }];
    label = "scene brightness (≈ dB above the stretch floor)";
  }
  const all = series.flatMap((s) => s.v); let lo = Math.min(...all), hi = Math.max(...all); const pad = (hi - lo) * 0.2 || 1; lo -= pad; hi += pad;
  const Y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" class="sar-chart" role="img" aria-label="${label}" style="width:100%">`;
  [lo, (lo + hi) / 2, hi].forEach((t) => { s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--grid)"/><text x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end" class="ax">${t.toFixed(1)}</text>`; });
  a.dates.forEach((d, i) => { if (i % 2 === 0 || i === n - 1) s += `<text x="${X(i)}" y="${H - 5}" text-anchor="middle" class="ax">${fmtDate(d.date).replace(/, \d{4}/, "")}</text>`; });
  s += `<line id="sar-mark" data-x0="${m.l}" data-w="${W - m.l - m.r}" x1="${X(S.t)}" x2="${X(S.t)}" y1="${m.t}" y2="${H - m.b}" stroke="rgba(255,255,255,.35)" stroke-dasharray="3 3"/>`;
  series.forEach((sr) => {
    s += `<path d="${sr.v.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("")}" fill="none" stroke="${sr.color}" stroke-width="2"/>`;
    sr.v.forEach((v, i) => { s += `<circle cx="${X(i)}" cy="${Y(v)}" r="2.6" fill="${sr.color}"/>`; });
  });
  return s + `</svg><div class="legend">${series.map((sr) => `<span><i style="background:${sr.color}"></i>${sr.name}</span>`).join("")}<span class="muted">${label}</span></div>`;
}

function panel() {
  const a = A(), esc = ctx.h.esc, n = a.dates.length;
  const fs = a.fire_series ? (a.fire_series.reduce((s, d) => s + d.fire_hv - d.other_hv, 0) / a.fire_series.length) : null;
  ctx.panel.innerHTML = `
    <div class="lab-top"><button class="btn" id="lab-back">← Back to Ember Atlas</button><span class="lab-tag">Labs · Hard</span></div>
    <p class="eyebrow">NASA Space Apps · Dancing with the SARs</p>
    <h2>Radar sees through smoke and cloud</h2>
    <p class="lede small">Real <b>NISAR</b> L-band radar (NASA–ISRO, launched 2025), every 12 days from August to November 2026, for three places that change in different ways.</p>
    <div class="sar-areas">${meta.areas.map((x, i) => `<button data-area="${i}" aria-pressed="${i === S.ai}"><b>${esc(x.name.split(" · ")[0])}</b>${esc(x.name.split(" · ")[1] || x.place)}</button>`).join("")}</div>
    <h3>${esc(a.name)}<span class="sar-badge">NISAR GCOV</span></h3>
    <p class="muted small" style="margin:-6px 0 4px">${esc(a.place)} · ${esc(a.track)} · ${n} passes · ${a.polarization}</p>
    <div class="sar-player"><button class="btn" id="sar-play" aria-label="Play">▶</button><input id="sar-t" type="range" min="0" max="${n - 1}" step="0.01" value="${S.t}" aria-label="Date"><b class="sar-date" id="sar-date">${fmtDate(a.dates[Math.round(S.t)].date)}</b></div>
    <div class="sar-row">
      <div class="seg" role="group" aria-label="View"><button data-view="radar" aria-pressed="${S.view === "radar"}">Radar image</button><button data-view="change" aria-pressed="${S.view === "change"}">Change ${fmtDate(a.dates[0].date).replace(/, \d{4}/, "")} → ${fmtDate(a.dates[n - 1].date).replace(/, \d{4}/, "")}</button></div>
      <div class="seg" role="group" aria-label="Polarization"><button data-pol="rgb" aria-pressed="${S.pol === "rgb"}">HH + HV</button><button data-pol="hh" aria-pressed="${S.pol === "hh"}">HH</button><button data-pol="hv" aria-pressed="${S.pol === "hv"}">HV</button></div>
    </div>
    ${S.view === "change"
      ? `<div class="sar-legend"><span>HV fell</span><i style="background:linear-gradient(90deg,#f06e14,#f0e6dc 45%,#dfe9ff 55%,#4187ff)"></i><span>HV rose</span></div>
         <p class="muted small" style="margin:0">Orange = less volume scattering (vegetation burned, harvested or dried). Blue = more (regrowth, wetter or rougher surface). Each scene's median is removed first, about ${Math.round(a.change.drop * 100)}% of the area fell and ${Math.round(a.change.rise * 100)}% rose by more than ~1 dB.</p>`
      : `<div class="sar-key"><span style="background:#e9a3e0"></span><div><b>Pink / purple</b>: strong HH, weak HV: bare or rough soil, buildings, wet ground</div><span style="background:#7fe0a0"></span><div><b>Green</b>: strong HV: vegetation volume (grass, crops, reeds, forest)</div><span style="background:#16181d;border:1px solid #444"></span><div><b>Black</b>: smooth surfaces that mirror the radar away: calm water, smooth sand</div></div>`}
    ${a.fires ? `<label class="chip" id="sar-fires" aria-pressed="${S.fires}" style="margin:6px 0"><span class="sw" style="background:#ffb24a"></span>NASA FIRMS fires this week (${ctx.h.fmt(a.fires)})</label>` : ""}
    <div class="callout"><b>What's happening here.</b> ${esc(a.driver)}<div style="margin-top:6px">${esc(a.look)}</div>${fs != null ? `<div style="margin-top:6px"><b>Finding:</b> on every pass since August, the places burning this week were <b>${fs.toFixed(1)} dB brighter in HV</b> than the rest of the scene: NISAR marked the fuel (denser grass and shrubs) before it burned. The burning started after the last pass (1 Nov); the next pass will show the scars.</div>` : ""}</div>
    <h3>Over time</h3>
    ${chartHtml(a)}
    <h3>What L-band radar sees</h3>
    <div class="sar-explain">
      <div><b>Roughness</b>Rough surfaces scatter energy back to the satellite (bright); smooth ones mirror it away (dark).</div>
      <div><b>Moisture</b>Water has a high dielectric constant: wet soil and wet plants reflect more strongly than dry ones.</div>
      <div><b>Volume (HV)</b>Leaves and branches bounce the signal many times and rotate its polarization: HV ≈ how much vegetation there is.</div>
    </div>
    <p class="muted small">NISAR's 24 cm wavelength passes through cloud, smoke and darkness and partly through leaves, which is why it can watch fires, harvests and floods when optical satellites can't.</p>
    <h3>Data</h3>
    <p class="muted small" style="margin-top:-4px">${esc(meta.source)}. ${esc(meta.note)} Found with the public ASF search API; the full HDF5 products need a free NASA Earthdata login (see docs/labs/sar.md).</p>
    <div class="sar-ids">${a.dates.map((d) => esc(d.product)).join("<br>")}</div>
    <p class="muted small">Credit: NASA/JPL-Caltech and ISRO, NISAR mission; distributed by the Alaska Satellite Facility DAAC. Fires: NASA FIRMS (VIIRS NOAA-20).</p>`;
  bind();
}

function bind() {
  $("#lab-back").addEventListener("click", () => ctx.back());
  ctx.panel.querySelectorAll("[data-area]").forEach((b) => b.addEventListener("click", () => setArea(+b.dataset.area)));
  $("#sar-play").addEventListener("click", play);
  $("#sar-t").addEventListener("input", (e) => { stop(); S.t = +e.target.value; render(); });
  ctx.panel.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { S.view = b.dataset.view; render(); panel(); }));
  ctx.panel.querySelectorAll("[data-pol]").forEach((b) => b.addEventListener("click", () => { S.pol = b.dataset.pol; render(); panel(); }));
  $("#sar-fires")?.addEventListener("click", () => { S.fires = !S.fires; drawFires(); panel(); });
}

// ---------------------------------------------------------------- globe input
function onHover(ll, e) {
  if (!ll) { ctx.h.hideTip(); return; }
  const a = A(), [w, s, eL, n] = a.bounds;
  if (ll.lon < w || ll.lon > eL || ll.lat < s || ll.lat > n || !canvas) { ctx.h.showTip(`<div class="muted small">Pick a study area in the panel</div>`, e.clientX, e.clientY); return; }
  const I = imgs[a.id], im = I && I.list[Math.round(S.t)]; if (!im) return;
  const x = Math.floor(((ll.lon - w) / (eL - w)) * a.size[0]), y = Math.floor(((n - ll.lat) / (n - s)) * a.size[1]);
  const c = document.createElement("canvas"); c.width = c.height = 1; const g = c.getContext("2d");
  g.drawImage(im, x, y, 1, 1, 0, 0, 1, 1); const [hh, hv] = g.getImageData(0, 0, 1, 1).data;
  ctx.h.showTip(`<b>${fmtDate(a.dates[Math.round(S.t)].date)}</b><div class="row"><span>HH</span><span>${((hh / 255) * 25).toFixed(1)} dB*</span></div><div class="row"><span>HV</span><span>${((hv / 255) * 25).toFixed(1)} dB*</span></div><div class="muted small">${hv > hh * 0.9 && hv > 90 ? "Vegetation (volume scattering)" : hh + hv < 60 ? "Smooth: water or flat sand" : "Soil, rock or built surfaces"} · *above the display floor</div>`, e.clientX, e.clientY);
}

export default { id: "sar", enter, exit, onHover };
