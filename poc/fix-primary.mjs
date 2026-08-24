import { readFileSync, writeFileSync } from "node:fs";
const p = "packages/shared/src/themePalettes.ts";
let s = readFileSync(p, "utf8");
const start = s.indexOf("export const ZEROPS_THEME");
const end = s.indexOf("\n};", start) + 3;
let block = s.slice(start, end);

const TEAL = "oklch(0.683663 0.120516 184.935)"; // #00b1a3
const TEAL_HOVER = "oklch(0.615000 0.115000 184.935)";
const TEAL_BRIGHT = "oklch(0.810765 0.141718 186.761)"; // #00ded0
const TEAL_BRIGHT_HOVER = "oklch(0.755000 0.135000 186.761)";

// messageAction drives --primary (the filled button). Light variant first, dark second.
let i = 0;
block = block.replace(
  /(messageAction: )"oklch\([^)]+\)"/g,
  (m, p1) => `${p1}"${++i === 1 ? TEAL : TEAL_BRIGHT}"`,
);
let j = 0;
block = block.replace(
  /(messageActionHover: )"oklch\([^)]+\)"/g,
  (m, p1) => `${p1}"${++j === 1 ? TEAL_HOVER : TEAL_BRIGHT_HOVER}"`,
);
// keep readable text on the teal button
let k = 0;
block = block.replace(
  /(messageActionForeground: )"oklch\([^)]+\)"/g,
  (m, p1) =>
    `${p1}"${++k === 1 ? "oklch(0.990339 0.008411 325.64)" : "oklch(0.185000 0.020000 190.000)"}"`,
);

s = s.slice(0, start) + block + s.slice(end);
writeFileSync(p, s);
console.log(`messageAction:${i} hover:${j} fg:${k}`);
