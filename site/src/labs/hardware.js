// Lab · Abandoned but not Forgotten (NASA Space Apps 2026: "Storytelling about NASA's Discarded Equipment on the
// Moon and Mars"). For school-age space fans: fly from Earth to the Moon or Mars, meet every NASA lander, rover and
// impact site at its real coordinates, take a narrated tour, check the deep-space travellers, then a quiz.
// Data: site/public/data/labs/hardware/hardware.json (hand-checked against NASA mission pages).
import { travel, resetBody } from "./planets.js";

const DATA = "/data/labs/hardware/hardware.json";
const AU_KM = 149597870.7;
const STATUS = {
  active: { label: "Still working!", ramp: "heat", tw: 1, color: "#ffb347" },
  retired: { label: "Mission complete", ramp: "modis", tw: 0.5, color: "#6ea8f0" },
  silent: { label: "Gone quiet", ramp: "industrial", tw: 0.35, color: "#aab3c2" },
  crashed: { label: "Crashed / impact", ramp: "volcano", tw: 0.5, color: "#c084fc" },
};
const BODY = {
  moon: { name: "the Moon", short: "Moon", icon: "🌕", view: { lat: 5, lon: 10, dist: 2.5 } },
  mars: { name: "Mars", short: "Mars", icon: "🔴", view: { lat: 6, lon: 105, dist: 2.5 } },
};
const KIND = { crewed: "Crewed landing", lander: "Lander", rover: "Rover", impactor: "Impact site", helicopter: "Helicopter" };
const QUIZ = [
  { q: "Which thing left by Apollo astronauts is STILL used by scientists today?", a: ["Mirror boxes that bounce lasers back to Earth", "The Moon buggies", "The flags", "Their boots"], ok: 0,
    why: "Laser retroreflectors from Apollo 11, 14 and 15 still measure the Moon's distance to a few millimetres." },
  { q: "Opportunity was planned to work for 90 days. How long did it really last?", a: ["About 1 year", "About 5 years", "Over 14 years", "Exactly 90 days"], ok: 2,
    why: "Opportunity drove 45 km over 14+ years until a dust storm in 2018." },
  { q: "What was the first aircraft to fly on another planet?", a: ["Sojourner", "Ingenuity", "Phoenix", "Viking 2"], ok: 1,
    why: "Ingenuity flew 72 times on Mars between 2021 and 2024." },
  { q: "Why did Apollo 12 astronauts walk over to Surveyor 3?", a: ["To fix it", "To take photos for fun", "To cut off parts and bring them home to study", "To refuel it"], ok: 2,
    why: "The parts showed scientists how materials change after years on the Moon." },
  { q: "Which spacecraft is the farthest human-made object?", a: ["New Horizons", "Pioneer 10", "Voyager 1", "Curiosity"], ok: 2,
    why: "Voyager 1 is about 170 times farther from the Sun than Earth is, and it still talks to us." },
  { q: "What did the LCROSS impact discover near the Moon's south pole?", a: ["Gold", "Water ice", "An old rover", "Moon bugs"], ok: 1,
    why: "Ice in dark craters could one day give astronauts water, air and rocket fuel." },
  { q: "What did InSight listen to on Mars?", a: ["Martian music", "Wind only", "Marsquakes", "Radio from aliens"], ok: 2,
    why: "InSight recorded over 1,300 marsquakes and measured Mars's core." },
];

let ctx, D, styleEl, capEl;
const S = { body: "earth", sel: null, tour: null, speak: false, quiz: null, deepTimer: null, busy: false, view: "home" };
const $ = (s) => document.querySelector(s);
const esc = (s) => ctx.h.esc(s ?? "");
const yearOf = (d) => +d.slice(0, 4);
const itemsOf = (body) => D.items.filter((x) => x.body === body).sort((a, b) => a.date.localeCompare(b.date));
const fmtDate = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
const yearsSince = (d) => Math.floor((Date.now() - new Date(d + "T00:00:00Z")) / (365.25 * 864e5));

