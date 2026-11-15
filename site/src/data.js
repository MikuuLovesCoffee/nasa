// Data loading + decoding. All history/forecast files are produced by pipeline/export.py.

export const RES = 0.5; // history grid, degrees
export const COLS05 = 720;

export const cell05ToLatLon = (c) => ({ lat: 90 - (Math.floor(c / COLS05) + 0.5) * RES, lon: -180 + ((c % COLS05) + 0.5) * RES });
export const cell1ToLatLon = (c) => ({ lat: 90 - (Math.floor(c / 360) + 0.5), lon: -180 + (c % 360) + 0.5 });
export const latLonToCell1 = (lat, lon) => Math.min(179, Math.floor(90 - lat)) * 360 + Math.min(359, Math.floor(lon + 180));
export const latLonToCell05 = (lat, lon) => Math.min(359, Math.floor((90 - lat) / RES)) * COLS05 + Math.min(719, Math.floor((lon + 180) / RES));

export const ymLabel = (ym) => new Date(Math.floor(ym / 100), (ym % 100) - 1, 1).toLocaleString("en", { month: "short", year: "numeric" });

// meta.json is always revalidated; every other data file is versioned from it
let V = "";
export const dataVersion = () => V;
export async function loadMeta() {
  const meta = await (await fetch("/data/meta.json", { cache: "no-cache" })).json();
  V = meta.version ? `?v=${meta.version}` : "";
  return meta;
}

/**
 * history.bin layout (little endian):
 *   u32 nMonths | u32 offsets[nMonths+1] | u32 cellDelta[N] | u16 harm[N] | u16 modis[N] | u16 viirs[N]
 * cells are sorted within each month and delta-encoded (first entry of a month is absolute).
 */
export async function loadHistory(onProgress, totalBytes) {
  const res = await fetch(`/data/history.bin${V}`);
  let buf;
  if (res.body && onProgress) {
    // stream so the loader can show progress (gzip hides the true length; meta.json carries it)
    const total = totalBytes || 50e6;
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(Math.min(0.99, got / total));
    }
    const out = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    buf = out.buffer;
  } else buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  const nM = dv.getUint32(0, true);
  const offsets = new Uint32Array(buf, 4, nM + 1);
  const N = offsets[nM];
  let p = 4 + (nM + 1) * 4;
  const cells = new Uint32Array(buf, p, N).slice(); p += N * 4;
  for (let m = 0; m < nM; m++) for (let i = offsets[m] + 1; i < offsets[m + 1]; i++) cells[i] += cells[i - 1];
  const harm = new Uint16Array(buf, p, N); p += N * 2;
  const modis = new Uint16Array(buf, p, N); p += N * 2;
  const viirs = new Uint16Array(buf, p, N);
  return { nM, offsets, cells, harm, modis, viirs };
}

/** Sum a range of months into Map(cell -> [harm, modis, viirs]). */
export function aggregate(h, m0, m1) {
  const out = new Map();
  for (let m = m0; m <= m1; m++) {
    for (let i = h.offsets[m]; i < h.offsets[m + 1]; i++) {
      const c = h.cells[i];
      let a = out.get(c);
      if (!a) out.set(c, (a = [0, 0, 0]));
      a[0] += h.harm[i]; a[1] += h.modis[i]; a[2] += h.viirs[i];
    }
  }
  return out;
}

const tileCache = new Map();
export async function loadCell(cell1) {
  const key = `${Math.floor(cell1 / 360 / 10)}_${Math.floor((cell1 % 360) / 10)}`;
  if (!tileCache.has(key)) {
    tileCache.set(key, fetch(`/data/tiles/${key}.json${V}`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}))); // ocean / no-fire tiles don't exist
  }
  const tile = await tileCache.get(key);
  return tile[cell1] || null;
}

export async function loadForecast() {
  try {
    const r = await fetch(`/data/forecast.json${V}`);
    return r.ok ? await r.json() : null;
  } catch {
    return null; // not published yet (SPA fallback returns HTML)
  }
}

// ---------- live (FIRMS near-real-time, proxied at /firms/ to avoid CORS) ----------
export const LIVE_SOURCES = [
  { id: "VIIRS_NOAA21", name: "VIIRS · NOAA-21", sensor: "VIIRS", path: "noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_" },
  { id: "VIIRS_NOAA20", name: "VIIRS · NOAA-20", sensor: "VIIRS", path: "noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_" },
  // Suomi NPP: FIRMS stopped delivering its data on 2 Nov 2026 (NASA notice), so it is no longer fetched.
  { id: "MODIS", name: "MODIS · Terra/Aqua", sensor: "MODIS", path: "modis-c6.1/csv/MODIS_C6_1_Global_" },
];

