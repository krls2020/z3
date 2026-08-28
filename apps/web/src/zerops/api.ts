/**
 * Web's Zerops API surface. The Settings → Zerops panel and the Zerops
 * projects page import plain functions from here rather than a hook, so
 * this module owns one singleton `ZeropsApiClient` bound to whichever
 * credential — an account session or a pasted Integration Token — is
 * currently active, plus its `localStorage` persistence.
 * `apps/web/src/zerops/session.tsx` wraps the same singleton in a React
 * context for the sign-in UI; both paths write through the same store, so
 * either one signing in or out is immediately visible to the other.
 */

import {
  buildZeropsContainerUrl,
  categorizeZeropsService,
  clearZeropsCredential,
  DEFAULT_ZEROPS_API_BASE,
  parseZeropsCredential,
  saveZeropsCredential,
  summarizeZeropsServices,
  ZEROPS_CREDENTIAL_STORAGE_KEY,
  ZeropsApiClient,
  ZeropsApiError,
  type ZeropsCredential,
  type ZeropsProject,
  type ZeropsProjectOverview,
  type ZeropsService,
  type ZeropsServiceGroup,
  type ZeropsServiceSummary,
  type ZeropsStorageAdapter,
  type ZeropsVerticalAutoscaling,
} from "@t3tools/client-runtime/zerops";

export { ZeropsApiError, buildZeropsContainerUrl as buildContainerUrl };
export {
  categorizeZeropsService as categorizeService,
  summarizeZeropsServices as summarizeServices,
};
export type {
  ZeropsProject,
  ZeropsProjectOverview,
  ZeropsService,
  ZeropsServiceGroup,
  ZeropsServiceSummary,
  ZeropsVerticalAutoscaling,
};

const localStorageAdapter: ZeropsStorageAdapter = {
  get: (key) => {
    try {
      return Promise.resolve(window.localStorage.getItem(key));
    } catch {
      return Promise.resolve(null);
    }
  },
  set: (key, value) => {
    window.localStorage.setItem(key, value);
    return Promise.resolve();
  },
  remove: (key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Best-effort — nothing to surface if local storage is unavailable.
    }
    return Promise.resolve();
  },
};

const AUTH_CHANGE_EVENT = "zerops:auth-change";

/** Notify same-tab listeners; `storage` only fires in *other* tabs. */
function notify(): void {
  try {
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
  } catch {
    // Best-effort - a view that misses the signal still reads on next mount.
  }
}

/** The one Zerops API client for the whole web app. See the file doc-comment. */
export const zeropsClient = new ZeropsApiClient({
  onCredentialChange: async (credential) => {
    if (credential) await saveZeropsCredential(localStorageAdapter, credential);
    else await clearZeropsCredential(localStorageAdapter);
    notify();
  },
});

function reseedFromStorage(): void {
  let credential: ZeropsCredential | null = null;
  try {
    credential = parseZeropsCredential(window.localStorage.getItem(ZEROPS_CREDENTIAL_STORAGE_KEY));
  } catch {
    credential = null;
  }
  if (credential?.kind === "session") zeropsClient.restoreSession(credential.session);
  else if (credential?.kind === "token") zeropsClient.restoreToken(credential.token);
  else if (zeropsClient.credential) void zeropsClient.discardCredential();
}

// Seed the client synchronously at import time so `getToken()` (and anything
// reading `zeropsClient.credential`) is already correct on first render —
// no flash of "signed out" while `ZeropsSessionProvider`'s async restore
// effect (which re-validates against `/user/info`) is still running.
reseedFromStorage();

/**
 * Subscribes to credential changes from this tab (login, logout, `setToken`,
 * refresh, …) and from other tabs via the `storage` event. Named
 * `subscribeToken` for the existing consumers that only ever dealt with a
 * pasted token; it now fires for either credential kind.
 */
