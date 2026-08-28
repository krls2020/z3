import { describe, expect, it } from "@effect/vitest";

import { parseZeropsTopology } from "./topologyParse.ts";
import { isSettledZeropsStatus, zeropsServiceGroup } from "./serviceTaxonomy.ts";

/**
 * The document `zcp studio topology` prints: `ops.DiscoverResult` as
 * pretty-printed JSON (`cmd/zcp/studio.go:110-142`). Per service, zcp emits
 * `hostname, serviceId, type, status, adoptionState, isInfrastructure` plus
 * `mountPath` when `/var/www/<hostname>` exists
 * (`internal/tools/discover.go:127-132`) and the subdomain fields when resolved.
 * There is no live process state on this path — the exported
 * `EnrichWithMetaStatus` passes `activity = nil`.
 */
const topologyJson = JSON.stringify(
  {
    project: { id: "proj-1", name: "z3-eval", status: "ACTIVE" },
    services: [
      {
        hostname: "zcp",
        serviceId: "svc-zcp",
        type: "zcp@1",
        status: "ACTIVE",
        adoptionState: "zcp-self",
        isInfrastructure: false,
        subdomainEnabled: true,
        subdomainUrl: "https://zcp-26a7-8080.prg1.zerops.app",
      },
      {
        hostname: "kanbandev",
        serviceId: "svc-kanbandev",
        type: "nodejs@22",
        status: "ACTIVE",
        adoptionState: "adopted",
        isInfrastructure: false,
        mountPath: "/var/www/kanbandev",
        subdomainEnabled: true,
        subdomainUrl: "https://kanbandev-26a7-3000.prg1.zerops.app",
      },
      {
        hostname: "kanbanstage",
        serviceId: "svc-kanbanstage",
        type: "nodejs@22",
        status: "CREATING",
        adoptionState: "adopted",
        isInfrastructure: false,
      },
      {
        hostname: "db",
        serviceId: "svc-db",
        type: "postgresql:single@18",
        status: "ACTIVE",
        adoptionState: "managed-dep",
        isInfrastructure: true,
      },
      {
        hostname: "cache",
        serviceId: "svc-cache",
        type: "valkey:single@7.2",
        status: "ACTIVE",
        adoptionState: "managed-dep",
        isInfrastructure: true,
      },
      {
        hostname: "storage",
        serviceId: "svc-storage",
        type: "object-storage@1",
        status: "ACTIVE",
        adoptionState: "managed-dep",
        isInfrastructure: true,
      },
    ],
    warnings: ["1 service can be adopted: legacyapp"],
  },
  null,
  2,
);

const parsed = () => parseZeropsTopology(topologyJson);

describe("zeropsServiceGroup", () => {
  const service = (type: string, adoptionState: string, isManagedService = false) => ({
    type,
    adoptionState,
    isManagedService,
  });

  it.each([
    ["the zcp container itself", service("zcp@1", "zcp-self"), "infrastructure"],
    ["a second zcp container", service("zcp@1", "adoptable"), "infrastructure"],
    ["a runtime", service("nodejs@22", "adopted"), "runtimes"],
    ["a static runtime", service("static@1", "adoptable"), "runtimes"],
    ["a database", service("postgresql:single@18", "managed-dep", true), "data"],
    ["a cache", service("valkey:single@7.2", "managed-dep", true), "data"],
    ["object storage", service("object-storage@1", "managed-dep", true), "data"],
  ])("puts %s in %s", (_label, input, expected) => {
    expect(zeropsServiceGroup(input)).toBe(expected);
  });
});

