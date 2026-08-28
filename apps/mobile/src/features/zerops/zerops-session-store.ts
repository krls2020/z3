/**
 * Mobile's storage backend for the shared Zerops session/selection
 * persistence in `@t3tools/client-runtime/zerops` — an Expo SecureStore
 * adapter, plus the mobile-shaped re-exports `ZeropsAuthProvider` uses.
 */
import * as SecureStore from "expo-secure-store";

import {
  clearZeropsCredential,
  clearZeropsSelection,
  loadZeropsCredential,
  loadZeropsSelection,
  saveZeropsCredential,
  saveZeropsSelection,
  type ZeropsCredential,
  type ZeropsSelection,
  type ZeropsStorageAdapter,
} from "@t3tools/client-runtime/zerops";

export type { ZeropsSelection };

const secureStoreAdapter: ZeropsStorageAdapter = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
};

export async function loadZeropsCredentialFromDevice(): Promise<ZeropsCredential | null> {
  return loadZeropsCredential(secureStoreAdapter);
}

export async function saveZeropsCredentialOnDevice(credential: ZeropsCredential): Promise<void> {
  await saveZeropsCredential(secureStoreAdapter, credential);
}

export async function clearZeropsCredentialOnDevice(): Promise<void> {
  await clearZeropsCredential(secureStoreAdapter);
}

export async function loadZeropsSelectionFromDevice(userId: string): Promise<ZeropsSelection> {
  return loadZeropsSelection(secureStoreAdapter, userId);
}

export async function saveZeropsSelectionOnDevice(selection: ZeropsSelection): Promise<void> {
  await saveZeropsSelection(secureStoreAdapter, selection);
}

export async function clearZeropsSelectionOnDevice(): Promise<void> {
  await clearZeropsSelection(secureStoreAdapter);
}