function parseCSV(text, src) {
  const lines = text.split("\n");
  const head = lines[0].split(",");
  const iLat = head.indexOf("latitude"), iLon = head.indexOf("longitude"), iFrp = head.indexOf("frp");
  const iDate = head.indexOf("acq_date"), iTime = head.indexOf("acq_time"), iConf = head.indexOf("confidence");
  const iSat = head.indexOf("satellite"), iDN = head.indexOf("daynight");
  const out = [];
  for (let k = 1; k < lines.length; k++) {
    const f = lines[k].split(",");
    if (f.length < head.length) continue;
    const conf = f[iConf];
    if (conf === "l" || conf === "low" || (+conf >= 0 && +conf < 30 && conf !== "")) continue; // drop low confidence, same rule as history
    out.push({
      lat: +f[iLat], lon: +f[iLon], frp: +f[iFrp] || 0, t: `${f[iDate]} ${f[iTime].padStart(4, "0").replace(/(\d\d)(\d\d)/, "$1:$2")} UTC`, src,
      sat: iSat >= 0 ? f[iSat] : "", dn: iDN >= 0 ? (f[iDN] || "").trim() : "",
    });
  }
  return out;
}

/**
 * static_mask.bin (pipeline/static_mask.py): sorted u32 ids of ~1 km cells with known
 * non-fire heat; static_mask_kind.bin: one u8 per id (1 volcano, 2 gas flare, 3 industrial).
 * FIRMS NRT has no `type` column, so live detections are tagged against this.
 * Missing file -> nothing is tagged.
 */
const MASK_GRID = 0.01, MASK_COLS = 36000;
export const MASK_KINDS = { 1: "volcano", 2: "gas flare", 3: "industrial" };
let maskPromise = null;
const binOrNull = (url) => fetch(url)
  .then((r) => (r.ok && !(r.headers.get("content-type") || "").includes("html") ? r.arrayBuffer() : null))
  .catch(() => null);
function loadStaticMask() {
  maskPromise ??= Promise.all([binOrNull(`/data/static_mask.bin${V}`), binOrNull(`/data/static_mask_kind.bin${V}`)])
    .then(([ids, kinds]) => {
      if (!ids) return null;
      const k = kinds && kinds.byteLength * 4 === ids.byteLength ? new Uint8Array(kinds) : null;
      return { ids: new Uint32Array(ids), kinds: k };
    });
  return maskPromise;
}
function maskIndex(ids, c) {
  let lo = 0, hi = ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ids[mid] === c) return mid;
    if (ids[mid] < c) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}
// also checks the 8 neighbours: NRT geolocation jitters by a pixel or so.
// Returns the kind (1-3), 0 if not masked; volcano > gas flare > industrial on ties.
function maskKind(mask, lat, lon) {
  const r = Math.floor((90 - lat) / MASK_GRID), c = Math.floor((lon + 180) / MASK_GRID);
  let best = 0;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const i = maskIndex(mask.ids, (r + dr) * MASK_COLS + ((c + dc + MASK_COLS) % MASK_COLS));
    if (i < 0) continue;
    const k = mask.kinds ? mask.kinds[i] : 3;
    if (!best || k < best) best = k;
    if (best === 1) return 1;
  }
  return best;
}

export async function loadLive(range = "24h") {
  const maskP = loadStaticMask();
  const res = await Promise.all(
    LIVE_SOURCES.map(async (s) => {
      try {
        const r = await fetch(`/firms/${s.path}${range}.csv`);
        if (!r.ok) throw new Error(r.status);
        return parseCSV(await r.text(), s.id);
      } catch (e) {
        console.warn("live source failed", s.id, e);
        return null;
      }
    })
  );
  const bySource = {};
  LIVE_SOURCES.forEach((s, i) => (bySource[s.id] = res[i]));
  const all = res.filter(Boolean).flat();
  const mask = await maskP;
  const hiddenByKind = { 1: 0, 2: 0, 3: 0 };
  if (mask) for (const d of all) { d.kind = maskKind(mask, d.lat, d.lon); d.industrial = d.kind > 0; }
  const fires = all.filter((d) => !d.industrial);
  const industrial = unify(all.filter((d) => d.industrial), 0.04, true);
  for (const f of industrial) hiddenByKind[f.kind]++;
  return {
    bySource, all, unified: unify(all), hasMask: !!mask,
    // "fires only" view: industrial heat removed
    fires, firesUnified: unify(fires), industrial, hiddenByKind,
  };
}

/**
 * Merge detections of the same fire seen by several satellites:
 * snap to a ~0.04 deg (~4 km) grid; each unique cell = one fire location.
 */
export function unify(all, res = 0.04, keepKind = false) {
  const m = new Map();
  for (const d of all) {
    const k = Math.round(d.lat / res) * 100000 + Math.round(d.lon / res);
    let f = m.get(k);
    if (!f) m.set(k, (f = { lat: 0, lon: 0, n: 0, frp: 0, srcs: new Set(), t: d.t }));
    f.lat += d.lat; f.lon += d.lon; f.n++; f.frp = Math.max(f.frp, d.frp); f.srcs.add(d.src);
    if (keepKind && d.kind && (!f.kind || d.kind < f.kind)) f.kind = d.kind;
    if (d.t > f.t) f.t = d.t;
  }
  return [...m.values()].map((f) => ({ ...f, lat: f.lat / f.n, lon: f.lon / f.n }));
}
