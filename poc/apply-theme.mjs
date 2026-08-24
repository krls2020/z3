import { readFileSync, writeFileSync } from "node:fs";
const p = "packages/shared/src/themePalettes.ts";
let src = readFileSync(p, "utf8");
const block = readFileSync("poc/zerops-theme.txt", "utf8");

if (src.includes("ZEROPS_THEME")) {
  console.log("already applied");
  process.exit(0);
}

const anchor = "export const BUILT_IN_THEMES";
src = src.replace(anchor, `${block}\n\n${anchor}`);
src = src.replace(
  /export const BUILT_IN_THEMES: ReadonlyArray<ThemeDefinition> = \[\n  T3_CHAT_THEME,/,
  "export const BUILT_IN_THEMES: ReadonlyArray<ThemeDefinition> = [\n  ZEROPS_THEME,\n  T3_CHAT_THEME,",
);
writeFileSync(p, src);
console.log("themePalettes.ts patched");
