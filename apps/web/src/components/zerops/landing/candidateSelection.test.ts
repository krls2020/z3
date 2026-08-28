import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentId } from "@t3tools/contracts";

import type { ZeropsCandidate, ZeropsCandidateGroup } from "~/zerops/candidates";
import type { ZeropsProject } from "~/zerops/api";

import { selectSoleConnectedEnvironmentId } from "./candidateSelection";

function project(id: string): ZeropsProject {
  return { id, name: id, status: "ACTIVE", clientId: "client-1", clientName: "acme" };
}

function candidate(
  group: ZeropsCandidateGroup,
  overrides: Partial<ZeropsCandidate> = {},
): ZeropsCandidate {
  return {
    project: project("project-1"),
    group,
    ...overrides,
  };
}

describe("selectSoleConnectedEnvironmentId", () => {
  it("picks the environment when exactly one candidate is connected", () => {
    const candidates = [
      candidate("connected", { environmentId: "env-1" as EnvironmentId }),
      candidate("ready", { project: project("project-2") }),
    ];
    expect(selectSoleConnectedEnvironmentId(candidates)).toBe("env-1");
  });

  it("returns null when nothing is connected yet", () => {
    const candidates = [
      candidate("ready"),
      candidate("unavailable", { project: project("project-2") }),
    ];
    expect(selectSoleConnectedEnvironmentId(candidates)).toBeNull();
  });

  it("returns null when more than one candidate is connected, rather than guessing", () => {
    const candidates = [
      candidate("connected", { environmentId: "env-1" as EnvironmentId }),
      candidate("connected", {
        environmentId: "env-2" as EnvironmentId,
        project: project("project-2"),
      }),
    ];
    expect(selectSoleConnectedEnvironmentId(candidates)).toBeNull();
  });

  it("ignores a 'connected' candidate with no environmentId rather than throwing", () => {
    const candidates = [candidate("connected")];
    expect(selectSoleConnectedEnvironmentId(candidates)).toBeNull();
  });
});
