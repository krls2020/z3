import { describe, expect, it } from "vite-plus/test";

import { resolveChatIndexView } from "./-chatIndexView";

describe("resolveChatIndexView", () => {
  it("shows the Zerops onboarding to a hosted client with no environment", () => {
    expect(resolveChatIndexView({ authGateStatus: "hosted-static", environmentCount: 0 })).toBe(
      "zerops-onboarding",
    );
  });

  it("keeps the draft landing once an environment is connected", () => {
    expect(resolveChatIndexView({ authGateStatus: "hosted-static", environmentCount: 1 })).toBe(
      "draft-landing",
    );
  });

  it("never replaces the landing of a client that is not the hosted static one", () => {
    expect(resolveChatIndexView({ authGateStatus: "authenticated", environmentCount: 0 })).toBe(
      "draft-landing",
    );
    expect(resolveChatIndexView({ authGateStatus: "hosted-pairing", environmentCount: 0 })).toBe(
      "draft-landing",
    );
  });
});
