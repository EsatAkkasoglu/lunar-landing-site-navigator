// SI-assisted: written with Anthropic Claude (Claude Code) under the team's direction; reviewed and validated by the team (see README, 'Use of AI').
// Runs core.sunlightMap off the main thread so playback and hover never stall.
import * as C from "./core.js";
let dem = null;
onmessage = ({ data: m }) => {
  if (m.dem) { dem = m.dem; return; }
  const r = C.sunlightMap(dem, m.sunDir, m.x0, m.y0, m.half, m.cell, { obsHeightM: m.obs });
  postMessage({ req: m, frac: r.frac, n: r.n }, [r.frac.buffer]);
};
