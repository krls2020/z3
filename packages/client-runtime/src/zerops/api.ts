/**
 * Zerops account client: login, TOTP/recovery, refresh, and the project
 * browsing calls both the web and mobile Settings → Zerops surfaces need.
 * Deliberately plain async/await (no Effect runtime) — this talks to the
 * Zerops REST API, not to a z3 server, so it doesn't belong in
 * `packages/contracts` and doesn't need the orchestration machinery.
 */

export const DEFAULT_ZEROPS_API_BASE = "https://api.app-prg1.zerops.io";

export interface ZeropsAuthSession {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: string;
  readonly expiresIn?: number;
  readonly userId?: string;
  readonly author?: {
    readonly authorType?: "BACKOFFICE" | "CLIENT";
  };
  readonly twoFAMethods?: ReadonlyArray<string>;
  readonly twoFAVerified?: boolean;
  readonly newRecoveryToken?: string;
}

/**
 * The two credential kinds `ZeropsApiClient` accepts. A `session` comes from
 * the account login flow (email/password, TOTP/recovery, refresh). A `token`
 * is a long-lived, org-scoped Integration Token pasted in directly — it has
 * no refresh, so a 401 against one means the token is bad, not that it needs
 * renewing. Callers of the fetch methods never branch on which kind is
 * active; only auth acquisition differs.
 */
export type ZeropsCredential =
  | { readonly kind: "session"; readonly session: ZeropsAuthSession }
  | { readonly kind: "token"; readonly token: string };

export interface ZeropsClientMembership {
  readonly id: string;
  readonly clientId?: string;
  readonly userId?: string;
  readonly status?: string;
  readonly roleCode?: string;
  readonly client?: {
    readonly id?: string;
    readonly accountName?: string;
    readonly companyName?: string;
  };
}

export interface ZeropsUser {
  readonly id: string;
  readonly email: string;
  readonly fullName?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly clientUserList?: ReadonlyArray<ZeropsClientMembership>;
  readonly twoFAMethods?: ReadonlyArray<string>;
}

export interface ZeropsClient {
  readonly id: string;
  readonly name: string;
  readonly membershipId: string;
  readonly roleCode?: string;
}

export interface ZeropsProject {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly clientId: string;
  readonly clientName: string;
}

export interface ZeropsServicePort {
  readonly port: number;
  readonly protocol?: string;
  readonly scheme?: string;
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

export interface ZeropsService {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly isSystem: boolean;
  readonly subdomainAccess?: boolean;
  readonly ports: ReadonlyArray<ZeropsServicePort>;
  readonly serviceStackTypeInfo: {
    readonly serviceStackTypeName: string;
    readonly serviceStackTypeVersionName: string;
    readonly serviceStackTypeCategory: string;
  };
  readonly currentAutoscaling?: {
    readonly verticalAutoscaling?: ZeropsVerticalAutoscaling;
  };
}

export type ZeropsServiceGroup = "runtimes" | "data" | "infrastructure";

export interface ZeropsServiceSummary {
  readonly runtimeCount: number;
  readonly dataCount: number;
  readonly infrastructureCount: number;
}

export interface ZeropsProjectOverview {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly subdomainPrefix?: string;
  /** The project's Zerops region (`"prg1"`, …), parsed from `publicZone`. See H-01. */
  readonly region?: string;
  readonly services: ReadonlyArray<ZeropsService>;
  readonly zcpService?: {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly url: string;
  };
}

interface ZeropsAuthResponse {
  readonly auth: ZeropsAuthSession;
  readonly user: ZeropsUser;
}

interface ZeropsProjectSearchResponse {
  readonly items?: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly status: string;
  }>;
}

interface ZeropsProjectDetailResponse {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly zeropsSubdomainHost?: string;
  readonly publicZone?: string;
}

interface ZeropsServiceStackResponse {
  readonly list?: ReadonlyArray<ZeropsService>;
}

type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

export class ZeropsApiError extends Error {
  readonly status: number | null;
  readonly code: string | null;

  constructor(message: string, status: number | null = null, code: string | null = null) {
    super(message);
    this.name = "ZeropsApiError";
    this.status = status;
    this.code = code;
  }
}

export function requiresZeropsTwoFactor(session: ZeropsAuthSession | null): boolean {
  return !!(
    session &&
    session.twoFAMethods &&
    session.twoFAMethods.length > 0 &&
    session.twoFAVerified !== true
  );
}

