import { readFileSync, writeFileSync } from "node:fs";

// 1. Sidebar wordmark: Zerops mark + "Zerops" label
const p = "apps/web/src/components/sidebar/SidebarChrome.tsx";
let s = readFileSync(p, "utf8");

const oldMark = s.slice(
  s.indexOf("function T3Wordmark() {"),
  s.indexOf("function SidebarUtilityItem"),
);
const newMark = `function T3Wordmark() {
  return (
    <svg
      aria-label="Zerops"
      className="h-4 w-auto shrink-0"
      viewBox="0 0 42.27 50.48"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(-.46 -.44)">
        <path
          d="M20.19.7L3 7.27A4 4 0 0 0 .46 11v16.54L8.36 23v-9.3L21.6 8.62V.44a4 4 0 0 0-1.41.26z"
          fill="currentColor"
        />
        <path
          d="M8.5 37.74l13.1-7.55v-9.12L1.36 32.74a1.82 1.82 0 0 0-.9 1.56v6.11A4 4 0 0 0 3 44.1l17.19 6.57a4 4 0 0 0 1.41.26v-8.18z"
          fill="currentColor"
        />
        <path
          d="M41.9 18.47a1.67 1.67 0 0 0 .84-1.47v-6a4 4 0 0 0-2.54-3.73L23 .7a4 4 0 0 0-1.4-.26v8.18l13 5-13 7.49v9.12z"
          fill="currentColor"
          opacity="0.6"
        />
        <path
          d="M23 50.67l17.2-6.57a4 4 0 0 0 2.54-3.69V23.7l-7.9 4.56v9.43L21.6 42.75v8.18a4 4 0 0 0 1.4-.26z"
          fill="currentColor"
          opacity="0.6"
        />
      </g>
    </svg>
  );
}

`;
s = s.replace(oldMark, newMark);
// the adjacent literal label
s = s.replace(/(\n        \)}\n      >\n        )Code(\n      <\/span>)/, "$1Zerops$2");
s = s.replace(/>\s*Code\s*<\/span>/, ">\n        Zerops\n      </span>");
writeFileSync(p, s);
console.log("SidebarChrome.tsx patched");

// 2. Default theme -> zerops
const t = "apps/web/src/hooks/useTheme.ts";
let ts = readFileSync(t, "utf8");
ts = ts.replace(
  /const DEFAULT_THEME_SNAPSHOT: ThemeSnapshot = \{\n  theme: "system",\n  systemDark: false,\n  followSystem: true,/,
  'const DEFAULT_THEME_SNAPSHOT: ThemeSnapshot = {\n  theme: "zerops",\n  systemDark: false,\n  followSystem: false,',
);
writeFileSync(t, ts);
console.log("useTheme.ts default =", /theme: "zerops"/.test(ts) ? "zerops" : "UNCHANGED");
