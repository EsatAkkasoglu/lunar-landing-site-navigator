// SI-assisted: written with Anthropic Claude (Claude Code) under the team's direction; reviewed and validated by the team (see README, 'Use of AI').
// core.js — the ONE implementation of the geometry. Used by the web app and by tools/validate.mjs (Node).
// Frame: Moon body-fixed MOON_ME (DE421), z = north pole, x = lon 0. Same frame as LOLA DEMs and ephem.bin.
// Grid: south polar stereographic, sphere R = 1737.4 km; col = off + x/scale, row = off - y/scale,
//       x = rho*sin(lon), y = rho*cos(lon)   (orientation verified in pipeline/check_orientation.py).

export const R = 1737.4;                 // km, LOLA reference sphere
export const SUN_RADIUS_DEG = 0.2666;    // mean apparent solar radius (varies ±1.7% over the year)
export const EARTH_RADIUS_KM = 6371.0;
const D2R = Math.PI / 180, R2D = 180 / Math.PI, TAU = 2 * Math.PI;

export function latlonToXY(lat, lon) {
  const rho = 2 * R * Math.tan(Math.PI / 4 + (lat * D2R) / 2);
  return [rho * Math.sin(lon * D2R), rho * Math.cos(lon * D2R)];
}

export function xyToLatLon(x, y) {
  const rho = Math.hypot(x, y);
  return [(2 * Math.atan(rho / (2 * R)) - Math.PI / 2) * R2D, Math.atan2(x, y) * R2D];
}

// Inverse stereographic straight to a unit vector (no trig): s = rho^2 / 4R^2.
export function unitFromXY(x, y) {
  const s = (x * x + y * y) / (4 * R * R), k = 1 / (s + 1);
  return [(y / R) * k, (x / R) * k, (s - 1) * k];
}

export function unitFromLatLon(lat, lon) {
  const a = lat * D2R, b = lon * D2R;
  return [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)];
}

// dem = { data: Int16Array (metres above R), n, off, scale (km/pix) }. Returns km above R, or NaN outside.
export function heightKm(dem, x, y) {
  const c = dem.off + x / dem.scale, r = dem.off - y / dem.scale;
  const c0 = Math.floor(c), r0 = Math.floor(r);
  if (c0 < 0 || r0 < 0 || c0 >= dem.n - 1 || r0 >= dem.n - 1) return NaN;
  const fc = c - c0, fr = r - r0, i = r0 * dem.n + c0, d = dem.data;
  return ((d[i] * (1 - fc) + d[i + 1] * fc) * (1 - fr) + (d[i + dem.n] * (1 - fc) + d[i + dem.n + 1] * fc) * fr) / 1000;
}

/** Decode the shipped DEM: gunzipped bytes = [low-byte plane][high-byte plane] of int16 row-wise deltas. */
export function decodeDem(bytes, n) {
  const N = n * n, out = new Int16Array(N);
  for (let r = 0; r < n; r++) {
    let acc = 0;
    for (let c = 0, i = r * n; c < n; c++, i++) {
      let d = bytes[i] | (bytes[N + i] << 8);
      if (d > 32767) d -= 65536;
      out[i] = acc += d;
    }
  }
  return out;
}

/** Local terrain slope (degrees) at a point: central differences over one DEM cell, corrected for the
 *  stereographic scale factor k = 1 + rho^2/4R^2 (map km = k x ground km). NaN outside the DEM. */
