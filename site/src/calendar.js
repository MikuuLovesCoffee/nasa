// Fire calendar for an area of interest (country, province, drawn box or 1° square).
// Everything is computed in the browser from history.bin (0.5° monthly, VIIRS-equivalent),
// so any area works without a server.
import { COLS05, RES } from "./data.js";
import { loadRegions, inPolys } from "./places.js";

export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NCELL = 360 * COLS05;

// ---------------------------------------------------------------- areas
let countriesP = null;
/** Country name -> [regions], from the Natural Earth admin-1 file the click card already uses. */
export function loadCountries() {
  countriesP ??= loadRegions().then((regions) => {
    if (!regions) return null;
    const m = new Map();
    for (const r of regions) {
      if (!r.country) continue;
      if (!m.has(r.country)) m.set(r.country, []);
      m.get(r.country).push(r);
    }
    return m;
  });
  return countriesP;
}

/** Search index: [{ label, kind, key }] for the area picker. */
export async function areaIndex() {
  const [regions, countries] = await Promise.all([loadRegions(), loadCountries()]);
  if (!regions) return [];
  const out = [...countries.keys()].sort().map((c) => ({ label: c, kind: "country", key: c }));
  for (const r of regions) if (r.country) out.push({ label: `${r.name}, ${r.country}`, kind: "province", key: provKey(r) });
  return out;
}

/** Resolve an AOI spec { kind, key | box } into { kind, name, sub, rings, parts }. */
export async function resolveArea(spec) {
  if (spec.kind === "box" || spec.kind === "square") {
    const [la0, lo0, la1, lo1] = spec.box;
    const lat0 = Math.min(la0, la1), lat1 = Math.max(la0, la1), lon0 = Math.min(lo0, lo1), lon1 = Math.max(lo0, lo1);
    const ring = [[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1], [lon0, lat0]];
    const f = (v, p, n) => `${Math.abs(v).toFixed(1)}°${v >= 0 ? p : n}`;
    return {
      ...spec, box: [lat0, lon0, lat1, lon1], rings: [ring],
      name: spec.kind === "square" ? "1° grid square" : "Drawn box",
      sub: `${f(lat0, "N", "S")}–${f(lat1, "N", "S")}, ${f(lon0, "E", "W")}–${f(lon1, "E", "W")}`,
    };
  }
  const regions = await loadRegions();
  if (!regions) return null;
  let parts;
  if (spec.kind === "country") parts = regions.filter((r) => r.country === spec.key);
  else parts = regions.filter((r) => provKey(r) === spec.key || (r.iso && r.iso === spec.key));
  if (spec.kind === "province" && parts.length > 1) parts = parts.filter((r) => provKey(r) === spec.key).slice(0, 1).concat(parts).slice(0, 1);
  if (!parts.length) return null;
  const rings = parts.flatMap((r) => r.polys.map((p) => p[0]));
  return {
    ...spec, parts, rings,
    name: spec.kind === "country" ? spec.key : parts[0].name,
    sub: spec.kind === "country" ? `Country · ${parts.length} provinces` : `${parts[0].type || "Province"} · ${parts[0].country}`,
  };
}

/** Stable id for a province (ISO 3166-2 codes are not unique in Natural Earth, e.g. city + region). */
export const provKey = (r) => `${r.iso || "?"}|${r.name}`;

const cellOf = (r, c) => r * COLS05 + c;
const rowOfLat = (lat) => Math.max(0, Math.min(359, Math.floor((90 - lat) / RES)));
const colOfLon = (lon) => Math.max(0, Math.min(COLS05 - 1, Math.floor((lon + 180) / RES)));

/**
 * Share of each 0.5° cell that lies inside the area (0..1), as Float32Array over the whole grid.
 * Small areas are sampled 4×4 per cell so a small province still gets partial cells;
 * large ones use the cell centre (fast enough for Russia).
 */
export function areaWeights(area) {
  const w = new Float32Array(NCELL);
  if (area.box) {
    const [lat0, lon0, lat1, lon1] = area.box;
    for (let r = rowOfLat(lat1); r <= rowOfLat(lat0 + 1e-9); r++) {
      const cTop = 90 - r * RES, cBot = cTop - RES;
      const fy = Math.max(0, Math.min(cTop, lat1) - Math.max(cBot, lat0)) / RES;
      if (fy <= 0) continue;
      for (let c = colOfLon(lon0); c <= colOfLon(lon1 - 1e-9); c++) {
        const cL = -180 + c * RES;
        const fx = Math.max(0, Math.min(cL + RES, lon1) - Math.max(cL, lon0)) / RES;
        if (fx > 0) w[cellOf(r, c)] = fx * fy;
      }
    }
    return w;
  }
  for (const reg of area.parts) {
    const [x0, y0, x1, y1] = reg.bbox;
    const r0 = rowOfLat(y1), r1 = rowOfLat(y0), c0 = colOfLon(x0), c1 = colOfLon(x1);
    const n = (r1 - r0 + 1) * (c1 - c0 + 1);
    const S = n <= 900 ? 4 : 1;
    let any = false;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const top = 90 - r * RES, left = -180 + c * RES;
      let hit = 0;
      for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
        if (inPolys(reg.polys, left + ((j + 0.5) / S) * RES, top - ((i + 0.5) / S) * RES)) hit++;
      }
      if (hit) { const k = cellOf(r, c); w[k] = Math.min(1, w[k] + hit / (S * S)); any = true; }
    }
    if (!any) { // tiny region (e.g. a city): give it the cell it sits in, by its share of that cell
      const k = cellOf(rowOfLat((y0 + y1) / 2), colOfLon((x0 + x1) / 2));
      w[k] = Math.min(1, w[k] + Math.max(0.02, ((x1 - x0) * (y1 - y0)) / (RES * RES)));
    }
  }
  return w;
}

