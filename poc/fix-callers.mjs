import { readFileSync, writeFileSync } from "node:fs";
for (const p of [
  "apps/web/src/components/settings/ZeropsSettings.tsx",
  "apps/web/src/components/zerops/ZeropsProjectsPage.tsx",
]) {
  let s = readFileSync(p, "utf8");
  s = s.replace(/^\s*fetchClientId,\n/m, "  fetchAllProjects,\n");
  s = s.replace(
    /const clientId = await fetchClientId\(\);\n(\s*)const (projects|list) = await fetchProjects\(clientId\);/,
    (m, indent, name) => `const ${name} = await fetchAllProjects();`,
  );
  // drop a now-unused fetchProjects import if nothing else uses it
  if (!/fetchProjects\(/.test(s)) s = s.replace(/^\s*fetchProjects,\n/m, "");
  writeFileSync(p, s);
  console.log(
    `${p.split("/").pop()}: ${/fetchAllProjects\(\)/.test(s) ? "switched" : "NOT SWITCHED"}`,
  );
}
