import { readFileSync, writeFileSync } from "node:fs";
const edit = (path, pairs) => {
  let s = readFileSync(path, "utf8");
  let n = 0;
  for (const [from, to] of pairs) {
    if (typeof from === "string") {
      if (!s.includes(from)) {
        console.log(`  MISS ${path}: ${from.slice(0, 60)}`);
        continue;
      }
      s = s.split(from).join(to);
      n++;
    } else {
      const before = s;
      s = s.replace(from, to);
      if (s !== before) n++;
      else console.log(`  MISS re ${path}`);
    }
  }
  writeFileSync(path, s);
  console.log(`${path}: ${n} edits`);
};

// A. re-export the new built-in theme
edit("apps/web/src/themePalette.ts", [
  [
    "  T3_CHAT_THEME,\n  THEME_COLOR_ROLES,",
    "  T3_CHAT_THEME,\n  THEME_COLOR_ROLES,\n  ZEROPS_THEME,",
  ],
  [
    "export { EMBER_THEME, GROVE_THEME, IRIS_THEME, OCEAN_THEME, T3_CHAT_THEME, THEME_COLOR_ROLES };",
    "export { EMBER_THEME, GROVE_THEME, IRIS_THEME, OCEAN_THEME, T3_CHAT_THEME, THEME_COLOR_ROLES, ZEROPS_THEME };",
  ],
  [
    'export const T3_CHAT_THEME_ID = "t3-chat" as const;',
    'export const ZEROPS_THEME_ID = "zerops" as const;\nexport const ZEROPS_THEME_LABEL = "Zerops";\nexport const T3_CHAT_THEME_ID = "t3-chat" as const;',
  ],
]);

// B. product name
edit("apps/web/src/branding.ts", [['?? "T3 Code";', '?? "Zerops";']]);

// C. web shell
edit("apps/web/index.html", [
  ["<title>T3 Code (Alpha)</title>", "<title>Zerops</title>"],
  [
    '<meta name="theme-color" content="#0a0a0a" />',
    '<meta name="theme-color" content="#00100f" />',
  ],
  [
    '<link rel="icon" href="/favicon.ico" sizes="48x48" />',
    '<link rel="icon" href="/zerops-mark.svg" type="image/svg+xml" />\n    <link rel="icon" href="/favicon.ico" sizes="48x48" />',
  ],
]);

// D. splash screen artwork
edit("apps/web/src/components/SplashScreen.tsx", [
  ['aria-label="T3 Code splash screen"', 'aria-label="Zerops splash screen"'],
  [
    '<img alt="T3 Code" className="size-16 object-contain" src="/apple-touch-icon.png" />',
    '<img alt="Zerops" className="size-16 object-contain" src="/zerops-mark.svg" />',
  ],
]);

// E. connection labels
edit("apps/web/src/connection/platform.ts", [
  ['desktop ? "T3 Code Desktop" : "T3 Code Web"', 'desktop ? "Zerops Desktop" : "Zerops Web"'],
]);
