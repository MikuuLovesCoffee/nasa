// Lab · Flame in Freefall (NASA Space Apps 2026 challenge "Flame in Freefall: SI-Powered Fire Safety Insights").
// A dashboard over NASA PSI combustion investigations: ranked by relevance to a crew habitat, searchable and
// filterable, with plain summaries, conditions, similar investigations, side-by-side comparison and
// fire-safety insights with citations. The "SI" ran locally (Ollama) in pipeline/labs_flame.py; the site
// only reads site/public/data/labs/flame/flame.json. Globe: Earth from orbit with the ISS circling.

const DATA = "/data/labs/flame/flame.json";
const HAB_LABEL = { spacecraft: "Spacecraft", station: "Space station", moon_base: "Moon base", mars_base: "Mars base", rover: "Pressurized rover" };
const O2 = { any: "Any O₂", low: "Below air (<21%)", air: "Air (~21%)", high: "Enriched (>21%)" };
let ctx, D, byId, raf = 0, styleEl;
const S = { hab: "station", q: "", fuel: "all", grav: "all", o2: "any", view: "list", inv: null, cmp: [null, null] };
const $ = (s) => document.querySelector(s);

// ---------------------------------------------------------------- styles (scoped, fl-)
const CSS = `
.fl-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0 4px}
.fl-stat{border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:rgba(255,255,255,.02)}
.fl-stat b{display:block;font-size:20px;font-family:var(--mono);color:var(--text)}
.fl-stat span{font-size:11px;color:var(--text-3)}
.fl-tabs{display:flex;gap:4px;margin:12px 0 8px;border-bottom:1px solid var(--line)}
.fl-tabs button{background:none;border:0;border-bottom:2px solid transparent;color:var(--text-3);padding:6px 10px;font-size:13px;cursor:pointer}
.fl-tabs button[aria-pressed="true"]{color:var(--text);border-bottom-color:var(--ember)}
.fl-filters{display:grid;gap:6px;margin:6px 0 10px}
.fl-filters input{width:100%;padding:8px 11px;border-radius:9px;border:1px solid var(--line-strong);background:rgba(255,255,255,.05);color:var(--text);font:inherit;font-size:13px}
.fl-filters .chips{margin:0}
.fl-card{border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:0 0 8px;background:rgba(255,255,255,.025);cursor:pointer;transition:border-color .15s,background .15s}
.fl-card:hover{border-color:rgba(240,138,36,.5);background:rgba(240,138,36,.05)}
.fl-card .fl-row{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.fl-card b{font-size:13.5px;line-height:1.35}
.fl-id{font-family:var(--mono);font-size:11px;color:var(--text-3);white-space:nowrap}
.fl-reason{font-size:12px;color:var(--text-2);margin:4px 0 0;line-height:1.45}
.fl-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.fl-tag{font-size:10.5px;padding:2px 7px;border-radius:999px;background:rgba(255,255,255,.06);color:var(--text-2)}
.fl-tag.hot{background:rgba(240,138,36,.16);color:#ffb070}
.fl-dots{display:inline-flex;gap:3px;vertical-align:middle}
.fl-dots i{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.12)}
.fl-dots i.on{background:var(--ember);box-shadow:0 0 6px rgba(240,138,36,.7)}
.fl-si{display:inline-block;font-size:10px;letter-spacing:.06em;text-transform:uppercase;padding:1px 6px;border-radius:4px;background:rgba(140,90,255,.18);color:#c8b4ff;margin-right:6px;vertical-align:1px}
.fl-cond td:first-child{color:var(--text-3);width:34%}
.fl-cond td{font-size:12.5px;vertical-align:top}
.fl-unknown{color:var(--text-3);font-style:italic}
.fl-hab{display:grid;grid-template-columns:110px 54px 1fr;gap:4px 8px;align-items:center;font-size:12px;margin:6px 0}
.fl-hab span:last-child{color:var(--text-2)}
.fl-sim{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--line);font-size:12.5px;cursor:pointer}
.fl-sim:hover b{color:var(--ember)}
.fl-sim em{font-style:normal;font-family:var(--mono);color:var(--text-3);font-size:11px}
.fl-ins{border:1px solid rgba(240,138,36,.25);background:linear-gradient(135deg,rgba(240,138,36,.08),rgba(140,90,255,.06));border-radius:12px;padding:11px 13px;margin:0 0 9px}
.fl-ins h4{margin:0 0 4px;font-size:14px}
.fl-ins p{margin:0;font-size:12.5px;line-height:1.5;color:var(--text-2)}
.fl-cite{font-family:var(--mono);font-size:10.5px;padding:1px 6px;border-radius:5px;border:1px solid var(--line-strong);background:none;color:var(--text-2);cursor:pointer;margin:6px 4px 0 0}
.fl-cite:hover{border-color:var(--ember);color:var(--text)}
.fl-cmp{width:100%;border-collapse:collapse;font-size:12px}
.fl-cmp th,.fl-cmp td{padding:6px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}
.fl-cmp th{color:var(--text-3);font-weight:500;width:22%}
.fl-cmp td.diff{background:rgba(240,138,36,.07)}
.fl-cmp select{width:100%;background:rgba(255,255,255,.05);color:var(--text);border:1px solid var(--line-strong);border-radius:7px;padding:5px;font:inherit;font-size:12px}
.fl-back{background:none;border:0;color:var(--ember);cursor:pointer;padding:0;margin:4px 0 8px;font-size:12.5px}
.fl-pubs li{font-size:12px;margin:3px 0;color:var(--text-2)}
.fl-pubs a, .fl-link{color:#9cc3ff}
.fl-orbitnote{font-size:11px;color:var(--text-3);margin-top:2px}
`;