export function slopeDeg(dem, lat, lon) {
  const [x, y] = latlonToXY(lat, lon), d = dem.scale, k = 1 + (x * x + y * y) / (4 * R * R);
  const dx = (heightKm(dem, x + d, y) - heightKm(dem, x - d, y)) / (2 * d / k);
  const dy = (heightKm(dem, x, y + d) - heightKm(dem, x, y - d)) / (2 * d / k);
  return (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
}

/** Ground distance (km) from a point to the nearest set cell of a 0/1 mask on the DEM grid (e.g. permanently
 *  shadowed regions), searched out to maxKm; Infinity if none within reach, NaN outside the grid. */
export function nearestMaskKm(mask, grid, lat, lon, maxKm = 60) {
  const [x, y] = latlonToXY(lat, lon), c0 = grid.off + x / grid.scale, r0 = grid.off - y / grid.scale;
  if (c0 < 0 || r0 < 0 || c0 >= grid.n || r0 >= grid.n) return NaN;
  const k = 1 + (x * x + y * y) / (4 * R * R), rad = Math.ceil((maxKm * k) / grid.scale);
  let best = Infinity;
  for (let r = Math.max(0, Math.floor(r0 - rad)); r <= Math.min(grid.n - 1, Math.ceil(r0 + rad)); r++)
    for (let c = Math.max(0, Math.floor(c0 - rad)); c <= Math.min(grid.n - 1, Math.ceil(c0 + rad)); c++)
      if (mask[r * grid.n + c]) { const d2 = (r - r0) ** 2 + (c - c0) ** 2; if (d2 < best) best = d2; }
  const km = (Math.sqrt(best) * grid.scale) / k; // cell centre to point, map px -> ground km
  return km <= maxKm ? km : Infinity;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Local east/north/up at a surface point; azimuth measured from north, clockwise (through east).
export function makeSite(lat, lon, radiusKm) {
  const a = lat * D2R, b = lon * D2R;
  const up = unitFromLatLon(lat, lon);
  return {
    lat, lon, radiusKm, up,
    p: up.map((v) => v * radiusKm),
    east: [-Math.sin(b), Math.cos(b), 0],
    north: [-Math.sin(a) * Math.cos(b), -Math.sin(a) * Math.sin(b), Math.cos(a)],
  };
}

export const N_AZ = 720; // horizon bins of 0.5°

/** Terrain horizon: max elevation angle (deg) of terrain per azimuth bin, ray-marched over the DEM in 3D
 *  (curvature and projection distortion are exact because every sample is placed on the sphere).
 *  Outside DEM coverage -> smooth sphere (horizon = geometric dip for the observer height). */
export function computeHorizon(dem, lat, lon, { obsHeightM = 0, nRays = 1440, maxKm = 400 } = {}) {
  const [x0, y0] = latlonToXY(lat, lon);
  const h0 = dem ? heightKm(dem, x0, y0) : NaN;
  const terrain = !Number.isNaN(h0);
  const site = makeSite(lat, lon, R + (terrain ? h0 : 0) + obsHeightM / 1000);
  const dip = -Math.acos(R / site.radiusKm) * R2D;
  const el = new Float32Array(N_AZ).fill(terrain ? -90 : dip);
  let edgeKm = Infinity; // closest distance at which a ray left the DEM (terrain beyond is ignored)
  if (terrain) {
    const pix = dem.scale, { p, up, east, north } = site;
    const tanMax = new Float64Array(N_AZ).fill(-Infinity);
    for (let k = 0; k < nRays; k++) {
      const phi = (TAU * k) / nRays, dx = Math.sin(phi), dy = Math.cos(phi);
      for (let r = pix; r < maxKm; r += Math.max(0.5 * pix, r * 0.004)) {
        const x = x0 + dx * r, y = y0 + dy * r, h = heightKm(dem, x, y);
        if (Number.isNaN(h)) { if (r < edgeKm) edgeKm = r; break; }
        const u = unitFromXY(x, y), rad = R + h;
        const d = [u[0] * rad - p[0], u[1] * rad - p[1], u[2] * rad - p[2]];
        const de = dot(d, east), dn = dot(d, north), t = dot(d, up) / Math.hypot(de, dn);
        let a = Math.atan2(de, dn); if (a < 0) a += TAU;
        const bin = Math.floor((a / TAU) * N_AZ) % N_AZ;
        if (t > tanMax[bin]) tanMax[bin] = t;
      }
    }
    for (let i = 0; i < N_AZ; i++) el[i] = Math.atan(tanMax[i]) * R2D;
    // fill any bin no ray landed in (only happens very close to the site) from neighbours
    for (let i = 0; i < N_AZ; i++) if (!Number.isFinite(el[i]) || el[i] === -90) el[i] = Math.max(el[(i + N_AZ - 1) % N_AZ], el[(i + 1) % N_AZ]);
  }
  return { el, terrain, site, h0Km: terrain ? h0 : 0, obsHeightM, edgeKm };
}

const _hmax = new WeakMap(); // highest terrain in a DEM (km), for early ray termination
function demMaxKm(dem) {
  if (!_hmax.has(dem)) { let m = -Infinity; for (const v of dem.data) if (v > m) m = v; _hmax.set(dem, m / 1000); }
  return _hmax.get(dem);
}

/** Instantaneous sunlight on a map window centred at (x0,y0): visible fraction of the Sun's disc for an observer
 *  obsHeightM above the terrain of each cell. Same rule as the horizon method (disc fraction vs terrain angle), but one
 *  great-circle ray per cell straight toward the Sun's azimuth. sunDir = unit vector in MOON_ME (from sunDirAt).
 *  Returns { frac: Float32Array(n*n) row 0 = north edge (max y), NaN outside the DEM; n; cellKm }. */
export function sunlightMap(dem, sunDir, x0, y0, halfKm, cellKm, { obsHeightM = 0, maxKm = 400 } = {}) {
  const n = Math.round((2 * halfKm) / cellKm) + 1, frac = new Float32Array(n * n);
  const rSun = SUN_RADIUS_DEG * D2R, hmax = demMaxKm(dem), pix = dem.scale, obs = obsHeightM / 1000;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 - halfKm + i * cellKm, y = y0 + halfKm - j * cellKm, h = heightKm(dem, x, y), k = j * n + i;
      if (Number.isNaN(h)) { frac[k] = NaN; continue; }
      const u = unitFromXY(x, y), hP = h + obs, rad = R + hP;
      const sinEl = dot(sunDir, u), el = Math.asin(sinEl);
      if (el < -0.12) { frac[k] = 0; continue; } // > 6.9° below the geometric horizon: no terrain dip can reveal it
      const hd = [sunDir[0] - sinEl * u[0], sunDir[1] - sinEl * u[1], sunDir[2] - sinEl * u[2]];
      const hn = Math.hypot(hd[0], hd[1], hd[2]); hd[0] /= hn; hd[1] /= hn; hd[2] /= hn;
      let maxT = -Infinity;
      const need = Math.tan(el - rSun);
      for (let d = pix; d < maxKm; d += Math.max(0.5 * pix, d * 0.004)) {
        // nothing farther can rise above both the current max and the Sun's lower limb -> done
        if ((hmax - hP - (d * d) / (2 * R)) / d < Math.max(maxT, need)) break;
        const th = d / R, c = Math.cos(th), s = Math.sin(th);
        const q0 = u[0] * c + hd[0] * s, q1 = u[1] * c + hd[1] * s, q2 = u[2] * c + hd[2] * s;
        const xq = (2 * R * q1) / (1 - q2), yq = (2 * R * q0) / (1 - q2), hq = heightKm(dem, xq, yq);
        if (Number.isNaN(hq)) break;
        const rq = R + hq, Dx = q0 * rq - u[0] * rad, Dy = q1 * rq - u[1] * rad, Dz = q2 * rq - u[2] * rad;
        const du = Dx * u[0] + Dy * u[1] + Dz * u[2], dh = Dx * hd[0] + Dy * hd[1] + Dz * hd[2];
        const t = du / dh; if (t > maxT) maxT = t;
      }
      frac[k] = discFraction((el - Math.atan(maxT)) / rSun);
    }
  }
  return { frac, n, cellKm };
}

