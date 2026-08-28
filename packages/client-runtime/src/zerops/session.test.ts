import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  clearZeropsSelection,
  loadZeropsSelection,
  loadZeropsCredential,
  saveZeropsSelection,
  saveZeropsCredential,
  type ZeropsStorageAdapter,
} from "./session.ts";

const store = new Map<string, string>();

const storage: ZeropsStorageAdapter = {
  get: (key) => Promise.resolve(store.get(key) ?? null),
  set: (key, value) => {
    store.set(key, value);
    return Promise.resolve();
  },
  remove: (key) => {
    store.delete(key);
    return Promise.resolve();
  },
};

beforeEach(() => {
  store.clear();
});

describe("session credential", () => {
  it("stores a complete Zerops session without persisting a rotated recovery code", async () => {
    await saveZeropsCredential(storage, {
      kind: "session",
      session: {
        accessToken: "access",
        refreshToken: "refresh",
        twoFAVerified: true,
        newRecoveryToken: "one-time-secret",
      },
    });

    await expect(loadZeropsCredential(storage)).resolves.toEqual({
      kind: "session",
      session: { accessToken: "access", refreshToken: "refresh", twoFAVerified: true },
    });
    expect([...store.values()].join(" ")).not.toContain("one-time-secret");
  });

  it("never restores a partial two-factor session as an authorized credential", async () => {
    await saveZeropsCredential(storage, {
      kind: "session",
      session: {
        accessToken: "partial",
        refreshToken: "refresh",
        twoFAMethods: ["TOTP"],
        twoFAVerified: false,
      },
    });

    await expect(loadZeropsCredential(storage)).resolves.toBeNull();
    expect(store.size).toBe(0);
  });

  it("stores and restores an integration token credential", async () => {
    await saveZeropsCredential(storage, { kind: "token", token: "int-token" });

    await expect(loadZeropsCredential(storage)).resolves.toEqual({
      kind: "token",
      token: "int-token",
    });
  });
});

describe("selection", () => {
  it("scopes the remembered organization and project to the signed-in user", async () => {
    await saveZeropsSelection(storage, {
      userId: "user-1",
      clientId: "client-1",
      projectId: "project-1",
    });

    await expect(loadZeropsSelection(storage, "user-1")).resolves.toEqual({
      userId: "user-1",
      clientId: "client-1",
      projectId: "project-1",
    });
    await expect(loadZeropsSelection(storage, "user-2")).resolves.toEqual({
      userId: "user-2",
      clientId: null,
      projectId: null,
    });

    await clearZeropsSelection(storage);
    await expect(loadZeropsSelection(storage, "user-1")).resolves.toEqual({
      userId: "user-1",
      clientId: null,
      projectId: null,
    });
  });
});
