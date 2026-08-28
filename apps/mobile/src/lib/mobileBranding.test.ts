import { describe, expect, it } from "vite-plus/test";

import {
  MOBILE_APP_NAME,
  MOBILE_AUTH_CLIENT_LABEL,
  resolveMobileStageLabel,
} from "./mobileBranding";

it("exposes the Zerops mobile product identity", () => {
  expect(MOBILE_APP_NAME).toBe("Zerops Code");
  expect(MOBILE_AUTH_CLIENT_LABEL).toBe("Zerops Code Mobile");
});

describe("resolveMobileStageLabel", () => {
  it.each([
    ["development", "Dev"],
    ["preview", "Nightly"],
    ["production", "Alpha"],
    [undefined, "Alpha"],
  ])("maps %s builds to %s", (appVariant, expected) => {
    expect(resolveMobileStageLabel(appVariant)).toBe(expected);
  });
});