/** Sun unit vector (MOON_ME) at time t. */
export function sunDirAt(eph, tMs) { interp(eph, tMs); return [_s[0], _s[1], _s[2]]; }

export const horizonAt = (hz, azDeg) => hz.el[Math.floor((((azDeg % 360) + 360) % 360) / (360 / N_AZ)) % N_AZ];

// Fraction of a disc of angular radius r visible above a locally flat horizon, d = (el - horizon)/r.
export function discFraction(d) {
  if (d >= 1) return 1;
  if (d <= -1) return 0;
  return 1 - (Math.acos(d) - d * Math.sqrt(1 - d * d)) / Math.PI;
}

// ephem = { f32: Float32Array rows of [sx,sy,sz, ex,ey,ez], t0: ms UTC, stepMs, rows }
export function ephemFrom(buffer, meta) {
  return { f32: new Float32Array(buffer), t0: Date.parse(meta.start_utc), stepMs: meta.step_hours * 3600e3, rows: meta.rows };
}
export const ephemEnd = (eph) => eph.t0 + (eph.rows - 1) * eph.stepMs;

const _s = [0, 0, 0], _e = [0, 0, 0];
function interp(eph, tMs) {
  const f = (tMs - eph.t0) / eph.stepMs;
  const i = Math.min(Math.max(Math.floor(f), 0), eph.rows - 2), w = f - i, a = eph.f32, o = i * 6;
  for (let k = 0; k < 3; k++) {
    _s[k] = a[o + k] * (1 - w) + a[o + 6 + k] * w;
    _e[k] = a[o + 3 + k] * (1 - w) + a[o + 9 + k] * w;
  }
  const n = Math.hypot(_s[0], _s[1], _s[2]);
  _s[0] /= n; _s[1] /= n; _s[2] /= n;
}

