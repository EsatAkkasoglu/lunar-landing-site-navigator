// SI-assisted: written with Anthropic Claude (Claude Code) under the team's direction; reviewed and validated by the team (see README, 'Use of AI').
// Long-term (18.6 yr) Sun/Earth visibility at every curated site vs the PGDA map pixel, plus the Dec-2026 14-day window.
import * as C from "../web/core.js";
import { rd, loadEphem, loadShippedDem } from "./data.mjs";
const eph = loadEphem();
// default: the DEM actually shipped to the browser (80S crop); "full" = 75S validation grid
const full = process.argv[2] === "full";
const dem = full ? (() => { const db = rd("data_raw/dem75s_i16.bin"); return { data: new Int16Array(db.buffer, db.byteOffset, db.byteLength / 2), n: 3812, off: 1905.5, scale: 0.24 }; })() : loadShippedDem();
console.log("DEM:", full ? "75S validation grid" : "shipped web/data/" + JSON.parse(rd("web/data/dem.json")).file);
const map = (e) => { const b = rd(`data_raw/AVGVISIB_65S_240M_201608${e ? "_EARTH" : ""}.IMG`); return new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2); };
const sm = map(false), emp = map(true);
for (const s of JSON.parse(rd("web/data/sites.json"))) {
  const [x, y] = C.latlonToXY(s.lat, s.lon);
  if (Math.hypot(x, y) > 450) continue;
  if (Number.isNaN(C.heightKm(dem, x, y))) continue;
  const hz = C.computeHorizon(dem, s.lat, s.lon);
  let a = 0, b = 0; const nT = Math.floor((18.6 * 365.25 * 12));
  for (let i = 0; i < nT; i++) { const st = C.stateAt(eph, hz, eph.t0 + i * 2 * 3600e3); a += st.sunFrac > 0; b += st.earthFrac > 0; }
  const row = Math.round(3209.5 - y / 0.24), col = Math.round(3209.5 + x / 0.24);
  const sum = C.summarize(C.series(eph, hz, Date.UTC(2026, 11, 1), Date.UTC(2026, 11, 15), 10));
  console.log(`${s.name.padEnd(36)} sun ours ${(100 * a / nT).toFixed(0).padStart(3)}% pgda ${(sm[row * 6420 + col] * 4e-3).toFixed(0).padStart(3)}% | earth ours ${(100 * b / nT).toFixed(0).padStart(3)}% pgda ${(emp[row * 6420 + col] * 4e-3).toFixed(0).padStart(3)}% | Dec26 earth ${sum.earthPct.toFixed(0)}%`);
}
