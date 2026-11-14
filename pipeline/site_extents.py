# SI-assisted: written with Anthropic Claude (Claude Code) under the team's direction; reviewed and validated by the team (see README, 'Use of AI').
"""Read GeoTIFF georeferencing (tiepoint + pixel scale + size) from the first 64 KB of each PGDA site DEM
(Barker et al. 2021, LOLA 5 m/px, south polar stereographic metres, MOON_ME DE421) -> tile extents in km."""
import struct, json, sys
from common import RAW

def tags(path):
    b = open(path, "rb").read()
    e = "<" if b[:2] == b"II" else ">"
    off = struct.unpack(e + "I", b[4:8])[0]
    n = struct.unpack(e + "H", b[off:off + 2])[0]
    out = {}
    size = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8}
    fmt = {1: "B", 2: "c", 3: "H", 4: "I", 5: "II", 11: "f", 12: "d", 16: "Q"}
    for i in range(n):
        t, typ, cnt, val = struct.unpack(e + "HHI4s", b[off + 2 + 12 * i: off + 14 + 12 * i])
        nbytes = size[typ] * cnt
        data = val if nbytes <= 4 else b[struct.unpack(e + "I", val)[0]:][:nbytes]
        if typ in (12, 3, 4, 11):
            out[t] = struct.unpack(e + fmt[typ] * cnt, data[:nbytes])
    return out

res = {}
for s in ["Site01", "Site04", "Site06", "Site07", "Site11", "Site20", "Site23", "Site42"]:
    t = tags(RAW / "sitehdr" / f"{s}.tif")
    w, h = t[256][0], t[257][0]
    sx, sy = t[33550][:2]
    i, j, _, X, Y, _ = t[33922][:6]
    x0, y0 = X - i * sx, Y - j * sy
    res[s] = {"xmin_km": x0 / 1000, "xmax_km": (x0 + w * sx) / 1000, "ymax_km": y0 / 1000, "ymin_km": (y0 - h * sy) / 1000, "px": [w, h], "scale_m": sx}
    print(s, {k: round(v, 3) if isinstance(v, float) else v for k, v in res[s].items()})
json.dump(res, open(RAW / "sitehdr" / "extents.json", "w"), indent=1)
