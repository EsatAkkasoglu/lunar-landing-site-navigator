# Lunar Landing Site Navigator

NASA Space Apps Challenge 2026: **Lunar Landing Site Navigator** challenge.

**Live app:** https://esatakkasoglu.github.io/lunar-landing-site-navigator/  
**Example comparison:** [Malapert vs Connecting Ridge vs Apollo 11, March 2027](https://esatakkasoglu.github.io/lunar-landing-site-navigator/#t=2027-03-10T12:00&d=21&m=5&pow=900:250&s=Site23,Site01,A11)

This is a browser tool for mission planners. You pick lunar south-pole landing sites and a landing date, and within seconds you see when each site has **sunlight** (power) and **Earth in view** (direct-to-Earth comms). The calculation uses the real terrain horizon from NASA LOLA topography and JPL ephemerides, and you can compare up to 4 sites side by side. The *"What if the landing slips?"* chart shows the outcome of every possible landing time over the next year.

## What it does
- **South-pole map**: LOLA shaded relief, with NASA's long-term sunlight and Earth-visibility maps as overlays. Click anywhere between 80°S and the pole to add a site.
- **Sky view**: the terrain horizon around the site (traced across the LOLA DEM) and the Sun and Earth paths for the whole surface mission. The Sun and Earth are drawn at their true angular size and are hidden by terrain the way they would be on the Moon.
- **Mission timeline**: Sun, Earth and both together, for every compared site, in 10-minute steps. Hover to scrub the sky view.
- **Compare table**: sunlit %, Earth in view %, both %, longest darkness (battery sizing), longest Earth blackout (relay need), time until sunset or Earthset at landing, and mean Sun elevation.
- **Landing-slip scan**: the share of the mission with both Sun and Earth, for each landing time over 12 months (6-hour steps). Click it to move the landing.
- **Live shadows**: the map shows which ground within 30 km of the site is sunlit at the selected moment.
- **Play**: animates the mission. The sky view, timeline cursor, shadow map and 3D view all move together.
- **3D terrain**: true-scale LOLA terrain lit by our own shadow model. The dark ring is the full terrain horizon. *Eye level* puts the camera at the lander's mast height.
- **Power budget**: you enter the array output in full Sun and the lander load. The table shows sun-hours, energy generated, energy balance, and the battery needed for the longest darkness. A night that runs past the mission window is marked "≥".
- **Mast height**: raise the solar array or antenna 0–20 m to see how much it gains over nearby terrain.
- **CSV export**: the 10-minute time series for all compared sites (UTC, az/el, terrain horizon, visible disc fraction, flags).
- **Shareable links**: the URL holds the sites, date, mission length, mast height and power inputs.

## How it works
1. **Ephemeris**: JPL DE421 with the Moon PA/ME kernels (Skyfield). Sun and Earth vectors are stored in the Moon body-fixed **MOON_ME** frame, the same frame the LOLA maps use, every 2 hours from 2024 to 2042. Libration is included.
2. **Terrain horizon**: from each site, 1,440 rays are traced over LOLA `LDEM_75S_240M` and the highest terrain angle is kept in each 0.5° of azimuth. Each terrain sample is placed on the sphere in 3D, so curvature and map distortion are exact. The Moon has no atmosphere, so there is no refraction.
3. **Visibility**: a body counts as visible when the centre of its disc is above the terrain horizon. The partial solar-disc fraction is also computed.
4. **Live shadows**: the same rule is applied to every map cell around the site, tracing one ray toward the Sun along the curved surface. The calculation runs in a Web Worker so playback stays smooth.
5. **Data size**: the shipped DEM is row-delta encoded and gzipped (12.9 → 6.2 MB). The browser decodes it with `DecompressionStream`, and the decoded data is checked byte-for-byte against the source.

All the geometry is in one file, `web/core.js`. The web page and the validation script both use this same code.

## Validation (`node tools/validate.mjs`, `tools/check_*.mjs`)
| Check | Result |
|---|---|
| Sun/Earth azimuth & elevation vs **JPL Horizons API** (120 comparisons, 3 sites incl. near-pole and Apollo 11, 2026–2028) | max error **0.0065°** (the Sun's radius is 0.27°) |
| 18.6-yr average sunlight vs **NASA PGDA map** (Mazarico et al. 2011), 60 points ≥85°S, randomly sampled within 5 illumination strata | mean abs. difference **0.58 %-points**, r = **0.9992** |
| 18.6-yr average Earth visibility vs **NASA PGDA map**, same points | mean abs. difference **0.53 %-points**, r = **0.998** |
| Live shadow map vs horizon method (`check_shadow.mjs`): 2,400 random point/time cases, 275 with the Sun within 1° of the terrain edge | **0** lit/dark disagreements; mean disc-fraction difference 0.0012 |
| Mast height (`check_mast.mjs`): 12 polar sites, 0→20 m | the horizon never rises and sunlit % never drops |
| Shipped compressed DEM (`check_dem.mjs`) | identical to the source, all 6,431,296 samples |
| Window-edge handling (`check_summary.mjs`) | unit tests pass |

The largest single difference is 5–7.5 %-points. A likely reason is that PGDA used an earlier LOLA DEM (2016) than ours (2017 V2.1). These results are reported as measured; nothing was tuned to fit. `tools/check_sites.mjs` repeats the PGDA comparison for every curated site.

## Data sources / references
- NASA LRO LOLA, `LDEM_75S_240M` (PDS Geosciences Node): https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/float_img/
- NASA GSFC PGDA, Lunar Polar Illumination (average Sun/Earth visibility): https://pgda.gsfc.nasa.gov/products/69. Mazarico, E., et al. (2011), Illumination conditions of the lunar polar regions using LOLA topography, *Icarus* 211, 1066–1081, doi:10.1016/j.icarus.2010.10.030.
- NASA GSFC PGDA, High-resolution LOLA topography for south-pole sites: https://pgda.gsfc.nasa.gov/products/78. Barker, M.K., et al. (2021), Improved LOLA Elevation Maps for South Pole Landing Sites: Error Estimates and Their Impact on Illumination Conditions, *Planetary & Space Science* 203, 105119, doi:10.1016/j.pss.2020.105119. Used to place the region markers.
- JPL NAIF SPICE kernels: DE421, `moon_pa_de421_1900-2050.bpc`, `moon_080317.tf`, `pck00008.tpc`.
- JPL Horizons API, used for validation: https://ssd.jpl.nasa.gov/horizons/
- NASA Artemis III candidate regions update (Oct 2024): https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/
- Landing-site coordinates: the source of each site is in `web/data/sites.json` and appears in the app on hover.
- Software: Skyfield, NumPy, Pillow (pipeline); Leaflet 1.9.4 (map); three.js 0.160 (3D view, loaded only when opened). Everything else is plain JavaScript.

## Use of AI (SI) tools
As the NASA Space Apps rules require, we acknowledge that this project was built with **Anthropic Claude (Claude Code)** as an AI assistant:
- **Research and planning:** comparing challenges and datasets, and proposing the approach and the feature list. The team chose the challenge, the mission-planner focus, and the features to build.
- **Code:** the data pipeline (`pipeline/`), the web app (`web/`) and the validation scripts (`tools/`). Every source file carries an `SI-assisted` header, and the data metadata (`web/data/*.json`) has an `si_note` field.
- **Documentation:** this README and the submission text.

Every scientific output is checked against independent NASA references, using the scripts listed in the Validation section. There are no AI-generated images, audio or video, and no NASA logos or branding.

## Run locally
```
python -m http.server 8765 --directory web     # then open http://localhost:8765
```
To rebuild the data from NASA sources, run:
```
sh pipeline/fetch.sh
pip install -r pipeline/requirements.txt
cd pipeline && python check_orientation.py && python build_ephem.py && python build_dem.py && python build_sites.py
cd .. && node tools/validate.mjs && node tools/check_shadow.mjs && node tools/check_sites.mjs && node tools/check_mast.mjs && node tools/check_dem.mjs && node tools/check_summary.mjs
```

## Limits
- At 240 m terrain resolution, features smaller than about 0.5 km are not resolved.
- Terrain covers 80°S to the pole. Sites outside it fall back to a smooth sphere, and the app labels them that way.
- Earth visibility is line of sight only. It does not model ground-station scheduling.
- The 3D mesh covers ±15 km. More distant terrain is represented by the horizon ring, which comes from the same validated horizon.
- Power assumes a Sun-tracking array whose output scales with the visible disc fraction. It ignores temperature, dust and degradation.
