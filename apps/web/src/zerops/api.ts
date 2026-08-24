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

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch (cause) {
    throw new ZeropsApiError(
      cause instanceof Error ? `Failed to save token: ${cause.message}` : "Failed to save token.",
    );
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Best-effort — nothing to surface if local storage is unavailable.
  }
}

interface ZeropsUserInfoResponse {
  readonly clientId?: string;
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

interface ZeropsServicePort {
  readonly port: number;
  readonly scheme: string;
}

interface ZeropsServiceStackItem {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly subdomainAccess?: boolean;
  readonly ports: ReadonlyArray<ZeropsServicePort>;
}

interface ZeropsServiceStackResponse {
  readonly list: ReadonlyArray<ZeropsServiceStackItem>;
  readonly totalCount: number;
}

export interface ZeropsProject {
  readonly id: string;
  readonly name: string;
  readonly status: string;
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
export async function fetchClientId(): Promise<string> {
  const info = await zeropsFetch<ZeropsUserInfoResponse>("/api/rest/public/user/info");
  if (!info.clientId) {
    throw new ZeropsApiError("Zerops user info response did not include a clientId.");
  }
  return info.clientId;
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

export async function fetchProjectDetail(projectId: string): Promise<ZeropsProjectDetailResponse> {
  return zeropsFetch<ZeropsProjectDetailResponse>(`/api/rest/public/project/${projectId}`);
}

export async function fetchServices(
  projectId: string,
): Promise<ReadonlyArray<ZeropsServiceStackItem>> {
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