// ---------------------------------------------------------------- style
const CSS = `
.hw-hero { font-size: 13px; color: var(--text-2); line-height: 1.5; margin: 0 0 12px; }
.hw-go { display: grid; gap: 10px; margin: 6px 0 14px; }
.hw-go button { display: flex; align-items: center; gap: 12px; text-align: left; padding: 13px 14px; border-radius: 14px; cursor: pointer; color: var(--text);
  border: 1px solid rgba(255,255,255,.14); background: linear-gradient(120deg, rgba(110,168,240,.16), rgba(192,132,252,.12)); transition: transform .15s, border-color .15s; }
.hw-go button:hover { transform: translateY(-1px); border-color: var(--ember); }
.hw-go button.mars { background: linear-gradient(120deg, rgba(232,88,52,.25), rgba(255,179,71,.12)); }
.hw-go button.deep { background: linear-gradient(120deg, rgba(40,60,120,.35), rgba(120,90,220,.18)); }
.hw-go .ico { font-size: 28px; line-height: 1; }
.hw-go b { display: block; font-size: 15px; }
.hw-go span.s { font-size: 12px; color: var(--text-2); }
.hw-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 4px 0 10px; }
.hw-legend { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 11.5px; color: var(--text-2); margin: 6px 0 10px; }
.hw-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; box-shadow: 0 0 8px currentColor; }
.hw-pill { display: inline-block; font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; }
.hw-card { border-radius: 14px; padding: 14px; margin: 8px 0 12px; border: 1px solid rgba(255,255,255,.12);
  background: radial-gradient(120% 140% at 0% 0%, rgba(240,138,36,.14), transparent 60%), rgba(255,255,255,.03); animation: hwIn .35s ease; }
@keyframes hwIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.hw-card h3 { margin: 6px 0 2px; font-size: 17px; color: var(--text); letter-spacing: 0; text-transform: none; }
.hw-card .meta { font-size: 11.5px; color: var(--text-3); margin-bottom: 8px; }
.hw-card p { font-size: 13px; line-height: 1.55; color: var(--text-2); margin: 6px 0; }
.hw-card .row2 { display: grid; grid-template-columns: 22px 1fr; gap: 6px; align-items: start; font-size: 12.5px; line-height: 1.5; color: var(--text-2); margin-top: 6px; }
.hw-card a { color: var(--ember); font-size: 11.5px; }
.hw-list { display: grid; gap: 4px; margin: 6px 0 12px; }
.hw-list button { display: grid; grid-template-columns: 12px 1fr auto; gap: 8px; align-items: center; text-align: left; padding: 7px 9px; border-radius: 9px;
  border: 1px solid transparent; background: rgba(255,255,255,.03); color: var(--text-2); cursor: pointer; font-size: 12.5px; }
.hw-list button:hover, .hw-list button.on { border-color: rgba(240,138,36,.5); color: var(--text); background: rgba(240,138,36,.08); }
.hw-list i { width: 9px; height: 9px; border-radius: 50%; box-shadow: 0 0 6px currentColor; }
.hw-list small { color: var(--text-3); font-family: var(--mono); font-size: 11px; }
.hw-tl { margin: 4px 0 12px; }
.hw-tl svg { width: 100%; display: block; overflow: visible; }
.hw-tl circle { cursor: pointer; transition: r .15s; }
.hw-tl circle:hover { r: 6; }
.hw-tl text { fill: var(--text-3); font-size: 10px; font-family: var(--mono); }
.hw-caption { position: fixed; left: 50%; bottom: 26px; transform: translateX(-60%); z-index: 11; width: min(620px, calc(100vw - 480px)); min-width: 300px;
  background: rgba(10,12,18,.88); border: 1px solid rgba(240,138,36,.4); border-radius: 16px; padding: 14px 16px 12px; backdrop-filter: blur(12px);
  box-shadow: 0 12px 40px rgba(0,0,0,.45); animation: hwIn .35s ease; }
.hw-caption .k { font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ember); }
.hw-caption b { display: block; font-size: 17px; margin: 2px 0 4px; }
.hw-caption p { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--text-2); }
.hw-caption .ctl { display: flex; gap: 6px; margin-top: 10px; align-items: center; }
.hw-caption .ctl .btn { padding: 5px 10px; }
.hw-caption .prog { flex: 1; height: 3px; background: rgba(255,255,255,.1); border-radius: 2px; overflow: hidden; }
.hw-caption .prog i { display: block; height: 100%; background: var(--ember); transition: width .3s; }
.hw-quiz .q { font-size: 15px; font-weight: 600; margin: 10px 0; line-height: 1.4; }
.hw-quiz .opts { display: grid; gap: 7px; }
.hw-quiz .opts button { text-align: left; padding: 10px 12px; border-radius: 11px; border: 1px solid var(--line-strong); background: rgba(255,255,255,.03); color: var(--text); cursor: pointer; font-size: 13px; }
.hw-quiz .opts button:hover:not([disabled]) { border-color: var(--ember); }
.hw-quiz .opts button.ok { border-color: #34c27a; background: rgba(52,194,122,.15); }
.hw-quiz .opts button.no { border-color: #ff5d5d; background: rgba(255,93,93,.12); }
.hw-quiz .dots { display: flex; gap: 5px; margin-top: 4px; }
.hw-quiz .dots i { width: 22px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.12); }
.hw-quiz .dots i.ok { background: #34c27a; } .hw-quiz .dots i.no { background: #ff5d5d; } .hw-quiz .dots i.cur { background: var(--ember); }
.hw-score { text-align: center; font-size: 42px; margin: 10px 0 2px; }
.hw-deep svg { width: 100%; display: block; margin: 6px 0 10px; }
.hw-deep svg text { font-size: 10.5px; fill: var(--text-2); }
.hw-deep .km { font-family: var(--mono); color: var(--text); }
.hw-deep table td { vertical-align: top; }
`;

