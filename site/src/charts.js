// Small dependency-free SVG charts: thin marks, recessive grid, hover layer.
const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};

export const fmt = (v) => {
  if (v == null || !isFinite(v)) return "–";
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "k";
  return a < 10 && v % 1 ? v.toFixed(1) : Math.round(v).toString();
};

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const tooltip = () => document.getElementById("tooltip");
export function showTip(html, x, y) {
  const t = tooltip();
  t.innerHTML = html;
  t.classList.remove("hidden");
  const r = t.getBoundingClientRect();
  let left = x + 14, top = y + 14;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
  t.style.left = Math.max(8, left) + "px";
  t.style.top = Math.max(8, top) + "px";
}
export function hideTip() { tooltip().classList.add("hidden"); }

function legend(container, series, kind = "line") {
  if (series.length < 2) return;
  const lg = document.createElement("div");
  lg.className = "legend";
  lg.innerHTML = series.map((s) => `<span><i class="${kind === "bar" ? "sq" : ""}" style="background:${s.color}"></i>${s.name}</span>`).join("");
  container.appendChild(lg);
}

/**
 * Line chart. series: [{name, color, values (nullable), width?}], labels: x labels.
 * opts: {height, xTicks(i)->string|null, marker: index, onPick(i)}
 */
export function lineChart(container, { series, labels, height = 150, xTicks, marker, onPick, yLabel }) {
  container.innerHTML = "";
  container.classList.add("chart");
  legend(container, series);
  const W = container.clientWidth || 340, H = height;
  const m = { l: 34, r: 8, t: 8, b: 20 };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": yLabel || "chart" }, container);
  const n = labels.length;
  const max = niceMax(Math.max(...series.flatMap((s) => s.values.filter((v) => v != null))));
  const x = (i) => m.l + (i / Math.max(1, n - 1)) * (W - m.l - m.r);
  const y = (v) => H - m.b - (v / max) * (H - m.t - m.b);
  const grid = el("g", { class: "grid" }, svg), axis = el("g", { class: "axis" }, svg);
  for (let k = 0; k <= 3; k++) {
    const v = (max * k) / 3;
    el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, grid);
    el("text", { x: m.l - 6, y: y(v) + 3.5, "text-anchor": "end" }, axis).textContent = fmt(v);
  }
  labels.forEach((lab, i) => {
    const t = xTicks ? xTicks(i, lab) : null;
    if (t) el("text", { x: x(i), y: H - 5, "text-anchor": "middle" }, axis).textContent = t;
  });
  if (marker != null) el("line", { x1: x(marker), x2: x(marker), y1: m.t, y2: H - m.b, stroke: "rgba(255,255,255,.22)", "stroke-width": 1 }, svg);
  for (const s of series) {
    let d = "", pen = false;
    s.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += (pen ? "L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1);
      pen = true;
    });
    el("path", { d, fill: "none", stroke: s.color, "stroke-width": s.width || 2, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: s.opacity ?? 1 }, svg);
  }
  // hover layer
  const xh = el("line", { class: "xh", y1: m.t, y2: H - m.b, visibility: "hidden" }, svg);
  const dots = series.map((s) => el("circle", { r: 4, fill: s.color, stroke: "#10131a", "stroke-width": 2, visibility: "hidden" }, svg));
  const hit = el("rect", { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: "transparent", style: "cursor:crosshair" }, svg);
  const idxAt = (evt) => {
    const r = svg.getBoundingClientRect();
    const px = ((evt.clientX - r.left) / r.width) * W;
    return Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / (W - m.l - m.r)) * (n - 1))));
  };
  hit.addEventListener("pointermove", (evt) => {
    const i = idxAt(evt);
    xh.setAttribute("x1", x(i)); xh.setAttribute("x2", x(i)); xh.setAttribute("visibility", "visible");
    series.forEach((s, k) => {
      const v = s.values[i];
      dots[k].setAttribute("visibility", v == null ? "hidden" : "visible");
      if (v != null) { dots[k].setAttribute("cx", x(i)); dots[k].setAttribute("cy", y(v)); }
    });
    showTip(`<b>${labels[i]}</b>` + series.map((s) => `<div class="row"><span><i class="sw" style="background:${s.color}"></i>${s.name}</span><span>${s.values[i] == null ? "–" : fmt(s.values[i])}</span></div>`).join(""), evt.clientX, evt.clientY);
  });
  hit.addEventListener("pointerleave", () => { xh.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); hideTip(); });
  if (onPick) hit.addEventListener("click", (evt) => onPick(idxAt(evt)));
}

/** Simple vertical bars, one series. highlight: Set of indices drawn in accent. */
export function barChart(container, { values, labels, color, height = 110, xTicks, highlight, highlightColor, tipLabel = "Value", fmtV = fmt }) {
  container.innerHTML = "";
  container.classList.add("chart");
  const W = container.clientWidth || 340, H = height;
  const m = { l: 30, r: 4, t: 6, b: 18 };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img" }, container);
  const n = values.length;
  const max = niceMax(Math.max(1e-9, ...values));
  const bw = (W - m.l - m.r) / n;
  const y = (v) => H - m.b - (v / max) * (H - m.t - m.b);
  const grid = el("g", { class: "grid" }, svg), axis = el("g", { class: "axis" }, svg);
  for (let k = 0; k <= 2; k++) {
    const v = (max * k) / 2;
    el("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, grid);
    el("text", { x: m.l - 5, y: y(v) + 3.5, "text-anchor": "end" }, axis).textContent = fmtV(v);
  }
  values.forEach((v, i) => {
    const x0 = m.l + i * bw;
    const h = Math.max(0, H - m.b - y(v));
    const w = Math.max(1, bw - 2);
    const r = Math.min(3, w / 2, h);
    const c = highlight && highlight.has(i) ? highlightColor : color;
    if (h > 0) {
      // rounded top, square base
      const top = H - m.b - h;
      el("path", { d: `M${x0},${H - m.b}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + w - r}Q${x0 + w},${top} ${x0 + w},${top + r}V${H - m.b}Z`, fill: c }, svg);
    }
    const t = xTicks ? xTicks(i, labels[i]) : null;
    if (t) el("text", { x: x0 + w / 2, y: H - 4, "text-anchor": "middle" }, axis).textContent = t;
    const hit = el("rect", { x: x0, y: m.t, width: bw, height: H - m.t - m.b, fill: "transparent" }, svg);
    hit.addEventListener("pointermove", (e) => showTip(`<b>${labels[i]}</b><div class="row"><span>${tipLabel}</span><span>${fmtV(v)}</span></div>`, e.clientX, e.clientY));
    hit.addEventListener("pointerleave", hideTip);
  });
}

/** Timeline sparkline (area) into an existing <svg>. */
export function sparkline(svg, values, color = "rgba(240,138,36,.55)") {
  svg.innerHTML = "";
  const W = 1000, H = 30;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const max = Math.max(...values) || 1;
  const n = values.length;
  let d = `M0,${H}`;
  values.forEach((v, i) => { d += `L${((i / Math.max(1, n - 1)) * W).toFixed(1)},${(H - (v / max) * (H - 3)).toFixed(1)}`; });
  d += `L${W},${H}Z`;
  el("path", { d, fill: color }, svg);
  el("line", { x1: 0, x2: W, y1: H - 0.5, y2: H - 0.5, stroke: "rgba(255,255,255,.12)" }, svg);
}
