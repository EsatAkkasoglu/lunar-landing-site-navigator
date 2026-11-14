# SI-assisted: written with Anthropic Claude (Claude Code) under the team's direction; reviewed and validated by the team (see README, 'Use of AI').
"""Gate 1: verify (lat,lon)->(row,col) orientation using crater depressions.
For each axis convention, measure (floor mean - rim annulus mean); the right one makes all craters deep.
Crater centers/diameters: IAU Gazetteer of Planetary Nomenclature (approximate is fine for this test)."""
import numpy as np
from common import load_dem_75s, latlon_to_xy, R_KM

CRATERS = {  # name: (lat, lon_east, diameter_km)
    "Shackleton": (-89.67, 129.78, 21), "Haworth": (-87.45, -4.94, 51), "Shoemaker": (-88.14, 44.91, 51),
    "Faustini": (-87.18, 84.31, 39), "Amundsen": (-84.44, 85.06, 103), "de Gerlache": (-88.5, -87.1, 32),
    "Nobile": (-85.2, 53.5, 73), "Cabeus": (-84.9, -35.5, 98), "Sverdrup": (-88.5, -152.0, 33),
    "Malapert": (-84.9, 12.9, 69),
}
dem, off, sc = load_dem_75s()
n = dem.shape[0]
rr, cc = np.mgrid[0:n, 0:n]

def depth(row, col, rad_pix):
    d = np.hypot(rr - row, cc - col)
    return dem[d < 0.3 * rad_pix].mean() - dem[(d > 1.2 * rad_pix) & (d < 1.6 * rad_pix)].mean()

for swap in (False, True):
    for sx in (1, -1):
        for sy in (1, -1):
            ds = []
            for lat, lon, D in CRATERS.values():
                x, y = latlon_to_xy(lat, lon)
                x, y = sx * x, sy * y
                if swap: x, y = y, x
                ds.append(depth(off - y / sc, off + x / sc, D / 2 / sc))
            print(f"swap={swap!s:5} sx={sx:+d} sy={sy:+d}  mean={np.mean(ds):+.2f} km  max={np.max(ds):+.2f}  "
                  + " ".join(f"{v:+.1f}" for v in ds))
