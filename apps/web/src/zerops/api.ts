/**
 * Thin fetch-based client for the Zerops public REST API, used by the Settings
 * → Zerops panel to list the user's projects and derive their `zcp` container
 * URL. Deliberately plain async/await (no Effect runtime) — this is a small,
 * self-contained POC surface.
 */

const ZEROPS_API_BASE = "https://api.app-prg1.zerops.io";

/** Region used to derive container URLs. Zerops projects are single-region today. */
export const ZEROPS_REGION = "prg1";

const TOKEN_STORAGE_KEY = "zerops:api-token";

export class ZeropsApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ZeropsApiError";
    this.status = status;
  }
}

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

const TOKEN_CHANGE_EVENT = "zerops:token-change";

/** Notify same-tab listeners; `storage` only fires in *other* tabs. */
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
  } catch (cause) {
    throw new ZeropsApiError(
      cause instanceof Error ? `Failed to save token: ${cause.message}` : "Failed to save token.",
    );
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    emitTokenChange();
  } catch {
    // Best-effort — nothing to surface if local storage is unavailable.
  }
}

interface ZeropsUserInfoResponse {
  readonly clientUserList?: ReadonlyArray<{
    readonly clientId?: string;
    readonly client?: { readonly id?: string; readonly accountName?: string };
  }>;
}

interface ZeropsProjectSearchItem {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

interface ZeropsProjectSearchResponse {
  readonly totalHits: number;
  readonly items: ReadonlyArray<ZeropsProjectSearchItem>;
}

interface ZeropsProjectDetailResponse {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly zeropsSubdomainHost?: string;
}

export interface ZeropsServicePort {
  readonly port: number;
  readonly protocol?: string;
  readonly scheme?: string;
}

export interface ZeropsServiceStackTypeInfo {
  readonly serviceStackTypeName: string;
  readonly serviceStackTypeVersionName: string;
  readonly serviceStackTypeCategory: string;
}

export interface ZeropsResourceEnvelope {
  readonly cpuCoreCount: number;
  readonly memoryGBytes: number;
  readonly diskGBytes: number;
}

export interface ZeropsVerticalAutoscaling {
  readonly minResource: ZeropsResourceEnvelope;
  readonly maxResource: ZeropsResourceEnvelope;
  readonly cpuMode: string;
}

/** A service's live entry in a project's service-stack — one runtime, managed dependency, or system service. */
export interface ZeropsService {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly isSystem: boolean;
  readonly subdomainAccess?: boolean;
  readonly ports: ReadonlyArray<ZeropsServicePort>;
  readonly serviceStackTypeInfo: ZeropsServiceStackTypeInfo;
  readonly currentAutoscaling?: {
    readonly verticalAutoscaling?: ZeropsVerticalAutoscaling;
  };
}

interface ZeropsServiceStackResponse {
  readonly list: ReadonlyArray<ZeropsService>;
  readonly totalCount: number;
}

/** The three groups the Zerops projects page renders services into, derived from `serviceStackTypeCategory`. */
export type ZeropsServiceGroup = "runtimes" | "data" | "infrastructure";

/** `USER` → Runtimes, `STANDARD`/`OBJECT_STORAGE` → Data, everything else (`CORE`, `BUILD`, ...) → Infrastructure. */
export function categorizeService(service: ZeropsService): ZeropsServiceGroup {
  switch (service.serviceStackTypeInfo.serviceStackTypeCategory) {
    case "USER":
      return "runtimes";
    case "STANDARD":
    case "OBJECT_STORAGE":
      return "data";
    default:
      return "infrastructure";
  }
}

export interface ZeropsServiceSummary {
  readonly runtimeCount: number;
  readonly dataCount: number;
  readonly infrastructureCount: number;
}

/** Compact per-project counts for the projects list, e.g. "4 runtimes · 2 data". */
export function summarizeServices(services: ReadonlyArray<ZeropsService>): ZeropsServiceSummary {
  const summary = { runtimeCount: 0, dataCount: 0, infrastructureCount: 0 };
  for (const service of services) {
    const group = categorizeService(service);
    if (group === "runtimes") summary.runtimeCount += 1;
    else if (group === "data") summary.dataCount += 1;
    else summary.infrastructureCount += 1;
  }
  return summary;
}

export interface ZeropsProject {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly clientId?: string;
  readonly clientName?: string;
  readonly subdomainPrefix?: string;
  readonly zcpService?: {
    readonly name: string;
    readonly status: string;
    readonly url: string;
  };
}

async function zeropsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  if (!token) {
    throw new ZeropsApiError("No Zerops API token is set.");
  }

