// SI-assisted: written with Anthropic Claude (Claude Code) under the team's direction; reviewed and validated by the team (see README, 'Use of AI').
import * as C from "./core.js";

const $ = (s) => document.querySelector(s);
const COLORS = ["#ff7a59", "#a78bfa", "#2dd4bf", "#f472b6"];
const MAX_SITES = 4, DAY = 86400e3, HOUR = 3600e3, SCAN_DAYS = 365;
const SUN = "251,191,36", EARTH = "96,165,250", BOTH = "52,211,153";

const S = {
  sites: [], byId: new Map(), selected: [], active: null,
  landing: Date.UTC(2026, 11, 1), missionDays: 14, mastM: 0, scanStart: null, arrayW: 400, loadW: 150, playing: false,
  pin: null, hover: null, eph: null, dem: null, customN: 0, layer: "hillshade",
};
const hzCache = new Map();
let results = new Map(), scans = new Map(), map, markers = new Map();

// ---------- formatting ----------
const iso = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
const isoInput = (t) => new Date(t).toISOString().slice(0, 16);
function dur(h) {
  if (h < 0) return "—";
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  const H = Math.round(h);
  return `${Math.floor(H / 24)} d ${H % 24} h`;
}
const pct = (v) => `${v.toFixed(0)}%`;
const colorOf = (id) => COLORS[S.selected.indexOf(id)] ?? "#666";

// ---------- loading ----------
async function fetchBin(url, expected, onProgress, gzip = false) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const reader = (gzip ? r.body.pipeThrough(new DecompressionStream("gzip")) : r.body).getReader(), chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length; onProgress?.(got / expected);
  }
  const buf = new Uint8Array(got);
  let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
  return buf.buffer;
}
const getJSON = (u) => fetch(u).then((r) => r.json());

async function init() {
  initLook();
  const [sites, ephMeta, demMeta, validation] = await Promise.all([
    getJSON("data/sites.json"), getJSON("data/ephem.json"), getJSON("data/dem.json"), getJSON("data/validation.json").catch(() => null),
  ]);
  const prog = (a, b) => (p) => { $("#loadBar").style.width = `${(a + (b - a) * Math.min(p, 1)) * 100}%`; };
  $("#loadTxt").textContent = "JPL DE421 ephemeris (Sun & Earth, 2024–2042)";
  S.eph = C.ephemFrom(await fetchBin("data/ephem.bin", ephMeta.rows * 24, prog(0, 0.15)), ephMeta);
  $("#loadTxt").textContent = "LRO LOLA topography, 80°S–90°S at 240 m";
  if (!("DecompressionStream" in window)) throw new Error("this browser is too old (no DecompressionStream). Please use a current Chrome, Edge, Firefox or Safari.");
  const demBytes = new Uint8Array(await fetchBin("data/" + demMeta.file, demMeta.n * demMeta.n * 2, prog(0.15, 1), true));
  S.dem = { data: C.decodeDem(demBytes, demMeta.n), n: demMeta.n, off: demMeta.off, scale: demMeta.scale_km };
  S.psr = new Uint8Array(await fetchBin("data/psr.u8", demMeta.n * demMeta.n, null, true)); // PGDA permanently shadowed regions, same grid
  S.sites = sites; sites.forEach((s) => S.byId.set(s.id, s));
  readHash();
  if (!S.selected.length) S.selected = ["Site01", "Site23", "Site20", "Haworth"];
  S.active ??= S.selected[0];
  S.scanStart ??= S.landing;
  buildAbout(validation, ephMeta, demMeta);
  initMap(); bindControls();
  $("#loading").remove();
  entrance();
  update(true);
}

// ---------- state <-> URL ----------
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("t")) { const t = Date.parse(h.get("t") + ":00Z"); if (!Number.isNaN(t)) S.landing = t; }
  if (h.get("d")) S.missionDays = Math.min(60, Math.max(1, +h.get("d") || 14));
  if (h.get("m")) S.mastM = Math.min(20, Math.max(0, +h.get("m") || 0));
  if (h.get("pow")) { const [a, l] = h.get("pow").split(":").map(Number); if (a >= 0) S.arrayW = a; if (l >= 0) S.loadW = l; }
  if (h.get("s")) S.selected = h.get("s").split(",").map((tok) => {
    if (!tok.includes(":")) return S.byId.has(tok) ? tok : null;
    const [lat, lon] = tok.split(":").map(Number);
    return Number.isFinite(lat) && Number.isFinite(lon) ? addCustom(lat, lon, false) : null;
  }).filter(Boolean).slice(0, MAX_SITES);
}
function writeHash() {
  const s = S.selected.map((id) => { const x = S.byId.get(id); return x.custom ? `${x.lat.toFixed(4)}:${x.lon.toFixed(4)}` : id; });
  history.replaceState(null, "", `#t=${isoInput(S.landing)}&d=${S.missionDays}&m=${S.mastM}&pow=${S.arrayW}:${S.loadW}&s=${s.join(",")}`);
}