// ---------------------------------------------------------------- lifecycle
async function enter(c, params) {
  ctx = c;
  if (!styleEl) { styleEl = document.createElement("style"); styleEl.id = "hw-style"; styleEl.textContent = CSS; document.head.appendChild(styleEl); }
  ctx.panel.innerHTML = `<p class="eyebrow">Labs · Abandoned but not Forgotten</p><h2>Loading…</h2>`;
  if (!D) D = await (await fetch(DATA + ctx.v)).json();
  S.body = ctx.globe.bodyKind || "earth"; S.sel = null; S.view = "home";
  const want = params.get("body"), item = D.items.find((x) => x.id === params.get("item"));
  if (want === "deep") { S.view = "deep"; render(); return; }
  if (item) { await go(item.body); select(item, true); return; }
  if (want === "moon" || want === "mars") { await go(want); return; }
  render();
}

function exit() {
  stopTour(); stopSpeech(); clearInterval(S.deepTimer);
  ["hwA", "hwR", "hwS", "hwC"].forEach((l) => ctx.globe.hideLayer(l));
  ctx.globe.setMarker(null);
  capEl?.remove(); capEl = null;
  resetBody(ctx.globe);
  S.body = "earth";
}

// ---------------------------------------------------------------- travel + markers
async function go(body) {
  if (S.busy) return;
  S.busy = true; stopTour(); clearInterval(S.deepTimer);
  S.sel = null; ctx.globe.setMarker(null);
  ["hwA", "hwR", "hwS", "hwC"].forEach((l) => ctx.globe.hideLayer(l));
  S.view = body === "earth" ? "home" : "body";
  if (body !== "earth") ctx.panel.innerHTML = `<p class="eyebrow">Labs · Abandoned but not Forgotten</p><h2>${BODY[body].icon} Flying to ${BODY[body].name}…</h2><p class="hw-hero">Hold on tight!</p>`;
  const v = body === "earth" ? { lat: 20, lon: 20, dist: 3.2 } : BODY[body].view;
  await travel(ctx.globe, body, v);
  S.body = body; S.busy = false;
  if (body !== "earth") draw();
  ctx.setParams({ body: body === "earth" ? null : body, item: null });
  render();
}

function draw() {
  const groups = { hwA: "active", hwR: "retired", hwS: "silent", hwC: "crashed" };
  const list = itemsOf(S.body);
  for (const [layer, st] of Object.entries(groups)) {
    const its = list.filter((x) => x.status === st);
    if (!its.length) { ctx.globe.hideLayer(layer); continue; }
    ctx.globe.setPoints(layer, {
      lats: Float32Array.from(its, (x) => x.lat), lons: Float32Array.from(its, (x) => x.lon), values: new Float32Array(its.length).fill(0.9),
      ramp: STATUS[st].ramp, size: 0.05, minSize: 0.6, opacity: 1, soft: 0.05, blending: ctx.blend.additive, radius: 1.006, twinkle: STATUS[st].tw,
    });
  }
}

