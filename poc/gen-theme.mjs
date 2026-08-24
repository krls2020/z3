import { readFileSync, writeFileSync } from "node:fs";
const src = readFileSync("packages/shared/src/themePalettes.ts", "utf8");
const start = src.indexOf("export const GROVE_THEME");
const end = src.indexOf("\n};", start) + 3;
let block = src.slice(start, end);

// Zerops exact accents (from frontend-legacy _theme.scss + logo scss)
const Z = {
  accent: "oklch(0.683663 0.120516 184.935)", // #00b1a3 logo secondary
  accentAlt: "oklch(0.726625 0.111204 186.798)", // #3cbdb2 logo main
  bright: "oklch(0.810765 0.141718 186.761)", // #00ded0
  success: "oklch(0.737429 0.211435 148.366)", // #00cc55 identityGreen
};

// Rotate GROVE's green hues (140-175) into the Zerops teal band (180-190),
// leaving reds/oranges/pinks untouched.
block = block.replace(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/g, (m, l, c, h) => {
  const hue = parseFloat(h);
  if (hue < 140 || hue > 175) return m;
  const nh = 180 + (hue - 140) * (10 / 35);
  return `oklch(${l} ${c} ${nh.toFixed(3)})`;
});

block = block
  .replace("export const GROVE_THEME", "export const ZEROPS_THEME")
  .replace(/id: "grove"/, 'id: "zerops"')
  .replace(/label: "Grove"/, 'label: "Zerops"')
  .replace(/\n  sidebarArtwork: true,/, "");

// Exact brand accents on the roles that carry identity, both variants.
for (const role of ["accent", "focus", "terminalCursor", "update"]) {
  block = block.replace(new RegExp(`(${role}: )"oklch\\([^)]+\\)"`, "g"), `$1"${Z.accent}"`);
}
// Dark variant reads better with the brighter teal: second occurrence wins per role.
for (const role of ["accent", "focus", "terminalCursor", "update"]) {
  const re = new RegExp(`(${role}: )"${Z.accent.replace(/[.()]/g, "\\$&")}"`, "g");
  let n = 0;
  block = block.replace(re, (m, p1) => (++n === 2 ? `${p1}"${Z.bright}"` : m));
}
writeFileSync("poc/zerops-theme.txt", block);
console.log("generated", block.length, "chars");
console.log(block.split("\n").slice(0, 12).join("\n"));
