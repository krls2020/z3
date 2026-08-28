import type { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveZeropsCandidate } from "./candidates";
import type { ZeropsProject, ZeropsProjectOverview, ZeropsService } from "./api";

const PROJECT: ZeropsProject = {
  id: "project-1",
  name: "Eval",
  status: "ACTIVE",
  clientId: "client-1",
  clientName: "Acme",
};

function zcpService(overrides: Partial<ZeropsService> = {}): ZeropsService {
  return {
    id: "service-zcp",
    name: "zcp",
    status: "ACTIVE",
    isSystem: false,
    ports: [{ port: 8080 }],
    serviceStackTypeInfo: {
      // The real values a zcp container reports; a container is recognised by
      // this type, not by its hostname.
      serviceStackTypeName: "Zerops Control Plane",
      serviceStackTypeVersionName: "zcp@1",
      serviceStackTypeCategory: "USER",
    },
    ...overrides,
  };
}

function overview(overrides: Partial<ZeropsProjectOverview> = {}): ZeropsProjectOverview {
  return {
    id: PROJECT.id,
    name: PROJECT.name,
    status: "ACTIVE",
    subdomainPrefix: "2333",
    region: "prg1",
    services: [zcpService()],
    ...overrides,
  };
}

const NO_CONNECTIONS: ReadonlyMap<string, EnvironmentId> = new Map();

describe("deriveZeropsCandidate — unavailable reasons (matching zcli's Candidate model)", () => {
  it("flags a project that isn't ACTIVE, quoting its status", () => {
    const candidate = deriveZeropsCandidate(
      { ...PROJECT, status: "STOPPED" },
      null,
      NO_CONNECTIONS,
    );
    expect(candidate).toEqual({
      project: { ...PROJECT, status: "STOPPED" },
      group: "unavailable",
      reason: "project is STOPPED",
    });
  });

  it("flags a project with no zcp service", () => {
    const candidate = deriveZeropsCandidate(PROJECT, overview({ services: [] }), NO_CONNECTIONS);
    expect(candidate.group).toBe("unavailable");
    expect(candidate.reason).toBe("zcp service is missing");
  });

  it("treats a missing overview for an ACTIVE project the same as no zcp service", () => {
    const candidate = deriveZeropsCandidate(PROJECT, null, NO_CONNECTIONS);
    expect(candidate.group).toBe("unavailable");
    expect(candidate.reason).toBe("zcp service is missing");
  });

  it("flags a project with more than one zcp service", () => {
    const candidate = deriveZeropsCandidate(
      PROJECT,
      overview({ services: [zcpService({ id: "a" }), zcpService({ id: "b" })] }),
      NO_CONNECTIONS,
    );
    expect(candidate.group).toBe("unavailable");
    expect(candidate.reason).toBe("multiple zcp services found");
  });

  it("flags a zcp service that isn't ACTIVE, quoting its status", () => {
    const candidate = deriveZeropsCandidate(
      PROJECT,
      overview({ services: [zcpService({ status: "STOPPING" })] }),
      NO_CONNECTIONS,
    );
    expect(candidate.group).toBe("unavailable");
    expect(candidate.reason).toBe("zcp service is STOPPING");
  });
});