// ---------- sites ----------
function inDem(lat, lon) {
  const [x, y] = C.latlonToXY(lat, lon);
  return !Number.isNaN(C.heightKm(S.dem, x, y));
}
function addCustom(lat, lon, select = true) {
  const id = `C${++S.customN}`;
  const site = { id, custom: true, name: `Custom ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, group: "Custom points", lat, lon,
    source: "User-selected point" };
  S.sites.push(site); S.byId.set(id, site);
  if (select) {
    if (S.selected.length >= MAX_SITES) S.selected.pop();
    S.selected.push(id); S.active = id;
  }
  return id;
}
function toggleSite(id) {
  const i = S.selected.indexOf(id);
  if (i >= 0) { if (S.selected.length > 1) S.selected.splice(i, 1); if (S.active === id) S.active = S.selected[0]; }
  else { if (S.selected.length >= MAX_SITES) S.selected.pop(); S.selected.push(id); S.active = id; }
  update(true);
}
function hzFor(site) {
  const k = `${site.id}|${S.mastM}`;
  if (!hzCache.has(k)) hzCache.set(k, C.computeHorizon(inDem(site.lat, site.lon) ? S.dem : null, site.lat, site.lon, { obsHeightM: S.mastM }));
  return hzCache.get(k);
}

function renderSiteList() {
  const el = $("#siteList"); el.innerHTML = "";
  let group = null;
  for (const s of S.sites) {
    if (s.group !== group) { group = s.group; el.insertAdjacentHTML("beforeend", `<div class="group">${group}</div>`); }
    const sel = S.selected.includes(s.id);
    const row = document.createElement("div");
    row.className = "site" + (s.id === S.active ? " active" : "");
    row.title = `${s.lat.toFixed(3)}°, ${s.lon.toFixed(3)}°\n${s.source}`;
    row.innerHTML = `<input type="checkbox" ${sel ? "checked" : ""}><span class="dot" style="background:${sel ? colorOf(s.id) : "transparent"}"></span>
      <span class="nm">${s.name}</span><span class="tag">${inDem(s.lat, s.lon) ? "" : "no DEM"}</span>${s.custom ? '<button class="rm" title="Remove">×</button>' : ""}`;
    row.querySelector("input").addEventListener("click", (e) => { e.stopPropagation(); toggleSite(s.id); });
    row.querySelector(".rm")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (S.selected.length === 1 && S.selected[0] === s.id) return; // keep at least one site
      S.sites = S.sites.filter((x) => x !== s); S.byId.delete(s.id);
      if (S.selected.includes(s.id)) toggleSite(s.id); else update(false);
      markers.get(s.id)?.remove(); markers.delete(s.id);
    });
    row.addEventListener("click", () => { if (sel) { S.active = s.id; update(false); } else toggleSite(s.id); });
    el.appendChild(row);
  }
  $("#selCount").textContent = `${S.selected.length}/${MAX_SITES}`;
}

// ---------- compute ----------
function update(rescan) {
  const end = C.ephemEnd(S.eph) - (SCAN_DAYS + 61) * DAY;
  S.landing = Math.min(Math.max(S.landing, S.eph.t0), end);
  S.scanStart = Math.min(Math.max(S.scanStart, S.eph.t0), end);
  results = new Map();
  for (const id of S.selected) {
    const site = S.byId.get(id), hz = hzFor(site);
    const ser = C.series(S.eph, hz, S.landing, S.landing + S.missionDays * DAY, 10);
    results.set(id, { site, hz, ser, sum: C.summarize(ser) });
  }
  if (rescan) {
    scans = new Map();
    for (const id of S.selected) scans.set(id, C.scanLandingDates(S.eph, results.get(id).hz, S.scanStart, SCAN_DAYS, S.missionDays, 30, 6));
  }
  $("#landing").value = isoInput(S.landing);
  $("#missionDays").value = S.missionDays;
  $("#mast").value = S.mastM; $("#mastOut").textContent = `${S.mastM} m`;
  $("#arrayW").value = S.arrayW; $("#loadW").value = S.loadW;
  renderSiteList(); renderMetrics(); renderKpis(); drawSky(); drawTimeline(); drawScan(); refreshMarkers(); drawShadows(); refresh3D(); writeHash();
  // fly the map to a newly activated site so its live-shadow window is readable (not on first load: keep the overview)
  const act = S.byId.get(S.active);
  if (S.lastActive !== undefined && S.lastActive !== S.active && act && inDem(act.lat, act.lon)) map.flyTo(S.toLL(act.lat, act.lon), Math.max(map.getZoom(), 0.5), { duration: 0.6 });
  S.lastActive = S.active;
}

// ---------- look & feel: starfield, KPI strip, motion (GSAP when present; respects reduced motion) ----------
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function drawStars() {
  const cv = $("#stars"); if (!cv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = innerWidth, h = innerHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext("2d"); g.scale(dpr, dpr);
  let seed = 42; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < Math.round((w * h) / 2600); i++) {
    const x = rnd() * w, y = rnd() * h, m = rnd() ** 3, r = 0.3 + m * 1.3;
    g.fillStyle = `rgba(${215 + m * 40},${225 + m * 30},255,${0.25 + m * 0.75})`;
    g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fill();
  }
}
const RING_C = 2 * Math.PI * 18;
function kpiTile(key, value, unit, sub, ring, color) {
  const r = ring == null ? "" : `<svg viewBox="0 0 44 44" aria-hidden="true"><circle class="ring-bg" cx="22" cy="22" r="18"/><circle class="ring" cx="22" cy="22" r="18" stroke="${color}" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}" data-ring="${ring}"/></svg>`;
  const shown = Number.isFinite(value) ? value : null;
  return `<div class="kpi" style="--glow:${color}33"><div class="k">${key}</div><div class="row"><div class="v" ${shown == null ? "" : `data-to="${shown}" data-dec="${unit === "°" || unit === " km" ? 1 : 0}"`}>${shown == null ? "—" : "0"}<small>${shown == null ? "" : unit}</small></div>${r}</div><div class="s">${sub}</div></div>`;
}
function renderKpis() {
  const r = results.get(S.active); if (!r) return;
  const s = r.sum, terr = r.hz.terrain;
  $("#kpiSite").textContent = r.site.name; $("#kpiSite").style.color = colorOf(S.active); $("#kpiDot").style.background = colorOf(S.active); $("#kpiDot").style.color = colorOf(S.active);
  $("#kpiRange").textContent = `${S.missionDays}-day surface mission from ${iso(S.landing)} UTC`;
  const slope = terr ? C.slopeDeg(S.dem, r.site.lat, r.site.lon) : NaN;
  const psr = terr ? C.nearestMaskKm(S.psr, S.dem, r.site.lat, r.site.lon) : NaN;
  const night = s.longestDarkH;
  $("#kpis").innerHTML = [
    kpiTile("Sunlit", s.sunPct, "%", "Sun centre above terrain", s.sunPct, "#fbbf24"),
    kpiTile("Earth in view", s.earthPct, "%", "direct-to-Earth link", s.earthPct, "#60a5fa"),
    kpiTile("Sun + Earth", s.bothPct, "%", "power and comms together", s.bothPct, "#34d399"),
    kpiTile("Longest night", night < 48 ? night : night / 24, night < 48 ? " h" : " d", s.longestDarkCut ? "continues past the mission" : "battery must bridge this", null, "#a78bfa"),
    kpiTile("Regional slope", slope, "°", "480 m baseline (LOLA)", null, "#ff7a59"),
    kpiTile("Nearest PSR", psr === Infinity ? NaN : psr, " km", psr === Infinity ? "none within 60 km" : "water-ice target", null, "#46c8ff"),
  ].join("");
  animateKpis();
}
function animateKpis() {
  const els = [...document.querySelectorAll("#kpis [data-to]")], rings = [...document.querySelectorAll("#kpis .ring")];
  const setRing = (el, f) => (el.style.strokeDashoffset = String(RING_C * (1 - f)));
  const fmt = (el, v) => { el.firstChild.textContent = (+v).toFixed(+el.dataset.dec); };
  if (!window.gsap || reduceMotion()) { els.forEach((el) => fmt(el, el.dataset.to)); rings.forEach((el) => setRing(el, el.dataset.ring / 100)); return; }
  els.forEach((el) => {
    const o = { v: 0 }, tw = gsap.to(o, { v: +el.dataset.to, duration: 1.1, ease: "power3.out", onUpdate: () => fmt(el, o.v) });
    // the true value always wins: stop the tween, then write the exact number (throttled frames can't overwrite it)
    setTimeout(() => { tw.kill(); fmt(el, el.dataset.to); }, 1300);
  });
  requestAnimationFrame(() => rings.forEach((el) => setRing(el, el.dataset.ring / 100)));
}
function entrance() {
  if (!window.gsap || reduceMotion()) return;
  gsap.from(["header", "#sidebar", ".card"], { y: 18, opacity: 0, duration: 0.7, ease: "power3.out", stagger: 0.06, clearProps: "transform,opacity" });
  // safety net: if frames are throttled (background tab), never leave panels invisible
  setTimeout(() => { gsap.killTweensOf(["header", "#sidebar", ".card"]); gsap.set(["header", "#sidebar", ".card"], { clearProps: "transform,opacity" }); }, 1600);
}
function initLook() {
  drawStars(); addEventListener("resize", () => drawStars());
  try { if (localStorage.getItem("solid") === "1") document.body.classList.add("solid"); } catch {}
  $("#solidBtn").addEventListener("click", () => {
    const on = document.body.classList.toggle("solid");
    try { localStorage.setItem("solid", on ? "1" : "0"); } catch {}
  });
}