function select(item, fly = true) {
  S.sel = item;
  ctx.globe.setMarker(item.lat, item.lon);
  if (fly) ctx.globe.flyTo(item.lat, item.lon, 1.75);
  ctx.setParams({ body: item.body, item: item.id });
  S.view = "body"; render();
  ctx.panel.querySelector(".hw-card")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// ---------------------------------------------------------------- panel
function statusPill(st) { const s = STATUS[st]; return `<span class="hw-pill" style="background:${s.color}22;color:${s.color};border:1px solid ${s.color}55">${s.label}</span>`; }

function storyCard(x) {
  const yrs = yearsSince(x.date);
  const life = x.status === "active" ? `Working on ${BODY[x.body].name} for <b>${yrs} years</b> and counting` :
    x.end && x.end !== x.date ? `Worked ${fmtDate(x.date)} – ${fmtDate(x.end)}` : `${fmtDate(x.date)}`;
  return `<div class="hw-card">
    ${statusPill(x.status)} <span class="muted small">${KIND[x.kind] || ""}</span>
    <h3>${esc(x.name)}</h3>
    <div class="meta">${life} · on ${BODY[x.body].name} for ${yrs} years · ${Math.abs(x.lat).toFixed(2)}°${x.lat >= 0 ? "N" : "S"}, ${Math.abs(x.lon).toFixed(2)}°${x.lon >= 0 ? "E" : "W"}${x.approx ? " (approx.)" : ""}</div>
    <p>${esc(x.kid)}</p>
    <div class="row2"><span>🔬</span><span><b>The science:</b> ${esc(x.science)}</span></div>
    <div class="row2"><span>⭐</span><span><b>Fun fact:</b> ${esc(x.fact)}</span></div>
    <div class="row-ctl" style="margin-top:10px"><button class="btn" id="hw-say">🔊 Read aloud</button><a href="${esc(x.src)}" target="_blank" rel="noopener">NASA mission page ↗</a></div>
  </div>`;
}

function timelineSvg(items) {
  const W = 400, H = 58, y0 = 1964, y1 = new Date().getFullYear() + 1, X = (y) => 10 + ((y - y0) / (y1 - y0)) * (W - 20);
  const rows = {}; // stack dots of the same year
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Timeline of missions"><line x1="10" x2="${W - 10}" y1="${H - 16}" y2="${H - 16}" stroke="var(--line-strong)"/>`;
  for (let y = 1970; y <= y1; y += 10) s += `<line x1="${X(y)}" x2="${X(y)}" y1="${H - 19}" y2="${H - 13}" stroke="var(--line-strong)"/><text x="${X(y)}" y="${H - 2}" text-anchor="middle">${y}</text>`;
  for (const x of items) {
    const yr = yearOf(x.date) + (+x.date.slice(5, 7) - 1) / 12, k = Math.round(yr * 2);
    rows[k] = (rows[k] || 0) + 1;
    const col = x.body === "moon" ? "#d7dbe4" : "#ff7a4d";
    s += `<circle data-id="${x.id}" cx="${X(yr).toFixed(1)}" cy="${H - 16 - rows[k] * 9}" r="4" fill="${col}" stroke="${STATUS[x.status].color}" stroke-width="1.6"><title>${esc(x.name)} · ${x.date.slice(0, 4)}</title></circle>`;
  }
  return s + `</svg>`;
}

function render() {
  if (S.quiz) return renderQuiz();
  if (S.view === "deep") return renderDeep();
  const top = `<div class="lab-top"><button class="btn" id="lab-back">← Back to Ember Atlas</button><span class="lab-tag" style="color:#7fe0b8">Labs · Easy</span></div>
    <p class="eyebrow">NASA Space Apps · Abandoned but not Forgotten</p>`;
  const moonN = itemsOf("moon").length, marsN = itemsOf("mars").length;
  if (S.body === "earth" || S.view === "home") {
    ctx.panel.innerHTML = `${top}
      <h2>What did NASA leave out there?</h2>
      <p class="hw-hero">Since 1964 NASA has left landers, rovers, a helicopter, Moon buggies and even golf balls on other worlds, and sent five spacecraft out of the Solar System. Pick a world and fly there: every glowing dot is a real piece of hardware at its real landing spot.</p>
      <div class="hw-go">
        <button data-go="moon"><span class="ico">🌕</span><span><b>Fly to the Moon</b><span class="s">${moonN} landers, rovers & impact sites · 6 Apollo landings</span></span></button>
        <button data-go="mars" class="mars"><span class="ico">🔴</span><span><b>Fly to Mars</b><span class="s">${marsN} landers, rovers & a helicopter · 2 still working</span></span></button>
        <button data-go="deep" class="deep"><span class="ico">🛰️</span><span><b>Deep space travellers</b><span class="s">Voyager, Pioneer & New Horizons, leaving the Sun behind</span></span></button>
      </div>
      <h3>Everything on one timeline</h3>
      <div class="hw-tl">${timelineSvg(D.items)}</div>
      <div class="hw-legend"><span><i style="color:#d7dbe4;background:#d7dbe4"></i>Moon</span><span><i style="color:#ff7a4d;background:#ff7a4d"></i>Mars</span><span class="muted">ring colour = status · click a dot</span></div>
      <div class="row-ctl"><button class="btn" id="hw-quiz">🧠 Take the 5-question quiz</button></div>
      <p class="muted small" style="margin-top:12px">Coordinates and dates from NASA mission pages (linked on every card). Moon: selenographic, Mars: planetocentric, both east-positive.</p>`;
    bind(); return;
  }
  const B = BODY[S.body], list = itemsOf(S.body), other = S.body === "moon" ? "mars" : "moon";
  const counts = Object.keys(STATUS).map((k) => [k, list.filter((x) => x.status === k).length]).filter(([, n]) => n);
  ctx.panel.innerHTML = `${top}
    <h2>${B.icon} NASA on ${B.name}</h2>
    <div class="hw-bar">
      <button class="btn" id="hw-tour">${S.tour ? "❚❚ Pause tour" : "▶ Start the tour"}</button>
      <button class="btn" id="hw-speak" aria-pressed="${S.speak}">${S.speak ? "🔊 Narration on" : "🔈 Narration off"}</button>
      <button class="btn" data-go="${other}">${BODY[other].icon} Fly to ${BODY[other].short}</button>
      <button class="btn" data-go="earth">🌍 Earth</button>
    </div>
    <div class="hw-legend">${counts.map(([k, n]) => `<span><i style="color:${STATUS[k].color};background:${STATUS[k].color}"></i>${STATUS[k].label} · ${n}</span>`).join("")}</div>
    ${S.sel ? storyCard(S.sel) : `<div class="callout">Click a glowing dot on ${B.name}, pick one below, or press <b>Start the tour</b>.</div>`}
    <h3>${list.length} things on ${B.name}</h3>
    <div class="hw-list">${list.map((x) => `<button data-id="${x.id}" class="${S.sel?.id === x.id ? "on" : ""}"><i style="color:${STATUS[x.status].color};background:${STATUS[x.status].color}"></i><span>${esc(x.name)}</span><small>${x.date.slice(0, 4)}</small></button>`).join("")}</div>
    <h3>Timeline</h3>
    <div class="hw-tl">${timelineSvg(list)}</div>
    <div class="row-ctl"><button class="btn" id="hw-quiz">🧠 Take the quiz</button><button class="btn" data-go="deep">🛰️ Deep space</button></div>
    <p class="muted small" style="margin-top:12px">Map: ${S.body === "moon" ? "NASA LRO / LROC" : "NASA Viking / MGS"}. Dots sit at published landing coordinates.</p>`;
  bind();
}

function bind() {
  const P = ctx.panel;
  $("#lab-back")?.addEventListener("click", () => ctx.back());
  P.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => {
    const g = b.dataset.go;
    if (g === "deep") { stopTour(); S.view = "deep"; render(); ctx.setParams({ body: "deep", item: null }); }
    else go(g);
  }));
  P.querySelectorAll(".hw-list button[data-id], .hw-tl circle[data-id]").forEach((b) => b.addEventListener("click", async () => {
    const it = D.items.find((x) => x.id === b.dataset.id);
    if (it.body !== S.body) await go(it.body);
    stopTour(); select(it);
  }));
  $("#hw-tour")?.addEventListener("click", () => (S.tour ? stopTour(true) : startTour()));
  $("#hw-speak")?.addEventListener("click", () => { S.speak = !S.speak; if (!S.speak) stopSpeech(); render(); });
  $("#hw-say")?.addEventListener("click", () => S.sel && say(`${S.sel.name}. ${S.sel.kid} The science: ${S.sel.science} Fun fact: ${S.sel.fact}`, true));
  $("#hw-quiz")?.addEventListener("click", () => { stopTour(); startQuiz(); });
}

