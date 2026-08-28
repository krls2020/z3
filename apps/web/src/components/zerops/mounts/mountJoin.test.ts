import { describe, expect, it } from "vite-plus/test";

import type { FilesystemBrowseEntry } from "@t3tools/contracts";

import type { ZeropsService } from "~/zerops/api";

import { joinVarWwwMounts } from "./mountJoin";

function entry(name: string, fullPath = `/var/www/${name}`): FilesystemBrowseEntry {
  return { name, fullPath };
}

function service(name: string, status = "ACTIVE"): ZeropsService {
  return {
    id: `${name}-id`,
    name,
    status,
    isSystem: false,
    ports: [],
    serviceStackTypeInfo: {
      serviceStackTypeName: "nodejs",
      serviceStackTypeVersionName: "22",
      serviceStackTypeCategory: "USER",
    },
  };
}

describe("joinVarWwwMounts", () => {
  it("matches a mount to its sibling service by hostname", () => {
    const rows = joinVarWwwMounts([entry("api")], [service("api")], null);
    expect(rows).toEqual([{ name: "api", fullPath: "/var/www/api", service: service("api") }]);
  });

  it("keeps an entry with no matching service, marked unmatched rather than hidden", () => {
    const rows = joinVarWwwMounts([entry("mystery")], [service("api")], null);
    expect(rows).toEqual([{ name: "mystery", fullPath: "/var/www/mystery", service: null }]);
  });

  it("excludes the project's own workspace root instead of showing it as a mount", () => {
    const rows = joinVarWwwMounts([entry("app"), entry("api")], [service("api")], "/var/www/app");
    expect(rows.map((row) => row.name)).toEqual(["api"]);
  });

  it("does not filter anything when the workspace root is unknown", () => {
    const rows = joinVarWwwMounts([entry("app")], [], null);
    expect(rows.map((row) => row.name)).toEqual(["app"]);
  });
});
