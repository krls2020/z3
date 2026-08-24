import { converter, parse, formatCss } from "culori/fn";
import "culori/css";
const toOklch = converter("oklch");
const cols = {
  logoMain: "#3cbdb2",
  logoSecondary: "#00b1a3",
  identityAlpha: "#00ccbb",
  identityGreen: "#00cc55",
  identityLightGreen: "#00ded0",
  textGreen: "#00aea2",
  backgroundDark: "#00100f",
  background: "#eceff3",
  textWhite: "#e6e7ec",
  identityRed: "#cc0011",
  identityBlue: "#0077cc",
};
for (const [k, v] of Object.entries(cols)) {
  const c = toOklch(parse(v));
  console.log(
    `${k.padEnd(20)} ${v}  ->  oklch(${c.l.toFixed(6)} ${c.c.toFixed(6)} ${(c.h ?? 0).toFixed(3)})`,
  );
}