function azEl(site, d) {
  const de = dot(d, site.east), dn = dot(d, site.north), du = dot(d, site.up);
  let az = Math.atan2(de, dn) * R2D; if (az < 0) az += 360;
  return [az, Math.atan2(du, Math.hypot(de, dn)) * R2D];
}

/** Sun & Earth geometry at one instant for a horizon (from computeHorizon). */
export function stateAt(eph, hz, tMs) {
  interp(eph, tMs);
  const s = hz.site;
  const [sunAz, sunEl] = azEl(s, _s);
  const d = [_e[0] - s.p[0], _e[1] - s.p[1], _e[2] - s.p[2]];
  const dist = Math.hypot(d[0], d[1], d[2]);
  const [earthAz, earthEl] = azEl(s, d);
  const earthR = Math.asin(EARTH_RADIUS_KM / dist) * R2D;
  const sunHz = horizonAt(hz, sunAz), earthHz = horizonAt(hz, earthAz);
  return {
    t: tMs, sunAz, sunEl, sunHz, sunFrac: discFraction((sunEl - sunHz) / SUN_RADIUS_DEG),
    earthAz, earthEl, earthHz, earthR, earthFrac: discFraction((earthEl - earthHz) / earthR), earthDistKm: dist,
  };
}

/** Time series [t0, t1) at stepMin. Typed arrays so a year at 10 min stays cheap. */
export function series(eph, hz, t0, t1, stepMin = 10) {
  const n = Math.max(1, Math.floor((t1 - t0) / (stepMin * 60e3)));
  const out = { t0, stepMs: stepMin * 60e3, n, sunEl: new Float32Array(n), sunAz: new Float32Array(n), sunFrac: new Float32Array(n),
    earthEl: new Float32Array(n), earthAz: new Float32Array(n), earthFrac: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    const st = stateAt(eph, hz, t0 + i * out.stepMs);
    out.sunEl[i] = st.sunEl; out.sunAz[i] = st.sunAz; out.sunFrac[i] = st.sunFrac;
    out.earthEl[i] = st.earthEl; out.earthAz[i] = st.earthAz; out.earthFrac[i] = st.earthFrac;
  }
  return out;
}

// "Sunlit" / "Earth in view" = disc centre above local terrain (fraction >= 0.5).
export const LIT = 0.5;

// Longest run where pred holds. `cut` = a longest run is still going at the window END, so the real event may be longer.
// (A run touching the start is exact for the mission: it began before landing but the mission only lives from landing.)
function longestRun(n, pred) {
  let best = 0, cur = 0, start = 0, cut = false;
  for (let i = 0; i < n; i++) {
    if (pred(i)) { if (!cur) start = i; cur++; } else cur = 0;
    if (cur > best || (cur === best && cur && i === n - 1)) { best = cur; cut = i === n - 1; }
  }
  return { len: best, cut: best > 0 && cut };
}
function firstIndex(n, pred) { for (let i = 0; i < n; i++) if (pred(i)) return i; return -1; }

