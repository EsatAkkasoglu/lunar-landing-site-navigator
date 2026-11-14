// SI-assisted: written with Anthropic Claude (Claude Code) under the team's direction; reviewed and validated by the team (see README, 'Use of AI').
// Validation of web/core.js (the shipped code) against two independent NASA references:
//  1) JPL Horizons API: Sun/Earth azimuth+elevation seen from lunar surface sites.
//  2) PGDA average Sun/Earth visibility maps (Mazarico et al. 2011, 240 m, 18.6-yr hourly), using their definition
//     "fraction of timesteps where ANY part of the disc is visible".
// Usage: node tools/validate.mjs [horizons|pgda|all]   -> writes tools/validation_report.json
import { readFileSync, writeFileSync } from "node:fs";
import * as C from "../web/core.js";

const root = new URL("..", import.meta.url);
const read = (p) => readFileSync(new URL(p, root));
const ephMeta = JSON.parse(read("web/data/ephem.json"));
const ephBuf = read("web/data/ephem.bin");
const eph = C.ephemFrom(ephBuf.buffer.slice(ephBuf.byteOffset, ephBuf.byteOffset + ephBuf.byteLength), ephMeta);
const mode = process.argv[2] || "all";
const report = {};

async function horizons() {
  const sites = [ [-89.9, 0, "near pole"], [-85.3, 31.2, "85S 31E"], [0.674, 23.473, "Apollo 11"] ];
  const rows = [];
  for (const [lat, lon, name] of sites) {
    for (const [body, key] of [["10", "sun"], ["399", "earth"]]) {
      const q = new URLSearchParams({ format: "text", COMMAND: `'${body}'`, CENTER: "'coord@301'", COORD_TYPE: "'GEODETIC'",
        SITE_COORD: `'${lon},${lat},0'`, MAKE_EPHEM: "'YES'", EPHEM_TYPE: "'OBSERVER'", START_TIME: "'2026-11-15'",
        STOP_TIME: "'2028-11-15'", STEP_SIZE: "'37d'", QUANTITIES: "'4'", CSV_FORMAT: "'YES'", ANG_FORMAT: "'DEG'" });
      const txt = await (await fetch("https://ssd.jpl.nasa.gov/api/horizons.api?" + q)).text();
      const body_ = txt.split("$$SOE")[1]?.split("$$EOE")[0];
      if (!body_) throw new Error("Horizons parse failed:\n" + txt.slice(0, 1500));
      const hz = C.computeHorizon(null, lat, lon); // smooth sphere, observer on the 1737.4 km sphere
      for (const line of body_.trim().split("\n")) {
        const f = line.split(",").map((s) => s.trim());
        const t = Date.parse(f[0].replace(/^(\d{4})-(\w{3})-(\d{2}) (\d{2}:\d{2})$/, "$2 $3 $1 $4 UTC"));
        const az = +f[3], el = +f[4], st = C.stateAt(eph, hz, t);
        const dAz = ((st[key + "Az"] - az + 540) % 360) - 180, dEl = st[key + "El"] - el;
        rows.push({ name, key, t: new Date(t).toISOString().slice(0, 16), dAz: +dAz.toFixed(4), dEl: +dEl.toFixed(4), el });
      }
    }
  }
  const maxEl = Math.max(...rows.map((r) => Math.abs(r.dEl)));
  // azimuth error only meaningful when the body is not near the zenith (equatorial Earth is ~overhead)
  const maxAz = Math.max(...rows.filter((r) => r.el < 80).map((r) => Math.abs(r.dAz * Math.cos((r.el * Math.PI) / 180))));
  report.horizons = { comparisons: rows.length, maxAbsElevErrDeg: maxEl, maxAbsAzErrDegOnSky: maxAz, rows };
  console.log(`Horizons: ${rows.length} comparisons, max |dEl| = ${maxEl.toFixed(4)}°, max |dAz·cos el| = ${maxAz.toFixed(4)}°`);
}