// ---------- metrics table ----------
function renderMetrics() {
  const cols = S.selected.map((id) => results.get(id));
  const rows = [
    ["Sunlit", "Sun centre above local terrain", (r) => r.sum.sunPct, pct, "max"],
    ["Earth in view", "direct-to-Earth comms possible", (r) => r.sum.earthPct, pct, "max"],
    ["Sun + Earth", "power and comms together", (r) => r.sum.bothPct, pct, "max"],
    ["Longest darkness", "battery / survival need", (r) => r.sum.longestDarkH, (v, r) => atLeast(r.sum.longestDarkCut, dur(v)), "min"],
    ["Longest Earth blackout", "relay needed for this long", (r) => r.sum.longestEarthGapH, (v, r) => atLeast(r.sum.longestEarthGapCut, dur(v)), "min"],
    ["Sun up, Earth down", "power but no direct link to Earth", (r) => r.sum.sunUpEarthDownH, dur, "min"],
    ["Longest total blackout", "no Sun and no Earth at once", (r) => r.sum.longestBlackoutH, (v, r) => atLeast(r.sum.longestBlackoutCut, dur(v)), "min"],
    ["Sun-hours", "full-disc equivalent", (r) => r.sum.sunHours, (v) => `${v.toFixed(0)} h`, "max"],
    ["Solar energy", `${S.arrayW} W tracking array, incl. partly visible Sun`, (r) => (S.arrayW * r.sum.sunHours) / 1000, (v) => `${v.toFixed(1)} kWh`, "max"],
    ["Energy balance", `minus ${S.loadW} W load`, (r) => (S.arrayW * r.sum.sunHours - S.loadW * r.sum.hours) / 1000, (v) => `<span class="${v < 0 ? "warn" : ""}">${v >= 0 ? "+" : ""}${v.toFixed(1)} kWh</span>`, "max"],
    ["Battery for longest darkness", `${S.loadW} W while under half the Sun's disc is visible`, (r) => (S.loadW * r.sum.longestDarkH) / 1000, (v, r) => atLeast(r.sum.longestDarkCut, `${v.toFixed(1)} kWh`), "min"],
    ["At landing: Sun", "time until it changes", (r) => r.sum.sunChangeH, (v, r) => sunText(r), null],
    ["At landing: Earth", "time until it changes", (r) => r.sum.earthChangeH, (v, r) => earthText(r), null],
    ["Mean Sun elevation", "while sunlit", (r) => r.sum.meanSunElLit, (v) => (Number.isFinite(v) ? `${v.toFixed(1)}°` : "—"), null],
    ["Regional slope", "over 480 m (LOLA 240 m grid); slopes at lander scale can be steeper", (r) => terrainOr(r, () => C.slopeDeg(S.dem, r.site.lat, r.site.lon), 99), (v) => (v === 99 ? "—" : `${v.toFixed(1)}°`), null],
    ["Nearest permanent shadow", "water-ice science target (PGDA PSR map)", (r) => terrainOr(r, () => C.nearestMaskKm(S.psr, S.dem, r.site.lat, r.site.lon), 999), (v) => (v === 999 ? "—" : v === Infinity ? "&gt; 60 km" : `${v.toFixed(1)} km`), "min"],
    ["Terrain model", "", () => 0, (v, r) => terrainText(r), null],
  ];
  let html = `<table><tr><th></th>${cols.map((r) => `<th style="color:${colorOf(r.site.id)}">${r.site.name}</th>`).join("")}</tr>`;
  for (const [name, sub, get, fmt, best] of rows) {
    const vals = cols.map(get);
    const b = best === "max" ? Math.max(...vals) : best === "min" ? Math.min(...vals) : null;
    html += `<tr><td>${name}${sub ? `<small>${sub}</small>` : ""}</td>${cols.map((r, i) =>
      `<td class="${b !== null && cols.length > 1 && vals[i] === b ? "best" : ""}">${fmt(vals[i], r)}</td>`).join("")}</tr>`;
  }
  $("#metrics").innerHTML = html + "</table>";
}
const terrainOr = (r, f, none) => (r.hz.terrain ? f() : none);
const atLeast = (cut, txt) => (cut ? `&ge; ${txt}<small>continues past the mission window</small>` : txt);
function sunText(r) {
  const s = r.sum;
  if (s.startsLit) return s.sunChangeH < 0 ? "Lit all mission" : `Lit · sets in ${dur(s.sunChangeH)}`;
  return s.sunChangeH < 0 ? `<span class="warn">Dark all mission</span>` : `<span class="warn">Dark</span> · rises in ${dur(s.sunChangeH)}`;
}
function earthText(r) {
  const s = r.sum;
  if (s.startsInView) return s.earthChangeH < 0 ? "In view all mission" : `In view · sets in ${dur(s.earthChangeH)}`;
  return s.earthChangeH < 0 ? `<span class="warn">Hidden all mission</span>` : `<span class="warn">Hidden</span> · rises in ${dur(s.earthChangeH)}`;
}
function terrainText(r) {
  if (!r.hz.terrain) return `<span class="warn">none — smooth sphere</span>`;
  const edge = r.hz.edgeKm < 60 ? `<small class="warn">DEM ends ${r.hz.edgeKm.toFixed(0)} km away</small>` : "";
  return `LOLA 240 m${edge}`;
}

// ---------- canvas helpers ----------
function setupCanvas(cv) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  g.font = "11px system-ui, sans-serif"; g.textBaseline = "middle";
  return [g, w, h];
}
function niceStep(range, target) {
  for (const s of [0.25, 0.5, 1, 2, 5, 10, 15, 30]) if (range / s <= target) return s;
  return 30;
}

