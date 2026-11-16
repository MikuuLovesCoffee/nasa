// Lab · Martian Map (NASA Space Apps 2026 "Interplanetary Survival Guide: Martian Map").
// Fly from the Earth fire globe to Mars, dive into Jezero Crater and plan a Marswalk on a layered map built from
// several NASA missions: MRO CTX + HiRISE imagery, a CTX elevation model tied to MGS MOLA, Mars Odyssey THEMIS
// night-time infrared, the Mars 2020 Perseverance traverse and MEDA weather. Data: site/public/data/labs/marswalk/
// (pipeline/labs_marswalk.py). Loaded only when this lab opens.
import { travel, resetBody } from "./planets.js";

const BASE = "/data/labs/marswalk/";
const R_KM = 3389.5;               // Mars mean radius
const JEZ = { lat: 18.445, lon: 77.43 };
// Walk-budget assumptions (shown in the panel and in docs/labs/marswalk.md)
const A = { v0: 3.0, stopMin: 20, evaH: 8, reserve: 0.3, warnDeg: 15, nogoDeg: 25 };

let ctx, meta, route, weather, dem, ctxImg, hiImg, themisImg, elevCv, slopeCv, themisCv, slopeGrid;
let root, cv, g2, styleEl, raf = 0;
const S = { base: "ctx", hirise: true, themis: false, ellipse: true, path: true, stops: true, way: [], back: true, view: null, mapOpen: true, hover: null, sel: null };

// ---------------------------------------------------------------- data
const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
async function load() {
  if (meta) return;
  const v = ctx.v;
  const [m, r, w, buf, a, b, c] = await Promise.all([
    fetch(BASE + "meta.json" + v).then((x) => x.json()), fetch(BASE + "route.json" + v).then((x) => x.json()),
    fetch(BASE + "weather.json" + v).then((x) => x.json()), fetch(BASE + "dem.bin" + v).then((x) => x.arrayBuffer()),
    loadImg(BASE + "ctx.jpg" + v), loadImg(BASE + "hirise.jpg" + v), loadImg(BASE + "themis.png" + v),
  ]);
  meta = m; route = r; weather = w; ctxImg = a; hiImg = b; themisImg = c;
  dem = new Int16Array(buf);
  buildRasters();
}

// ---------------------------------------------------------------- geometry (map pixels = CTX image pixels)
const BB = () => meta.ctx.bbox;           // [lon0, lat0, lon1, lat1]
const W = () => ctxImg.width, H = () => ctxImg.height;
const toPx = (lon, lat) => { const [a, b, c, d] = BB(); return [((lon - a) / (c - a)) * W(), ((d - lat) / (d - b)) * H()]; };
const toLL = (x, y) => { const [a, b, c, d] = BB(); return [a + (x / W()) * (c - a), d - (y / H()) * (d - b)]; };
function distKm(a, b) { // equirectangular is fine at this scale
  const la = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const dx = (b[0] - a[0]) * Math.cos(la), dy = b[1] - a[1];
  return Math.hypot(dx, dy) * Math.PI / 180 * R_KM;
}
function elevAt(lon, lat) {
  const { w, h, bbox, nodata } = meta.dem;
  const x = ((lon - bbox[0]) / (bbox[2] - bbox[0])) * w - 0.5, y = ((bbox[3] - lat) / (bbox[3] - bbox[1])) * h - 0.5;
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return null;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const v = [dem[y0 * w + x0], dem[y0 * w + x1], dem[y1 * w + x0], dem[y1 * w + x1]];
  if (v.some((q) => q === nodata)) { const ok = v.filter((q) => q !== nodata); return ok.length ? ok.reduce((s, q) => s + q, 0) / ok.length : null; }
  return (v[0] * (1 - fx) + v[1] * fx) * (1 - fy) + (v[2] * (1 - fx) + v[3] * fx) * fy;
}
function slopeAt(lon, lat) {
  const { w, h, bbox } = meta.dem;
  const x = Math.floor(((lon - bbox[0]) / (bbox[2] - bbox[0])) * w), y = Math.floor(((bbox[3] - lat) / (bbox[3] - bbox[1])) * h);
  return x < 0 || y < 0 || x >= w || y >= h ? null : slopeGrid[y * w + x];
}

