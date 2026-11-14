# SI-assisted: written with Anthropic Claude (Claude Code) under the team's direction; reviewed and validated by the team (see README, 'Use of AI').
"""Convert LOLA LDEM_75S_240M to compact int16 grids + make map imagery.
- data_raw/dem75s_i16.bin : full 75S-90S grid (validation only, not shipped)
- web/data/dem.bin        : 80S-90S crop shipped to the browser (int16 metres above 1737.4 km sphere)
- web/data/hillshade.jpg, illum.jpg, earthvis.jpg : map layers on the same 80S crop grid
Mazarico et al. (2011) average Sun/Earth visibility maps (PGDA) are aligned to the same 240 m grid."""
import json
import numpy as np
from PIL import Image
from common import ROOT, RAW, load_dem_75s, load_avgvisib

dem, off, sc = load_dem_75s()
i16 = np.round(dem * 1000).astype("<i2")
i16.tofile(RAW / "dem75s_i16.bin")
(RAW / "dem75s_i16.json").write_text(json.dumps({"n": 3812, "off": 1905.5, "scale_km": sc}))

C0, N = 638, 2536                      # symmetric crop -> ~80.0S at edges, new offset 1267.5
crop = i16[C0:C0 + N, C0:C0 + N]
web = ROOT / "web" / "data"
crop.tofile(RAW / "dem80s_i16.bin")   # plain copy for byte-identity checks
# shipped file: gzip of [low-byte plane][high-byte plane] of row-wise int16 deltas (12.9 MB -> 6.2 MB); decoded by core.decodeDem
import gzip
dl = np.diff(crop, axis=1, prepend=0).astype("<i2").view(np.uint16)
(web / "dem.i16d").write_bytes(gzip.compress((dl & 255).astype(np.uint8).tobytes() + (dl >> 8).astype(np.uint8).tobytes(), 9))
(web / "dem.json").write_text(json.dumps({"n": N, "off": 1905.5 - C0, "scale_km": sc, "file": "dem.i16d",
    "encoding": "gzip( [low bytes plane][high bytes plane] of int16 row-wise deltas )",
    "units": "int16 metres above 1737.4 km sphere", "source": "LRO LOLA LDEM_75S_240M (PDS), cropped to ~80S-90S",
    "si_note": "Re-encoded by an SI-assisted pipeline (Anthropic Claude); decoded output verified identical to the source"}, indent=1))

# hillshade (sun from upper-left in map space), gentle vertical exaggeration
z = dem[C0:C0 + N, C0:C0 + N] * 1000
gy, gx = np.gradient(z, sc * 1000)
slope = np.arctan(np.hypot(gx, gy) * 2)
aspect = np.arctan2(-gx, gy)
az, alt = np.radians(315), np.radians(35)
hs = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
Image.fromarray((np.clip(hs, 0, 1) * 235 + 10).astype(np.uint8)).save(web / "hillshade.jpg", quality=82)

def colorize(v, rgb):  # blend hillshade with a colour ramp of v in [0,1]
    base = np.clip(hs, 0, 1)[..., None] * 0.55
    col = np.array(rgb, dtype=np.float32)[None, None, :] / 255
    img = base * (1 - v[..., None] * 0.85) + col * (v[..., None] ** 0.8) * 0.95
    return Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))

p0 = 3209.5 - (1905.5 - C0)            # same centre in the 65S grid
for earth, name, rgb in ((False, "illum.jpg", (255, 200, 60)), (True, "earthvis.jpg", (80, 170, 255))):
    v, voff, _ = load_avgvisib(earth)
    a = int(round(p0)); assert abs(p0 - a) < 1e-9
    colorize(v[a:a + N, a:a + N], rgb).save(web / name, quality=82)
print("ok", crop.shape, crop.min(), crop.max())