// ---------- sky view ----------
function drawSky() {
  const r = results.get(S.active); if (!r) return;
  const [g, W, H] = setupCanvas($("#sky"));
  const t = S.hover ?? S.pin ?? S.landing, st = C.stateAt(S.eph, r.hz, t);
  $("#skySite").textContent = r.site.name; $("#skySite").style.color = colorOf(r.site.id);
  $("#skyTime").textContent = `${iso(t)} UTC${S.hover ? " (hover)" : S.pin ? " (pinned)" : " (landing)"}`;
  const el = r.hz.el, ser = r.ser;
  let top = Math.max(...el), bot = Math.min(...el);
  for (let i = 0; i < ser.n; i++) { if (ser.sunFrac[i] > 0) top = Math.max(top, ser.sunEl[i]); top = Math.max(top, ser.earthEl[i]); }
  const yMax = Math.min(90, Math.max(4, top + 1.5)), yMin = Math.max(-12, Math.min(-1.5, bot - 0.8));
  const L = 38, Rr = 8, T = 8, B = 22, w = W - L - Rr, h = H - T - B;
  const X = (az) => L + (az / 360) * w, Y = (e) => T + ((yMax - e) / (yMax - yMin)) * h;
  const sky = g.createLinearGradient(0, T, 0, T + h); sky.addColorStop(0, "#05070c"); sky.addColorStop(1, "#111827");
  g.fillStyle = sky; g.fillRect(L, T, w, h);
  // grid
  const step = niceStep(yMax - yMin, 8);
  g.strokeStyle = "#ffffff12"; g.fillStyle = "#8b93a7"; g.textAlign = "right";
  for (let e = Math.ceil(yMin / step) * step; e <= yMax; e += step) {
    g.beginPath(); g.moveTo(L, Y(e)); g.lineTo(L + w, Y(e)); g.stroke(); g.fillText(`${+e.toFixed(2)}°`, L - 4, Y(e));
  }
  g.textAlign = "center";
  [["N", 0], ["E", 90], ["S", 180], ["W", 270], ["N", 360]].forEach(([n, a]) => {
    g.beginPath(); g.moveTo(X(a), T); g.lineTo(X(a), T + h); g.stroke(); g.fillText(n, X(a), T + h + 11);
  });
  // paths over the mission
  const dot = (az, e, col, a) => { g.fillStyle = `rgba(${col},${a})`; g.fillRect(X(az) - 1, Y(e) - 1, 2, 2); };
  for (let i = 0; i < ser.n; i += 2) {
    dot(ser.sunAz[i], ser.sunEl[i], SUN, ser.sunFrac[i] >= C.LIT ? 0.9 : 0.25);
    dot(ser.earthAz[i], ser.earthEl[i], EARTH, ser.earthFrac[i] >= C.LIT ? 0.9 : 0.25);
  }
  // bodies at time t (true angular size on the vertical scale), drawn BEFORE terrain so hills occlude them
  const pxDeg = h / (yMax - yMin), labels = [];
  const body = (az, e, rDeg, col, label) => {
    const rad = Math.max(3, rDeg * pxDeg);
    g.save(); g.shadowColor = `rgb(${col})`; g.shadowBlur = 14; g.fillStyle = `rgb(${col})`;
    g.beginPath(); g.arc(X(az), Y(e), rad, 0, 2 * Math.PI); g.fill(); g.restore();
    labels.push([az, e, rad, label]);
  };
  g.save(); g.beginPath(); g.rect(L, T, w, h); g.clip();
  body(st.earthAz, st.earthEl, st.earthR, EARTH, `Earth ${st.earthEl.toFixed(2)}° · ${(st.earthFrac * 100).toFixed(0)}% visible`);
  body(st.sunAz, st.sunEl, C.SUN_RADIUS_DEG, SUN, `Sun ${st.sunEl.toFixed(2)}° · ${(st.sunFrac * 100).toFixed(0)}% of disc`);
  g.restore();
  // terrain silhouette
  g.beginPath(); g.moveTo(L, T + h);
  for (let i = 0; i <= C.N_AZ; i++) g.lineTo(L + (i / C.N_AZ) * w, Y(el[i % C.N_AZ]));
  g.lineTo(L + w, T + h); g.closePath();
  g.fillStyle = "#3a404ee8"; g.fill(); g.strokeStyle = "#9aa3b8"; g.lineWidth = 1; g.stroke();
  g.font = "600 12px system-ui, sans-serif";
  for (const [az, e, rad, label] of labels) {
    const right = az > 300, x = X(az) + (right ? -rad - 6 : rad + 6), y = Math.max(T + 8, Math.min(T + h - 8, Y(e)));
    g.textAlign = right ? "right" : "left"; g.lineWidth = 3; g.strokeStyle = "#05070ccc"; g.strokeText(label, x, y);
    g.fillStyle = "#e6e9f2"; g.fillText(label, x, y);
  }
  g.lineWidth = 1;
}

// ---------- timeline ----------
const TL = { L: 170, R: 10, T: 22, rowH: 11, gap: 3, siteGap: 10 };
function drawTimeline() {
  const cv = $("#timeline"), rowsH = S.selected.length * (3 * (TL.rowH + TL.gap) + TL.siteGap);
  cv.style.height = `${TL.T + rowsH + 6}px`;
  const [g, W] = setupCanvas(cv), w = W - TL.L - TL.R, span = S.missionDays * DAY;
  const X = (t) => TL.L + ((t - S.landing) / span) * w;
  $("#tlRange").textContent = `${iso(S.landing)} → ${iso(S.landing + span)} UTC`;
  // day ticks
  g.fillStyle = "#8b93a7"; g.textAlign = "center"; g.strokeStyle = "#ffffff10";
  const tickDays = S.missionDays > 30 ? 7 : S.missionDays > 10 ? 2 : 1;
  for (let d = 0; d <= S.missionDays; d += tickDays) {
    g.beginPath(); g.moveTo(X(S.landing + d * DAY), TL.T - 4); g.lineTo(X(S.landing + d * DAY), TL.T + rowsH); g.stroke();
    g.fillText(`day ${d}`, X(S.landing + d * DAY), 9);
  }
  let y = TL.T;
  for (const id of S.selected) {
    const { ser, site } = results.get(id), n = ser.n, bw = w / n + 0.6;
    g.textAlign = "left"; g.fillStyle = colorOf(id); g.font = "600 12px system-ui, sans-serif";
    g.fillText(site.name.length > 24 ? site.name.slice(0, 23) + "…" : site.name, 4, y + 6);
    g.font = "11px system-ui, sans-serif"; g.fillStyle = "#8b93a7";
    ["Sun", "Earth", "Both"].forEach((lab, k) => g.fillText(lab, TL.L - 40, y + k * (TL.rowH + TL.gap) + TL.rowH / 2));
    for (let i = 0; i < n; i++) {
      const x = TL.L + (i / n) * w, s = ser.sunFrac[i], e = ser.earthFrac[i] >= C.LIT;
      g.fillStyle = `rgba(${SUN},${0.08 + 0.92 * s})`; g.fillRect(x, y, bw, TL.rowH);
      g.fillStyle = `rgba(${EARTH},${e ? 1 : 0.08})`; g.fillRect(x, y + TL.rowH + TL.gap, bw, TL.rowH);
      g.fillStyle = `rgba(${BOTH},${e && s >= C.LIT ? 1 : 0.06})`; g.fillRect(x, y + 2 * (TL.rowH + TL.gap), bw, TL.rowH);
    }
    y += 3 * (TL.rowH + TL.gap) + TL.siteGap;
  }
  for (const [t, col] of [[S.pin, "#ffffff"], [S.hover, "#ffffffaa"]]) {
    if (t == null || t < S.landing || t > S.landing + span) continue;
    g.strokeStyle = col; g.beginPath(); g.moveTo(X(t), TL.T - 6); g.lineTo(X(t), TL.T + rowsH); g.stroke();
  }
}
function timelineTime(ev) {
  const cv = $("#timeline"), rect = cv.getBoundingClientRect(), w = rect.width - TL.L - TL.R;
  const f = (ev.clientX - rect.left - TL.L) / w;
  return f < 0 || f > 1 ? null : S.landing + f * S.missionDays * DAY;
}