export function isZeropsAuthSession(value: unknown): value is ZeropsAuthSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<ZeropsAuthSession>;
  return typeof session.accessToken === "string" && session.accessToken.trim().length > 0;
}

export function isUsableZeropsSession(value: unknown): value is ZeropsAuthSession {
  return isZeropsAuthSession(value) && !requiresZeropsTwoFactor(value);
}

export function categorizeZeropsService(service: ZeropsService): ZeropsServiceGroup {
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

/** Compact per-project counts for a projects list, e.g. "4 runtimes · 2 data". */
export function summarizeZeropsServices(
  services: ReadonlyArray<ZeropsService>,
): ZeropsServiceSummary {
  const summary = { runtimeCount: 0, dataCount: 0, infrastructureCount: 0 };
  for (const service of services) {
    const group = categorizeZeropsService(service);
    if (group === "runtimes") summary.runtimeCount += 1;
    else if (group === "data") summary.dataCount += 1;
    else summary.infrastructureCount += 1;
  }
  return summary;
}

/**
 * Recovers the region (`"prg1"`, …) from a project's `publicZone`
 * (`"fte23….prg1-zerops.zone"`). H-01: a container URL used to hardcode
 * `prg1`, which broke every non-`prg1` project. `publicZone` is already part
 * of the project detail response both clients fetch, so this needs no extra
 * request. Returns `null` if the zone doesn't match the expected shape.
 */
export function zeropsRegionFromPublicZone(publicZone: string): string | null {
  const match = /\.([a-z0-9-]+)-zerops\.zone$/i.exec(publicZone);
  return match?.[1] ?? null;
}

export function buildZeropsContainerUrl(
  serviceName: string,
  subdomainPrefix: string,
  port: number,
  region: string,
): string {
  return `https://${serviceName}-${subdomainPrefix}-${port}.${region}.zerops.app`;
}

function findString(value: unknown, keys: ReadonlyArray<string>): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  for (const candidate of Object.values(record)) {
    const nested = findString(candidate, keys);
    if (nested) return nested;
  }
  return null;
}

async function apiErrorFromResponse(response: Response): Promise<ZeropsApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // An empty or non-JSON error response still has a useful HTTP status.
  }

  const code = findString(body, ["code", "errorCode"]);
  const backendMessage = findString(body, ["message", "detail", "description"]);
  const message =
    response.status === 401
      ? "Your Zerops session has expired. Sign in again."
      : response.status === 403
        ? "This Zerops account is not allowed to perform that action."
        : (backendMessage ?? `Zerops API request failed (${response.status}).`);
  return new ZeropsApiError(message, response.status, code);
}

function activeClientsFromUser(user: ZeropsUser): ReadonlyArray<ZeropsClient> {
  const seen = new Set<string>();
  const clients: ZeropsClient[] = [];
  for (const membership of user.clientUserList ?? []) {
    if (membership.status && membership.status !== "ACTIVE") continue;
    const id = membership.clientId ?? membership.client?.id ?? "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    clients.push({
      id,
      membershipId: membership.id,
      name: membership.client?.accountName ?? membership.client?.companyName ?? "Organization",
      ...(membership.roleCode ? { roleCode: membership.roleCode } : {}),
    });
  }
  return clients;
}

function credentialAccessToken(credential: ZeropsCredential): string {
  return credential.kind === "session" ? credential.session.accessToken : credential.token;
}

export interface ZeropsApiClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: FetchImplementation;
  readonly onCredentialChange?: (credential: ZeropsCredential | null) => Promise<void> | void;
}

/**
 * Zerops API client matching frontend-legacy's login, TOTP and refresh flow,
 * plus a non-expiring Integration Token as an alternative credential. The
 * caller owns persistence; this class owns request serialization so parallel
 * 401 responses result in exactly one refresh request.
 */
export class ZeropsApiClient {
  readonly #baseUrl: string;
  readonly #fetch: FetchImplementation;
  readonly #onCredentialChange: (credential: ZeropsCredential | null) => Promise<void> | void;
  #credential: ZeropsCredential | null = null;
  #refreshPromise: Promise<ZeropsAuthSession> | null = null;

