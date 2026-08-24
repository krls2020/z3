import { readFileSync, writeFileSync } from "node:fs";

// 1. Boot-time palette mirror must know "zerops", else the pre-React paint
//    falls back and flashes the wrong ground on cold load.
const h = "apps/web/index.html";
let s = readFileSync(h, "utf8");
if (!s.includes("zerops: {")) {
  s = s.replace(
    'const BUILT_IN_THEME_PALETTES = {\n          "t3-chat": {',
    `const BUILT_IN_THEME_PALETTES = {
          zerops: {
            light: {
              background: "oklch(0.972369 0.005497 184.900)",
              foreground: "oklch(0.222003 0.03479 328.979)",
              accent: "oklch(0.683663 0.120516 184.935)",
              chrome: "oklch(0.972369 0.005497 184.900)",
            },
            dark: {
              background: "oklch(0.260865 0.02152 186.500)",
              foreground: "oklch(0.990339 0.008411 325.64)",
              accent: "oklch(0.810765 0.141718 186.761)",
              chrome: "oklch(0.260865 0.02152 186.500)",
            },
          },
          "t3-chat": {`,
  );
  s = s.replace(
    'const RESERVED_THEME_IDS = [\n          "system",',
    'const RESERVED_THEME_IDS = [\n          "zerops",\n          "system",',
  );
  // splash accent should be the brand teal, not the stock indigo
  s = s.replace('accent: "#4f46e5"', 'accent: "#00b1a3"');
  s = s.replace('accent: "#818cf8"', 'accent: "#00ded0"');
  writeFileSync(h, s);
  console.log("index.html boot mirror patched");
} else console.log("boot mirror already patched");

// 2. Desktop shell has its OWN branding source; the web edit does not reach it.
const d = "apps/desktop/src/app/DesktopEnvironment.ts";
let ds = readFileSync(d, "utf8");
ds = ds.replace('const APP_BASE_NAME = "T3 Code";', 'const APP_BASE_NAME = "Zerops";');
writeFileSync(d, ds);
console.log(
  "desktop APP_BASE_NAME =",
  /const APP_BASE_NAME = "Zerops";/.test(ds) ? "Zerops" : "UNCHANGED",
);

// 3. RESERVED_THEME_IDS also lives in the TS copy - keep both in sync.
const t = "apps/web/src/themePalette.ts";
let ts = readFileSync(t, "utf8");
if (ts.includes('"t3-chat",') && !ts.includes('"zerops",')) {
  ts = ts.replace(/(RESERVED_THEME_IDS[^=]*=\s*\[\s*\n\s*)"system",/, '$1"zerops",\n  "system",');
  writeFileSync(t, ts);
}
console.log("themePalette RESERVED has zerops:", /"zerops",/.test(readFileSync(t, "utf8")));
