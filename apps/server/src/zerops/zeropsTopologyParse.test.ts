import { describe, expect, it } from "@effect/vitest";

import { parseZeropsTopology } from "./zeropsTopologyParse.ts";
import { isSettledZeropsStatus, zeropsServiceGroup } from "./zeropsServiceTaxonomy.ts";

/**
 * Verbatim `zcp studio topology` output from the `z3-eval` project (dev zcp
 * `343bd2d2`, 2026-08-28): one mounted runtime, one managed valkey, one
 * unmounted runtime, the zcp container itself, and zcp's adoptable warning.
 *
 * Kept verbatim on purpose — a fixture rewritten by hand stops being evidence.
 */
const realTopologyJson =
  '{"project":{"id":"nTV3oMB2SS634ImDJnQckg","name":"z3-eval","status":"ACTIVE"},"services":[{"hostname":"s6fix1","serviceId":"msJJFlOMQO2ABdTHAK9nNQ","type":"ubuntu/nodejs@22","status":"ACTIVE","adoptionState":"adoptable","isInfrastructure":false,"mountPath":"/var/www/s6fix1"},{"hostname":"s6db","serviceId":"xStWGSjtTjCNBNtu2yGqAA","type":"valkey:single@7.2","status":"ACTIVE","adoptionState":"managed-dep","isInfrastructure":true},{"hostname":"s6fix2","serviceId":"c3CkBxoqRweCBd97vxAoVQ","type":"ubuntu/nodejs@22","status":"ACTIVE","adoptionState":"adoptable","isInfrastructure":false},{"hostname":"zcp","serviceId":"gt7tJZjDSk2zyH5XvNeAQQ","type":"zcp@1","status":"ACTIVE","adoptionState":"zcp-self","isInfrastructure":false,"subdomainEnabled":true,"subdomainUrl":"https://zcp-26a7-8080.prg1.zerops.app"}],"warnings":["Services with adoptionState=\\"adoptable\\" (live but not tracked by ZCP): s6fix1, s6fix2. Run `zerops_workflow action=\\"start\\" workflow=\\"bootstrap\\" route=\\"adopt\\"` before any service-scoped MUTATING or PROMOTING call."]}';

/**
 * A constructed document covering the shapes the live samples happen not to
 * contain: a settling service, a subdomain on a runtime, object storage.
 */
const constructedTopologyJson = JSON.stringify(
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
        type: "ubuntu/nodejs@22",
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
        type: "ubuntu/nodejs@22",
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

const parsed = () => parseZeropsTopology(constructedTopologyJson);

describe("zeropsServiceGroup", () => {
  const service = (type: string, adoptionState: string, isManagedService = false) => ({
    type,
    adoptionState,
    isManagedService,
  });

  it.each([
    ["the zcp container itself", service("zcp@1", "zcp-self"), "infrastructure"],
    ["a second zcp container", service("zcp@1", "adoptable"), "infrastructure"],
    ["a runtime", service("ubuntu/nodejs@22", "adopted"), "runtimes"],
    ["a runtime with no OS prefix", service("nodejs@22", "adopted"), "runtimes"],
    ["a zcp behind an OS prefix", service("ubuntu/zcp@1", "adoptable"), "infrastructure"],
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
    const raw = JSON.parse(constructedTopologyJson) as Record<string, unknown>;
    (raw.services as Array<unknown>).push({ hostname: 42 });
    const result = parseZeropsTopology(JSON.stringify(raw));
    expect(result?.services).toHaveLength(5);
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

describe("parseZeropsTopology — the live z3-eval document", () => {
  const live = () => parseZeropsTopology(realTopologyJson);

  it("reads the project", () => {
    expect(live()?.project).toEqual({
      id: "nTV3oMB2SS634ImDJnQckg",
      name: "z3-eval",
      status: "ACTIVE",
    });
  });

  it("groups the four real services", () => {
    expect(
      Object.fromEntries(
        (live()?.services ?? []).map((service) => [service.hostname, service.group]),
      ),
    ).toEqual({
      s6fix1: "runtimes",
      s6db: "data",
      s6fix2: "runtimes",
      zcp: "infrastructure",
    });
  });

  it("puts the zcp container in infrastructure even though zcp says it is not managed", () => {
    // The live document carries `isInfrastructure:false` on the zcp container —
    // that flag means "managed data service", so the zcp has to be claimed by
    // the adoptionState/type branch before the runtime branch sees it.
    const zcp = (live()?.services ?? []).find((service) => service.hostname === "zcp");
    expect(zcp?.isManagedService).toBe(false);
    expect(zcp?.group).toBe("infrastructure");
  });

  it("reads mounted state per service", () => {
    const byHost = new Map((live()?.services ?? []).map((service) => [service.hostname, service]));
    expect(byHost.get("s6fix1")?.mounted).toBe(true);
    expect(byHost.get("s6fix1")?.mountPath).toBe("/var/www/s6fix1");
    expect(byHost.get("s6fix2")?.mounted).toBe(false);
  });

  it("is not confused by the OS prefix on a runtime type", () => {
    const runtime = (live()?.services ?? []).find((service) => service.hostname === "s6fix1");
    expect(runtime?.type).toBe("ubuntu/nodejs@22");
    expect(runtime?.group).toBe("runtimes");
  });

  it("carries zcp's warning prose through as an opaque string", () => {
    // Agent-facing prose. It is surfaced, never parsed — its wording is not a
    // contract and reading structure out of it would break on the next reword.
    const warnings = live()?.warnings ?? [];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("adoptable");
  });

  it("marks every settled service non-transient", () => {
    expect((live()?.services ?? []).every((service) => !service.transient)).toBe(true);
  });
});
