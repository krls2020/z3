import { readFileSync, writeFileSync } from "node:fs";
const a = "apps/web/src/zerops/api.ts";
let s = readFileSync(a, "utf8");

// /user/info has no top-level clientId. It returns clientUserList - one entry
// per organisation the user belongs to, and a user can be in several.
s = s.replace(
  /export async function fetchClientId\(\): Promise<string> \{[\s\S]*?\n\}/,
  `export interface ZeropsClient {
  readonly id: string;
  readonly name: string;
}

/**
 * The organisations this user belongs to.
 *
 * \`/user/info\` carries no top-level clientId: membership lives in
 * \`clientUserList\`, and a user can belong to more than one org, so callers
 * must handle a list rather than picking the first entry.
 */
export async function fetchClients(): Promise<ReadonlyArray<ZeropsClient>> {
  const info = await zeropsFetch<ZeropsUserInfoResponse>("/api/rest/public/user/info");
  const memberships = info.clientUserList ?? [];
  const clients = memberships
    .map((m) => ({
      id: m.clientId ?? m.client?.id ?? "",
      name: m.client?.accountName ?? "",
    }))
    .filter((c) => c.id.length > 0);
  if (clients.length === 0) {
    throw new ZeropsApiError("This Zerops account is not a member of any organisation.");
  }
  return clients;
}`,
);

// projects across every org, each row tagged with the org it came from
s = s.replace(
  /\/\*\* Projects owned by the given org[^\n]*\n(export async function fetchProjects\(clientId: string\): Promise<ReadonlyArray<ZeropsProject>> \{[\s\S]*?\n\})/,
  `/** Projects owned by the given org. Rows come back without service/subdomain info — resolve those per-project via \`fetchProjectDetail\` + \`fetchServices\`. */
$1

/** Projects across every org the user belongs to, tagged with their org. */
export async function fetchAllProjects(): Promise<ReadonlyArray<ZeropsProject>> {
  const clients = await fetchClients();
  const perClient = await Promise.all(
    clients.map(async (client) => {
      const projects = await fetchProjects(client.id);
      return projects.map((p) => ({ ...p, clientId: client.id, clientName: client.name }));
    }),
  );
  return perClient.flat();
}`,
);

// carry the org on the project row
s = s.replace(
  /export interface ZeropsProject \{\n  readonly id: string;\n  readonly name: string;\n  readonly status: string;/,
  `export interface ZeropsProject {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly clientId?: string;
  readonly clientName?: string;`,
);

// widen the user-info wire type
s = s.replace(
  /interface ZeropsUserInfoResponse \{[\s\S]*?\n\}/,
  `interface ZeropsUserInfoResponse {
  readonly clientUserList?: ReadonlyArray<{
    readonly clientId?: string;
    readonly client?: { readonly id?: string; readonly accountName?: string };
  }>;
}`,
);
writeFileSync(a, s);
console.log(
  "api.ts:",
  /fetchClients/.test(s) ? "fetchClients" : "MISSING",
  /fetchAllProjects/.test(s) ? "fetchAllProjects" : "MISSING",
  /clientUserList\?:/.test(s) ? "wire-type" : "MISSING",
);