describe("deriveZeropsCandidate — ready and connected", () => {
  it("is ready with no z3Origin when the zcp service hasn't declared the 3773 port (C3's redeploy sub-state)", () => {
    const candidate = deriveZeropsCandidate(
      PROJECT,
      overview({ services: [zcpService({ ports: [{ port: 8080 }] })] }),
      NO_CONNECTIONS,
    );
    expect(candidate.group).toBe("ready");
    expect(candidate.z3Origin).toBeUndefined();
    expect(candidate.mintOrigin).toBe("https://zcp-2333-8080.prg1.zerops.app");
    expect(candidate.zcpService).toEqual({ id: "service-zcp", name: "zcp", status: "ACTIVE" });
  });

  it('recognises a zcp container under any hostname, not just "zcp"', () => {
    // A container is identified by its zcp@1 service type. Matching the literal
    // name reported "zcp service is missing" for projects that had one.
    const candidate = deriveZeropsCandidate(
      PROJECT,
      overview({ services: [zcpService({ id: "svc-1", name: "z3probe" })] }),
      NO_CONNECTIONS,
    );
    expect(candidate.group).toBe("ready");
    expect(candidate.reason).toBeUndefined();
    expect(candidate.zcpService).toEqual({ id: "svc-1", name: "z3probe", status: "ACTIVE" });
  });

  it("prefers the container that declares the z3 port over an older one beside it", () => {
    // A project can hold an old zcp next to a newer one that declares 3773.
    // Only one is usable, so this is not ambiguous — reporting it as such hides
    // a container that is ready to connect.
    const candidate = deriveZeropsCandidate(
      PROJECT,
      overview({
        services: [
          zcpService({ id: "old", name: "zcp", ports: [{ port: 8080 }] }),
          zcpService({ id: "new", name: "z3probe", ports: [{ port: 8080 }, { port: 3773 }] }),
        ],
      }),
      NO_CONNECTIONS,
    );
    expect(candidate.group).toBe("ready");
    expect(candidate.zcpService?.id).toBe("new");
    expect(candidate.z3Origin).toBe("https://z3probe-2333-3773.prg1.zerops.app");
  });

  it("is ambiguous only when several containers declare the z3 port", () => {
    const candidate = deriveZeropsCandidate(
      PROJECT,
      overview({
        services: [
          zcpService({ id: "a", name: "one", ports: [{ port: 8080 }, { port: 3773 }] }),
          zcpService({ id: "b", name: "two", ports: [{ port: 8080 }, { port: 3773 }] }),
        ],
      }),
      NO_CONNECTIONS,
    );
    expect(candidate.group).toBe("unavailable");
    expect(candidate.reason).toBe("multiple zcp services found");
  });

  it("ignores non-zcp services when looking for the container", () => {
    const candidate = deriveZeropsCandidate(
      PROJECT,
      overview({
        services: [
          zcpService({
            id: "svc-db",
            name: "zcp",
            serviceStackTypeInfo: {
              serviceStackTypeName: "MariaDB",
              serviceStackTypeVersionName: "mariadb:single@10.6",
              serviceStackTypeCategory: "STANDARD",
            },
          }),
        ],
      }),
      NO_CONNECTIONS,
    );
    expect(candidate.group).toBe("unavailable");
    expect(candidate.reason).toBe("zcp service is missing");
  });

  it("is ready with both origins when the zcp service declares 8080 and 3773 and nothing is connected yet", () => {
    const candidate = deriveZeropsCandidate(
      PROJECT,
      overview({ services: [zcpService({ ports: [{ port: 8080 }, { port: 3773 }] })] }),
      NO_CONNECTIONS,
    );
    expect(candidate.group).toBe("ready");
    expect(candidate.z3Origin).toBe("https://zcp-2333-3773.prg1.zerops.app");
    expect(candidate.mintOrigin).toBe("https://zcp-2333-8080.prg1.zerops.app");
  });

  it("is ready with neither origin when the region or subdomain prefix can't be derived", () => {
    const candidate = deriveZeropsCandidate(
      PROJECT,
      {
        id: PROJECT.id,
        name: PROJECT.name,
        status: "ACTIVE",
        services: [zcpService({ ports: [{ port: 8080 }, { port: 3773 }] })],
      },
      NO_CONNECTIONS,
    );
    expect(candidate.group).toBe("ready");
    expect(candidate.z3Origin).toBeUndefined();
    expect(candidate.mintOrigin).toBeUndefined();
  });

  it("is connected when the derived z3Origin matches a registered environment", () => {
    const environmentId = "env-1" as EnvironmentId;
    const connections = new Map([["https://zcp-2333-3773.prg1.zerops.app", environmentId]]);
    const candidate = deriveZeropsCandidate(
      PROJECT,
      overview({ services: [zcpService({ ports: [{ port: 8080 }, { port: 3773 }] })] }),
      connections,
    );
    expect(candidate.group).toBe("connected");
    expect(candidate.environmentId).toBe(environmentId);
    expect(candidate.z3Origin).toBe("https://zcp-2333-3773.prg1.zerops.app");
  });

  it("stays ready when a registered environment exists but its origin doesn't match this project's", () => {
    const connections = new Map([
      ["https://zcp-9999-3773.prg1.zerops.app", "env-other" as EnvironmentId],
    ]);
    const candidate = deriveZeropsCandidate(
      PROJECT,
      overview({ services: [zcpService({ ports: [{ port: 8080 }, { port: 3773 }] })] }),
      connections,
    );
    expect(candidate.group).toBe("ready");
    expect(candidate.environmentId).toBeUndefined();
  });
});