// ---------- landing-date scan ----------
const SC = { L: 34, R: 10, T: 18, chartH: 170, strip: 10 };
function drawScan() {
  const cv = $("#scan"), nS = S.selected.length;
  const stripsTop = SC.T + SC.chartH + 6, H = stripsTop + 12 + nS * (SC.strip + 3) + 22;
  cv.style.height = `${H}px`;
  const [g, W] = setupCanvas(cv), w = W - SC.L - SC.R, h = SC.chartH;
  const t0 = S.scanStart, span = SCAN_DAYS * DAY;
  const X = (t) => SC.L + ((t - t0) / span) * w, Y = (v) => SC.T + (1 - v / 100) * h;
  $("#scanRange").textContent = `${iso(t0).slice(0, 10)} → ${iso(t0 + span).slice(0, 10)}`;
  g.strokeStyle = "#ffffff12"; g.fillStyle = "#8b93a7"; g.textAlign = "right";
  for (let v = 0; v <= 100; v += 25) { g.beginPath(); g.moveTo(SC.L, Y(v)); g.lineTo(SC.L + w, Y(v)); g.stroke(); g.fillText(`${v}%`, SC.L - 4, Y(v)); }
  g.textAlign = "center";
  const d0 = new Date(t0), bottom = H - 8;
  for (let m = 0; m <= 12; m++) {
    const t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + m, 1);
    if (t < t0 || t > t0 + span) continue;
    g.beginPath(); g.moveTo(X(t), SC.T); g.lineTo(X(t), bottom - 10); g.stroke();
    g.fillText(new Date(t).toLocaleString("en", { month: "short", timeZone: "UTC" }) + (new Date(t).getUTCMonth() === 0 ? ` ${new Date(t).getUTCFullYear()}` : ""), X(t), bottom);
  }
  // other sites faint, active site bold on top
  const order = [...S.selected.filter((id) => id !== S.active), S.active];
  for (const id of order) {
    const arr = scans.get(id); if (!arr) continue;
    const act = id === S.active;
    g.strokeStyle = colorOf(id); g.lineWidth = act ? 2 : 1; g.globalAlpha = act ? 1 : 0.3;
    g.beginPath(); arr.forEach((c, i) => (i ? g.lineTo(X(c.t), Y(c.bothPct)) : g.moveTo(X(c.t), Y(c.bothPct)))); g.stroke();
  }
  g.globalAlpha = 1; g.lineWidth = 1;
  // best landing time for the active site
  const act = scans.get(S.active);
  if (act?.length) {
    const best = act.reduce((a, c) => (c.bothPct > a.bothPct ? c : a), act[0]);
    g.fillStyle = colorOf(S.active); g.beginPath(); g.arc(X(best.t), Y(best.bothPct), 4, 0, 2 * Math.PI); g.fill();
    g.textAlign = X(best.t) > W - 200 ? "right" : "left"; g.fillStyle = "#e6e9f2";
    g.fillText(`best: ${iso(best.t)} (${best.bothPct.toFixed(0)}%)`, X(best.t) + (g.textAlign === "left" ? 7 : -7), Math.max(SC.T - 8, Y(best.bothPct) - 10));
    S.bestScan = best.t;
  }
  renderWindows();
  // per-site heat strips (same metric, readable for all sites at once) + "lands in sunlight" strip for the active site
  g.textAlign = "right"; g.fillStyle = "#8b93a7"; g.fillText("lit", SC.L - 4, stripsTop + 4);
  if (act) for (const c of act) { g.fillStyle = c.litAtLanding ? `rgba(${SUN},.85)` : "#ffffff10"; g.fillRect(X(c.t), stripsTop, w / act.length + 0.5, 8); }
  S.selected.forEach((id, k) => {
    const arr = scans.get(id), y = stripsTop + 12 + k * (SC.strip + 3); if (!arr) return;
    g.fillStyle = colorOf(id); g.fillRect(SC.L - 12, y + 1, 8, SC.strip - 2);
    for (const c of arr) { g.fillStyle = `rgba(${BOTH},${0.04 + 0.96 * (c.bothPct / 100) ** 1.5})`; g.fillRect(X(c.t), y, w / arr.length + 0.5, SC.strip); }
  });
  g.strokeStyle = "#fff"; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(X(S.landing), SC.T); g.lineTo(X(S.landing), stripsTop + 12 + nS * (SC.strip + 3)); g.stroke(); g.setLineDash([]);
  if (S.scanHover) {
    const { t, vals } = S.scanHover;
    g.strokeStyle = "#ffffff66"; g.beginPath(); g.moveTo(X(t), SC.T); g.lineTo(X(t), SC.T + h); g.stroke();
    const left = X(t) < W - 220, x = X(t) + (left ? 8 : -8);
    g.textAlign = left ? "left" : "right";
    g.fillStyle = "#0b0e14dd"; g.fillRect(left ? x - 4 : x - 214, SC.T, 218, 18 + vals.length * 14);
    g.fillStyle = "#e6e9f2"; g.fillText(`land ${iso(t)} UTC`, x, SC.T + 9);
    vals.forEach(([id, v], k) => { g.fillStyle = colorOf(id); g.fillText(`${v.toFixed(0)}%  ${S.byId.get(id).name}`, x, SC.T + 23 + k * 14); });
  }
}
// Landing windows where the active site keeps BOTH Sun and Earth for the whole surface stay (consecutive 6-h candidates).
function renderWindows() {
  const arr = scans.get(S.active), el = $("#windows"); if (!arr || !el) return;
  const step = arr.length > 1 ? arr[1].t - arr[0].t : 6 * HOUR, wins = [];
  for (const c of arr) {
    if (c.bothPct < 99.95) continue;
    const last = wins[wins.length - 1];
    if (last && c.t - last.end <= step + 1) last.end = c.t; else wins.push({ start: c.t, end: c.t });
  }
  const name = S.byId.get(S.active).name, day = (t) => iso(t).slice(0, 16);
  el.innerHTML = wins.length
    ? `<b>${name}</b>: Sun and Earth stay in view for the whole ${S.missionDays}-day stay if you land in ${wins.length} window${wins.length > 1 ? "s" : ""}: ` +
      wins.slice(0, 8).map((w) => `<button class="win" data-t="${w.start}">${day(w.start)}${w.end > w.start ? ` → ${day(w.end)}` : ""}</button>`).join(" ") + (wins.length > 8 ? ` <span class="muted">+${wins.length - 8} more</span>` : "")
    : `<b>${name}</b>: no landing time in this year keeps both Sun and Earth for the whole ${S.missionDays}-day stay. Try a shorter stay or another site.`;
  el.querySelectorAll(".win").forEach((b) => b.addEventListener("click", () => { stopPlay(); S.landing = +b.dataset.t; S.pin = null; update(false); }));
}
function scanCandidate(ev) {
  const rect = $("#scan").getBoundingClientRect(), w = rect.width - SC.L - SC.R;
  const f = (ev.clientX - rect.left - SC.L) / w;
  if (f < 0 || f > 1) return null;
  const arr = scans.get(S.active); if (!arr?.length) return null;
  const i = Math.min(arr.length - 1, Math.max(0, Math.round(f * (SCAN_DAYS * DAY) / (arr[1].t - arr[0].t))));
  return { t: arr[i].t, vals: S.selected.map((id) => [id, scans.get(id)[i]?.bothPct ?? 0]) };
}