// colour rasters computed once from the DEM: elevation + hillshade, slope classes; THEMIS colourised
function buildRasters() {
  const { w, h, nodata, res_m } = meta.dem;
  let lo = 1e9, hi = -1e9;
  for (const q of dem) if (q !== nodata) { lo = Math.min(lo, q); hi = Math.max(hi, q); }
  meta.dem.lo = lo; meta.dem.hi = hi;
  slopeGrid = new Float32Array(w * h).fill(NaN);
  const e = document.createElement("canvas"); e.width = w; e.height = h;
  const s = document.createElement("canvas"); s.width = w; s.height = h;
  const ei = e.getContext("2d").createImageData(w, h), si = s.getContext("2d").createImageData(w, h);
  const at = (x, y) => { x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y)); const q = dem[y * w + x]; return q === nodata ? null : q; };
  const ER = [[37, 52, 148], [44, 127, 184], [65, 182, 196], [161, 218, 180], [255, 255, 204], [253, 174, 97], [215, 48, 39]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const z = at(x, y), o = (y * w + x) * 4; if (z == null) continue;
    const zl = at(x - 1, y) ?? z, zr = at(x + 1, y) ?? z, zu = at(x, y - 1) ?? z, zd = at(x, y + 1) ?? z;
    const gx = (zr - zl) / (2 * res_m), gy = (zd - zu) / (2 * res_m);
    const sl = Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI; slopeGrid[y * w + x] = sl;
    // hillshade, sun from NW at 45°
    const az = 315 * Math.PI / 180, alt = 45 * Math.PI / 180, asp = Math.atan2(gy, -gx), slp = Math.atan(Math.hypot(gx, gy));
    const hs = Math.max(0, Math.sin(alt) * Math.cos(slp) + Math.cos(alt) * Math.sin(slp) * Math.cos(az - asp));
    const t = (z - lo) / (hi - lo) * (ER.length - 1), i = Math.min(ER.length - 2, Math.floor(t)), f = t - i;
    for (let k = 0; k < 3; k++) ei.data[o + k] = (ER[i][k] + (ER[i + 1][k] - ER[i][k]) * f) * (0.45 + 0.75 * hs);
    ei.data[o + 3] = 255;
    const c = sl < 8 ? [60, 180, 110, 70] : sl < A.warnDeg ? [240, 210, 60, 150] : sl < A.nogoDeg ? [255, 140, 40, 200] : [235, 50, 50, 230];
    si.data.set(c, o);
  }
  e.getContext("2d").putImageData(ei, 0, 0); s.getContext("2d").putImageData(si, 0, 0);
  elevCv = e; slopeCv = s;
  const t = document.createElement("canvas"); t.width = themisImg.width; t.height = themisImg.height;
  const tx = t.getContext("2d"); tx.drawImage(themisImg, 0, 0);
  const id = tx.getImageData(0, 0, t.width, t.height);
  for (let i = 0; i < id.data.length; i += 4) { // magma-like: dark = dust (cold at night), bright = rock (warm at night)
    const v = id.data[i] / 255, a = v < 0.02 ? 0 : 200;
    id.data[i] = Math.min(255, 40 + 330 * v); id.data[i + 1] = Math.max(0, Math.min(255, 300 * (v - 0.35))); id.data[i + 2] = Math.min(255, 120 * (1 - v) + 60 * v * v); id.data[i + 3] = a;
  }
  tx.putImageData(id, 0, 0); themisCv = t;
}

// ---------------------------------------------------------------- map view
function css() {
  styleEl = document.createElement("style");
  styleEl.textContent = `
  .mw-map { position: fixed; left: 16px; top: 84px; bottom: 16px; right: calc(440px + 32px); z-index: 9; border-radius: 14px; overflow: hidden;
    border: 1px solid rgba(255,140,90,.28); background: #0b0806; box-shadow: 0 10px 40px rgba(0,0,0,.5); }
  .mw-map canvas { width: 100%; height: 100%; display: block; cursor: crosshair; }
  .mw-map.drag canvas { cursor: grabbing; }
  .mw-hud { position: absolute; left: 12px; top: 10px; display: flex; gap: 8px; align-items: center; pointer-events: none; }
  .mw-hud b { font-family: var(--mono); font-size: 12px; letter-spacing: .12em; color: #ffb38a; text-transform: uppercase; }
  .mw-hud span { font-size: 11.5px; color: var(--text-3); }
  .mw-read { position: absolute; left: 12px; bottom: 10px; font-family: var(--mono); font-size: 11.5px; color: #e9ddd2; background: rgba(10,8,6,.72);
    padding: 5px 9px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); pointer-events: none; }
  .mw-tools { position: absolute; right: 10px; top: 10px; display: flex; flex-direction: column; gap: 6px; }
  .mw-tools button { width: 34px; height: 34px; border-radius: 9px; border: 1px solid rgba(255,255,255,.14); background: rgba(16,12,10,.85); color: #f3e7dc; font-size: 15px; cursor: pointer; }
  .mw-tools button:hover { border-color: #ff8a5c; }
  .mw-legend { position: absolute; right: 10px; bottom: 10px; background: rgba(10,8,6,.78); border: 1px solid rgba(255,255,255,.08); border-radius: 9px; padding: 7px 9px; font-size: 11px; color: var(--text-2); }
  .mw-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin: 0 4px 0 8px; vertical-align: -1px; }
  .mw-legend .grad { width: 120px; height: 8px; border-radius: 4px; display: block; margin: 4px 0 2px; }
  .mw-cond { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 8px 0 4px; }
  .mw-cond div { border: 1px solid var(--line); border-radius: 9px; padding: 7px 8px; background: rgba(255,120,70,.05); }
  .mw-cond b { display: block; font-family: var(--mono); font-size: 15px; color: #ffd6bf; }
  .mw-cond span { font-size: 10.5px; color: var(--text-3); }
  .mw-bar { height: 10px; border-radius: 5px; background: rgba(255,255,255,.07); overflow: hidden; position: relative; margin: 4px 0 2px; }
  .mw-bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 5px; }
  .mw-bar em { position: absolute; top: -2px; bottom: -2px; width: 2px; background: #fff; opacity: .7; }
  .mw-stops li { cursor: pointer; }
  .mw-stops li:hover { background: rgba(255,255,255,.04); }
  .mw-warn { border-color: rgba(255,77,94,.45) !important; background: rgba(255,77,94,.08) !important; }
  .mw-ok { border-color: rgba(60,180,110,.45) !important; background: rgba(60,180,110,.08) !important; }
  .mw-prof { width: 100%; display: block; }
  .mw-prof .ax { fill: var(--text-3); font-size: 10px; font-family: var(--mono); }
  .mw-open { position: fixed; left: 16px; bottom: 16px; z-index: 10; }`;
  document.head.appendChild(styleEl);
}

