import { describe, expect, it, vi } from "vite-plus/test";

import {
  buildZeropsContainerUrl,
  categorizeZeropsService,
  requiresZeropsTwoFactor,
  zeropsRegionFromPublicZone,
  ZeropsApiClient,
  type ZeropsAuthSession,
  type ZeropsService,
} from "./api.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ZeropsApiClient authentication", () => {
  it("shows a credential error for a rejected password login", async () => {
    const client = new ZeropsApiClient({
      baseUrl: "https://api.example.test",
      fetch: async () => jsonResponse({ error: { code: "invalidCredentials" } }, 401),
    });

    await expect(client.login("person@example.com", "wrong")).rejects.toMatchObject({
      message: "Email or password is incorrect.",
      status: 401,
      code: "invalidCredentials",
    });
  });

  it("matches frontend-legacy's password and TOTP login contract", async () => {
    const partialSession: ZeropsAuthSession = {
      accessToken: "partial-access",
      refreshToken: "partial-refresh",
      twoFAMethods: ["TOTP"],
      twoFAVerified: false,
    };
    const fullSession: ZeropsAuthSession = {
      accessToken: "full-access",
      refreshToken: "full-refresh",
      twoFAVerified: true,
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/auth/login")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          email: "person@example.com",
          password: "password",
          totpCode: "",
          recoveryCode: "",
        });
        return jsonResponse({
          auth: partialSession,
          user: { id: "user-1", email: "person@example.com", clientUserList: [] },
        });
      }
      expect(url).toMatch(/\/2fa\/totp\/login$/);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer partial-access");
      expect(JSON.parse(String(init?.body))).toEqual({ token: "123456" });
      return jsonResponse({ auth: fullSession, newRecoveryToken: "rotated-recovery" });
    });
    const persisted: Array<ZeropsAuthSession | null> = [];
    const client = new ZeropsApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
      onCredentialChange: (credential) => {
        persisted.push(credential?.kind === "session" ? credential.session : null);
      },
    });

    const login = await client.login(" person@example.com ", "password");
    expect(requiresZeropsTwoFactor(login.auth)).toBe(true);
    expect(client.session).toEqual(partialSession);

    await client.verifyTotp(" 123456 ");
    expect(client.session).toEqual({ ...fullSession, newRecoveryToken: "rotated-recovery" });
    expect(persisted).toEqual([
      partialSession,
      { ...fullSession, newRecoveryToken: "rotated-recovery" },
    ]);
  });

  it("coalesces parallel 401 responses into one refresh and retries with the new token", async () => {
    let resolveRefresh: ((response: Response) => void) | null = null;
    let refreshCalls = 0;
    const authorizationHeaders: string[] = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit): Promise<Response> => {
      const authorization = new Headers(init?.headers).get("Authorization") ?? "";
      if (url.endsWith("/auth/refresh")) {
        refreshCalls += 1;
        expect(JSON.parse(String(init?.body))).toEqual({ refreshTokenId: "refresh-1" });
        return new Promise((resolve) => {
          resolveRefresh = resolve;
        });
      }
      authorizationHeaders.push(authorization);
      if (authorization === "Bearer access-1") return Promise.resolve(jsonResponse({}, 401));
      return Promise.resolve(jsonResponse({ id: "user-1", email: "person@example.com" }));
    });
    const client = new ZeropsApiClient({ baseUrl: "https://api.example.test", fetch: fetchMock });
    client.restoreSession({ accessToken: "access-1", refreshToken: "refresh-1" });

    const first = client.fetchUser();
    const second = client.fetchUser();
    await Promise.resolve();
    await Promise.resolve();
    expect(refreshCalls).toBe(1);
    expect(resolveRefresh).not.toBeNull();
    resolveRefresh!(
      jsonResponse({ accessToken: "access-2", refreshToken: "refresh-2", twoFAVerified: true }),
    );

    await expect(Promise.all([first, second])).resolves.toEqual([
      { id: "user-1", email: "person@example.com" },
      { id: "user-1", email: "person@example.com" },
    ]);
    expect(refreshCalls).toBe(1);
    expect(authorizationHeaders.filter((header) => header === "Bearer access-2")).toHaveLength(2);
  });
});

describe("ZeropsApiClient integration token credential", () => {
  it("authenticates fetches with the token and never attempts a refresh on 401", async () => {
    let requestCount = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      requestCount += 1;
      expect(url.endsWith("/auth/refresh")).toBe(false);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer integration-token");
      return jsonResponse({}, 401);
    });
    let lastCredential: unknown;
    const client = new ZeropsApiClient({
      baseUrl: "https://api.example.test",
      fetch: fetchMock,
      onCredentialChange: (credential) => {
        lastCredential = credential;
      },
    });
    client.restoreToken("integration-token");
    expect(client.session).toBeNull();
    expect(client.credential).toEqual({ kind: "token", token: "integration-token" });

    await expect(client.fetchUser()).rejects.toMatchObject({ status: 401 });

    // Exactly one request — a bad token clears the credential instead of
    // retrying through a refresh flow that doesn't exist for tokens.
    expect(requestCount).toBe(1);
    expect(client.credential).toBeNull();
    expect(lastCredential).toBeNull();
  });

  it("lets callers use the same fetch methods with a token credential", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/user/info")
        ? jsonResponse({
            id: "user-1",
            email: "person@example.com",
            clientUserList: [
              { id: "m1", clientId: "client-a", status: "ACTIVE", client: { accountName: "A" } },
            ],
          })
        : jsonResponse({ items: [{ id: "project-1", name: "Project", status: "ACTIVE" }] }),
    );
    const client = new ZeropsApiClient({ baseUrl: "https://api.example.test", fetch: fetchMock });
    client.restoreToken("integration-token");

    await expect(client.fetchAllProjects()).resolves.toEqual([
      {
        id: "project-1",
        name: "Project",
        status: "ACTIVE",
        clientId: "client-a",
        clientName: "A",
      },
    ]);
  });
});