// ---------------------------------------------------------------- ISS on the globe
const R_ISS = 1 + 420 / 6371, INC = (51.64 * Math.PI) / 180;
function issAt(t) { // t in seconds of (sped-up) mission time; returns lat, lon in degrees
  const period = 46; // one orbit in 46 s on screen (real ISS: ~92 min)
  const u = (2 * Math.PI * t) / period;
  const lat = Math.asin(Math.sin(INC) * Math.sin(u));
  const lon = Math.atan2(Math.cos(INC) * Math.sin(u), Math.cos(u)) - (2 * Math.PI * t) / (period * 16) - 0.35; // ground track drifts west; starts just west of the camera
  return [(lat * 180) / Math.PI, ((((lon * 180) / Math.PI) + 540) % 360) - 180];
}
function startOrbit() {
  const g = ctx.globe, t0 = performance.now();
  // the orbit path as a faint ring of dots
  const n = 180, lats = new Float32Array(n), lons = new Float32Array(n), vals = new Float32Array(n).fill(0.25);
  for (let i = 0; i < n; i++) { const [a, b] = issAt((i / n) * 46); lats[i] = a; lons[i] = b; }
  g.setPoints("flOrbit", { lats, lons, values: vals.fill(0.6), ramp: "flare", size: 0.013, minSize: 1, opacity: 0.75, soft: 0.35, radius: R_ISS, twinkle: 0.6, blending: ctx.blend.additive });
  const T = 26, tl = new Float32Array(T), tn = new Float32Array(T), tv = new Float32Array(T);
  let last = 0;
  const step = (now) => {
    raf = requestAnimationFrame(step);
    if (now - last < 33) return;
    last = now;
    const t = (now - t0) / 1000;
    for (let i = 0; i < T; i++) { const [a, b] = issAt(t - i * 0.12); tl[i] = a; tn[i] = b; tv[i] = 1 - i / T; }
    g.setPoints("flTrail", { lats: tl, lons: tn, values: tv, ramp: "heat", size: 0.026, minSize: 0.2, opacity: 0.95, soft: 0.3, radius: R_ISS, twinkle: 0, blending: ctx.blend.additive });
    g.setPoints("flIss", { lats: tl.subarray(0, 1), lons: tn.subarray(0, 1), values: new Float32Array([1]), ramp: "heat", size: 0.1, minSize: 1, opacity: 1, soft: 0.12, radius: R_ISS, twinkle: 1, blending: ctx.blend.additive });
  };
  raf = requestAnimationFrame(step);
}

