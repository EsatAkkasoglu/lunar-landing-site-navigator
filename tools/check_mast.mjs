// SI-assisted: written with Anthropic Claude (Claude Code) under the team's direction; reviewed and validated by the team (see README, 'Use of AI').
// Mast-height sanity: raising the observer must never lower the terrain horizon, and sunlit % must not drop.
import * as C from "../web/core.js";
import { rd, loadEphem, loadShippedDem } from "./data.mjs";
const eph = loadEphem(), dem = loadShippedDem();
const t0 = Date.UTC(2027, 0, 1), t1 = Date.UTC(2028, 0, 1);
let ok = true;
for (const s of JSON.parse(rd("web/data/sites.json")).filter((s) => s.lat < -83)) {
  let prev = null; const out = [];
  for (const m of [0, 2, 5, 10, 20]) {
    const hz = C.computeHorizon(dem, s.lat, s.lon, { obsHeightM: m }), sum = C.summarize(C.series(eph, hz, t0, t1, 60));
    if (prev) { for (let i = 0; i < C.N_AZ; i++) if (hz.el[i] > prev.el[i] + 1e-6) ok = false; if (sum.sunPct < prev.sun - 1e-9) ok = false; }
    prev = { el: hz.el, sun: sum.sunPct }; out.push(`${m}m:${sum.sunPct.toFixed(1)}%`);
  }
  console.log(s.name.padEnd(36), out.join("  "));
}
console.log(ok ? "PASS: horizon never rises and sunlit % never drops with mast height" : "FAIL: non-monotonic");
process.exit(ok ? 0 : 1);
