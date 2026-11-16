// Animated flow layer (wind now, ocean currents later): particles drift with a U/V field and leave fading trails,
// drawn into an equirectangular canvas that the globe drapes over the Earth (globe.setDataCanvas).
// field = { u, v: Int16Array (rows × cols, lat0 → south, lon0 → east), rows, cols, lat0, lon0, res, scale }

const W = 1600, H = 800;
const COLORS = ["rgba(150,190,255,0.85)", "rgba(225,238,255,0.9)", "rgba(255,236,150,0.95)", "rgba(255,170,90,1)"]; // calm → strong
const BREAKS = [4, 9, 15]; // m/s

export function createFlow(globe, field, { count = 6500, speed = 0.32, fade = 0.93 } = {}) {
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const g = canvas.getContext("2d");
  const { u, v, rows, cols, lat0, lon0, res, scale } = field;
  const P = new Float32Array(count * 4); // lon, lat, age, maxAge
  let raf = 0, last = 0, on = false;

  function sample(lat, lon) {
    let x = ((lon - lon0) % 360 + 360) % 360 / res, y = (lat0 - lat) / res;
    if (y < 0 || y > rows - 1) return null;
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = (x0 + 1) % cols, y1 = Math.min(rows - 1, y0 + 1), fx = x - x0, fy = y - y0;
    const at = (a, r, c) => a[r * cols + c];
    const bi = (a) => (at(a, y0, x0) * (1 - fx) + at(a, y0, x1) * fx) * (1 - fy) + (at(a, y1, x0) * (1 - fx) + at(a, y1, x1) * fx) * fy;
    return [bi(u) / scale, bi(v) / scale];
  }
  function spawn(i, young) {
    P[i * 4] = Math.random() * 360 - 180;
    P[i * 4 + 1] = (Math.asin(Math.random() * 2 - 1) * 180) / Math.PI * 0.96; // area-uniform, away from the poles
    P[i * 4 + 3] = 50 + Math.random() * 110;
    P[i * 4 + 2] = young ? 0 : Math.random() * P[i * 4 + 3];
  }
  for (let i = 0; i < count; i++) spawn(i, false);
  const px = (lon) => ((lon + 180) / 360) * W, py = (lat) => ((90 - lat) / 180) * H;

  function step(now) {
    raf = requestAnimationFrame(step);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    if (now - last < 22) return; // ~45 fps is plenty
    last = now;
    // fade old trails (multiply alpha)
    g.globalCompositeOperation = "destination-in";
    g.fillStyle = `rgba(0,0,0,${fade})`; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "source-over";
    g.lineWidth = 1.3; g.lineCap = "round";
    const paths = COLORS.map(() => new Path2D());
    for (let i = 0; i < count; i++) {
      const o = i * 4;
      let lon = P[o], lat = P[o + 1];
      if (++P[o + 2] > P[o + 3]) { spawn(i, true); continue; }
      const w = sample(lat, lon);
      if (!w) { spawn(i, true); continue; }
      const sp = Math.hypot(w[0], w[1]);
      if (sp < 0.3) { P[o + 2] += 3; continue; }
      const k = speed * dt * 60 * 0.05;
      const nlon = lon + (w[0] * k) / Math.max(0.2, Math.cos((lat * Math.PI) / 180)), nlat = lat + w[1] * k;
      const x0 = px(lon), y0 = py(lat);
      let wl = nlon > 180 ? nlon - 360 : nlon < -180 ? nlon + 360 : nlon;
      const x1 = px(wl), y1 = py(nlat);
      if (Math.abs(x1 - x0) < W / 2) {
        const b = sp < BREAKS[0] ? 0 : sp < BREAKS[1] ? 1 : sp < BREAKS[2] ? 2 : 3;
        paths[b].moveTo(x0, y0); paths[b].lineTo(x1, y1);
      }
      P[o] = wl; P[o + 1] = nlat;
      if (Math.abs(nlat) > 86) spawn(i, true);
    }
    paths.forEach((p, b) => { g.strokeStyle = COLORS[b]; g.stroke(p); });
    globe.setDataCanvas(canvas, 1);
  }

  return {
    start() { if (on) return; on = true; last = 0; raf = requestAnimationFrame(step); },
    stop() { on = false; cancelAnimationFrame(raf); g.clearRect(0, 0, W, H); globe.setDataCanvas(null); },
    get running() { return on; },
    speedAt: (lat, lon) => { const w = sample(lat, lon); return w ? { speed: Math.hypot(w[0], w[1]), dir: (Math.atan2(-w[0], -w[1]) * 180 / Math.PI + 360) % 360 } : null; },
  };
}
