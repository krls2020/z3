import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  ZeropsAgentAuth,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentAuthState,
  ZeropsAgentId,
} from "./zerops.ts";

const decodeAgentId = Schema.decodeUnknownSync(ZeropsAgentId);
const decodeAgentAuthState = Schema.decodeUnknownSync(ZeropsAgentAuthState);
const decodeAgentAuth = Schema.decodeUnknownSync(ZeropsAgentAuth);
const decodeSnapshot = Schema.decodeUnknownSync(ZeropsAgentAuthSnapshot);

describe("ZeropsAgentId", () => {
  it("accepts the two agents with a live-verified credential probe", () => {
    expect(decodeAgentId("claude-code")).toBe("claude-code");
    expect(decodeAgentId("codex")).toBe("codex");
  });

  it("rejects an agent with no verified probe", () => {
    expect(() => decodeAgentId("cursor")).toThrow();
  });
});

describe("ZeropsAgentAuthState", () => {
  it("accepts every value of the §3 W-STATE matrix", () => {
    for (const state of [
      "authorized-token",
      "authorized",
      "reconnect",
      "local-only",
      "not-authorized",
    ]) {
      expect(decodeAgentAuthState(state)).toBe(state);
    }
  });

  it("rejects a value outside the matrix", () => {
    expect(() => decodeAgentAuthState("pending")).toThrow();
  });
});

describe("ZeropsAgentAuth", () => {
  it("decodes one agent's row", () => {
    const decoded = decodeAgentAuth({
      agentId: "claude-code",
      credPresent: true,
      flagOAuth: true,
      flagToken: false,
      providerAuth: "authenticated",
      state: "authorized",
    });
    expect(decoded.agentId).toBe("claude-code");
    expect(decoded.state).toBe("authorized");
    expect(decoded.providerAuth).toBe("authenticated");
  });

  it("accepts every ServerProviderAuthStatus value for providerAuth", () => {
    for (const providerAuth of ["authenticated", "unauthenticated", "unknown"]) {
      const decoded = decodeAgentAuth({
        agentId: "codex",
        credPresent: false,
        flagOAuth: false,
        flagToken: false,
        providerAuth,
        state: "not-authorized",
      });
      expect(decoded.providerAuth).toBe(providerAuth);
    }
  });

  it("rejects a missing providerAuth field", () => {
    expect(() =>
      decodeAgentAuth({
        agentId: "codex",
        credPresent: false,
        flagOAuth: false,
        flagToken: false,
        state: "not-authorized",
      }),
    ).toThrow();
  });
});

describe("ZeropsAgentAuthSnapshot", () => {
  it("decodes an available snapshot with both agents", () => {
    const decoded = decodeSnapshot({
      available: true,
      agents: [
        {
          agentId: "claude-code",
          credPresent: false,
          flagOAuth: false,
          flagToken: false,
          providerAuth: "unknown",
          state: "not-authorized",
        },
        {
          agentId: "codex",
          credPresent: true,
          flagOAuth: false,
          flagToken: false,
          providerAuth: "unauthenticated",
          state: "local-only",
        },
      ],
    });
    expect(decoded.agents).toHaveLength(2);
    expect(decoded.reason).toBeUndefined();
  });

  it("decodes an unavailable snapshot (not a Zerops environment)", () => {
    const decoded = decodeSnapshot({
      available: false,
      reason: "Not a Zerops environment",
      agents: [],
    });
    expect(decoded.available).toBe(false);
    expect(decoded.agents).toEqual([]);
  });
});
