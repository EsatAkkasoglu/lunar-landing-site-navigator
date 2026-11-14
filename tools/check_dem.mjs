// SI-assisted: written with Anthropic Claude (Claude Code) under the team's direction; reviewed and validated by the team (see README, 'Use of AI').
// Gate: shipped compressed DEM decodes byte-identical to the plain 80S crop.
import { loadShippedDem, rd } from "./data.mjs";
const dem = loadShippedDem(), raw = rd("data_raw/dem80s_i16.bin");
const ref = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
let bad = 0; for (let i = 0; i < ref.length; i++) if (ref[i] !== dem.data[i]) bad++;
console.log(bad ? `FAIL: ${bad} mismatches` : `PASS: ${ref.length} samples identical`); process.exit(bad ? 1 : 0);