  let response: Response;
  try {
    response = await fetch(`${ZEROPS_API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (cause) {
    throw new ZeropsApiError(
      cause instanceof Error
        ? `Network error contacting Zerops: ${cause.message}`
        : "Network error contacting Zerops.",
    );
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ZeropsApiError(
        "Zerops rejected this token. It may be invalid or expired.",
        response.status,
      );
    }
    let detail = "";
    try {
      detail = (await response.text()).trim();
    } catch {
      // Body already consumed or unreadable — fall back to the status line only.
    }
    throw new ZeropsApiError(
      `Zerops API request failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

/** The org (client) id behind the current token. */
export interface ZeropsClient {
  readonly id: string;
  readonly name: string;
}

/**
 * The organisations this user belongs to.
 *
 * `/user/info` carries no top-level clientId: membership lives in
 * `clientUserList`, and a user can belong to more than one org, so callers
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
}

/** Projects owned by the given org. Rows come back without service/subdomain info — resolve those per-project via `fetchProjectDetail` + `fetchServices`. */
export async function fetchProjects(clientId: string): Promise<ReadonlyArray<ZeropsProject>> {
  const response = await zeropsFetch<ZeropsProjectSearchResponse>(
    "/api/rest/public/project/search",
    {
      method: "POST",
      body: JSON.stringify({
        search: [{ name: "clientId", operator: "eq", value: clientId }],
      }),
    },
  );
  return response.items.map((item) => ({
    id: item.id,
    name: item.name,
    status: item.status,
  }));
}

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
}

export async function fetchProjectDetail(projectId: string): Promise<ZeropsProjectDetailResponse> {
  return zeropsFetch<ZeropsProjectDetailResponse>(`/api/rest/public/project/${projectId}`);
}

export async function fetchServices(projectId: string): Promise<ReadonlyArray<ZeropsService>> {
  const response = await zeropsFetch<ZeropsServiceStackResponse>(
    `/api/rest/public/project/${projectId}/service-stack`,
  );
  return response.list;
}

/** `https://{serviceName}-{subdomainPrefix}-{port}.{ZEROPS_REGION}.zerops.app` */
export function buildContainerUrl(
  serviceName: string,
  subdomainPrefix: string,
  port: number,
): string {
  return `https://${serviceName}-${subdomainPrefix}-${port}.${ZEROPS_REGION}.zerops.app`;
}

/**
 * Resolves a project's `zcp` service (if any) and its derived container URL.
 * Returns the bare subdomain prefix alongside so callers can show it even
 * when there is no `zcp` service to link it to.
 */
export async function resolveProjectZcpService(
  projectId: string,
): Promise<Pick<ZeropsProject, "subdomainPrefix" | "zcpService">> {
  const [detail, services] = await Promise.all([
    fetchProjectDetail(projectId),
    fetchServices(projectId),
  ]);

  const subdomainPrefix = detail.zeropsSubdomainHost;
  const zcpServiceStack = services.find((service) => service.name === "zcp");
  const firstPort = zcpServiceStack?.ports[0]?.port;

  const zcpService =
    zcpServiceStack && subdomainPrefix && firstPort
      ? {
          name: zcpServiceStack.name,
          status: zcpServiceStack.status,
          url: buildContainerUrl(zcpServiceStack.name, subdomainPrefix, firstPort),
        }
      : undefined;

  return {
    ...(subdomainPrefix ? { subdomainPrefix } : {}),
    ...(zcpService ? { zcpService } : {}),
  };
}

export interface ZeropsProjectOverview {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly subdomainPrefix?: string;
  readonly services: ReadonlyArray<ZeropsService>;
}

/** Full detail for the Zerops projects page: project identity plus every service in its stack. */
export async function fetchProjectOverview(projectId: string): Promise<ZeropsProjectOverview> {
  const [detail, services] = await Promise.all([
    fetchProjectDetail(projectId),
    fetchServices(projectId),
  ]);

  return {
    id: detail.id,
    name: detail.name,
    status: detail.status,
    ...(detail.zeropsSubdomainHost ? { subdomainPrefix: detail.zeropsSubdomainHost } : {}),
    services,
  };
}