// ---------------------------------------------------------------- tour
function startTour() {
  const list = itemsOf(S.body);
  S.tour = { list, i: S.sel ? Math.max(0, list.findIndex((x) => x.id === S.sel.id)) : 0, timer: null, paused: false };
  render(); tourStep();
}
function tourStep() {
  const T = S.tour; if (!T) return;
  clearTimeout(T.timer);
  const x = T.list[T.i];
  select(x, true);
  caption(x, T.i, T.list.length);
  if (S.speak) say(`${x.name}. ${x.kid}`);
  if (!T.paused) T.timer = setTimeout(() => tourNext(1), S.speak ? 14000 : 10000);
}
function tourNext(d) {
  const T = S.tour; if (!T) return;
  const n = T.i + d;
  if (n >= T.list.length) { stopTour(); startQuiz(true); return; }
  T.i = Math.max(0, n); tourStep();
}
function stopTour(keepCard) {
  if (!S.tour) return;
  clearTimeout(S.tour.timer); S.tour = null; stopSpeech();
  capEl?.remove(); capEl = null;
  if (keepCard !== false) render();
}
function caption(x, i, n) {
  if (!capEl) { capEl = document.createElement("div"); capEl.className = "hw-caption"; document.body.appendChild(capEl); }
  capEl.innerHTML = `<div class="k">${BODY[x.body].icon} Tour of ${BODY[x.body].name} · ${i + 1} of ${n} · ${x.date.slice(0, 4)}</div>
    <b>${esc(x.name)}</b><p>${esc(x.kid)}</p>
    <div class="ctl"><button class="btn" id="hwc-prev" aria-label="Previous">◀</button><button class="btn" id="hwc-pause">${S.tour.paused ? "▶" : "❚❚"}</button><button class="btn" id="hwc-next" aria-label="Next">▶▶</button>
      <span class="prog"><i style="width:${((i + 1) / n) * 100}%"></i></span><button class="btn" id="hwc-stop" aria-label="Stop tour">✕</button></div>`;
  capEl.querySelector("#hwc-prev").onclick = () => tourNext(-1);
  capEl.querySelector("#hwc-next").onclick = () => tourNext(1);
  capEl.querySelector("#hwc-stop").onclick = () => stopTour(true);
  capEl.querySelector("#hwc-pause").onclick = () => { const T = S.tour; T.paused = !T.paused; clearTimeout(T.timer); if (!T.paused) T.timer = setTimeout(() => tourNext(1), 6000); caption(x, i, n); };
}

