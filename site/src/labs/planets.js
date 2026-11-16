// Shared by the Moon / Mars labs: travel from Earth to another body and back.
// The globe swaps the Earth sphere for the Moon or Mars at the same place and size (globe.setBody), so
// picking, setPoints, setOutline, setMarker and flyTo all work there too.
import { vec3ToLatLon } from "../globe.js";

export const BODIES = {
  earth: { name: "Earth" },
  moon: { name: "the Moon", url: "/textures/moon.jpg", tint: [1, 1, 1], rim: [0.32, 0.34, 0.4], credit: "NASA LRO / LROC (SVS CGI Moon Kit)" },
  mars: { name: "Mars", url: "/textures/mars.jpg", tint: [1.05, 0.97, 0.92], rim: [0.85, 0.42, 0.25], credit: "NASA Viking / MGS (NASA 3D Resources)" },
};

let veil;
function fade(on, ms = 260) {
  if (!veil) {
    veil = document.createElement("div");
    veil.dataset.labVeil = "1";
    Object.assign(veil.style, { position: "fixed", inset: "0", background: "#000", opacity: "0", pointerEvents: "none", zIndex: "8", transition: `opacity ${ms}ms ease` });
    document.body.appendChild(veil);
  }
  veil.style.transition = `opacity ${ms}ms ease`;
  veil.style.opacity = on ? "1" : "0";
  return new Promise((r) => setTimeout(r, ms));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fly from the current body to `kind` ('earth' | 'moon' | 'mars'), arriving above lat/lon at distance dist.
 * Resolves when the camera has arrived.
 */
export async function travel(globe, kind, { lat = 0, lon = 0, dist = 2.4 } = {}) {
  const cur = globe.bodyKind || "earth";
  if (cur === kind) { globe.flyTo(lat, lon, dist); await wait(1400); return; }
  const here = vec3ToLatLon(globe.camera.position.clone().normalize());
  globe.flyTo(here.lat, here.lon, 5.8);           // pull back until the planet is small
  await wait(1250);
  await fade(true);
  const b = BODIES[kind];
  globe.setBody(kind === "earth" ? null : kind, b.url, b);
  globe.camera.position.setLength(5.8);
  await wait(60);
  await fade(false, 420);
  globe.flyTo(lat, lon, dist);                    // and dive in
  await wait(1400);
}

/** Back to Earth immediately (used when a lab closes). */
export function resetBody(globe) {
  if (globe.bodyKind) globe.setBody(null);
  if (veil) veil.style.opacity = "0";
}
