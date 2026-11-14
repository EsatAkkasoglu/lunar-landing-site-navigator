// SI-assisted: written with Anthropic Claude (Claude Code) under the team's direction; reviewed and validated by the team (see README, 'Use of AI').
// Gate for the shadow map: at random (point, time) pairs, sunlightMap (one great-circle ray toward the Sun) must agree
// with the validated horizon method (stateAt over computeHorizon's 0.5-degree bins) on "sunlit" (disc centre visible).
// Uses the exact settings the app uses (shipped DEM, maxKm 400). Also times one app-sized map.
import * as C from "../web/core.js";
import { readFileSync, writeFileSync } from "node:fs";
import { loadEphem, loadShippedDem } from "./data.mjs";
const eph = loadEphem(), dem = loadShippedDem();
let seed = 7; const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const t0 = Date.UTC(2027, 0, 1), N = 600;
let n = 0, mismatch = 0, sumAbs = 0, nearEdge = 0, edgeCases = 0, partial = 0;
for (const obs of [0, 10]) {
  for (let k = 0; k < N / 2; k++) {
    const x = (rnd() * 2 - 1) * 180, y = (rnd() * 2 - 1) * 180;
    if (Math.hypot(x, y) > 180) { k--; continue; }
    const [lat, lon] = C.xyToLatLon(x, y);
    const hz = C.computeHorizon(dem, lat, lon, { obsHeightM: obs });
    for (let m = 0; m < 4; m++) {
      const t = t0 + rnd() * 365 * 86400e3, st = C.stateAt(eph, hz, t);
      const f = C.sunlightMap(dem, C.sunDirAt(eph, t), x, y, 0, 1, { obsHeightM: obs }).frac[0];
      n++; sumAbs += Math.abs(f - st.sunFrac); if (Math.abs(st.sunEl - st.sunHz) < 1) edgeCases++; if (f > 0 && f < 1) partial++;
      if ((f >= C.LIT) !== (st.sunFrac >= C.LIT)) { mismatch++; if (Math.abs(st.sunEl - st.sunHz) < 0.5) nearEdge++; }
    }
  }
}
console.log(`shadow map vs horizon: ${n} cases, lit/dark mismatch ${(100 * mismatch / n).toFixed(2)}% (${mismatch}, of which ${nearEdge} within 0.5 deg of the terrain edge), mean |disc fraction diff| ${(sumAbs / n).toFixed(4)}; coverage: ${edgeCases} cases with Sun within 1 deg of terrain edge, ${partial} partially visible discs`);
const tS = performance.now();
const map = C.sunlightMap(dem, C.sunDirAt(eph, t0), 0, 0, 30, 0.48);
console.log(`app-sized map (${map.n}x${map.n} cells, +-30 km @ 480 m): ${(performance.now() - tS).toFixed(0)} ms`);
const vp = new URL("../web/data/validation.json", import.meta.url), v = JSON.parse(readFileSync(vp));
v.shadow = { cases: n, mismatchPct: +(100 * mismatch / n).toFixed(2), edgeCases, partial, meanAbsDiscDiff: +(sumAbs / n).toFixed(4) };
writeFileSync(vp, JSON.stringify(v, null, 1));
process.exit(mismatch / n < 0.02 ? 0 : 1);
