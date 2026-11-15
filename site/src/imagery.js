// Real satellite pictures of a place — loaded by the visitor's browser straight from
// NASA GIBS, EUMETSAT View and Microsoft Planetary Computer (plain <img> URLs, no keys,
// nothing proxied through our server). Endpoints checked 2026-11-14.

const GIBS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";
const EUM = "https://view.eumetsat.int/geoserver/ows";
const PC_STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const PC_DATA = "https://planetarycomputer.microsoft.com/api/data/v1/item/bbox";

const pad = (n) => String(n).padStart(2, "0");
export const isoDay = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const isoMin = (d) => `${isoDay(d)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00Z`;
export const fmtUTC = (d) => `${isoDay(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;

/** Box around a point, `half` degrees each way (longitude widened so the ground is roughly square). */
export function boxAround(lat, lon, half) {
  const k = Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
  return { s: lat - half, n: lat + half, w: lon - half / k, e: lon + half / k };
}
function pxSize(b, w = 480) {
  const k = Math.max(Math.cos((((b.s + b.n) / 2) * Math.PI) / 180), 0.2);
  const ratio = ((b.e - b.w) * k) / (b.n - b.s);
  return { W: w, H: Math.round(w / ratio) };
}

/** NASA GIBS WMS image (EPSG:4326, WMS 1.3.0 → BBOX is lat,lon order). */
export function gibsUrl(layers, b, time, w = 480) {
  const { W, H } = pxSize(b, w);
  return `${GIBS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${layers.join(",")}&CRS=EPSG:4326` +
    `&BBOX=${b.s.toFixed(4)},${b.w.toFixed(4)},${b.n.toFixed(4)},${b.e.toFixed(4)}&WIDTH=${W}&HEIGHT=${H}&FORMAT=image/jpeg&TIME=${time}`;
}
/** EUMETSAT View WMS image (Meteosat). */
export function eumUrl(layers, b, time, w = 480) {
  const { W, H } = pxSize(b, w);
  return `${EUM}?service=WMS&version=1.3.0&request=GetMap&layers=${layers.join(",")}&styles=&crs=EPSG:4326` +
    `&bbox=${b.s.toFixed(4)},${b.w.toFixed(4)},${b.n.toFixed(4)},${b.e.toFixed(4)}&width=${W}&height=${H}&format=image/png&time=${time}`;
}

// ---------------------------------------------------------------- 1. the pass that saw the fire
const PASS = {
  VIIRS_NOAA20: { name: "NOAA-20 (VIIRS)", tc: "VIIRS_NOAA20_CorrectedReflectance_TrueColor", fire: "VIIRS_NOAA20_Thermal_Anomalies_375m_All", night: "VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance" },
  VIIRS_NOAA21: { name: "NOAA-21 (VIIRS)", tc: "VIIRS_NOAA21_CorrectedReflectance_TrueColor", fire: "VIIRS_NOAA21_Thermal_Anomalies_375m_All", night: "VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance" },
  VIIRS_SNPP: { name: "Suomi NPP (VIIRS)", tc: "VIIRS_SNPP_CorrectedReflectance_TrueColor", fire: "VIIRS_SNPP_Thermal_Anomalies_375m_All", night: "VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance" },
  MODIS_T: { name: "Terra (MODIS)", tc: "MODIS_Terra_CorrectedReflectance_TrueColor", fire: "MODIS_Terra_Thermal_Anomalies_All", night: "VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance" },
  MODIS_A: { name: "Aqua (MODIS)", tc: "MODIS_Aqua_CorrectedReflectance_TrueColor", fire: "MODIS_Aqua_Thermal_Anomalies_All", night: "VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance" },
};
/** Picture from the same satellite and UTC day as a live detection {lat, lon, src, sat, dn, t, frp}. */
export function passImage(det, half = 0.25) {
  const key = det.src === "MODIS" ? (det.sat === "A" ? "MODIS_A" : "MODIS_T") : det.src;
  const p = PASS[key] || PASS.VIIRS_NOAA20;
  const day = det.t.slice(0, 10);
  const b = boxAround(det.lat, det.lon, half);
  const night = det.dn === "N";
  return {
    url: gibsUrl(night ? [p.night, p.fire] : [p.tc, p.fire], b, day, 520),
    caption: night
      ? `Night pass: city lights and fire glow (NOAA-20 Day/Night Band) with ${p.name} fire pixels, ${day}. Source: NASA GIBS.`
      : `${p.name} true colour with its fire pixels (red), ${day}. Source: NASA GIBS.`,
    sat: p.name,
  };
}

// ---------------------------------------------------------------- 2. weather-satellite loop
/** Which geostationary satellite sees this longitude, and how to ask it for one frame. */
export function geoFor(lat, lon, when = new Date()) {
  const localHour = (when.getUTCHours() + lon / 15 + 24) % 24;
  const night = localHour < 6.5 || localHour > 17.5;
  if (lon >= -180 && lon < -105) return { name: "GOES-West", step: 10, lag: 40, kind: "gibs", layers: ["GOES-West_ABI_GeoColor"], night };
  if (lon >= -105 && lon < -30) return { name: "GOES-East", step: 10, lag: 40, kind: "gibs", layers: ["GOES-East_ABI_GeoColor"], night };
  if (lon >= -30 && lon < 40) return { name: "Meteosat (0°)", step: 15, lag: 45, kind: "eum", layers: [night ? "msg_fes:ir108" : "msg_fes:rgb_naturalenhncd", "msg_fes:fire"], night };
  if (lon >= 40 && lon < 100) return { name: "Meteosat IODC (45.5°E)", step: 15, lag: 45, kind: "eum", layers: [night ? "msg_iodc:ir108" : "msg_iodc:rgb_naturalenhncd", "msg_iodc:fire"], night };
  return { name: "Himawari-9", step: 10, lag: 40, kind: "gibs", layers: [night ? "Himawari_AHI_Band13_Clean_Infrared" : "Himawari_AHI_Band3_Red_Visible_1km"], night };
}
/** Frames for the last ~2-3 hours, newest last. */
export function geoFrames(lat, lon, n = 12, half = 2) {
  const g = geoFor(lat, lon);
  const b = boxAround(lat, lon, half);
  const ms = g.step * 60000;
  const t0 = Math.floor((Date.now() - g.lag * 60000) / ms) * ms;
  const frames = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(t0 - i * ms);
    frames.push({ time: d, url: g.kind === "gibs" ? gibsUrl(g.layers, b, isoMin(d), 440) : eumUrl(g.layers, b, isoMin(d), 440) });
  }
  return { sat: g, frames };
}

// ---------------------------------------------------------------- 3. daily strip
export function dailyStrip(sq, days = 7) {
  const b = { s: sq.lat0, n: sq.lat0 + sq.size, w: sq.lon0, e: sq.lon0 + sq.size };
  const out = [];
  const today = new Date();
  for (let i = days; i >= 1; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    out.push({ day: isoDay(d), url: gibsUrl(["VIIRS_NOAA20_CorrectedReflectance_TrueColor", "VIIRS_NOAA20_Thermal_Anomalies_375m_All"], b, isoDay(d), 520) });
  }
  return out;
}

// ---------------------------------------------------------------- 4. Sentinel-2 "fire view"
/**
 * Least-cloudy Sentinel-2 L2A scene covering the point between two dates (Planetary Computer STAC,
 * anonymous, CORS-enabled). Returns { id, date, cloud } or null.
 */
export async function s2Scene(lat, lon, from, to, maxCloud = 40) {
  const body = {
    collections: ["sentinel-2-l2a"],
    intersects: { type: "Point", coordinates: [lon, lat] },
    datetime: `${isoDay(from)}T00:00:00Z/${isoDay(to)}T23:59:59Z`,
    query: { "eo:cloud_cover": { lt: maxCloud } },
    sortby: [{ field: "properties.eo:cloud_cover", direction: "asc" }],
    limit: 5,
  };
  try {
    const r = await fetch(PC_STAC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) return null;
    const f = (await r.json()).features || [];
    if (!f.length) return null;
    const best = f[0];
    return { id: best.id, date: best.properties.datetime.slice(0, 10), cloud: Math.round(best.properties["eo:cloud_cover"]) };
  } catch {
    return null;
  }
}
/** Rendered image of a scene: "fire" = SWIR B12/B8A/B4 (flames bright orange, burn scars dark), "true" = B4/B3/B2. */
export function s2Url(id, lat, lon, half = 0.07, mode = "fire", px = 512) {
  const b = boxAround(lat, lon, half);
  const assets = mode === "fire" ? ["B12", "B8A", "B04"] : ["B04", "B03", "B02"];
  const rescale = mode === "fire" ? "0,4500" : "0,2500";
  return `${PC_DATA}/${b.w.toFixed(4)},${b.s.toFixed(4)},${b.e.toFixed(4)},${b.n.toFixed(4)}/${px}x${px}.png` +
    `?collection=sentinel-2-l2a&item=${encodeURIComponent(id)}&${assets.map((a) => `assets=${a}`).join("&")}&rescale=${rescale}&nodata=0`;
}

// ---------------------------------------------------------------- 5. smoke over the whole globe
export const SMOKE_LAYERS = {
  smoke: { layer: "OMPS_NOAA20_NadirMapper_AerosolIndex_380", name: "Smoke & dust (OMPS aerosol index, NOAA-20)" },
  co: { layer: "AIRS_L2_Carbon_Monoxide_500hPa_Volume_Mixing_Ratio_Day", name: "Carbon monoxide from fires (AIRS)" },
};
export function smokeGlobeUrl(kind = "smoke", day) {
  const L = SMOKE_LAYERS[kind];
  return `${GIBS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${L.layer}&CRS=EPSG:4326&BBOX=-90,-180,90,180` +
    `&WIDTH=2048&HEIGHT=1024&FORMAT=image/png&TRANSPARENT=TRUE&TIME=${day}`;
}

// ---------------------------------------------------------------- links out
export function worldviewLink(lat, lon, day, half = 0.6) {
  const b = boxAround(lat, lon, half);
  return `https://worldview.earthdata.nasa.gov/?v=${b.w.toFixed(3)},${b.s.toFixed(3)},${b.e.toFixed(3)},${b.n.toFixed(3)}` +
    `&t=${day}&l=VIIRS_NOAA20_Thermal_Anomalies_375m_All,VIIRS_NOAA21_Thermal_Anomalies_375m_All,VIIRS_NOAA20_CorrectedReflectance_TrueColor,Coastlines_15m`;
}
export function copernicusLink(lat, lon) {
  return `https://browser.dataspace.copernicus.eu/?zoom=12&lat=${lat.toFixed(4)}&lng=${lon.toFixed(4)}`;
}