describe("isSettledZeropsStatus", () => {
  it.each(["ACTIVE", "RUNNING", "STOPPED", "READY_TO_DEPLOY", "FAILED", "DELETED"])(
    "treats %s as settled",
    (status) => {
      expect(isSettledZeropsStatus(status)).toBe(true);
    },
  );

  it.each(["CREATING", "DELETING", "STARTING", "STOPPING", "RESTARTING", "SCALING", "UPGRADING"])(
    "treats %s as transient",
    (status) => {
      expect(isSettledZeropsStatus(status)).toBe(false);
    },
  );

  it("treats a status it has never seen as transient", () => {
    // A status the platform adds later costs one extra poll if we guess wrong
    // this way; guessing the other way freezes a service mid-transition on screen.
    expect(isSettledZeropsStatus("MIGRATING_SOMEWHERE")).toBe(false);
  });

  it("accepts the SERVICE_-prefixed spelling the platform also uses", () => {
    expect(isSettledZeropsStatus("SERVICE_ACTIVE")).toBe(true);
    expect(isSettledZeropsStatus("SERVICE_CREATING")).toBe(false);
  });
});

describe("parseZeropsTopology", () => {
  it("reads the project", () => {
    expect(parsed()?.project).toEqual({ id: "proj-1", name: "z3-eval", status: "ACTIVE" });
  });

  it("groups every service", () => {
    const groups = Object.fromEntries(
      (parsed()?.services ?? []).map((service) => [service.hostname, service.group]),
    );
    expect(groups).toEqual({
      zcp: "infrastructure",
      kanbandev: "runtimes",
      kanbanstage: "runtimes",
      db: "data",
      cache: "data",
      storage: "data",
    });
  });

  it("takes mounted state from zcp's own mountPath, not from a guess", () => {
    const services = parsed()?.services ?? [];
    const mounted = services.find((service) => service.hostname === "kanbandev");
    const unmounted = services.find((service) => service.hostname === "kanbanstage");
    expect(mounted?.mounted).toBe(true);
    expect(mounted?.mountPath).toBe("/var/www/kanbandev");
    expect(unmounted?.mounted).toBe(false);
    expect(unmounted?.mountPath).toBeUndefined();
  });

  it("marks a settling service transient", () => {
    const services = parsed()?.services ?? [];
    expect(services.find((service) => service.hostname === "kanbanstage")?.transient).toBe(true);
    expect(services.find((service) => service.hostname === "kanbandev")?.transient).toBe(false);
  });

  it("carries the subdomain through", () => {
    const service = (parsed()?.services ?? []).find((entry) => entry.hostname === "kanbandev");
    expect(service?.subdomainEnabled).toBe(true);
    expect(service?.subdomainUrl).toBe("https://kanbandev-26a7-3000.prg1.zerops.app");
  });

  it("carries zcp's warnings through untouched", () => {
    expect(parsed()?.warnings).toEqual(["1 service can be adopted: legacyapp"]);
  });

  it("survives a topology with no services and no warnings", () => {
    const result = parseZeropsTopology(
      JSON.stringify({ project: { id: "p", name: "empty" }, services: [] }),
    );
    expect(result?.services).toEqual([]);
    expect(result?.warnings).toEqual([]);
  });

  it("reads Go's null for an empty slice as an empty list", () => {
    // A nil Go slice marshals as `null`, not `[]` — a project with nothing in it
    // emits `"services": null`, and rejecting that would make an empty project
    // look like a broken read.
    const result = parseZeropsTopology(
      JSON.stringify({ project: { id: "p", name: "empty" }, services: null, warnings: null }),
    );
    expect(result?.services).toEqual([]);
    expect(result?.warnings).toEqual([]);
  });

  it("skips a service entry it cannot read rather than failing the read", () => {
    const raw = JSON.parse(topologyJson) as Record<string, unknown>;
    (raw.services as Array<unknown>).push({ hostname: 42 });
    const result = parseZeropsTopology(JSON.stringify(raw));
    expect(result?.services).toHaveLength(6);
  });

  it.each([
    ["not JSON", "zcp: some diagnostic on stdout"],
    ["JSON that is not an object", "[1,2,3]"],
    ["an object with no project", '{"services":[]}'],
    ["an object with no services", '{"project":{"id":"p","name":"n"}}'],
    ["an empty document", ""],
  ])("returns undefined for %s", (_label, text) => {
    expect(parseZeropsTopology(text)).toBeUndefined();
  });
});
