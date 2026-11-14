# SI-assisted: written with Anthropic Claude (Claude Code) under the team's direction; reviewed and validated by the team (see README, 'Use of AI').
"""Export Sun direction + Earth position in the Moon body-fixed MOON_ME (DE421) frame -- same frame as LOLA DEMs.
Output web/data/ephem.bin: float32 rows [sun_ux, sun_uy, sun_uz, earth_x_km, earth_y_km, earth_z_km], Moon-centered,
z = north pole, x = lon 0 (mean Earth direction). Rows are UTC-spaced every STEP_H hours from START (UTC)."""
import json
import numpy as np
from skyfield.api import Loader, PlanetaryConstants
from common import ROOT, RAW

START, YEARS, STEP_H = (2024, 1, 1), 19, 2   # 19 yr > 18.6 yr nutation cycle (for validation vs Mazarico 2011)
load = Loader(RAW / "kernels")
ts = load.timescale()
eph = load("de421.bsp")
pc = PlanetaryConstants()
pc.read_text(load("moon_080317.tf"))
pc.read_text(load("pck00008.tpc"))
pc.read_binary(load("moon_pa_de421_1900-2050.bpc"))
frame = pc.build_frame_named("MOON_ME_DE421")

n = int(YEARS * 365.25 * 24 / STEP_H)
t = ts.utc(*START, hour=np.arange(n) * STEP_H)
moon = eph["moon"]
sun = moon.at(t).observe(eph["sun"]).frame_xyz(frame).km
earth = moon.at(t).observe(eph["earth"]).frame_xyz(frame).km
sun = sun / np.linalg.norm(sun, axis=0)
out = np.vstack([sun, earth]).T.astype("<f4")
(ROOT / "web" / "data").mkdir(parents=True, exist_ok=True)
out.tofile(ROOT / "web" / "data" / "ephem.bin")
meta = {"start_utc": "%04d-%02d-%02dT00:00:00Z" % START, "step_hours": STEP_H, "rows": n,
        "frame": "MOON_ME_DE421", "source": "JPL DE421 + moon_pa_de421_1900-2050.bpc via Skyfield",
        "si_note": "Produced by an SI-assisted pipeline (Anthropic Claude); values validated against JPL Horizons"}
(ROOT / "web" / "data" / "ephem.json").write_text(json.dumps(meta, indent=1))
print(meta, out.nbytes / 1e6, "MB")
# sanity: sub-Earth point should librate within ~+-8 deg of (0,0); Earth distance 356k-407k km
el = np.linalg.norm(earth, axis=0)
print("earth dist km", el.min().round(), el.max().round(),
      "sub-earth lat range", np.degrees(np.arcsin(earth[2] / el)).min().round(2), np.degrees(np.arcsin(earth[2] / el)).max().round(2),
      "lon range", np.degrees(np.arctan2(earth[1], earth[0])).min().round(2), np.degrees(np.arctan2(earth[1], earth[0])).max().round(2))