/** Planner metrics for a series. Durations in hours; -1 = does not happen inside the window. */
export function summarize(ser) {
  const { n, sunFrac, earthFrac, sunEl } = ser, h = ser.stepMs / 3600e3;
  let sun = 0, earth = 0, both = 0, frac = 0, elSum = 0;
  for (let i = 0; i < n; i++) {
    const s = sunFrac[i] >= LIT, e = earthFrac[i] >= LIT;
    sun += s; earth += e; both += s && e; frac += sunFrac[i]; if (s) elSum += sunEl[i];
  }
  const lit0 = sunFrac[0] >= LIT, view0 = earthFrac[0] >= LIT;
  const dark = longestRun(n, (i) => sunFrac[i] < LIT), gap = longestRun(n, (i) => earthFrac[i] < LIT);
  // VIPER planners' question: "how much is the Sun up while the Earth is down?" (power but no direct link),
  // and the worst case, neither Sun nor Earth (no power and no direct link).
  let sunNoEarth = 0; for (let i = 0; i < n; i++) sunNoEarth += sunFrac[i] >= LIT && earthFrac[i] < LIT;
  const blackout = longestRun(n, (i) => sunFrac[i] < LIT && earthFrac[i] < LIT);
  const nextSunChange = firstIndex(n, (i) => (sunFrac[i] >= LIT) !== lit0);
  const nextEarthChange = firstIndex(n, (i) => (earthFrac[i] >= LIT) !== view0);
  return {
    hours: n * h,
    sunPct: (100 * sun) / n, earthPct: (100 * earth) / n, bothPct: (100 * both) / n,
    meanDiscPct: (100 * frac) / n,
    meanSunElLit: sun ? elSum / sun : NaN,
    longestDarkH: dark.len * h, longestDarkCut: dark.cut,
    longestEarthGapH: gap.len * h, longestEarthGapCut: gap.cut,
    sunUpEarthDownH: sunNoEarth * h,
    longestBlackoutH: blackout.len * h, longestBlackoutCut: blackout.cut,
    sunHours: frac * h, // full-disc-equivalent hours of sunlight (sum of visible disc fraction x time)
    startsLit: lit0, startsInView: view0,
    sunChangeH: nextSunChange < 0 ? -1 : nextSunChange * h,     // hours until sunset (if lit) or sunrise (if dark)
    earthChangeH: nextEarthChange < 0 ? -1 : nextEarthChange * h,
  };
}

/** Landing-date scan: for each candidate landing time, % of the next `missionDays` with Sun AND Earth.
 *  Uses one fine series + prefix sums, so a year of candidates costs one pass. */
export function scanLandingDates(eph, hz, tStart, scanDays, missionDays, stepMin = 30, candStepH = 6) {
  const total = series(eph, hz, tStart, tStart + (scanDays + missionDays) * 86400e3, stepMin);
  const pre = new Float64Array(total.n + 1), preS = new Float64Array(total.n + 1);
  for (let i = 0; i < total.n; i++) {
    const s = total.sunFrac[i] >= LIT, e = total.earthFrac[i] >= LIT;
    pre[i + 1] = pre[i] + (s && e); preS[i + 1] = preS[i] + s;
  }
  const win = Math.round((missionDays * 86400e3) / total.stepMs), stride = Math.round((candStepH * 3600e3) / total.stepMs);
  const out = [];
  for (let i = 0; i + win <= total.n && i * total.stepMs < scanDays * 86400e3; i += stride)
    out.push({ t: tStart + i * total.stepMs, bothPct: (100 * (pre[i + win] - pre[i])) / win, sunPct: (100 * (preS[i + win] - preS[i])) / win, litAtLanding: total.sunFrac[i] >= LIT });
  return out;
}
