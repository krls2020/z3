import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_ZEROPS_TURNSTILE_SITE_KEY,
  TURNSTILE_DOMAIN_NOT_AUTHORIZED,
  ZEROPS_TURNSTILE_SITE_KEY,
  describeTurnstileError,
} from "./turnstile";

describe("Zerops Turnstile", () => {
  it("uses Zerops' own site key by default, because the platform enforces the captcha", () => {
    expect(DEFAULT_ZEROPS_TURNSTILE_SITE_KEY).toBe("0x4AAAAAABkfI4SNvJav8428");
    expect(ZEROPS_TURNSTILE_SITE_KEY).toBe(DEFAULT_ZEROPS_TURNSTILE_SITE_KEY);
  });

  it("names the domain refusal the way a person can act on", () => {
    // 110200 is what the widget reports on any hostname Zerops has not
    // allowed — the whole reason registration has an "unavailable here" state.
    expect(describeTurnstileError(TURNSTILE_DOMAIN_NOT_AUTHORIZED)).toBe(
      "Domain not authorized (110200)",
    );
    expect(describeTurnstileError("300010")).toBe("Captcha error (300010)");
    expect(describeTurnstileError("")).toBe("The captcha could not be loaded");
  });
});