function mountMap() {
  root = document.createElement("div"); root.className = "mw-map";
  root.innerHTML = `<canvas></canvas>
    <div class="mw-hud"><b>Jezero Crater · Mars</b><span>18.4°N 77.4°E · click to add waypoints · drag to pan · wheel to zoom</span></div>
    <div class="mw-tools"><button data-z="1" title="Zoom in">+</button><button data-z="-1" title="Zoom out">−</button><button data-z="0" title="Fit">⤢</button><button data-hide title="Show the 3D Mars globe">◎</button></div>
    <div class="mw-read" id="mw-read">—</div><div class="mw-legend" id="mw-legend"></div>`;
  document.body.appendChild(root);
  cv = root.querySelector("canvas"); g2 = cv.getContext("2d");
  const resize = () => { if (!root || !cv) return; const r = root.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); cv.width = r.width * d; cv.height = r.height * d; cv.dataset.d = d; if (!S.view) fit(); draw(); };
  ro?.disconnect(); ro = new ResizeObserver(resize); ro.observe(root);
  // pan / zoom / click
  let down = null, moved = false;
  cv.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, cx: S.view.cx, cy: S.view.cy }; moved = false; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener("pointermove", (e) => {
    if (down) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) { moved = true; root.classList.add("drag"); }
      if (moved) { S.view.cx = down.cx - dx / S.view.k; S.view.cy = down.cy - dy / S.view.k; draw(); }
    }
    S.hover = screenToLL(e); readout();
  });
  cv.addEventListener("pointerup", (e) => {
    root.classList.remove("drag");
    if (down && !moved) addWay(screenToLL(e));
    down = null;
  });
  cv.addEventListener("pointerleave", () => { S.hover = null; readout(); });
  cv.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e); }, { passive: false });
  root.querySelectorAll("[data-z]").forEach((b) => b.addEventListener("click", () => { const z = +b.dataset.z; if (z === 0) fit(); else zoomAt(z > 0 ? 1.4 : 0.7); draw(); }));
  root.querySelector("[data-hide]").addEventListener("click", () => setMapOpen(false));
}
function fit() { if (!root) return; const r = root.getBoundingClientRect(); S.view = { cx: W() / 2, cy: H() / 2, k: Math.min(r.width / W(), r.height / H()) * 1.0 }; }
function zoomAt(f, e) {
  const r = cv.getBoundingClientRect(), sx = e ? e.clientX - r.left : r.width / 2, sy = e ? e.clientY - r.top : r.height / 2;
  const px = S.view.cx + (sx - r.width / 2) / S.view.k, py = S.view.cy + (sy - r.height / 2) / S.view.k;
  S.view.k = Math.max(0.15, Math.min(14, S.view.k * f));
  S.view.cx = px - (sx - r.width / 2) / S.view.k; S.view.cy = py - (sy - r.height / 2) / S.view.k;
  draw();
}
function screenToLL(e) {
  const r = cv.getBoundingClientRect();
  return toLL(S.view.cx + (e.clientX - r.left - r.width / 2) / S.view.k, S.view.cy + (e.clientY - r.top - r.height / 2) / S.view.k);
}
function centerOn(lon, lat, k) { const [x, y] = toPx(lon, lat); S.view.cx = x; S.view.cy = y; if (k) S.view.k = k; draw(); }