function pgda(obsHeightM = 0) {
  const dm = JSON.parse(read("data_raw/dem75s_i16.json"));
  const db = read("data_raw/dem75s_i16.bin");
  const dem = { data: new Int16Array(db.buffer, db.byteOffset, db.byteLength / 2), n: dm.n, off: dm.off, scale: dm.scale_km };
  const map = (earth) => {
    const b = read(`data_raw/AVGVISIB_65S_240M_201608${earth ? "_EARTH" : ""}.IMG`);
    return new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2);
  };
  const sunMap = map(false), earthMap = map(true), N = 6420, OFF = 3209.5, SC = 0.24;
  // deterministic stratified sample of pixels within ~150 km of the pole (>= ~85S), across the illumination range
  let seed = 12345; const rnd = () => { // mulberry32 (exact 32-bit integer math)
    seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const strata = [[0.0, 0.1], [0.1, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 1.0]], perStratum = 12, pts = [];
  for (const [lo, hi] of strata) {
    let got = 0;
    while (got < perStratum) {
      const x = (rnd() * 2 - 1) * 150, y = (rnd() * 2 - 1) * 150;
      if (Math.hypot(x, y) > 150) continue;
      const row = Math.round(OFF - y / SC), col = Math.round(OFF + x / SC); // pixel centre
      const v = sunMap[row * N + col] * 4e-5;
      if (v < lo || v >= hi) continue;
      pts.push({ x: (col - OFF) * SC, y: (OFF - row) * SC, pgdaSun: v, pgdaEarth: earthMap[row * N + col] * 4e-5 }); got++;
    }
  }
  // 18.6-yr window sampled on the 2-h ephemeris grid (PGDA used hourly steps over one nutation cycle)
  const t0 = eph.t0, nT = Math.floor((18.6 * 365.25 * 24) / 2);
  for (const p of pts) {
    const [lat, lon] = C.xyToLatLon(p.x, p.y);
    const hz = C.computeHorizon(dem, lat, lon, { obsHeightM });
    let s = 0, e = 0;
    for (let i = 0; i < nT; i++) {
      const st = C.stateAt(eph, hz, t0 + i * 2 * 3600e3);
      s += st.sunFrac > 0; e += st.earthFrac > 0;
    }
    Object.assign(p, { lat: +lat.toFixed(4), lon: +lon.toFixed(4), oursSun: s / nT, oursEarth: e / nT });
  }
  const stats = (k) => {
    const d = pts.map((p) => p["ours" + k] - p["pgda" + k]);
    const mae = d.reduce((a, b) => a + Math.abs(b), 0) / d.length, bias = d.reduce((a, b) => a + b, 0) / d.length;
    const xs = pts.map((p) => p["pgda" + k]), ys = pts.map((p) => p["ours" + k]);
    const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
    let sxy = 0, sxx = 0, syy = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
    return { meanAbsDiffPctPts: +(100 * mae).toFixed(2), biasPctPts: +(100 * bias).toFixed(2), r: +(sxy / Math.sqrt(sxx * syy)).toFixed(4),
      maxAbsDiffPctPts: +(100 * Math.max(...d.map(Math.abs))).toFixed(2) };
  };
  const res = { obsHeightM, points: pts.length, sun: stats("Sun"), earth: stats("Earth"),
    pts: pts.map((p) => ({ lat: p.lat, lon: p.lon, pgdaSun: +p.pgdaSun.toFixed(3), oursSun: +p.oursSun.toFixed(3), pgdaEarth: +p.pgdaEarth.toFixed(3), oursEarth: +p.oursEarth.toFixed(3) })) };
  (report.pgda ??= []).push(res);
  console.log(`PGDA (obs ${obsHeightM} m, ${pts.length} pts): Sun MAE ${res.sun.meanAbsDiffPctPts} pp, bias ${res.sun.biasPctPts}, r ${res.sun.r} | Earth MAE ${res.earth.meanAbsDiffPctPts} pp, bias ${res.earth.biasPctPts}, r ${res.earth.r}`);
}

if (mode === "horizons" || mode === "all") await horizons();
if (mode === "pgda" || mode === "all") pgda(0);
writeFileSync(new URL("tools/validation_report.json", root), JSON.stringify(report, null, 1));
if (report.horizons && report.pgda) {
  const p = report.pgda[0], { rows, ...h } = report.horizons;
  let prev = {}; try { prev = JSON.parse(read("web/data/validation.json")); } catch {}
  writeFileSync(new URL("web/data/validation.json", root), JSON.stringify({ ...prev, generated: new Date().toISOString(), horizons: h,
    pgda: { points: p.points, obsHeightM: p.obsHeightM, sun: p.sun, earth: p.earth } }, null, 1));
}