// ---------------------------------------------------------------- data helpers
const known = (v) => v && !/^unknown$/i.test(v);
const fmtV = (v) => (known(v) ? ctx.h.esc(v) : `<span class="fl-unknown">not stated</span>`);
const dots = (n) => `<span class="fl-dots" title="${n}/3">${[1, 2, 3].map((k) => `<i class="${k <= n ? "on" : ""}"></i>`).join("")}</span>`;
const yearOf = (s) => (String(s).match(/(19|20)\d\d/) || [""])[0];
function o2Class(i) {
  const r = i.si.o2; if (!r) return null;
  const c = []; if (r[0] < 20) c.push("low"); if (r[0] <= 22 && r[1] >= 20) c.push("air"); if (r[1] > 22) c.push("high");
  return c;
}
function filtered() {
  const q = S.q.trim().toLowerCase();
  return D.investigations.filter((i) => {
    if (S.fuel !== "all" && i.si.fuel_type !== S.fuel) return false;
    if (S.grav !== "all" && !String(i.si.gravity).startsWith(S.grav)) return false;
    if (S.o2 !== "any") { const c = o2Class(i); if (!c || !c.includes(S.o2)) return false; }
    if (q) {
      const hay = [i.id, i.title, i.acronym, i.si.summary, i.si.fuel, i.keywords.join(" "), i.hardware, i.objective].join(" ").toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  }).sort((a, b) => b.si.habitat[S.hab].score - a.si.habitat[S.hab].score || (b.si.themes.length - a.si.themes.length) || a.id.localeCompare(b.id));
}
function url() { ctx.setParams({ hab: S.hab, view: S.view === "list" ? null : S.view, inv: S.inv }); }

// ---------------------------------------------------------------- panel views
function head() {
  const inv = D.investigations, micro = inv.filter((i) => /microgravity|parabolic|partial/i.test(i.si.gravity)).length;
  const yrs = inv.map((i) => +yearOf(i.start)).filter(Boolean);
  return `
    <div class="lab-top"><button class="btn" id="lab-back">← Back to Ember Atlas</button><span class="lab-tag">Labs · Hard</span></div>
    <p class="eyebrow">NASA Space Apps · Flame in Freefall</p>
    <h2>Fire safety, learned from flames in space</h2>
    <p class="lede small">Every combustion investigation in NASA's Physical Sciences Informatics archive, read by a local AI (super intelligence, SI) and ranked for the habitat you pick. Each answer links back to the NASA record and its DOI.</p>
    <div class="fl-stats">
      <div class="fl-stat"><b>${inv.length}</b><span>NASA investigations</span></div>
      <div class="fl-stat"><b>${micro}</b><span>flown in low / partial gravity</span></div>
      <div class="fl-stat"><b>${Math.min(...yrs)}–${Math.max(...yrs)}</b><span>years of research</span></div>
    </div>
    <div class="fl-tabs" role="tablist">
      ${[["list", "Ranked"], ["insights", "Insights"], ["compare", "Compare"]].map(([k, l]) => `<button data-view="${k}" aria-pressed="${S.view === k || (k === "list" && S.view === "detail")}">${l}</button>`).join("")}
    </div>`;
}

function listView() {
  const rows = filtered(), fuels = [...new Set(D.investigations.map((i) => i.si.fuel_type))].filter(known).sort();
  const gravs = [["all", "Any gravity"], ["microgravity", "Microgravity"], ["parabolic", "Parabolic"], ["normal", "Ground lab"], ["modelling", "Modelling"]];
  return `
    <p class="small muted" style="margin:0 0 4px">Most relevant to a…</p>
    <div class="chips">${Object.entries(HAB_LABEL).map(([k, l]) => `<button data-hab="${k}" aria-pressed="${S.hab === k}">${l}</button>`).join("")}</div>
    <div class="fl-filters">
      <input id="fl-q" type="search" placeholder="Search: candle, droplet, PMMA, smoke, FLEX, oxygen…" value="${ctx.h.esc(S.q)}" aria-label="Search investigations">
      <div class="chips">${[["all", "Any fuel"], ...fuels.map((f) => [f, f])].map(([k, l]) => `<button data-fuel="${ctx.h.esc(k)}" aria-pressed="${S.fuel === k}">${ctx.h.esc(l)}</button>`).join("")}</div>
      <div class="chips">${gravs.map(([k, l]) => `<button data-grav="${k}" aria-pressed="${S.grav === k}">${l}</button>`).join("")}</div>
      <div class="chips">${Object.entries(O2).map(([k, l]) => `<button data-o2="${k}" aria-pressed="${S.o2 === k}">${l}</button>`).join("")}</div>
    </div>
    <p class="small muted" style="margin:0 0 6px">${rows.length} of ${D.investigations.length} · sorted by relevance to a ${HAB_LABEL[S.hab].toLowerCase()}</p>
    ${rows.map((i, k) => {
      const h = i.si.habitat[S.hab];
      return `<div class="fl-card" data-inv="${i.id}">
        <div class="fl-row"><b>${k + 1}. ${ctx.h.esc(i.acronym ? `${i.acronym}: ` : "")}${ctx.h.esc(i.title)}</b><span class="fl-id">${i.id}</span></div>
        <div class="fl-row" style="margin-top:4px"><span>${dots(h.score)}</span><span class="fl-id">${ctx.h.esc(i.si.gravity)}</span></div>
        ${h.reason ? `<p class="fl-reason">${ctx.h.esc(h.reason)}</p>` : ""}
        <div class="fl-tags">${i.si.themes.slice(0, 4).map((t) => `<span class="fl-tag">${ctx.h.esc(D.themes[t].split(/[ ,/(]/)[0])}</span>`).join("")}${known(i.si.fuel_type) ? `<span class="fl-tag hot">${ctx.h.esc(i.si.fuel_type)}</span>` : ""}</div>
      </div>`;
    }).join("") || `<p class="muted small">No investigation matches these filters.</p>`}`;
}

function detailView() {
  const i = byId.get(S.inv); if (!i) { S.view = "list"; return listView(); }
  const si = i.si, e = ctx.h.esc;
  const cond = [["Fuel", `${fmtV(si.fuel_type)}${known(si.fuel) ? ` · ${e(si.fuel)}` : ""}`], ["Sample / burner", fmtV(si.geometry)], ["Oxygen", fmtV(si.oxygen)],
    ["Pressure", fmtV(si.pressure)], ["Flow", fmtV(si.flow)], ["Gravity", fmtV(si.gravity)], ["Measurements", si.sensors.length ? e(si.sensors.join(", ")) : fmtV("")],
    ["Platform / hardware", e([i.platform, i.hardware].filter((x) => x && x !== "Not Applicable").join(" · ") || "–")], ["Years", e([yearOf(i.start), yearOf(i.end)].filter(Boolean).join("–") || "–")],
    ["Principal investigator", e(i.pi || "–")]];
  return `
    <button class="fl-back" id="fl-list">← All investigations</button>
    <p class="fl-id" style="margin:0">${i.id}${i.acronym ? ` · ${e(i.acronym)}` : ""} · ${e(i.type)}</p>
    <h3 style="margin:4px 0 8px;font-size:16px;line-height:1.35">${e(i.title)}</h3>
    <p style="font-size:13px;line-height:1.55;margin:0 0 8px"><span class="fl-si">SI summary</span>${e(si.summary)}</p>
    ${known(si.key_finding) ? `<div class="callout"><b>Key finding:</b> ${e(si.key_finding)}</div>` : ""}
    <h3>Test conditions</h3>
    <table class="data fl-cond">${cond.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>
    <h3>Relevance to crew habitats <span class="fl-si">SI</span></h3>
    ${Object.entries(HAB_LABEL).map(([k, l]) => `<div class="fl-hab"><span>${l}</span>${dots(si.habitat[k].score)}<span>${e(si.habitat[k].reason || "")}</span></div>`).join("")}
    <h3>Most similar investigations</h3>
    ${i.similar.map((s) => { const j = byId.get(s.id); return j ? `<div class="fl-sim" data-inv="${j.id}"><b>${e(j.acronym || j.title.slice(0, 60))}</b><em>${j.id} · ${Math.round(s.sim * 100)}%</em></div>` : ""; }).join("")}
    <p class="muted small" style="margin:4px 0 0">Similarity = cosine of local text embeddings (qwen3-embedding).</p>
    ${i.objective ? `<h3>Objective (NASA record)</h3><p class="small" style="color:var(--text-2);line-height:1.5">${e(i.objective)}</p>` : ""}
    ${i.pubs.length ? `<h3>Publications</h3><ul class="fl-pubs">${i.pubs.map((p) => `<li>${p.doi ? `<a href="https://doi.org/${e(p.doi)}" target="_blank" rel="noopener">${e(p.title)}</a>` : e(p.title)}</li>`).join("")}</ul>` : ""}
    <div class="row-ctl" style="margin-top:12px;flex-wrap:wrap">
      <a class="btn" href="${e(i.url)}" target="_blank" rel="noopener">NASA PSI record ↗</a>
      ${i.doi ? `<a class="btn" href="https://doi.org/${e(i.doi)}" target="_blank" rel="noopener">Cite: doi:${e(i.doi)}</a>` : ""}
      <button class="btn" id="fl-tocmp">Compare…</button>
    </div>
    <p class="muted small" style="margin-top:8px">Data licence: ${e(i.license || "see PSI record")}. "Not stated" = the NASA record does not give this value; the SI was told not to guess.</p>`;
}

function insightsView() {
  return `<p class="small muted" style="margin:0 0 8px">Each insight was written by the local SI from the investigations tagged with that theme, and may only cite those. Click a citation to open it.</p>
    ${D.insights.map((x) => `<div class="fl-ins"><h4>${ctx.h.esc(x.headline || x.label)}</h4><p>${ctx.h.esc(x.insight)}</p>
      <div><span class="fl-tag">${ctx.h.esc(x.label)} · ${x.n} investigations</span></div>
      <div>${(x.cites || []).map((c) => `<button class="fl-cite" data-inv="${c}">${c}${byId.get(c)?.acronym ? ` ${ctx.h.esc(byId.get(c).acronym)}` : ""}</button>`).join("")}</div></div>`).join("")}`;
}

function compareView() {
  const all = [...D.investigations].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  if (!S.cmp[0]) S.cmp[0] = filtered()[0]?.id || all[0].id;
  if (!S.cmp[1]) S.cmp[1] = byId.get(S.cmp[0])?.similar[0]?.id || all[1].id;
  const [a, b] = S.cmp.map((id) => byId.get(id)), e = ctx.h.esc;
  const sel = (k) => `<select data-cmp="${k}">${all.map((i) => `<option value="${i.id}" ${S.cmp[k] === i.id ? "selected" : ""}>${i.id} · ${e(i.acronym || i.title.slice(0, 40))}</option>`).join("")}</select>`;
  const rows = [["Fuel", (i) => [i.si.fuel_type, i.si.fuel].filter(known).join(" · ")], ["Sample", (i) => i.si.geometry], ["Oxygen", (i) => i.si.oxygen], ["Pressure", (i) => i.si.pressure],
    ["Flow", (i) => i.si.flow], ["Gravity", (i) => i.si.gravity], ["Measurements", (i) => i.si.sensors.join(", ")], ["Themes", (i) => i.si.themes.map((t) => D.themes[t].split(/[ ,/(]/)[0]).join(", ")],
    ["Key finding", (i) => i.si.key_finding], ...Object.entries(HAB_LABEL).map(([k, l]) => [l, (i) => `${i.si.habitat[k].score}/3`])];
  const shared = a.si.themes.filter((t) => b.si.themes.includes(t)).map((t) => D.themes[t]);
  const sim = a.similar.find((s) => s.id === b.id);
  return `<table class="fl-cmp"><tr><th></th><td>${sel(0)}</td><td>${sel(1)}</td></tr>
      <tr><th>Title</th><td>${e(a.title)}</td><td>${e(b.title)}</td></tr>
      ${rows.map(([l, f]) => { const va = f(a) || "unknown", vb = f(b) || "unknown", d = va !== vb; return `<tr><th>${l}</th><td class="${d ? "diff" : ""}">${fmtV(va)}</td><td class="${d ? "diff" : ""}">${fmtV(vb)}</td></tr>`; }).join("")}
    </table>
    <div class="callout">${shared.length ? `<b>Same:</b> both study ${e(shared.join("; "))}. ` : "<b>Same:</b> no shared theme. "}<b>Different:</b> highlighted rows.${sim ? ` Text similarity ${Math.round(sim.sim * 100)}%.` : ""}</div>`;
}

function panel() {
  let body = head();
  body += S.view === "detail" ? detailView() : S.view === "insights" ? insightsView() : S.view === "compare" ? compareView() : listView();
  body += `<p class="muted small" style="margin-top:14px">Source: NASA Physical Sciences Informatics (PSI), Combustion Science, ${D.investigations.length} investigations, read ${D.generated}. SI: ${ctx.h.esc(D.si.extract)} + ${ctx.h.esc(D.si.embed)} via Ollama, run locally (no cloud AI). SI text can be wrong: always check the linked NASA record.</p>`;
  ctx.panel.innerHTML = body;
  bind();
  url();
}

function open(id) { S.inv = id; S.view = "detail"; panel(); ctx.panel.closest(".panel")?.querySelector("#panel-body")?.scrollTo?.(0, 0); ctx.panel.scrollTop = 0; ctx.panel.parentElement && (ctx.panel.parentElement.scrollTop = 0); }

function bind() {
  const P = ctx.panel;
  $("#lab-back").addEventListener("click", () => ctx.back());
  P.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { S.view = b.dataset.view; panel(); }));
  P.querySelectorAll("[data-hab]").forEach((b) => b.addEventListener("click", () => { S.hab = b.dataset.hab; panel(); }));
  P.querySelectorAll("[data-fuel]").forEach((b) => b.addEventListener("click", () => { S.fuel = b.dataset.fuel; panel(); }));
  P.querySelectorAll("[data-grav]").forEach((b) => b.addEventListener("click", () => { S.grav = b.dataset.grav; panel(); }));
  P.querySelectorAll("[data-o2]").forEach((b) => b.addEventListener("click", () => { S.o2 = b.dataset.o2; panel(); }));
  P.querySelectorAll("[data-inv]").forEach((el) => el.addEventListener("click", () => open(el.dataset.inv)));
  P.querySelectorAll("select[data-cmp]").forEach((s) => s.addEventListener("change", () => { S.cmp[+s.dataset.cmp] = s.value; panel(); }));
  $("#fl-list")?.addEventListener("click", () => { S.view = "list"; S.inv = null; panel(); });
  $("#fl-tocmp")?.addEventListener("click", () => { S.cmp = [S.inv, byId.get(S.inv).similar[0]?.id || null]; S.view = "compare"; panel(); });
  const q = $("#fl-q");
  if (q) {
    let t;
    q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { S.q = q.value; const pos = q.selectionStart; panel(); const n = $("#fl-q"); n.focus(); n.setSelectionRange(pos, pos); }, 220); });
  }
}