// ---------- map ----------
function initMap() {
  const N = S.dem.n, off = S.dem.off, sc = S.dem.scale;
  const toLL = (lat, lon) => { const [x, y] = C.latlonToXY(lat, lon); return L.latLng(-(off - y / sc), off + x / sc); };
  S.toLL = toLL;
  const fromLL = (ll) => C.xyToLatLon((ll.lng - off) * sc, (off + ll.lat) * sc);
  map = L.map("map", { crs: L.CRS.Simple, minZoom: -3, maxZoom: 3, zoomSnap: 0.25, attributionControl: false });
  const bounds = [[-N, 0], [0, N]];
  const layers = { hillshade: L.imageOverlay("data/hillshade.jpg", bounds), illum: L.imageOverlay("data/illum.jpg", bounds), earth: L.imageOverlay("data/earthvis.jpg", bounds), psr: L.imageOverlay("data/psr.jpg", bounds) };
  layers.hillshade.addTo(map); map.fitBounds(bounds);
  const legends = {
    hillshade: "LRO LOLA topography (LDEM_75S_240M), shaded relief. 80°S to pole.",
    illum: "NASA PGDA average sunlight (Mazarico et al. 2011): brighter yellow = lit more often over 18.6 years.",
    earth: "NASA PGDA average Earth visibility: brighter blue = Earth above the horizon more often. Earth always sits toward 0° longitude.",
    psr: "NASA PGDA permanently shadowed regions (cyan): never sunlit, cold traps where water ice may survive.",
  };
  $("#mapLegend").dataset.base = legends.hillshade; $("#mapLegend").textContent = legends.hillshade;
  document.querySelectorAll("#layerSeg button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#layerSeg button").forEach((x) => x.classList.toggle("on", x === b));
    Object.values(layers).forEach((l) => l.remove()); layers[b.dataset.layer].addTo(map); graticule.bringToFront?.();
    $("#mapLegend").dataset.base = legends[b.dataset.layer];
    $("#mapLegend").textContent = legends[b.dataset.layer] + ($("#mapLegend").dataset.shadow && $("#shadowChk").checked ? "  ·  " + $("#mapLegend").dataset.shadow : "");
    shadowLayer?.bringToFront();
  }));
  // graticule
  const graticule = L.layerGroup().addTo(map), gs = { color: "#ffffff", weight: 0.6, opacity: 0.35, interactive: false };
  for (let lat = -88; lat >= -82; lat -= 2) {
    L.polyline(Array.from({ length: 181 }, (_, i) => toLL(lat, i * 2)), gs).addTo(graticule);
    L.marker(toLL(lat, 180), { icon: L.divIcon({ className: "grat-label", html: `${-lat}°S`, iconSize: null }), interactive: false }).addTo(graticule);
  }
  for (let lon = -180; lon < 180; lon += 30) {
    L.polyline([toLL(-89.999, lon), toLL(-80.3, lon)], gs).addTo(graticule);
    const lab = lon === 0 ? "0° · toward Earth" : `${Math.abs(lon)}°${lon < 0 ? "W" : "E"}`;
    L.marker(toLL(-80.9, lon), { icon: L.divIcon({ className: "grat-label", html: lab, iconSize: null }), interactive: false }).addTo(graticule);
  }
  map.on("click", (e) => {
    const [lat, lon] = fromLL(e.latlng);
    if (lat > -80 || !inDem(lat, lon)) return;
    addCustom(lat, lon); update(true);
  });
  const tip = L.tooltip({ direction: "top", offset: [0, -8] });
  map.on("mousemove", (e) => {
    const [lat, lon] = fromLL(e.latlng), [x, y] = C.latlonToXY(lat, lon), hk = C.heightKm(S.dem, x, y);
    if (Number.isNaN(hk)) return map.closeTooltip(tip);
    tip.setLatLng(e.latlng).setContent(`${lat.toFixed(3)}°, ${lon.toFixed(3)}° · ${(hk * 1000).toFixed(0)} m<br><span class="muted">click to add as a site</span>`);
    map.openTooltip(tip);
  });
  map.on("mouseout", () => map.closeTooltip(tip));
}
function refreshMarkers() {
  for (const s of S.sites) {
    if (!inDem(s.lat, s.lon)) continue;
    const sel = S.selected.includes(s.id);
    let m = markers.get(s.id);
    if (!m) {
      m = L.circleMarker(S.toLL(s.lat, s.lon), { radius: 5 }).addTo(map);
      m.bindTooltip(s.name, { direction: "right", offset: [6, 0] });
      m.on("click", (e) => { L.DomEvent.stopPropagation(e); toggleSite(s.id); });
      markers.set(s.id, m);
    }
    m.setStyle({ radius: sel ? 8 : 5, color: sel ? "#fff" : "#cbd5e1", weight: sel ? 2 : 1, fillColor: sel ? colorOf(s.id) : "#0b0e14", fillOpacity: sel ? 1 : 0.6 });
    if (sel) m.bringToFront();
  }
}