// ---------------------------------------------------------------- speech
function say(text, force) {
  if (!("speechSynthesis" in window) || (!S.speak && !force)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.rate = 0.98; u.pitch = 1.05;
  speechSynthesis.speak(u);
}
function stopSpeech() { if ("speechSynthesis" in window) speechSynthesis.cancel(); }

// ---------------------------------------------------------------- deep space
function deepNow(d) {
  if (d.status !== "active" && d.last) { /* silent probes keep coasting at the same speed */ }
  const yrs = (Date.now() - Date.UTC(2025, 0, 1)) / (365.25 * 864e5);
  return d.au2025 + d.auPerYear * yrs;
}
function renderDeep() {
  const top = `<div class="lab-top"><button class="btn" id="lab-back">← Back to Ember Atlas</button><span class="lab-tag" style="color:#7fe0b8">Labs · Easy</span></div>
    <p class="eyebrow">NASA Space Apps · Abandoned but not Forgotten</p>`;
  const deep = [...D.deep].sort((a, b) => deepNow(b) - deepNow(a));
  const maxAu = Math.max(...deep.map(deepNow)), W = 400, H = 170;
  const ang = { voyager1: -30, voyager2: 35, pioneer10: 8, pioneer11: -12, newhorizons: 20 };
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Distance of deep-space probes from the Sun">
    <circle cx="22" cy="${H / 2}" r="9" fill="#ffcf5a"/><circle cx="22" cy="${H / 2}" r="16" fill="#ffcf5a22"/>
    <text x="22" y="${H / 2 + 30}" text-anchor="middle">Sun</text>`;
  const L = (au) => 22 + (au / maxAu) * (W - 120);
  svg += `<circle cx="22" cy="${H / 2}" r="${L(30) - 22}" fill="none" stroke="rgba(255,255,255,.12)" stroke-dasharray="3 4"/><text x="${L(30)}" y="${H / 2 - 4}" text-anchor="middle" style="fill:var(--text-3)">Neptune</text>`;
  for (const d of deep) {
    const a = (ang[d.id] * Math.PI) / 180, r = L(deepNow(d)) - 22, x = 22 + r * Math.cos(a), y = H / 2 + r * Math.sin(a);
    const col = d.status === "active" ? "#ffb347" : "#aab3c2";
    svg += `<line x1="22" y1="${H / 2}" x2="${x}" y2="${y}" stroke="${col}" stroke-opacity=".45" stroke-dasharray="2 3"/><circle cx="${x}" cy="${y}" r="4" fill="${col}"/><text x="${x + 7}" y="${y + 4}">${d.name}</text>`;
  }
  svg += `</svg>`;
  ctx.panel.innerHTML = `${top}
    <h2>🛰️ Leaving the Sun behind</h2>
    <p class="hw-hero">Five NASA spacecraft are flying out of the Solar System forever. Two Voyagers are already in interstellar space and still send messages home.</p>
    <div class="hw-deep">${svg}
    <table class="data">
      <tr><th>Spacecraft</th><th>Distance from the Sun (approx.)</th></tr>
      ${deep.map((d) => `<tr><td><b>${d.name}</b><div class="muted small">launched ${d.launch.slice(0, 4)}</div>${statusPill(d.status === "active" ? "active" : "silent")}</td>
        <td><span class="km" data-km="${d.id}">–</span> km<div class="muted small"><span data-au="${d.id}">–</span> AU · light takes <span data-lt="${d.id}">–</span></div></td></tr>
        <tr><td colspan="2" class="small" style="color:var(--text-2)">${esc(d.kid)} <i>${esc(d.fact)}</i> <a href="${esc(d.src)}" target="_blank" rel="noopener" style="color:var(--ember)">NASA ↗</a></td></tr>`).join("")}
    </table></div>
    <p class="muted small">Distances are estimates: a 2025 position plus a constant speed, ticking live. 1 AU = the Earth–Sun distance, 149.6 million km.</p>
    <div class="hw-bar" style="margin-top:10px"><button class="btn" data-go="moon">🌕 Moon</button><button class="btn" data-go="mars">🔴 Mars</button><button class="btn" id="hw-quiz">🧠 Quiz</button></div>`;
  bind();
  const tick = () => {
    for (const d of D.deep) {
      const au = deepNow(d), km = au * AU_KM, h = (au * 499.005) / 3600;
      const k = ctx.panel.querySelector(`[data-km="${d.id}"]`); if (!k) { clearInterval(S.deepTimer); return; }
      k.textContent = Math.round(km).toLocaleString("en");
      ctx.panel.querySelector(`[data-au="${d.id}"]`).textContent = au.toFixed(4);
      ctx.panel.querySelector(`[data-lt="${d.id}"]`).textContent = `${Math.floor(h)} h ${Math.round((h % 1) * 60)} min`;
    }
  };
  clearInterval(S.deepTimer); tick(); S.deepTimer = setInterval(tick, 1000);
}

// ---------------------------------------------------------------- quiz
function startQuiz(afterTour) {
  const pool = [...QUIZ].sort(() => Math.random() - 0.5).slice(0, 5);
  S.quiz = { pool, i: 0, res: [], afterTour: !!afterTour, answered: false };
  renderQuiz();
}
function renderQuiz() {
  const Q = S.quiz, top = `<div class="lab-top"><button class="btn" id="lab-back">← Back to Ember Atlas</button><span class="lab-tag" style="color:#7fe0b8">Labs · Easy</span></div>`;
  if (Q.i >= Q.pool.length) {
    const ok = Q.res.filter(Boolean).length, msg = ok === 5 ? "Mission control is impressed: perfect score! 🚀" : ok >= 3 ? "Great job, space explorer! 🌟" : "Good try! Fly around and read a few stories, then try again. 🛰️";
    ctx.panel.innerHTML = `${top}<div class="hw-quiz"><p class="eyebrow">Quiz complete</p><div class="hw-score">${"⭐".repeat(ok)}${"☆".repeat(5 - ok)}</div>
      <h2 style="text-align:center">${ok} / 5</h2><p class="hw-hero" style="text-align:center">${msg}</p>
      <div class="hw-bar" style="justify-content:center"><button class="btn" id="hwq-again">Try again</button><button class="btn" id="hwq-done">Back to exploring</button></div></div>`;
    $("#lab-back").onclick = () => ctx.back();
    $("#hwq-again").onclick = () => startQuiz();
    $("#hwq-done").onclick = () => { S.quiz = null; render(); };
    return;
  }
  const q = Q.pool[Q.i];
  ctx.panel.innerHTML = `${top}<div class="hw-quiz">
    <p class="eyebrow">${Q.afterTour ? "Tour finished! " : ""}Quiz · question ${Q.i + 1} of 5</p>
    <div class="dots">${Q.pool.map((_, k) => `<i class="${k < Q.res.length ? (Q.res[k] ? "ok" : "no") : k === Q.i ? "cur" : ""}"></i>`).join("")}</div>
    <div class="q">${esc(q.q)}</div>
    <div class="opts">${q.a.map((a, k) => `<button data-k="${k}">${esc(a)}</button>`).join("")}</div>
    <div id="hwq-why"></div>
    <div class="hw-bar" style="margin-top:10px"><button class="btn" id="hwq-quit">Leave quiz</button></div></div>`;
  $("#lab-back").onclick = () => ctx.back();
  $("#hwq-quit").onclick = () => { S.quiz = null; render(); };
  ctx.panel.querySelectorAll(".opts button").forEach((b) => b.addEventListener("click", () => {
    const k = +b.dataset.k, right = k === q.ok;
    ctx.panel.querySelectorAll(".opts button").forEach((x) => { x.disabled = true; if (+x.dataset.k === q.ok) x.classList.add("ok"); });
    if (!right) b.classList.add("no");
    Q.res.push(right);
    $("#hwq-why").innerHTML = `<div class="callout">${right ? "✅ Correct! " : "❌ Not quite. "}${esc(q.why)}</div>
      <div class="hw-bar" style="margin-top:8px"><button class="btn" id="hwq-next">${Q.i + 1 < Q.pool.length ? "Next question →" : "See my score →"}</button></div>`;
    $("#hwq-next").onclick = () => { Q.i++; renderQuiz(); };
  }));
}

// ---------------------------------------------------------------- globe input
function nearest(ll, maxDeg) {
  if (S.body === "earth") return null;
  const r = Math.PI / 180, la = ll.lat * r, lo = ll.lon * r;
  let best = null, bd = maxDeg * r;
  for (const x of itemsOf(S.body)) {
    const d = Math.acos(Math.min(1, Math.sin(la) * Math.sin(x.lat * r) + Math.cos(la) * Math.cos(x.lat * r) * Math.cos(lo - x.lon * r)));
    if (d < bd) { bd = d; best = x; }
  }
  return best;
}
function onClick(ll) {
  if (S.busy || S.quiz) return;
  const x = nearest(ll, 4);
  if (x) { stopTour(false); select(x, true); }
}
function onHover(ll, e) {
  const x = ll && !S.busy ? nearest(ll, 3) : null;
  if (!x) { ctx.h.hideTip(); document.getElementById("globe").style.cursor = ""; return; }
  document.getElementById("globe").style.cursor = "pointer";
  ctx.h.showTip(`<b>${esc(x.name)}</b><div class="row"><span>${x.date.slice(0, 4)}</span><span style="color:${STATUS[x.status].color}">${STATUS[x.status].label}</span></div><div class="muted small">Click for its story</div>`, e.clientX, e.clientY);
}

export default { id: "hardware", enter, exit, onClick, onHover };
