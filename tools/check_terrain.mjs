// SI-assisted: written with Anthropic Claude (Claude Code) under the team's direction; reviewed and validated by the team (see README, 'Use of AI').
// Checks for slopeDeg and nearestMaskKm: exact answers on synthetic grids, then real values at curated sites.
import { gunzipSync } from "node:zlib";
import * as C from "../web/core.js";
import { rd, loadShippedDem } from "./data.mjs";
let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.log("FAIL", msg); } };

// 1) synthetic tilted plane near the pole: h = tan(10 deg) * ground distance along x
const n = 201, scale = 0.24, off = 100;
const plane = { n, off, scale, data: new Int16Array(n * n) };
for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
  const x = (c - off) * scale, y = (off - r) * scale, k = 1 + (x * x + y * y) / (4 * C.R * C.R);
  plane.data[r * n + c] = Math.round(1000 * Math.tan((10 * Math.PI) / 180) * (x / k));
}
const [la, lo] = C.xyToLatLon(3, -2), s = C.slopeDeg(plane, la, lo);
ok(Math.abs(s - 10) < 0.15, `plane slope ${s}`); // DEM stores whole metres: +-0.5 m over 0.48 km = ~0.06 deg
// 2) mask distance: single set cell 10 cells east of the origin
const mask = new Uint8Array(n * n); mask[off * n + off + 10] = 1;
const [la2, lo2] = C.xyToLatLon(0, 0), dkm = C.nearestMaskKm(mask, plane, la2, lo2, 20);
ok(Math.abs(dkm - 2.4) < 0.01, `mask distance ${dkm}`);
ok(C.nearestMaskKm(mask, plane, la2, lo2, 1) === Infinity, "beyond maxKm -> Infinity");

// 3) real data: shipped DEM + PSR mask
const dem = loadShippedDem(), psr = gunzipSync(rd("web/data/psr.u8"));
let psrHit = -1; for (let i = 0; i < psr.length; i++) if (psr[i]) { psrHit = i; break; }
const hr = Math.floor(psrHit / dem.n), hc = psrHit % dem.n, [pl, pn] = C.xyToLatLon((hc - dem.off) * dem.scale, (dem.off - hr) * dem.scale);
ok(C.nearestMaskKm(psr, dem, pl, pn) < 0.2, "a PSR pixel is ~0 km from a PSR");
for (const st of JSON.parse(rd("web/data/sites.json")).filter((q) => q.lat < -80.2))
  console.log(`${st.name.padEnd(36)} slope ${C.slopeDeg(dem, st.lat, st.lon).toFixed(1).padStart(5)} deg | nearest PSR ${C.nearestMaskKm(psr, dem, st.lat, st.lon).toFixed(1)} km`);
console.log(fail ? "FAIL" : "PASS: slope and PSR-distance checks"); process.exit(fail ? 1 : 0);