// ---------- worker queue: live shadow map + 3D lighting (core.sunlightMap off the main thread) ----------
let shadowLayer = null, worker = null, busy = false, reqId = 0;
const pendingReq = { map: null, v3: null }, SHADOW_HALF_KM = 30;
function ensureWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker("shadow-worker.js", { type: "module" });
    worker.postMessage({ dem: S.dem });
    worker.onmessage = ({ data }) => { busy = false; route(data.req, data.frac, data.n); next(); };
    worker.onerror = () => { worker = false; busy = false; next(); };
  } catch { worker = false; }
  return worker;
}
function route(req, frac, n) { if (req.kind === "map") paintShadows(req, frac, n); else paint3D(req, frac); }
function next() { const k = pendingReq.map ? "map" : pendingReq.v3 ? "v3" : null; if (k) { const r = pendingReq[k]; pendingReq[k] = null; send(r); } }
function send(req) {
  if (ensureWorker()) { busy = true; worker.postMessage(req); return; }
  const m = C.sunlightMap(S.dem, req.sunDir, req.x0, req.y0, req.half, req.cell, { obsHeightM: req.obs }); // fallback: main thread
  route(req, m.frac, m.n);
}
function queue(req) { if (busy) pendingReq[req.kind] = req; else send(req); } // newest request per kind wins
function drawShadows() {
  const site = S.byId.get(S.active), on = $("#shadowChk").checked;
  if (!on || !site || !inDem(site.lat, site.lon)) { shadowLayer?.remove(); shadowLayer = null; pendingReq.map = null; return; }
  const t = S.pin ?? S.landing, [x0, y0] = C.latlonToXY(site.lat, site.lon);
  queue({ kind: "map", id: ++reqId, t, name: site.name, sunDir: C.sunDirAt(S.eph, t), x0, y0, half: SHADOW_HALF_KM, cell: S.playing ? 0.96 : 0.48, obs: S.mastM });
}
function paintShadows(req, frac, n) {
  if (!$("#shadowChk").checked || req.name !== S.byId.get(S.active)?.name) return;
  const cv = document.createElement("canvas"); cv.width = cv.height = n;
  const g = cv.getContext("2d"), img = g.createImageData(n, n);
  for (let k = 0; k < n * n; k++) {
    const f = frac[k], o = 4 * k;
    if (Number.isNaN(f)) continue;
    if (f >= C.LIT) { img.data[o] = 255; img.data[o + 1] = 214; img.data[o + 2] = 120; img.data[o + 3] = 40; }
    else { img.data[o] = 4; img.data[o + 1] = 8; img.data[o + 2] = 28; img.data[o + 3] = Math.round(215 - 120 * f); }
  }
  g.putImageData(img, 0, 0);
  const off = S.dem.off, sc = S.dem.scale, half = req.half + req.cell / 2;
  const bounds = [[-(off - (req.y0 - half) / sc), off + (req.x0 - half) / sc], [-(off - (req.y0 + half) / sc), off + (req.x0 + half) / sc]];
  if (!shadowLayer) shadowLayer = L.imageOverlay(cv.toDataURL(), bounds, { interactive: false }).addTo(map);
  else shadowLayer.setUrl(cv.toDataURL()).setBounds(L.latLngBounds(bounds));
  $("#mapLegend").dataset.shadow = `Shadows: ${iso(req.t)} UTC, ${req.obs} m above ground, ±${req.half} km around ${req.name}. Dark = Sun's centre hidden by terrain.`;
  $("#mapLegend").textContent = $("#mapLegend").dataset.base + "  ·  " + $("#mapLegend").dataset.shadow;
}
// (registered in bindControls, after timeHooks exists)

// ---------- optional 3D view (lazy; failure leaves the planner intact) ----------
let v3 = null, v3key = null, v3grid = null;
const V3_LEGEND = "True vertical scale · terrain lit by our validated shadow model · terrain within 15 km is drawn; the dark ring is the full LOLA horizon (out to 400 km) · drag to orbit, scroll to zoom";
async function open3D() {
  if (v3 === null) {
    $("#view3d").textContent = "Loading 3D…";
    try { v3 = await import("./view3d.js"); $("#view3d").textContent = ""; v3.init($("#view3d")); }
    catch (e) { v3 = false; $("#view3d").textContent = "3D view unavailable here (" + e.message + "). The 2D planner is unaffected."; return; }
  }
  refresh3D();
}
function refresh3D() {
  if (!v3 || $("#view3d").hidden) return;
  const r = results.get(S.active); if (!r) return;
  const cvs = $("#view3d canvas");
  if (!r.hz.terrain) { if (cvs) cvs.style.visibility = "hidden"; $("#v3Legend").textContent = `3D needs a site inside LOLA coverage (80°S to the pole). ${r.site.name} uses a smooth sphere.`; v3key = null; return; }
  if (cvs) cvs.style.visibility = ""; $("#v3Legend").textContent = V3_LEGEND;
  const key = `${S.active}|${S.mastM}`;
  const rebuilt = key !== v3key;
  if (rebuilt) { v3grid = v3.setSite(S.dem, r.site, r.hz, colorOf(S.active)); v3key = key; }
  const t = S.pin ?? S.landing, st = C.stateAt(S.eph, r.hz, t);
  if (rebuilt && $("#eyeChk").checked) v3.setEye(true, S.mastM, st); // aim at the Sun once per site, not every frame
  v3.setTime(st, null, S.mastM);
  queue({ kind: "v3", id: ++reqId, key, t, sunDir: C.sunDirAt(S.eph, t), ...v3grid, obs: S.mastM });
}
function paint3D(req, frac) {
  if (!v3 || req.key !== v3key) return;
  const r = results.get(S.active); if (!r) return;
  v3.setTime(C.stateAt(S.eph, r.hz, req.t), frac, S.mastM);
}


// ---------- controls ----------
function bindControls() {
  $("#landing").addEventListener("change", (e) => {
    const t = Date.parse(e.target.value + ":00Z");
    if (!Number.isNaN(t)) { stopPlay(); S.landing = t; S.scanStart = t; S.pin = null; update(true); }
  });
  $("#missionDays").addEventListener("change", (e) => { stopPlay(); S.missionDays = Math.min(60, Math.max(1, Math.round(+e.target.value) || 14)); update(true); });
  $("#mast").addEventListener("input", (e) => { $("#mastOut").textContent = `${e.target.value} m`; });
  for (const k of ["arrayW", "loadW"]) $("#" + k).addEventListener("change", (e) => { S[k] = Math.max(0, +e.target.value || 0); renderMetrics(); writeHash(); });
  $("#playBtn").addEventListener("click", () => (S.playing ? stopPlay() : startPlay()));
  timeHooks.push(() => drawShadows(), () => refresh3D());
  document.querySelectorAll("#viewSeg button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#viewSeg button").forEach((x) => x.classList.toggle("on", x === b));
    const is3d = b.dataset.v === "3d";
    $("#sky").hidden = is3d; $("#skyLegend").hidden = is3d; $("#view3d").hidden = !is3d; $("#v3Legend").hidden = !is3d; $("#eyeWrap").hidden = !is3d;
    if (is3d) open3D(); else drawSky();
  }));
  $("#eyeChk").addEventListener("change", (e) => {
    if (!v3) return; const r = results.get(S.active);
    v3.setEye(e.target.checked, S.mastM, r && C.stateAt(S.eph, r.hz, S.pin ?? S.landing));
  });
  $("#shadowChk").addEventListener("change", () => { drawShadows(); if (!$("#shadowChk").checked) $("#mapLegend").textContent = $("#mapLegend").dataset.base; });
  $("#csvBtn").addEventListener("click", exportCSV);
  $("#mast").addEventListener("change", (e) => { S.mastM = +e.target.value; update(true); });
  const tl = $("#timeline");
  tl.addEventListener("mousemove", (e) => { S.hover = timelineTime(e); drawSky(); drawTimeline(); });
  tl.addEventListener("mouseleave", () => { S.hover = null; drawSky(); drawTimeline(); });
  tl.addEventListener("click", (e) => { S.pin = timelineTime(e); drawSky(); drawTimeline(); timeChanged(); });
  const sc = $("#scan");
  sc.addEventListener("mousemove", (e) => { S.scanHover = scanCandidate(e); drawScan(); });
  sc.addEventListener("mouseleave", () => { S.scanHover = null; drawScan(); });
  sc.addEventListener("click", (e) => { const c = scanCandidate(e); if (c) { stopPlay(); S.landing = c.t; S.pin = null; update(false); } });
  $("#copyLink").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); $("#copyLink").textContent = "Copied!"; }
    catch { prompt("Copy this link:", location.href); }
    setTimeout(() => ($("#copyLink").textContent = "Copy link"), 1500);
  });
  $("#aboutBtn").addEventListener("click", () => $("#about").showModal());
  let rt; window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { drawSky(); drawTimeline(); drawScan(); map.invalidateSize(); }, 120); });
}

