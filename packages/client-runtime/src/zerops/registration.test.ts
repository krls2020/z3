import { describe, expect, it } from "@effect/vitest";

import { DEFAULT_ZEROPS_API_BASE, ZeropsApiClient } from "./api.ts";
import { buildZeropsRegistrationBody } from "./registration.ts";

const INPUT = {
  email: "  someone@example.com ",
  password: " keeps spaces ",
  fullName: " Ada Lovelace ",
  organizationName: " Analytical Engines ",
};

describe("buildZeropsRegistrationBody", () => {
  it("sends what the platform requires, and claims a pool project by default", () => {
    expect(buildZeropsRegistrationBody(INPUT)).toEqual({
      email: "someone@example.com",
      password: " keeps spaces ",
      name: "Ada Lovelace",
      accountName: "Analytical Engines",
      languageId: "en",
      claimZcpPool: true,
    });
  });

  it("omits the captcha field entirely while the Turnstile flag is off", () => {
    const body = buildZeropsRegistrationBody(INPUT);
    expect("token" in body).toBe(false);
  });

  it("carries the Turnstile token when the flag is on", () => {
    const body = buildZeropsRegistrationBody({ ...INPUT, turnstileToken: "cf-token" });
    expect(body.token).toBe("cf-token");
  });

  it("can register without claiming, for a signup that is not pool-aware", () => {
    const body = buildZeropsRegistrationBody({ ...INPUT, claimZcpPool: false });
    expect(body.claimZcpPool).toBe(false);
  });
});

describe("ZeropsApiClient.register", () => {
  it("posts to /registration unauthenticated and adopts the session it gets back", async () => {
    const requests: Array<{
      url: string;
      method: string;
      auth: string | null;
      body: string | null;
    }> = [];
    const client = new ZeropsApiClient({
      fetch: (input, init) => {
        requests.push({
          url: input,
          method: init?.method ?? "GET",
          auth: new Headers(init?.headers).get("authorization"),
          body: typeof init?.body === "string" ? init.body : null,
        });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              auth: { accessToken: "access-1", refreshToken: "refresh-1" },
              user: { id: "user-1", email: "someone@example.com" },
              zcpClaimed: true,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    });

    const response = await client.register(INPUT);

    expect(response.zcpClaimed).toBe(true);
    expect(client.session?.accessToken).toBe("access-1");
    expect(requests[0]?.url).toBe(`${DEFAULT_ZEROPS_API_BASE}/api/rest/public/registration`);
    expect(requests[0]?.method).toBe("POST");
    // A registration carries no bearer: there is no session yet.
    expect(requests[0]?.auth).toBeNull();
    expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject({
      claimZcpPool: true,
      languageId: "en",
    });
  });

  it("reports an exhausted pool as a fact, not a failure", async () => {
    const client = new ZeropsApiClient({
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              auth: { accessToken: "access-1" },
              user: { id: "user-1", email: "someone@example.com" },
              zcpClaimed: false,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
    });

    const response = await client.register(INPUT);

    expect(response.zcpClaimed).toBe(false);
    expect(client.session?.accessToken).toBe("access-1");
  });
});
