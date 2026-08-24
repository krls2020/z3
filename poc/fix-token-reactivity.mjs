import { readFileSync, writeFileSync } from "node:fs";

// 1. api.ts: publish token changes so views can subscribe instead of
//    sampling once at mount.
const a = "apps/web/src/zerops/api.ts";
let s = readFileSync(a, "utf8");

if (!s.includes("subscribeToken")) {
  s = s.replace(
    /export function setToken\(token: string\): void \{\n  try \{\n    window\.localStorage\.setItem\(TOKEN_STORAGE_KEY, token\);\n/,
    `const TOKEN_CHANGE_EVENT = "zerops:token-change";

/** Notify same-tab listeners; \`storage\` only fires in *other* tabs. */
function emitTokenChange(): void {
  try {
    window.dispatchEvent(new Event(TOKEN_CHANGE_EVENT));
  } catch {
    // Best-effort - a view that misses the signal still reads on next mount.
  }
}

/** Subscribe to token changes from this tab and from other tabs. */
export function subscribeToken(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === TOKEN_STORAGE_KEY) onChange();
  };
  window.addEventListener(TOKEN_CHANGE_EVENT, onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(TOKEN_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    emitTokenChange();
`,
  );
  s = s.replace(
    /export function clearToken\(\): void \{\n  try \{\n    window\.localStorage\.removeItem\(TOKEN_STORAGE_KEY\);\n/,
    `export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    emitTokenChange();
`,
  );
  writeFileSync(a, s);
  console.log(
    "api.ts: subscribeToken added,",
    /emitTokenChange\(\);/g.test(s) ? "emitters wired" : "EMITTERS MISSING",
  );
} else console.log("api.ts already reactive");

// 2. the page subscribes instead of sampling once
const p = "apps/web/src/components/zerops/ZeropsProjectsPage.tsx";
let ps = readFileSync(p, "utf8");
ps = ps.replace(
  /  \/\/ Read once at mount[^\n]*\n(  \/\/[^\n]*\n)*  const \[token\] = useState<string \| null>\(\(\) => getToken\(\)\);/,
  `  // Subscribed, not sampled: the token is entered in Settings and this page
  // is reached by client-side navigation, so a mount-time read would show the
  // empty state until a hard reload.
  const token = useSyncExternalStore(subscribeToken, getToken, () => null);`,
);
if (!ps.includes("useSyncExternalStore")) {
  console.log("PAGE REPLACEMENT FAILED - inspect manually");
} else {
  ps = ps.replace(/(\n)import \{/, "$1import {");
  if (!/useSyncExternalStore[^\n]*from "react"/.test(ps)) {
    ps = ps.replace(/import \{([^}]*)\} from "react";/, (m, inner) => {
      const names = inner
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      if (!names.includes("useSyncExternalStore")) names.push("useSyncExternalStore");
      return `import { ${names.sort().join(", ")} } from "react";`;
    });
  }
  ps = ps.replace(/(\n\s*getToken,)/, "$1\n  subscribeToken,");
  writeFileSync(p, ps);
  console.log("page: subscribed via useSyncExternalStore");
}
