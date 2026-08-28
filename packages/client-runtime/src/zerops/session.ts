/**
 * Persistence for a Zerops credential (and, for the account-login flow, the
 * remembered org/project selection), behind an injectable storage adapter so
 * mobile can back it with SecureStore and web with `localStorage` without
 * either owning the encoding.
 */

import { isUsableZeropsSession, isZeropsAuthSession, type ZeropsCredential } from "./api.ts";

/** The narrowest storage shape both backends satisfy — get/set/remove, async. */
export interface ZeropsStorageAdapter {
  readonly get: (key: string) => Promise<string | null>;
  readonly set: (key: string, value: string) => Promise<void>;
  readonly remove: (key: string) => Promise<void>;
}

export const ZEROPS_CREDENTIAL_STORAGE_KEY = "zerops-code.zerops-credential.v1";
const ZEROPS_SELECTION_STORAGE_KEY = "zerops-code.zerops-selection.v1";

export interface ZeropsSelection {
  readonly userId: string;
  readonly clientId: string | null;
  readonly projectId: string | null;
}

function isZeropsCredential(value: unknown): value is ZeropsCredential {
  if (!value || typeof value !== "object") return false;
  const record = value as { kind?: unknown; session?: unknown; token?: unknown };
  if (record.kind === "session") return isZeropsAuthSession(record.session);
  if (record.kind === "token")
    return typeof record.token === "string" && record.token.trim().length > 0;
  return false;
}

function stripRecoveryToken(credential: ZeropsCredential): ZeropsCredential {
  if (credential.kind !== "session") return credential;
  // A newly rotated recovery token is a one-time secret shown by the UI. It
  // must not become a durable part of the regular persisted credential.
  const { newRecoveryToken: _newRecoveryToken, ...persistableSession } = credential.session;
  return { kind: "session", session: persistableSession };
}

/**
 * Parses a raw stored value into a usable credential, or `null` if it's
 * missing, corrupt, or (for a session) mid-2FA. A partial 2FA token is
 * deliberately memory-only: on restart the user starts a fresh login instead
 * of accidentally booting an authorized UI. Pure — no I/O — so a caller that
 * already has the raw string synchronously (e.g. web's `localStorage`, which
 * is synchronous) doesn't need to round-trip through the async adapter.
 */
export function parseZeropsCredential(raw: string | null): ZeropsCredential | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isZeropsCredential(parsed)) return null;
    if (parsed.kind === "session" && !isUsableZeropsSession(parsed.session)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function loadZeropsCredential(
  storage: ZeropsStorageAdapter,
): Promise<ZeropsCredential | null> {
  const raw = await storage.get(ZEROPS_CREDENTIAL_STORAGE_KEY);
  const credential = parseZeropsCredential(raw);
  if (raw && !credential) {
    // Corrupt, outdated, or partial-2FA records are treated as signed out.
    await storage.remove(ZEROPS_CREDENTIAL_STORAGE_KEY);
  }
  return credential;
}

export async function saveZeropsCredential(
  storage: ZeropsStorageAdapter,
  credential: ZeropsCredential,
): Promise<void> {
  if (credential.kind === "session" && !isUsableZeropsSession(credential.session)) {
    await clearZeropsCredential(storage);
    return;
  }
  await storage.set(ZEROPS_CREDENTIAL_STORAGE_KEY, JSON.stringify(stripRecoveryToken(credential)));
}

export async function clearZeropsCredential(storage: ZeropsStorageAdapter): Promise<void> {
  await storage.remove(ZEROPS_CREDENTIAL_STORAGE_KEY);
}

function parseSelection(value: unknown): ZeropsSelection | null {
  if (!value || typeof value !== "object") return null;
  const selection = value as Partial<ZeropsSelection>;
  if (typeof selection.userId !== "string" || !selection.userId) return null;
  if (selection.clientId !== null && typeof selection.clientId !== "string") return null;
  if (selection.projectId !== null && typeof selection.projectId !== "string") return null;
  return {
    userId: selection.userId,
    clientId: selection.clientId ?? null,
    projectId: selection.projectId ?? null,
  };
}

export async function loadZeropsSelection(
  storage: ZeropsStorageAdapter,
  userId: string,
): Promise<ZeropsSelection> {
  const fallback: ZeropsSelection = { userId, clientId: null, projectId: null };
  const raw = await storage.get(ZEROPS_SELECTION_STORAGE_KEY);
  if (!raw) return fallback;
  try {
    const selection = parseSelection(JSON.parse(raw));
    return selection?.userId === userId ? selection : fallback;
  } catch {
    return fallback;
  }
}

export async function saveZeropsSelection(
  storage: ZeropsStorageAdapter,
  selection: ZeropsSelection,
): Promise<void> {
  await storage.set(ZEROPS_SELECTION_STORAGE_KEY, JSON.stringify(selection));
}

export async function clearZeropsSelection(storage: ZeropsStorageAdapter): Promise<void> {
  await storage.remove(ZEROPS_SELECTION_STORAGE_KEY);
}