/** Monthly totals for the area: unified (VIIRS-eq.), raw MODIS, raw VIIRS. */
export function areaSeries(hist, w) {
  const nM = hist.nM, H = new Float64Array(nM), M = new Float64Array(nM), V = new Float64Array(nM);
  const { offsets, cells, harm, modis, viirs } = hist;
  for (let m = 0; m < nM; m++) {
    let h = 0, mo = 0, vi = 0;
    for (let i = offsets[m], e = offsets[m + 1]; i < e; i++) {
      const ww = w[cells[i]];
      if (ww) { h += ww * harm[i]; mo += ww * modis[i]; vi += ww * viirs[i]; }
    }
    H[m] = h; M[m] = mo; V[m] = vi;
  }
  return { H, M, V };
}

export function areaKm2(w) {
  let s = 0;
  for (let k = 0; k < w.length; k++) if (w[k]) {
    const lat = 90 - (Math.floor(k / COLS05) + 0.5) * RES;
    s += w[k] * 55.6 * 55.6 * Math.cos((lat * Math.PI) / 180);
  }
  return s;
}

// ---------------------------------------------------------------- statistics
const median = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

/** Theil–Sen slope + Mann–Kendall test (two-sided, normal approximation, no tie correction). */
function trend(vals) {
  const n = vals.length, sl = [];
  let S = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { sl.push((vals[j] - vals[i]) / (j - i)); S += Math.sign(vals[j] - vals[i]); }
  const varS = (n * (n - 1) * (2 * n + 5)) / 18;
  const z = S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0;
  const p = 2 * (1 - normCdf(Math.abs(z)));
  return { slope: median(sl), z, p };
}
function normCdf(x) { // Abramowitz–Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * x / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return 0.5 * (1 + y);
}

/**
 * The calendar: year × month grid, the "normal" for each calendar month, anomalies,
 * critical period, trend and season timing.
 */
