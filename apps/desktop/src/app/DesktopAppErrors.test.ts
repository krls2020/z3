import { assert, describe, it } from "@effect/vitest";

import { DesktopWebBundleMissingError } from "./DesktopApp.ts";

describe("DesktopApp errors", () => {
  it("reports the missing hosted-static web bundle", () => {
    const error = new DesktopWebBundleMissingError();

    assert.equal(
      error.message,
      "Could not locate the staged hosted-static web bundle (resources/web/index.html) next to the desktop app.",
    );
  });
});