function draw() {
  if (!cv || !S.view) return;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const d = +cv.dataset.d || 1, Wc = cv.width, Hc = cv.height, k = S.view.k * d;
    g2.setTransform(1, 0, 0, 1, 0, 0); g2.fillStyle = "#0b0806"; g2.fillRect(0, 0, Wc, Hc);
    g2.setTransform(k, 0, 0, k, Wc / 2 - S.view.cx * k, Hc / 2 - S.view.cy * k);
    g2.imageSmoothingEnabled = true; g2.imageSmoothingQuality = "high";
    const full = (img, a = 1) => { g2.globalAlpha = a; g2.drawImage(img, 0, 0, W(), H()); g2.globalAlpha = 1; };
    const boxed = (img, bb, a = 1) => { const [x0, y0] = toPx(bb[0], bb[3]), [x1, y1] = toPx(bb[2], bb[1]); g2.globalAlpha = a; g2.drawImage(img, x0, y0, x1 - x0, y1 - y0); g2.globalAlpha = 1; };
    if (S.base === "elev") full(elevCv);
    else { full(ctxImg); if (S.hirise && S.base === "ctx") boxed(hiImg, meta.hirise.bbox); }
    if (S.base === "slope") { full(ctxImg, 0.55); full(slopeCv, 0.9); }
    if (S.themis) full(themisCv, 0.6);
    const lw = 1 / S.view.k;
    if (S.ellipse) { // landing ellipse
      const E = route.ellipse, [x, y] = toPx(E.lon, E.lat), kmPx = W() / ((BB()[2] - BB()[0]) * Math.cos(E.lat * Math.PI / 180) * Math.PI / 180 * R_KM);
      g2.strokeStyle = "rgba(120,220,255,.9)"; g2.setLineDash([6 * lw, 5 * lw]); g2.lineWidth = 1.6 * lw;
      g2.beginPath(); g2.ellipse(x, y, (E.a_km / 2) * kmPx, (E.b_km / 2) * kmPx, 0, 0, Math.PI * 2); g2.stroke(); g2.setLineDash([]);
      label("Mars 2020 landing ellipse", x, y - (E.b_km / 2) * kmPx - 6 * lw, "rgba(150,230,255,.95)");
    }
    if (S.path) { // Perseverance traverse
      g2.strokeStyle = "rgba(255,255,255,.95)"; g2.lineWidth = 2.2 * lw; g2.lineJoin = "round"; g2.beginPath();
      route.traverse.forEach(([lo, la], i) => { const [x, y] = toPx(lo, la); i ? g2.lineTo(x, y) : g2.moveTo(x, y); }); g2.stroke();
      g2.strokeStyle = "rgba(255,90,60,.9)"; g2.lineWidth = 1 * lw; g2.stroke();
      const [rx, ry] = toPx(...route.rover_now); dot(rx, ry, 5 * lw, "#ff5a3c"); label(`Perseverance (sol ${route.through_sol})`, rx + 8 * lw, ry, "#ffd2c4", "left");
    }
    if (S.stops) route.stops.forEach((s, i) => {
      const [x, y] = toPx(s.lon, s.lat), c = s.kind === "sample" ? "#ffcc4d" : s.kind === "depot" ? "#b388ff" : "#7fe0b8";
      dot(x, y, (S.sel === i ? 7 : 5) * lw, c); label(s.name, x + 9 * lw, y, c, "left");
    });
    drawRoute(lw);
    scaleBar();
    legend();
  });
}
function dot(x, y, r, c) { g2.fillStyle = c; g2.strokeStyle = "rgba(0,0,0,.7)"; g2.lineWidth = r * 0.4; g2.beginPath(); g2.arc(x, y, r, 0, Math.PI * 2); g2.fill(); g2.stroke(); }
function label(t, x, y, c, align = "center") {
  const lw = 1 / S.view.k; g2.font = `${12 * lw}px Inter, sans-serif`; g2.textAlign = align; g2.textBaseline = "middle";
  g2.lineWidth = 3 * lw; g2.strokeStyle = "rgba(0,0,0,.75)"; g2.strokeText(t, x, y); g2.fillStyle = c; g2.fillText(t, x, y);
}
function drawRoute(lw) {
  if (!S.way.length) return;
  const pts = S.back && S.way.length > 1 ? [...S.way, S.way[0]] : S.way;
  for (let i = 1; i < pts.length; i++) { // colour each leg by its steepest slope
    const seg = sampleLeg(pts[i - 1], pts[i]), mx = Math.max(0, ...seg.map((q) => q.slope || 0));
    const [x0, y0] = toPx(...pts[i - 1]), [x1, y1] = toPx(...pts[i]);
    g2.strokeStyle = "rgba(0,0,0,.6)"; g2.lineWidth = 5 * lw; g2.setLineDash(i === pts.length - 1 && S.back && S.way.length > 1 ? [8 * lw, 6 * lw] : []);
    g2.beginPath(); g2.moveTo(x0, y0); g2.lineTo(x1, y1); g2.stroke();
    g2.strokeStyle = mx >= A.nogoDeg ? "#ff4d5e" : mx >= A.warnDeg ? "#ffb13d" : "#5ce1a6"; g2.lineWidth = 3 * lw; g2.stroke();
  }
  g2.setLineDash([]);
  S.way.forEach((p, i) => { const [x, y] = toPx(...p); dot(x, y, 6 * lw, i === 0 ? "#ffffff" : "#ff8a5c"); label(i === 0 ? "START" : String(i), x, y - 13 * lw, "#fff"); });
}
function scaleBar() {
  const d = +cv.dataset.d || 1; g2.setTransform(d, 0, 0, d, 0, 0);
  const lat = JEZ.lat, kmPerPx = ((BB()[2] - BB()[0]) / W()) * Math.cos(lat * Math.PI / 180) * Math.PI / 180 * R_KM / S.view.k;
  const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10], km = nice.find((n) => n / kmPerPx > 90) || 10, px = km / kmPerPx;
  const x = 14, y = cv.height / d - 44;
  g2.fillStyle = "rgba(10,8,6,.7)"; g2.fillRect(x - 6, y - 16, px + 60, 24);
  g2.fillStyle = "#f3e7dc"; g2.fillRect(x, y, px, 3); g2.font = "11px JetBrains Mono, monospace"; g2.textAlign = "left"; g2.fillText(`${km} km`, x + px + 6, y + 3);
  g2.fillText("N ↑", x, y - 6);
}
function legend() {
  const el = document.getElementById("mw-legend"); if (!el) return;
  let h = "";
  if (S.base === "elev") h += `Elevation (m)<span class="grad" style="background:linear-gradient(90deg,#253494,#2c7fb8,#41b6c4,#a1dab4,#ffffcc,#fdae61,#d73027)"></span>${meta.dem.lo} … ${meta.dem.hi}`;
  else if (S.base === "slope") h += `Slope<br><i style="background:#3cb46e"></i>&lt;8° <i style="background:#f0d23c"></i>8–15° <i style="background:#ff8c28"></i>15–25° <i style="background:#eb3232"></i>&gt;25°`;
  else h += `MRO CTX 6 m${S.hirise ? " + HiRISE 25 cm" : ""}`;
  if (S.themis) h += `<br>THEMIS night IR: <i style="background:#3a1050"></i>dust <i style="background:#ffe066"></i>rock`;
  el.innerHTML = h;
}
function readout() {
  const el = document.getElementById("mw-read"); if (!el) return;
  if (!S.hover) { el.textContent = "—"; return; }
  const [lo, la] = S.hover, z = elevAt(lo, la), s = slopeAt(lo, la);
  el.textContent = `${la.toFixed(4)}°N ${lo.toFixed(4)}°E · ${z == null ? "no elevation" : Math.round(z) + " m"} · slope ${s == null || isNaN(s) ? "–" : s.toFixed(1) + "°"}`;
}

