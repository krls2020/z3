import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  PROVISIONING_CAPS,
  advanceProvisioning,
  startProvisioning,
  type ProvisioningState,
} from "~/zerops/provisioning";

import { ZeropsProvisioningPanel, zeropsGuiProjectUrl } from "./ZeropsProvisioningPanel";

const noop = () => undefined;

const PROJECT = {
  id: "project-1",
  name: "p",
  status: "ACTIVE",
  publicZone: "abc.prg1-zerops.zone",
  zeropsSubdomainHost: "24cb",
};

const CONTAINER = {
  id: "service-1",
  name: "zcp",
  status: "ACTIVE",
  subdomainAccess: true,
  ports: [{ port: 8080 }],
  serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
};

function render(state: ProvisioningState, error: string | null = null): string {
  return renderToStaticMarkup(
    <ZeropsProvisioningPanel
      state={state}
      busy={false}
      error={error}
      onRetry={noop}
      onEnable={noop}
    />,
  );
}

const awaitingContainer = advanceProvisioning(
  startProvisioning({ zcpClaimed: true, nowMs: 0 }),
  { kind: "projects", projects: [PROJECT] },
  0,
);
const awaitingHealth = advanceProvisioning(
  awaitingContainer,
  { kind: "services", project: PROJECT, services: [CONTAINER] },
  1000,
);

describe("ZeropsProvisioningPanel", () => {
  it("names what every wait is waiting for, and its cap", () => {
    expect(render(startProvisioning({ zcpClaimed: true, nowMs: 0 }))).toContain(
      "Waiting for your project to appear",
    );
    expect(render(startProvisioning({ zcpClaimed: true, nowMs: 0 }))).toContain("up to 60s");

    expect(render(awaitingContainer)).toContain("Waiting for the Zerops Code container to start");
    expect(render(awaitingContainer)).toContain("up to 5 min");

    expect(render(awaitingHealth)).toContain("Waiting for Zerops Code to answer");
    expect(render(awaitingHealth)).toContain("up to 30s");
  });

  it("offers the restart when the container predates Zerops Code, and says what it costs", () => {
    const needsEnable = advanceProvisioning(
      awaitingHealth,
      { kind: "health", health: "predates-z3" },
      2000,
    );

    const markup = render(needsEnable);
    expect(markup).toContain("Enable Zerops Code");
    // A restart is safe; saying so is what makes the button clickable.
    expect(markup).toMatch(/untouched/i);
  });

  it("turns a cap that ran out into two ways forward, never a failure", () => {
    const expired = advanceProvisioning(
      awaitingContainer,
      { kind: "tick" },
      PROVISIONING_CAPS["awaiting-container"] + 1,
    );

    const markup = render(expired);
    expect(markup).toContain("Keep waiting");
    expect(markup).toContain(zeropsGuiProjectUrl("project-1"));
    expect(markup).not.toMatch(/failed|error/i);
  });

  it("links to the project the wait is about", () => {
    expect(zeropsGuiProjectUrl("abc123")).toBe("https://app.zerops.io/project/abc123");
    expect(zeropsGuiProjectUrl(null)).toBe("https://app.zerops.io");
  });

  it("shows a read failure without abandoning the wait", () => {
    const markup = render(awaitingHealth, "Network error contacting Zerops.");

    expect(markup).toContain("Network error contacting Zerops.");
    expect(markup).toContain("Waiting for Zerops Code to answer");
  });
});
