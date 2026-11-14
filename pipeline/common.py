# SI-assisted: written with Anthropic Claude (Claude Code) under the team's direction; reviewed and validated by the team (see README, 'Use of AI').
"""Shared helpers: LOLA polar stereographic grids (PDS3 IMG) and projection.

Projection (from PDS labels): polar stereographic, sphere R=1737.4 km, center lat -90, lon0=0,
planetocentric lat, east-positive lon, frame MOON_ME (DE421). 0-based grid index:
    col = OFFSET + x/scale,  row = OFFSET - y/scale   (verified in check_orientation.py: all 10 test craters -0.9..-3.4 km deep)
"""
from pathlib import Path
import numpy as np

R_KM = 1737.4
ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data_raw"


def load_dem_75s():
    """LDEM_75S_240M: float32 km above 1737.4 sphere, 3812x3812, offset 1905.5."""
    a = np.fromfile(RAW / "ldem_75s_240m_float.img", dtype="<f4").reshape(3812, 3812)
    return a, 1905.5, 0.240  # grid, projection offset (pix), scale (km/pix)


def load_avgvisib(earth=False):
    """Mazarico et al. 2011 average visibility (fraction of timesteps any part of disc visible)."""
    name = "AVGVISIB_65S_240M_201608" + ("_EARTH" if earth else "") + ".IMG"
    a = np.fromfile(RAW / name, dtype="<i2").reshape(6420, 6420).astype(np.float32) * 0.00004
    return a, 3209.5, 0.240


def latlon_to_xy(lat, lon):
    """South polar stereographic map coords (km). lat/lon degrees."""
    lat, lon = np.radians(lat), np.radians(lon)
    rho = 2 * R_KM * np.tan(np.pi / 4 + lat / 2)
    return rho * np.sin(lon), rho * np.cos(lon)


def xy_to_rowcol(x, y, off, scale):
    return off - y / scale, off + x / scale


def bilinear(grid, row, col):
    r0, c0 = int(np.floor(row)), int(np.floor(col))
    fr, fc = row - r0, col - c0
    g = grid[r0:r0 + 2, c0:c0 + 2]
    return (g[0, 0] * (1 - fr) * (1 - fc) + g[0, 1] * (1 - fr) * fc
            + g[1, 0] * fr * (1 - fc) + g[1, 1] * fr * fc)