// ---------- playback: advances the pinned time; redraw only, no recomputation ----------
let lastFrame = 0;
const timeHooks = []; // time-dependent views (shadow map, 3D) register a redraw here
function timeChanged() { for (const f of timeHooks) f(); }
function startPlay() {
  S.playing = true; $("#playBtn").innerHTML = "&#10074;&#10074; Pause";
  const end = S.landing + S.missionDays * DAY;
  if (S.pin == null || S.pin >= end) S.pin = S.landing;
  lastFrame = performance.now(); requestAnimationFrame(tick);
}
function stopPlay() { S.playing = false; $("#playBtn").innerHTML = "&#9654; Play"; timeChanged(); }
function tick(now) {
  if (!S.playing) return;
  const dt = Math.min(0.5, (now - lastFrame) / 1000); lastFrame = now; // real elapsed time, so speed matches the label
  S.pin += dt * +$("#playSpeed").value * DAY;
  if (S.pin >= S.landing + S.missionDays * DAY) { S.pin = S.landing + S.missionDays * DAY; stopPlay(); return; }
  S.hover = null; drawSky(); drawTimeline(); timeChanged();
  requestAnimationFrame(tick);
}

// ---------- CSV export ----------
function exportCSV() {
  const head = "utc,site,lat_deg,lon_deg,mast_m,terrain,sun_az_deg,sun_el_deg,sun_terrain_horizon_deg,sun_disc_visible,earth_az_deg,earth_el_deg,earth_terrain_horizon_deg,earth_disc_visible,sunlit,earth_in_view";
  const lines = [head];
  for (const id of S.selected) {
    const { site, hz, ser } = results.get(id), name = `"${site.name.replace(/"/g, "'")}"`;
    for (let i = 0; i < ser.n; i++) {
      const t = S.landing + i * ser.stepMs, st = C.stateAt(S.eph, hz, t);
      lines.push([new Date(t).toISOString().slice(0, 16) + "Z", name, site.lat.toFixed(5), site.lon.toFixed(5), S.mastM, hz.terrain ? "LOLA240m" : "sphere",
        st.sunAz.toFixed(3), st.sunEl.toFixed(3), st.sunHz.toFixed(3), st.sunFrac.toFixed(3), st.earthAz.toFixed(3), st.earthEl.toFixed(3), st.earthHz.toFixed(3), st.earthFrac.toFixed(3),
        +(st.sunFrac >= C.LIT), +(st.earthFrac >= C.LIT)].join(","));
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/csv" }));
  a.download = `lunar-sites_${isoInput(S.landing).replace(":", "")}_${S.missionDays}d.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function buildAbout(v, ephMeta, demMeta) {
  const val = v ? `<ul>
    <li><b>Ephemeris vs JPL Horizons:</b> ${v.horizons.comparisons} Sun/Earth positions at 3 sites (2026–2028) — max elevation error ${v.horizons.maxAbsElevErrDeg.toFixed(4)}°, max azimuth error ${v.horizons.maxAbsAzErrDegOnSky.toFixed(4)}° (Sun's radius is 0.27°).</li>
    ${v.shadow ? `<li><b>Live shadow map vs horizon method:</b> ${v.shadow.cases} random point/time cases (${v.shadow.edgeCases} with the Sun within 1° of the terrain edge): lit/dark disagreement ${v.shadow.mismatchPct}%, mean disc-fraction difference ${v.shadow.meanAbsDiscDiff}.</li>` : ""}
    <li><b>Terrain shadows vs NASA PGDA maps</b> (Mazarico et al. 2011, 18.6-year average, ${v.pgda.points} points ≥85°S, random within 5 illumination strata): sunlight mean abs. difference ${v.pgda.sun.meanAbsDiffPctPts} %-points (r = ${v.pgda.sun.r}); Earth visibility ${v.pgda.earth.meanAbsDiffPctPts} %-points (r = ${v.pgda.earth.r}).</li></ul>` : "<p>Validation summary not available.</p>";
  $("#aboutBody").innerHTML = `
  <h3>How it works</h3>
  <ol>
    <li>Sun and Earth positions come from JPL's DE421 planetary ephemeris, expressed in the Moon's body-fixed frame (MOON_ME), the same frame as the LOLA maps. Libration and the Moon's orbital changes are included.</li>
    <li>For each site we trace 1,440 rays across LOLA topography (240 m grid) and keep the highest terrain angle in every 0.5° of azimuth. The Moon's curvature is handled exactly: each terrain sample is placed on the sphere in 3D. There is no atmosphere, so no refraction.</li>
    <li>"Sunlit" means the centre of the Sun is above that terrain horizon. We also compute how much of the Sun's disc is visible. "Earth in view" means the centre of Earth is visible, which is needed for a direct radio link.</li>
    <li>Live shadows (map and 3D) apply the same rule to every cell around the site, tracing one ray toward the Sun along the Moon's curved surface. The 3D view uses true vertical scale, and its dark ring is the validated terrain horizon.</li>
    <li>Power numbers use only your inputs: array output in full Sun × sun-hours (visible disc fraction × time), minus load × time. Battery = load × the longest darkness.</li>
  </ol>
  <h3>Validation (run with tools/validate.mjs on the same code as this page)</h3>${val}
  <h3>Data sources</h3>
  <ul>
    <li>NASA LRO LOLA ${demMeta.source} (PDS Geosciences Node).</li>
    <li>NASA GSFC PGDA, Lunar Polar Illumination: average Sun and Earth visibility maps (Mazarico et al. 2011, Icarus 211).</li>
    <li>NASA GSFC PGDA, permanently shadowed regions map (Mazarico et al. 2011): the PSR layer and the distance-to-PSR metric.</li>
    <li>NASA Earth Observatory, Blue Marble Next Generation: Earth texture in the 3D view (its phase is lit by the real Sun direction; continents are not oriented to the time of day).</li>
    <li>NASA GSFC PGDA, high-resolution south-pole site DEMs (Barker et al. 2021, PSS 203), used to place the Artemis region markers.</li>
    <li>JPL NAIF DE421 + Moon PA/ME kernels via Skyfield; cross-checked with the JPL Horizons API.</li>
  </ul>
  <h3>Limits</h3>
  <ul><li>240 m terrain: features smaller than ~0.5 km (boulders, small craters) are not resolved. Use a higher mast to reduce near-field effects.</li>
  <li>Terrain is available from 80°S to the pole. Sites outside it (Apollo 11, Chang'e-4, Chandrayaan-3) use a smooth sphere.</li>
  <li>Earth visibility is geometric line of sight. It does not include DSN station scheduling.</li></ul>
  <h3>Use of AI (SI)</h3><p>This app's code and data pipeline were written with Anthropic Claude (Claude Code) as an AI assistant, under the team's direction. Every scientific result is checked against the independent NASA references above. Details are in the README.</p>
  <p class="muted">Site coordinates and their sources: hover a site in the list.</p>`;
}

init().catch((e) => { $("#loadTxt").textContent = "Failed to load: " + e.message; console.error(e); });