// ---------------------------------------------------------------- route analysis
function sampleLeg(a, b) {
  const km = distKm(a, b), n = Math.max(2, Math.ceil(km * 1000 / 40)), out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, lo = a[0] + (b[0] - a[0]) * t, la = a[1] + (b[1] - a[1]) * t;
    out.push({ d: km * t, z: elevAt(lo, la), slope: slopeAt(lo, la) });
  }
  return out;
}
function analyse() {
  if (S.way.length < 2) return null;
  const pts = S.back ? [...S.way, S.way[0]] : S.way;
  let dist = 0, up = 0, down = 0, tH = 0, maxS = 0, steep = 0, nogo = 0, prof = [], legs = [];
  for (let i = 1; i < pts.length; i++) {
    const seg = sampleLeg(pts[i - 1], pts[i]); let legT = 0, legMax = 0;
    for (let j = 1; j < seg.length; j++) {
      const p = seg[j - 1], q = seg[j], dd = q.d - p.d;
      const dz = p.z != null && q.z != null ? q.z - p.z : 0;
      if (dz > 0) up += dz; else down -= dz;
      const grade = dd > 0 ? dz / (dd * 1000) : 0, ground = q.slope || 0;
      // Tobler-style speed with a suit-limited flat speed; cross-slope roughness from the terrain slope
      const v = A.v0 * Math.exp(-3.5 * Math.abs(grade + 0.05)) / Math.exp(-3.5 * 0.05) * (ground > A.warnDeg ? 0.6 : 1);
      legT += dd / Math.max(0.3, v);
      legMax = Math.max(legMax, ground); if (ground >= A.warnDeg) steep += dd; if (ground >= A.nogoDeg) nogo += dd;
      prof.push({ d: dist + q.d, z: q.z, s: ground });
    }
    dist += seg[seg.length - 1].d; tH += legT; maxS = Math.max(maxS, legMax); legs.push({ km: seg[seg.length - 1].d, max: legMax });
  }
  const stops = (S.way.length - 1) * A.stopMin / 60, total = tH + stops, budget = A.evaH * (1 - A.reserve);
  return { dist, up, down, walkH: tH, stopsH: stops, totalH: total, used: total / A.evaH, ok: total <= budget, maxS, steep, nogo, prof, legs, budget };
}
const hm = (h) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, "0")} min`;
function profileSvg(r) {
  const Wd = 400, Hd = 120, m = { l: 40, r: 8, t: 8, b: 18 }, z = r.prof.filter((p) => p.z != null);
  if (z.length < 2) return "";
  const lo = Math.min(...z.map((p) => p.z)) - 10, hi = Math.max(...z.map((p) => p.z)) + 10, D = r.dist;
  const X = (d) => m.l + (d / D) * (Wd - m.l - m.r), Y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (Hd - m.t - m.b);
  let s = `<svg viewBox="0 0 ${Wd} ${Hd}" class="mw-prof" role="img" aria-label="Elevation profile">`;
  [lo, hi].forEach((v) => (s += `<text x="${m.l - 4}" y="${Y(v) + 3}" text-anchor="end" class="ax">${Math.round(v)}</text>`));
  s += `<text x="${Wd - m.r}" y="${Hd - 4}" text-anchor="end" class="ax">${D.toFixed(1)} km</text><text x="${m.l}" y="${Hd - 4}" class="ax">0</text>`;
  for (let i = 1; i < z.length; i++) {
    const c = z[i].s >= A.nogoDeg ? "#ff4d5e" : z[i].s >= A.warnDeg ? "#ffb13d" : "#5ce1a6";
    s += `<line x1="${X(z[i - 1].d)}" y1="${Y(z[i - 1].z)}" x2="${X(z[i].d)}" y2="${Y(z[i].z)}" stroke="${c}" stroke-width="2"/>`;
  }
  return s + "</svg>";
}

// ---------------------------------------------------------------- panel
function panel() {
  const esc = ctx.h.esc, w = weather.latest, r = analyse();
  const chip = (k, on, l) => `<button data-mw="${k}" aria-pressed="${on}">${l}</button>`;
  const ls = +w.ls, dusty = ls >= 180 && ls <= 360;
  let routeHtml = `<p class="muted small">Click the map to drop waypoints. The first one is your habitat / rover; each leg is coloured by its steepest ground (green &lt; ${A.warnDeg}°, amber ${A.warnDeg}–${A.nogoDeg}°, red &gt; ${A.nogoDeg}°).</p>`;
  if (r) {
    const pct = Math.min(1, r.used), bc = r.used > 1 - A.reserve ? "#ff4d5e" : r.used > 0.5 ? "#ffb13d" : "#5ce1a6";
    routeHtml = `
      <table class="data"><tr><th>Distance${S.back ? " (round trip)" : ""}</th><td><b>${r.dist.toFixed(2)} km</b></td></tr>
      <tr><th>Climb / descent</th><td>+${Math.round(r.up)} m / −${Math.round(r.down)} m</td></tr>
      <tr><th>Steepest ground</th><td>${r.maxS.toFixed(1)}°${r.steep > 0 ? ` · ${(r.steep * 1000).toFixed(0)} m above ${A.warnDeg}°` : ""}</td></tr>
      <tr><th>Walking + science stops</th><td>${hm(r.walkH)} + ${hm(r.stopsH)} = <b>${hm(r.totalH)}</b></td></tr></table>
      ${profileSvg(r)}
      <div class="small muted" style="margin-top:6px">Suit consumables used (O₂, power, cooling; ${A.evaH} h suit, ${A.reserve * 100}% kept in reserve)</div>
      <div class="mw-bar"><i style="width:${pct * 100}%;background:${bc}"></i><em style="left:${(1 - A.reserve) * 100}%"></em></div>
      <div class="callout ${r.ok && !r.nogo ? "mw-ok" : "mw-warn"}">${r.nogo > 0 ? `<b>No-go:</b> ${(r.nogo * 1000).toFixed(0)} m of the route crosses slopes over ${A.nogoDeg}°. Move a waypoint around the red ground.` : !r.ok ? `<b>Too long:</b> ${hm(r.totalH)} is over the ${hm(r.budget)} you can plan with a ${A.reserve * 100}% reserve. Drop a stop or shorten the walk.` : r.steep > 0 ? `<b>Go, with care:</b> short steep stretches (${A.warnDeg}–${A.nogoDeg}°). Walk them slowly, one at a time.` : `<b>Go:</b> fits the suit budget with ${hm(r.budget - r.totalH)} to spare and no steep ground.`}</div>`;
  }
  ctx.panel.innerHTML = `
    <div class="lab-top"><button class="btn" id="lab-back">← Back to Ember Atlas</button><span class="lab-tag" style="color:#7fe0b8">Labs · Easy</span></div>
    <p class="eyebrow">NASA Space Apps · Interplanetary Survival Guide: Martian Map</p>
    <h2>Plan a Marswalk in Jezero Crater</h2>
    <p class="lede small">An ancient lake with a river delta, now explored by Perseverance. One map stacks data from four NASA missions so an astronaut can pick a safe route to the best rocks.</p>
    <h3>Conditions at Jezero</h3>
    <div class="mw-cond">
      <div><b>${w.max_temp}°</b><span>day high, °C</span></div><div><b>${w.min_temp}°</b><span>night low, °C</span></div>
      <div><b>${w.pressure}</b><span>pressure, Pa</span></div><div><b>${w.sunrise?.slice(0, 5)}</b><span>sunrise (LMST)</span></div>
    </div>
    <p class="muted small" style="margin:0">Latest report in NASA's public MEDA feed: sol ${w.sol} (${w.terrestrial_date}), ${esc(w.season)} at Jezero, Ls ${Math.round(ls)}°.
      ${dusty ? "<b>Dust-storm season</b> (Ls 180–360°): check for dust before going out." : "Outside the main dust-storm season."} Air pressure is under 1% of Earth's and UV at the surface is strong: a pressurised suit is required, and the warm midday hours are best.</p>
    <h3>Map layers</h3>
    <div class="chips">${chip("base:ctx", S.base === "ctx", "Imagery")}${chip("base:elev", S.base === "elev", "Elevation")}${chip("base:slope", S.base === "slope", "Slope hazard")}</div>
    <div class="chips">${chip("hirise", S.hirise, "HiRISE close-up")}${chip("themis", S.themis, "Rocks (THEMIS night IR)")}${chip("ellipse", S.ellipse, "Landing ellipse")}${chip("path", S.path, "Perseverance path")}${chip("stops", S.stops, "Science stops")}</div>
    <h3>Your Marswalk</h3>
    <div class="row-ctl" style="flex-wrap:wrap;margin-bottom:6px">
      <button class="btn" id="mw-suggest">Suggested: landing site → delta front</button>
      <button class="btn" id="mw-undo" ${S.way.length ? "" : "disabled"}>Undo</button><button class="btn" id="mw-clear" ${S.way.length ? "" : "disabled"}>Clear</button>
      <label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="mw-back" ${S.back ? "checked" : ""}> return to start</label>
    </div>
    ${routeHtml}
    <h3>Science stops</h3>
    <ul class="rank mw-stops">${route.stops.map((s, i) => `<li data-stop="${i}"><span class="i" style="color:${s.kind === "sample" ? "#ffcc4d" : s.kind === "depot" ? "#b388ff" : "#7fe0b8"}">●</span><span><b>${esc(s.name)}</b>${s.sol ? `<span class="muted small"> · sol ${s.sol}</span>` : ""}${S.sel === i ? `<div class="small" style="color:var(--text-2);margin-top:3px">${esc(s.why)}${s.src ? ` <a href="${s.src}" target="_blank" rel="noopener">NASA ↗</a>` : ""}</div><button class="btn small" data-add="${i}" style="margin-top:5px">Add as waypoint</button>` : ""}</span></li>`).join("")}</ul>
    <p class="muted small" style="margin-top:10px"><b>Walk model</b> (assumptions): ${A.v0} km/h on flat ground in a suit, slowed on slopes (Tobler's hiking rule) and by 40% on ground steeper than ${A.warnDeg}°; ${A.stopMin} min per science stop; ${A.evaH} h of suit consumables with ${A.reserve * 100}% held back for emergencies; no walking on slopes over ${A.nogoDeg}°.</p>
    <p class="muted small"><b>Data</b> (all NASA, no login): MRO CTX 6 m + HiRISE 25 cm orthomosaics and Mars Odyssey THEMIS night IR via NASA Mars Trek; CTX elevation model tied to MGS MOLA (USGS Astrogeology, Mars 2020 navigation maps); Perseverance traverse to sol ${route.through_sol} (${route.traverse_km} km) from NASA/JPL; MEDA weather from mars.nasa.gov.</p>
    ${S.mapOpen ? "" : `<button class="btn" id="mw-reopen" style="margin-top:6px">Open the Jezero map</button>`}`;
  bind();
}
function bind() {
  const P = ctx.panel;
  P.querySelector("#lab-back").addEventListener("click", () => ctx.back());
  P.querySelectorAll("[data-mw]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.mw;
    if (k.startsWith("base:")) S.base = k.slice(5); else S[k] = !S[k];
    draw(); panel();
  }));
  P.querySelector("#mw-suggest").addEventListener("click", () => {
    const st = route.stops;
    S.way = [[st[0].lon, st[0].lat], [77.425, 18.452], [st[2].lon, st[2].lat]];
    centerOn(77.43, 18.45, 2.2 * Math.min(root.clientWidth / W(), root.clientHeight / H())); panel();
  });
  P.querySelector("#mw-undo").addEventListener("click", () => { S.way.pop(); draw(); panel(); });
  P.querySelector("#mw-clear").addEventListener("click", () => { S.way = []; draw(); panel(); });
  P.querySelector("#mw-back").addEventListener("change", (e) => { S.back = e.target.checked; draw(); panel(); });
  P.querySelectorAll("[data-stop]").forEach((li) => li.addEventListener("click", (e) => {
    if (e.target.closest("[data-add]") || e.target.closest("a")) return;
    const i = +li.dataset.stop; S.sel = S.sel === i ? null : i; const s = route.stops[i];
    if (S.sel != null) centerOn(s.lon, s.lat, Math.max(S.view.k, 1.4 * Math.min(root.clientWidth / W(), root.clientHeight / H())));
    draw(); panel();
  }));
  P.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => { const s = route.stops[+b.dataset.add]; addWay([s.lon, s.lat]); }));
  P.querySelector("#mw-reopen")?.addEventListener("click", () => setMapOpen(true));
}
function addWay(ll) {
  const [a, b, c, d] = BB(); if (ll[0] < a || ll[0] > c || ll[1] < b || ll[1] > d) return;
  S.way.push(ll); draw(); panel();
}
function setMapOpen(on) {
  S.mapOpen = on; root.style.display = on ? "" : "none";
  if (!on) ctx.globe.flyTo(JEZ.lat, JEZ.lon, 2.2);
  panel();
}

// ---------------------------------------------------------------- lifecycle
async function enter(c) {
  ctx = c;
  ctx.panel.innerHTML = `<div class="lab-top"><button class="btn" id="lab-back">← Back to Ember Atlas</button><span class="lab-tag" style="color:#7fe0b8">Labs · Easy</span></div>
    <p class="eyebrow">Martian Map</p><h2>Flying to Mars…</h2><p class="lede small">Leaving the Earth fire globe for Jezero Crater, 18.4°N 77.4°E.</p>`;
  ctx.panel.querySelector("#lab-back").addEventListener("click", () => ctx.back());
  css();
  const loading = load();
  await travel(ctx.globe, "mars", { lat: JEZ.lat, lon: JEZ.lon, dist: 2.1 });
  await loading;
  ctx.globe.setMarker(JEZ.lat, JEZ.lon);
  const E = route.ellipse, ring = []; // ellipse outline on the 3D globe too
  for (let i = 0; i <= 48; i++) { const t = (i / 48) * Math.PI * 2; ring.push([E.lon + (E.a_km / 2) * Math.cos(t) / (59.16 * Math.cos(E.lat * Math.PI / 180)), E.lat + (E.b_km / 2) * Math.sin(t) / 59.16]); }
  ctx.globe.setOutline([ring]);
  mountMap();
  panel();
  ctx.setParams?.({});
}
let ro = null;
function exit() {
  cancelAnimationFrame(raf); ro?.disconnect(); ro = null;
  root?.remove(); root = null; cv = null; styleEl?.remove(); styleEl = null; S.view = null;
  ctx.globe.setMarker(null); ctx.globe.setOutline(null);
  resetBody(ctx.globe);
}
function onClick(ll) { // on the 3D globe (map hidden): clicking near Jezero reopens the map
  if (!S.mapOpen && Math.abs(ll.lat - JEZ.lat) < 6 && Math.abs(ll.lon - JEZ.lon) < 6) setMapOpen(true);
}
function onHover(ll, e) {
  if (!ll) { ctx.h.hideTip(); return; }
  const near = Math.abs(ll.lat - JEZ.lat) < 6 && Math.abs(ll.lon - JEZ.lon) < 6;
  ctx.h.showTip(`<b>Mars</b> · ${ll.lat.toFixed(1)}°, ${ll.lon.toFixed(1)}°<div class="muted small">${near ? "Jezero Crater · click to open the map" : "Jezero is at 18.4°N 77.4°E"}</div>`, e.clientX, e.clientY);
}

export default { id: "marswalk", enter, exit, onClick, onHover };
