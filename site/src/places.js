// "Where did I click?" — offline province / region lookup (no external geocoding service).
// Borders: Natural Earth 1:10m admin-1, simplified (pipeline/provinces.sh), so a click
// within ~1 km of a border may land on the neighbour.
import { feature } from "topojson-client";
import { dataVersion } from "./data.js";

// Uzbek names for the viloyats (Natural Earth mixes spellings).
const UZ = {
  "UZ-AN": "Andijon viloyati", "UZ-BU": "Buxoro viloyati", "UZ-FA": "Farg‘ona viloyati",
  "UZ-JI": "Jizzax viloyati", "UZ-NG": "Namangan viloyati", "UZ-NW": "Navoiy viloyati",
  "UZ-QA": "Qashqadaryo viloyati", "UZ-QR": "Qoraqalpog‘iston Respublikasi", "UZ-SA": "Samarqand viloyati",
  "UZ-SI": "Sirdaryo viloyati", "UZ-SU": "Surxondaryo viloyati", "UZ-TK": "Toshkent shahri",
  "UZ-TO": "Toshkent viloyati", "UZ-XO": "Xorazm viloyati",
};

let regionsP = null;
export function loadRegions() {
  regionsP ??= fetch(`/data/admin1.json${dataVersion()}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((topo) => {
      if (!topo) return null;
      return feature(topo, topo.objects.admin1).features.map((f) => {
        const polys = f.geometry ? (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) : [];
        let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
        for (const p of polys) for (const [x, y] of p[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        const p = f.properties;
        return {
          polys, bbox: [x0, y0, x1, y1],
          name: UZ[p.iso_3166_2] || p.name_en || p.name || "Unnamed region",
          type: p.iso_3166_2 === "UZ-QR" ? "Autonomous Republic" : (p.type_en || "").replace("Automonous", "Autonomous"),
          country: p.admin || "", iso: p.iso_3166_2 || "",
        };
      });
    })
    .catch(() => null);
  return regionsP;
}

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function inPolys(polys, x, y) {
  for (const p of polys) {
    if (!inRing(p[0], x, y)) continue;
    let hole = false;
    for (let k = 1; k < p.length && !hole; k++) hole = inRing(p[k], x, y);
    if (!hole) return true;
  }
  return false;
}
function find(regions, lat, lon) {
  for (const r of regions) {
    const b = r.bbox;
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if (inPolys(r.polys, lon, lat)) return r;
  }
  return null;
}

/** Region at a point: { name, type, country } or null (sea / no data). */
export async function placeAt(lat, lon) {
  const regions = await loadRegions();
  return regions ? find(regions, lat, lon) : null;
}

/**
 * Which regions a grid square covers, by share of its land area (sampled 20x20).
 * Returns [{ name, country, share }] sorted by share, plus the sea share.
 */
export async function regionsInSquare(lat0, lon0, size) {
  const regions = await loadRegions();
  if (!regions) return null;
  const n = 20, count = new Map();
  let sea = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const r = find(regions, lat0 + ((i + 0.5) / n) * size, lon0 + ((j + 0.5) / n) * size);
    if (!r) { sea++; continue; }
    const c = count.get(r) || 0;
    count.set(r, c + 1);
  }
  const total = n * n;
  const list = [...count].map(([r, c]) => ({ name: r.name, country: r.country, share: c / total })).sort((a, b) => b.share - a.share);
  return { list, sea: sea / total };
}