describe("ZeropsApiClient projects", () => {
  it("loads every active organization instead of assuming the first membership", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/user/info")) {
        return jsonResponse({
          id: "user-1",
          email: "person@example.com",
          clientUserList: [
            {
              id: "membership-disabled",
              clientId: "client-disabled",
              status: "WAITING_AUTHORIZATION",
              client: { accountName: "Waiting" },
            },
            {
              id: "membership-a",
              clientId: "client-a",
              status: "ACTIVE",
              client: { accountName: "A" },
            },
            {
              id: "membership-b",
              clientId: "client-b",
              status: "ACTIVE",
              client: { accountName: "B" },
            },
          ],
        });
      }
      const body = JSON.parse(String(init?.body));
      const clientId = body.search[0].value;
      return jsonResponse({
        items: [{ id: `project-${clientId}`, name: `Project ${clientId}`, status: "ACTIVE" }],
      });
    });
    const client = new ZeropsApiClient({ baseUrl: "https://api.example.test", fetch: fetchMock });
    client.restoreSession({ accessToken: "access" });

    await expect(client.fetchAllProjects()).resolves.toEqual([
      {
        id: "project-client-a",
        name: "Project client-a",
        status: "ACTIVE",
        clientId: "client-a",
        clientName: "A",
      },
      {
        id: "project-client-b",
        name: "Project client-b",
        status: "ACTIVE",
        clientId: "client-b",
        clientName: "B",
      },
    ]);
  });

  it("derives a project's public zcp endpoint and service groups from its region, not a hardcoded one", async () => {
    const zcpService: ZeropsService = {
      id: "service-zcp",
      name: "zcp",
      status: "ACTIVE",
      isSystem: false,
      ports: [{ port: 8080 }],
      serviceStackTypeInfo: {
        serviceStackTypeName: "nodejs",
        serviceStackTypeVersionName: "22",
        serviceStackTypeCategory: "USER",
      },
    };
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/service-stack")
        ? jsonResponse({ list: [zcpService] })
        : jsonResponse({
            id: "project-1",
            name: "Eval",
            status: "ACTIVE",
            zeropsSubdomainHost: "2333",
            // Verified live against the `eval` project, 2026-08-27.
            publicZone: "fte23prpara6p2koq60b9pvsgk0.prg1-zerops.zone",
          }),
    );
    const client = new ZeropsApiClient({ baseUrl: "https://api.example.test", fetch: fetchMock });
    client.restoreSession({ accessToken: "access" });

    const overview = await client.fetchProjectOverview("project-1");
    expect(overview.region).toBe("prg1");
    expect(overview.zcpService?.url).toBe("https://zcp-2333-8080.prg1.zerops.app");
    expect(categorizeZeropsService(zcpService)).toBe("runtimes");
    expect(buildZeropsContainerUrl("zcp", "2333", 8080, "prg1")).toBe(
      "https://zcp-2333-8080.prg1.zerops.app",
    );
  });

  it("omits zcpService when the region can't be derived, instead of guessing prg1", async () => {
    const zcpService: ZeropsService = {
      id: "service-zcp",
      name: "zcp",
      status: "ACTIVE",
      isSystem: false,
      ports: [{ port: 8080 }],
      serviceStackTypeInfo: {
        serviceStackTypeName: "nodejs",
        serviceStackTypeVersionName: "22",
        serviceStackTypeCategory: "USER",
      },
    };
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/service-stack")
        ? jsonResponse({ list: [zcpService] })
        : jsonResponse({
            id: "project-1",
            name: "Eval",
            status: "ACTIVE",
            zeropsSubdomainHost: "2333",
          }),
    );
    const client = new ZeropsApiClient({ baseUrl: "https://api.example.test", fetch: fetchMock });
    client.restoreSession({ accessToken: "access" });

    const overview = await client.fetchProjectOverview("project-1");
    expect(overview.region).toBeUndefined();
    expect(overview.zcpService).toBeUndefined();
  });
});

describe("zeropsRegionFromPublicZone", () => {
  it("parses the region label preceding -zerops.zone", () => {
    expect(zeropsRegionFromPublicZone("fte23prpara6p2koq60b9pvsgk0.prg1-zerops.zone")).toBe("prg1");
  });

  it("returns null for a zone that doesn't match the expected shape", () => {
    expect(zeropsRegionFromPublicZone("not-a-zone")).toBeNull();
  });
});

describe("ZeropsApiClient default fetch binding", () => {
  it("calls the global fetch with a receiver the browser accepts", async () => {
    // Browsers brand-check `fetch` against Window: an unbound reference invoked
    // as `this.#fetch(...)` throws "Illegal invocation". Emulate that check so a
    // regression fails here rather than only in a real browser.
    const original = globalThis.fetch;
    const calls: string[] = [];
    const guarded = function (this: unknown, input: string) {
      if (this !== globalThis && this !== undefined) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      calls.push(input);
      return Promise.resolve(
        new Response(JSON.stringify({ id: "u1", email: "a@b.c" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    };
    globalThis.fetch = guarded as unknown as typeof fetch;
    try {
      const client = new ZeropsApiClient();
      client.restoreToken("t");
      await expect(client.fetchUser()).resolves.toMatchObject({ id: "u1" });
      expect(calls).toHaveLength(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});