export function analyse(months, years, S) {
  const idx = new Map(months.map((m, i) => [m, i]));
  const grid = years.map((y) => MON.map((_, mo) => { const i = idx.get(y * 100 + mo + 1); return i == null ? null : { i, h: S.H[i], m: S.M[i], v: S.V[i] }; }));
  // normal per calendar month: median + robust spread (MAD) in log space, all years with data
  const norm = MON.map((_, mo) => {
    const vals = grid.map((r) => r[mo]).filter(Boolean).map((c) => c.h);
    const lv = vals.map(Math.log1p), med = median(lv);
    const mad = median(lv.map((v) => Math.abs(v - med))) * 1.4826;
    const mean = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
    const burned = vals.filter((v) => v >= 1).length;
    return { med: Math.expm1(med), lmed: med, spread: Math.max(0.35, mad), mean, burned, n: vals.length };
  });
  const annualNormal = norm.reduce((s, n) => s + n.mean, 0);
  for (const row of grid) row.forEach((c, mo) => {
    if (!c) return;
    const N = norm[mo];
    c.z = (Math.log1p(c.h) - N.lmed) / N.spread;
    c.x = N.mean > 0 ? c.h / N.mean : null;
    // flags: a lot more fire than normal for that month, or a normally-burning month that stayed quiet
    c.flag = c.z >= 2 && c.h >= Math.max(10, 0.02 * annualNormal) ? "high" : c.z <= -2 && N.mean >= Math.max(20, 0.04 * annualNormal) ? "low" : null;
  });

  // critical period: fewest months that hold 80% of a normal year's burning, shown as runs
  const order = MON.map((_, i) => i).sort((a, b) => norm[b].mean - norm[a].mean);
  const crit = new Set();
  let acc = 0;
  for (const mo of order) { if (acc >= 0.8 * annualNormal || norm[mo].mean <= 0) break; crit.add(mo); acc += norm[mo].mean; }
  // a single quiet month between two critical ones belongs to the same season
  if (crit.size >= 2 && crit.size < 11) for (let mo = 0; mo < 12; mo++) {
    if (!crit.has(mo) && crit.has((mo + 11) % 12) && crit.has((mo + 1) % 12)) crit.add(mo);
  }
  const peak = order[0];
  const runs = monthRuns(crit);

  // annual totals (complete years only) + trend
  const full = years.map((y, yi) => ({ y, row: grid[yi] })).filter((r) => r.row.every(Boolean));
  const annual = full.map((r) => ({ y: r.y, h: r.row.reduce((s, c) => s + c.h, 0) }));
  const tr = annual.length >= 8 ? trend(annual.map((a) => a.h)) : null;
  const annMed = median(annual.map((a) => a.h)) || 1;

  // season timing: circular centroid of the monthly cycle, first vs second half of the record
  const half = Math.floor(full.length / 2);
  const centroid = (rows) => {
    let sx = 0, sy = 0;
    for (const r of rows) r.row.forEach((c, mo) => { const a = (2 * Math.PI * (mo + 0.5)) / 12; sx += c.h * Math.cos(a); sy += c.h * Math.sin(a); });
    if (!sx && !sy) return null;
    let a = Math.atan2(sy, sx); if (a < 0) a += 2 * Math.PI;
    return (a / (2 * Math.PI)) * 12; // month position 0..12
  };
  const cA = centroid(full.slice(0, half)), cB = centroid(full.slice(half));
  let shiftDays = null;
  if (cA != null && cB != null) { let d = cB - cA; if (d > 6) d -= 12; if (d < -6) d += 12; shiftDays = Math.round(d * 30.4); }

  const flagged = grid.flat().filter((c) => c && c.flag).sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  const max = Math.max(1, ...grid.flat().filter(Boolean).map((c) => c.h));
  return {
    firstYear: years[0], grid, norm, annualNormal, crit, runs, peak, annual, trend: tr, annMed, flagged, max,
    timing: { first: full.length ? `${full[0].y}–${full[half - 1]?.y}` : "", second: full.length ? `${full[half]?.y}–${full.at(-1).y}` : "", shiftDays },
    total: grid.flat().filter(Boolean).reduce((s, c) => s + c.h, 0),
  };
}

function monthRuns(set) {
  if (!set.size) return [];
  if (set.size === 12) return [[0, 11]];
  let start = 0;
  while (set.has(start)) start = (start + 1) % 12; // begin scanning at a month outside the set
  const runs = [];
  let cur = null;
  for (let k = 1; k <= 12; k++) {
    const mo = (start + k) % 12;
    if (set.has(mo)) { if (!cur) cur = [mo, mo]; else cur[1] = mo; }
    else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs;
}
export const runLabel = ([a, b]) => (a === b ? MON[a] : `${MON[a]}–${MON[b]}`);

// ---------------------------------------------------------------- colour
const lerp = (a, b, t) => a + (b - a) * t;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function ramp(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const k = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
  const f = t * (stops.length - 1) - k, a = hex(stops[k]), b = hex(stops[k + 1]);
  return `rgb(${Math.round(lerp(a[0], b[0], f))},${Math.round(lerp(a[1], b[1], f))},${Math.round(lerp(a[2], b[2], f))})`;
}
export const HEAT = ["#2a1a14", "#6b2a12", "#b8431a", "#ec7a22", "#ffc35c", "#fff1c4"];
export const DIV = ["#2f6fd0", "#5d8fd8", "#2a2e37", "#e0703a", "#ff4d3d"];
export function cellColor(c, max, mode) {
  if (!c) return "transparent";
  if (mode === "anomaly") {
    if (c.h < 1 && c.z > -1) return "#1a1d24";
    return ramp(DIV, (Math.max(-3, Math.min(3, c.z)) + 3) / 6);
  }
  if (c.h < 1) return "#15181e";
  return ramp(HEAT, 0.08 + 0.92 * Math.sqrt(c.h / max)); // sqrt keeps both quiet and peak months readable
}

// ---------------------------------------------------------------- CSV
export function toCSV(area, A) {
  const lines = [
    `# Ember Atlas fire calendar: ${area.name} (${area.sub})`,
    "# unified = VIIRS-equivalent vegetation-fire detections (MODIS calibrated to VIIRS before 2012); normal = median of that calendar month over all years",
    "year,month,unified_viirs_eq,modis_raw,viirs_raw,normal_median,times_normal_mean,anomaly_z,flag,critical_month",
  ];
  A.grid.forEach((row, yi) => row.forEach((c, mo) => {
    if (!c) return;
    const y = Math.floor((A.firstYear ?? 0) + yi);
    lines.push([y, mo + 1, c.h.toFixed(1), c.m.toFixed(1), c.v.toFixed(1), A.norm[mo].med.toFixed(1), c.x == null ? "" : c.x.toFixed(2), c.z.toFixed(2), c.flag || "", A.crit.has(mo) ? 1 : 0].join(","));
  }));
  return lines.join("\n");
}