export function subscribeToken(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== ZEROPS_CREDENTIAL_STORAGE_KEY) return;
    reseedFromStorage();
    onChange();
  };
  window.addEventListener(AUTH_CHANGE_EVENT, onChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(AUTH_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
  };
}

/**
 * Truthy exactly when a usable credential (session or token) is active.
 * Historically this returned the raw pasted token; consumers only ever test
 * it for truthiness, so a session-backed sign-in returns a non-empty marker
 * rather than a real secret.
 */
export function getToken(): string | null {
  const credential = zeropsClient.credential;
  if (!credential) return null;
  return credential.kind === "token" ? credential.token : "session";
}

/** Saves a pasted Integration Token as the active credential. */
export function setToken(token: string): void {
  try {
    window.localStorage.setItem(
      ZEROPS_CREDENTIAL_STORAGE_KEY,
      JSON.stringify({ kind: "token", token } satisfies ZeropsCredential),
    );
  } catch (cause) {
    throw new ZeropsApiError(
      cause instanceof Error ? `Failed to save token: ${cause.message}` : "Failed to save token.",
    );
  }
  zeropsClient.restoreToken(token);
  notify();
}

/** Clears whichever credential (token or session) is currently active. */
export function clearToken(): void {
  try {
    window.localStorage.removeItem(ZEROPS_CREDENTIAL_STORAGE_KEY);
  } catch {
    // Best-effort — nothing to surface if local storage is unavailable.
  }
  void zeropsClient.discardCredential();
}

export async function fetchAllProjects(): Promise<ReadonlyArray<ZeropsProject>> {
  return zeropsClient.fetchAllProjects();
}

export async function fetchServices(projectId: string): Promise<ReadonlyArray<ZeropsService>> {
  return zeropsClient.fetchServices(projectId);
}

/**
 * Full detail for a project: identity, region, subdomain prefix, and every
 * service in its stack. A thin pass-through — see H-01 in
 * docs/internals/zerops/hacks.md for why this used to need more.
 */
export async function fetchProjectOverview(projectId: string): Promise<ZeropsProjectOverview> {
  return zeropsClient.fetchProjectOverview(projectId);
}

interface ZeropsUserDataEntry {
  readonly key: string;
  readonly content: string;
}

interface ZeropsUserDataResponse {
  readonly list?: ReadonlyArray<ZeropsUserDataEntry>;
}

/**
 * Reads a zcp service's `VSCODE_PASSWORD` straight from its user-data.
 * Verified live against `z3probe` (2026-08-27, see verified.md): the value
 * comes back unmasked in `content` — no `/reveal` call needed. This bypasses
 * `ZeropsApiClient`'s typed request surface with a raw authenticated
 * `fetch`, because that class exposes no generic request method for a new
 * caller in this file to build on — see hacks.md.
 */
export async function fetchZcpVscodePassword(serviceId: string): Promise<string> {
  const credential = zeropsClient.credential;
  if (!credential) {
    throw new ZeropsApiError("Sign in to Zerops first.");
  }
  const accessToken =
    credential.kind === "session" ? credential.session.accessToken : credential.token;

  let response: Response;
  try {
    response = await fetch(
      `${DEFAULT_ZEROPS_API_BASE}/api/rest/public/service-stack/${serviceId}/user-data`,
      { headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` } },
    );
  } catch (cause) {
    throw new ZeropsApiError(
      cause instanceof Error
        ? `Network error contacting Zerops: ${cause.message}`
        : "Network error contacting Zerops.",
    );
  }
  if (!response.ok) {
    throw new ZeropsApiError(
      response.status === 401
        ? "Your Zerops session has expired. Sign in again."
        : `Could not read this container's credentials (${response.status}).`,
      response.status,
    );
  }

  const body = (await response.json()) as ZeropsUserDataResponse;
  const password = body.list?.find((entry) => entry.key === "VSCODE_PASSWORD")?.content;
  if (!password) {
    throw new ZeropsApiError("This container has no VSCODE_PASSWORD set yet.");
  }
  return password;
}
