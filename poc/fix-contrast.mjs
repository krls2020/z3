import { readFileSync, writeFileSync } from "node:fs";
const p = "packages/shared/src/themePalettes.ts";
let s = readFileSync(p, "utf8");
const start = s.indexOf("export const ZEROPS_THEME");
const end = s.indexOf("\n};", start) + 3;
let block = s.slice(start, end);

// Light-mode filled buttons put white on the brand teal, which measures
// 2.61:1 - below WCAG AA. Deepen the light action shade until white passes
// (4.82:1 at L=0.520). The dark variant already measures 10.89:1, leave it.
const LIGHT_ACTION = "oklch(0.520000 0.120516 184.935)";
const LIGHT_ACTION_HOVER = "oklch(0.470000 0.115000 184.935)";

let i = 0;
block = block.replace(/(messageAction: )"oklch\([^)]+\)"/g, (m, p1) =>
  ++i === 1 ? `${p1}"${LIGHT_ACTION}"` : m,
);
let j = 0;
block = block.replace(/(messageActionHover: )"oklch\([^)]+\)"/g, (m, p1) =>
  ++j === 1 ? `${p1}"${LIGHT_ACTION_HOVER}"` : m,
);

s = s.slice(0, start) + block + s.slice(end);
writeFileSync(p, s);
console.log(`light action patched (messageAction:${i} hover:${j})`);

// keep the boot mirror's light accent in step with the theme
const h = "apps/web/index.html";
let hs = readFileSync(h, "utf8");
hs = hs.replace('accent: "oklch(0.683663 0.120516 184.935)"', `accent: "${LIGHT_ACTION}"`);
writeFileSync(h, hs);
console.log("boot mirror light accent synced");
