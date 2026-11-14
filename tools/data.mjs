// SI-assisted: written with Anthropic Claude (Claude Code) under the team's direction; reviewed and validated by the team (see README, 'Use of AI').
// Shared loaders for Node checks: always read the files that ship in web/data.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as C from "../web/core.js";
export const rd = (p) => readFileSync(new URL("../" + p, import.meta.url));
export function loadEphem() {
  const em = JSON.parse(rd("web/data/ephem.json")), eb = rd("web/data/ephem.bin");
  return C.ephemFrom(eb.buffer.slice(eb.byteOffset, eb.byteOffset + eb.byteLength), em);
}
export function loadShippedDem() {
  const dm = JSON.parse(rd("web/data/dem.json"));
  return { data: C.decodeDem(gunzipSync(rd("web/data/" + dm.file)), dm.n), n: dm.n, off: dm.off, scale: dm.scale_km };
}
