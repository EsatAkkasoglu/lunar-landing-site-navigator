// SI-assisted: written with Anthropic Claude (Claude Code) under the team's direction; reviewed and validated by the team (see README, 'Use of AI').
// Unit check: longest-run metrics and the "still running at the window end" flag in core.summarize.
import * as C from "../web/core.js";
const mk = (a) => ({ n: a.length, stepMs: 3600e3, sunFrac: Float32Array.from(a), earthFrac: Float32Array.from(a), sunEl: new Float32Array(a.length) });
let fail = 0;
for (const [a, exp] of [[[1,0,0,1,0],[2,false]], [[1,1,0,0,0],[3,true]], [[0,0,1,0,0,0,1],[3,false]], [[0,0,0,1,0,0],[3,false]], [[1,1,1],[0,false]], [[1,0,0,1,0,0],[2,true]]]) {
  const s = C.summarize(mk(a)), got = [s.longestDarkH, s.longestDarkCut];
  if (JSON.stringify(got) !== JSON.stringify(exp)) { fail++; console.log("FAIL", a, got, exp); }
}
console.log(fail ? "FAIL" : "PASS: summarize longest-run + edge flags"); process.exit(fail ? 1 : 0);
