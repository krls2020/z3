import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import type { ZeropsAgentAuth, ZeropsAgentAuthSnapshot } from "@t3tools/contracts";

import { ZeropsAgentAuthCard } from "./ZeropsAgentAuthCard";

const agent = (overrides: Partial<ZeropsAgentAuth> & Pick<ZeropsAgentAuth, "agentId">) =>
  ({
    credPresent: false,
    flagOAuth: false,
    flagToken: false,
    state: "not-authorized",
    ...overrides,
  }) as ZeropsAgentAuth;

const snapshot = (agents: ReadonlyArray<ZeropsAgentAuth>): ZeropsAgentAuthSnapshot => ({
  available: true,
  agents,
});

const noop = () => {};

describe("ZeropsAgentAuthCard", () => {
  it("renders nothing when the feed is not available", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard snapshot={{ available: false, agents: [] }} onSignIn={noop} />,
    );

    expect(html).toBe("");
  });

  it("renders one row per agent, with its name and state label", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([
          agent({ agentId: "claude-code", state: "not-authorized" }),
          agent({ agentId: "codex", state: "authorized" }),
        ])}
        onSignIn={noop}
      />,
    );

    expect(html).toContain("Claude Code");
    expect(html).toContain("Codex");
    expect(html).toContain("Not signed in");
    expect(html).toContain("Authorized");
    expect(html).toContain("data-zerops-agent-auth-card");
  });

  it("shows a sign-in button for a not-authorized agent", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([agent({ agentId: "claude-code", state: "not-authorized" })])}
        onSignIn={noop}
      />,
    );

    expect(html).toContain("Sign in to Claude");
  });

  it("shows a sign-in button for a reconnect agent, worded the same as not-authorized", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([agent({ agentId: "codex", state: "reconnect" })])}
        onSignIn={noop}
      />,
    );

    expect(html).toContain("Sign in to Codex");
    expect(html).toContain("Reconnect needed");
  });

  it("shows a disabled button while local-only, not a sign-in prompt", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([agent({ agentId: "claude-code", state: "local-only" })])}
        onSignIn={noop}
      />,
    );

    expect(html).not.toContain("Sign in to Claude");
    // A tight check: the `disabled:` Tailwind variant sits in every button's
    // className regardless of state, so a bare "disabled" substring would
    // pass even with the prop missing. The rendered boolean HTML attribute
    // is what actually disables the control.
    expect(html).toContain('disabled=""');
    expect(html).toContain("registering with Zerops");
  });

  it("shows no button at all once authorized", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([agent({ agentId: "claude-code", state: "authorized" })])}
        onSignIn={noop}
      />,
    );

    expect(html).not.toContain("<button");
    expect(html).toContain("Authorized");
  });

  it("shows no button at all once authorized via token", () => {
    const html = renderToStaticMarkup(
      <ZeropsAgentAuthCard
        snapshot={snapshot([agent({ agentId: "codex", state: "authorized-token" })])}
        onSignIn={noop}
      />,
    );

    expect(html).not.toContain("<button");
    expect(html).toContain("Authorized (token)");
  });
});