// ---------------------------------------------------------------- lifecycle
async function enter(c, params) {
  ctx = c;
  if (!styleEl) { styleEl = document.createElement("style"); styleEl.dataset.lab = "flame"; styleEl.textContent = CSS; document.head.appendChild(styleEl); }
  ctx.panel.innerHTML = `<p class="eyebrow">Labs · Flame in Freefall</p><h2>Loading NASA combustion research…</h2>`;
  if (!D) {
    D = await (await fetch(DATA + ctx.v)).json();
    byId = new Map(D.investigations.map((i) => [i.id, i]));
  }
  if (params.get("hab") && HAB_LABEL[params.get("hab")]) S.hab = params.get("hab");
  if (params.get("inv") && byId.has(params.get("inv"))) { S.inv = params.get("inv"); S.view = "detail"; }
  else if (["insights", "compare"].includes(params.get("view"))) S.view = params.get("view");
  panel();
  ctx.globe.flyTo(22, 20, 3.4); // pull back to orbit height to see the station circling
  startOrbit();
}
function exit() {
  cancelAnimationFrame(raf);
  ["flOrbit", "flTrail", "flIss"].forEach((l) => ctx.globe.hideLayer(l));
}
function onHover(ll, e) {
  if (!ll) { ctx.h.hideTip(); return; }
  ctx.h.showTip(`<b>International Space Station</b><div class="muted small">Most of these flames burned up here, ~420 km above Earth, 51.6° orbit. (Shown sped up: one orbit ≈ 46 s; real ≈ 92 min.)</div>`, e.clientX, e.clientY);
}

export default { id: "flame", enter, exit, onHover };