  constructor(options: ZeropsApiClientOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? DEFAULT_ZEROPS_API_BASE).replace(/\/+$/, "");
    // Bound to globalThis on purpose: the browser's `fetch` is brand-checked
    // against Window, so storing the bare function and calling it as
    // `this.#fetch(...)` throws "Illegal invocation". React Native tolerates
    // the unbound form, which is why this survived the lift from mobile.
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#onCredentialChange = options.onCredentialChange ?? (() => undefined);
  }

  /** Non-null only when the active credential is an account session. */
  get session(): ZeropsAuthSession | null {
    return this.#credential?.kind === "session" ? this.#credential.session : null;
  }

  get credential(): ZeropsCredential | null {
    return this.#credential;
  }

  restoreSession(session: ZeropsAuthSession): void {
    this.#credential = { kind: "session", session };
  }

  restoreToken(token: string): void {
    this.#credential = { kind: "token", token };
  }

  async discardCredential(): Promise<void> {
    await this.#setCredential(null);
  }

  async login(email: string, password: string): Promise<ZeropsAuthResponse> {
    const response = await this.#request<ZeropsAuthResponse>(
      "/api/rest/public/auth/login",
      {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          password,
          // frontend-legacy submits the complete login form, including the
          // empty 2FA controls. Keep the request contract identical.
          totpCode: "",
          recoveryCode: "",
        }),
      },
      {
        authenticated: false,
        retryAfterRefresh: false,
        unauthorizedMessage: "Email or password is incorrect.",
      },
    );
    if (!isZeropsAuthSession(response.auth)) {
      throw new ZeropsApiError("Zerops returned an invalid login session.");
    }
    await this.#setSession(response.auth);
    return response;
  }

  async verifyTotp(token: string): Promise<ZeropsAuthSession> {
    if (!this.session || !requiresZeropsTwoFactor(this.session)) {
      throw new ZeropsApiError("Start a Zerops login before entering a two-factor code.");
    }
    const response = await this.#request<{
      readonly auth: ZeropsAuthSession;
      readonly newRecoveryToken?: string;
    }>(
      "/api/rest/public/2fa/totp/login",
      {
        method: "POST",
        body: JSON.stringify({ token: token.trim() }),
      },
      {
        authenticated: true,
        retryAfterRefresh: false,
        unauthorizedMessage: "The two-factor or recovery code was not accepted.",
      },
    );
    const session = response.newRecoveryToken
      ? { ...response.auth, newRecoveryToken: response.newRecoveryToken }
      : response.auth;
    if (!isUsableZeropsSession(session)) {
      await this.#setSession(null);
      throw new ZeropsApiError("Zerops returned an invalid two-factor session.");
    }
    await this.#setSession(session);
    return session;
  }

  async logout(): Promise<void> {
    try {
      // `/auth/logout` is a session operation. An Integration Token has no
      // server-side session to end — signing it out is purely local, so it
      // doesn't get invalidated for other holders of the same token.
      if (this.session) {
        await this.#request(
          "/api/rest/public/auth/logout",
          { method: "POST", body: JSON.stringify({}) },
          { authenticated: true, retryAfterRefresh: false },
        );
      }
    } finally {
      await this.#setCredential(null);
    }
  }

  async fetchUser(): Promise<ZeropsUser> {
    return this.#request<ZeropsUser>("/api/rest/public/user/info");
  }

  clientsFromUser(user: ZeropsUser): ReadonlyArray<ZeropsClient> {
    return activeClientsFromUser(user);
  }

  async fetchClients(): Promise<ReadonlyArray<ZeropsClient>> {
    const clients = activeClientsFromUser(await this.fetchUser());
    if (clients.length === 0) {
      throw new ZeropsApiError("This Zerops account has no active organization.");
    }
    return clients;
  }

  async fetchProjects(client: ZeropsClient): Promise<ReadonlyArray<ZeropsProject>> {
    const response = await this.#request<ZeropsProjectSearchResponse>(
      "/api/rest/public/project/search",
      {
        method: "POST",
        body: JSON.stringify({
          search: [{ name: "clientId", operator: "eq", value: client.id }],
        }),
      },
    );
    return (response.items ?? []).map((project) => ({
      ...project,
      clientId: client.id,
      clientName: client.name,
    }));
  }

  async fetchAllProjects(
    clients?: ReadonlyArray<ZeropsClient>,
  ): Promise<ReadonlyArray<ZeropsProject>> {
    const memberships = clients ?? (await this.fetchClients());
    const projects = await Promise.all(memberships.map((client) => this.fetchProjects(client)));
    return projects.flat();
  }

  async fetchServices(projectId: string): Promise<ReadonlyArray<ZeropsService>> {
    const response = await this.#request<ZeropsServiceStackResponse>(
      `/api/rest/public/project/${projectId}/service-stack`,
    );
    return response.list ?? [];
  }

  async fetchProjectOverview(projectId: string): Promise<ZeropsProjectOverview> {
    const [project, services] = await Promise.all([
      this.#request<ZeropsProjectDetailResponse>(`/api/rest/public/project/${projectId}`),
      this.fetchServices(projectId),
    ]);
    const region = project.publicZone ? zeropsRegionFromPublicZone(project.publicZone) : null;
    const zcp = services.find((service) => service.name === "zcp");
    const zcpPort = zcp?.ports[0]?.port;
    const zcpService =
      zcp && project.zeropsSubdomainHost && zcpPort && region
        ? {
            id: zcp.id,
            name: zcp.name,
            status: zcp.status,
            url: buildZeropsContainerUrl(zcp.name, project.zeropsSubdomainHost, zcpPort, region),
          }
        : undefined;

    return {
      id: project.id,
      name: project.name,
      status: project.status,
      services,
      ...(project.zeropsSubdomainHost ? { subdomainPrefix: project.zeropsSubdomainHost } : {}),
      ...(region ? { region } : {}),
      ...(zcpService ? { zcpService } : {}),
    };
  }

  async #setSession(session: ZeropsAuthSession | null): Promise<void> {
    await this.#setCredential(session ? { kind: "session", session } : null);
  }

  async #setCredential(credential: ZeropsCredential | null): Promise<void> {
    this.#credential = credential;
    await this.#onCredentialChange(credential);
  }

  async #refreshSession(): Promise<ZeropsAuthSession> {
    if (this.#refreshPromise) return this.#refreshPromise;
    const current = this.session;
    if (!current?.refreshToken) {
      await this.#setSession(null);
      throw new ZeropsApiError("Your Zerops session has expired. Sign in again.", 401);
    }

    this.#refreshPromise = (async () => {
      const response = await this.#fetch(`${this.#baseUrl}/api/rest/public/auth/refresh`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${current.accessToken}`,
        },
        body: JSON.stringify({ refreshTokenId: current.refreshToken }),
      });
      if (!response.ok) {
        const error = await apiErrorFromResponse(response);
        await this.#setSession(null);
        throw error;
      }
      const session = (await response.json()) as ZeropsAuthSession;
      if (!isUsableZeropsSession(session)) {
        await this.#setSession(null);
        throw new ZeropsApiError("Zerops returned an invalid refreshed session.", 401);
      }
      await this.#setSession(session);
      return session;
    })().finally(() => {
      this.#refreshPromise = null;
    });

    return this.#refreshPromise;
  }

  async #request<T = unknown>(
    path: string,
    init: RequestInit = {},
    options: {
      readonly authenticated: boolean;
      readonly retryAfterRefresh: boolean;
      readonly unauthorizedMessage?: string;
    } = {
      authenticated: true,
      retryAfterRefresh: true,
    },
  ): Promise<T> {
    const run = async () => {
      const credential = this.#credential;
      const response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
          ...(options.authenticated && credential
            ? { Authorization: `Bearer ${credentialAccessToken(credential)}` }
            : {}),
        },
      });
      return response;
    };

    let response: Response;
    try {
      response = await run();
      if (response.status === 401 && options.retryAfterRefresh) {
        const credential = this.#credential;
        // Only an account session can be refreshed. A bad Integration Token
        // (or a session with no refresh token) just signs the client out.
        if (credential?.kind === "session" && credential.session.refreshToken) {
          await this.#refreshSession();
          response = await run();
        }
        if (response.status === 401) await this.#setCredential(null);
      }
    } catch (cause) {
      if (cause instanceof ZeropsApiError) throw cause;
      throw new ZeropsApiError(
        cause instanceof Error
          ? `Network error contacting Zerops: ${cause.message}`
          : "Network error contacting Zerops.",
      );
    }

    if (!response.ok) {
      const error = await apiErrorFromResponse(response);
      if (response.status === 401 && options.unauthorizedMessage) {
        throw new ZeropsApiError(options.unauthorizedMessage, error.status, error.code);
      }
      throw error;
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}
