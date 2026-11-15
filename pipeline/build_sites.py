# SI-assisted: written with Anthropic Claude (Claude Code) under the team's direction; reviewed and validated by the team (see README, 'Use of AI').
"""Curated site list (web/data/sites.json). Every entry carries its source.
PGDA region tiles (Barker et al. 2021, 5 m/px LOLA site DEMs): the marker is placed at the pixel of highest
long-term solar illumination (Mazarico et al. 2011 map) inside the tile -- a documented, reproducible choice."""
import json, math
import numpy as np
from common import ROOT, RAW, load_avgvisib, R_KM

PGDA = "https://pgda.gsfc.nasa.gov/products/78"
ART = "region name listed in the NASA release 'NASA Provides Update on Artemis III Moon Landing Regions' (Oct 28, 2024); marker placed in the PGDA site tile of the same name"
tiles = {  # tile id: (display name, tag)
    "Site01": ("Connecting Ridge", None), "Site04": ("Shackleton Rim", None), "Site07": ("Peak near Shackleton", None),
    "Site11": ("de Gerlache Rim", None), "Site42": ("de Gerlache-Kocher Massif", None), "DM1": ("Amundsen Rim", None),
    "Site06": ("Nobile Rim 1", ART), "DM2": ("Nobile Rim 2", ART), "Site20": ("Mons Mouton Plateau (Leibnitz beta)", ART + "; Mons Mouton was informally Leibnitz Beta (NASA SVS 5074)"),
    "Site23": ("Malapert Massif", ART), "Haworth": ("Haworth", ART),
}
exec(open(ROOT / "pipeline" / "site_extents.py").read().split("res = {}")[0])  # reuse tags()
sun, off, sc = load_avgvisib(False)
sites = []
for tid, (name, tag) in tiles.items():
    t = tags(RAW / "sitehdr" / f"{tid}.tif")
    w, h = t[256][0], t[257][0]; s = t[33550][0]; i, j, _, X, Y, _ = t[33922][:6]
    x0, y0 = (X - i * s) / 1000, (Y - j * s) / 1000; x1, y1 = x0 + w * s / 1000, y0 - h * s / 1000
    c0, c1 = math.ceil(off + x0 / sc), math.floor(off + x1 / sc); r0, r1 = math.ceil(off - y0 / sc), math.floor(off - y1 / sc)
    win = sun[r0:r1 + 1, c0:c1 + 1]; rr, cc = np.unravel_index(np.argmax(win), win.shape)
    x, y = (c0 + cc - off) * sc, (off - (r0 + rr)) * sc
    rho = math.hypot(x, y); lat = math.degrees(2 * math.atan(rho / (2 * R_KM))) - 90; lon = math.degrees(math.atan2(x, y))
    sites.append({"id": tid, "name": name, "group": "Artemis candidate region (NASA 2024 list)" if tag else "South-pole ridge / rim",
        "lat": round(lat, 4), "lon": round(lon, 4),
        "source": f"PGDA high-res site tile {tid} (Barker et al. 2021); point = max long-term illumination in tile (Mazarico et al. 2011 map = {win.max():.2f})"
                  + (f"; {tag}" if tag else ""), "url": PGDA,
        "tile_km": [round(x0, 1), round(x1, 1), round(y1, 1), round(y0, 1)]})
sites += [
    {"id": "IM2", "name": "IM-2 Athena (landed 2025)", "group": "Landed mission", "lat": -84.7906, "lon": 29.1957,
     "source": "Reported landing site 84.7906 S, 29.1957 E (Wikipedia: IM-2); LROC gives the intended target -84.78, 29.13E, ~250 m away", "url": "https://en.wikipedia.org/wiki/IM-2"},
    {"id": "IM1", "name": "IM-1 Odysseus (landed 2024)", "group": "Landed mission", "lat": -80.13, "lon": 1.44,
     "source": "NASA LRO image of Odysseus: 80.13 S, 1.44 E", "url": "https://www.nasa.gov/missions/lro/nasas-lro-images-intuitive-machines-odysseus-lander/"},
    {"id": "CH3", "name": "Chandrayaan-3 Vikram (ISRO, 2023)", "group": "Landed mission", "lat": -69.373, "lon": 32.319,
     "source": "Statio Shiv Shakti, IAU-approved name; 69.373 S, 32.319 E", "url": "https://en.wikipedia.org/wiki/Statio_Shiv_Shakti"},
    {"id": "CE4", "name": "Chang'e-4 (CNSA, far side, 2019)", "group": "Landed mission", "lat": -45.457, "lon": 177.589,
     "source": "LROC 'Chang'e 4 Lander Coordinates': 45.457 S, 177.589 E (+-20 m)", "url": "https://www.lroc.asu.edu/posts/1087"},
    {"id": "A11", "name": "Apollo 11 (1969)", "group": "Landed mission", "lat": 0.67416, "lon": 23.47314,
     "source": "NASA NSSDCA Apollo 11 Lunar Module: 0.67416 N, 23.47314 E", "url": "https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1969-059C"},
]
(ROOT / "web" / "data" / "sites.json").write_text(json.dumps(sites, indent=1))
for s in sites: print(f"{s['id']:8} {s['lat']:9.4f} {s['lon']:9.4f}  {s['name']}")
