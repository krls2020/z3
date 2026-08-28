import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { appBasePath, appBasePathHref } from "./basePath.ts";

describe("appBasePath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is empty when the bundle is served at the origin root", () => {
    vi.stubEnv("BASE_URL", "/");
    expect(appBasePath()).toBe("");
  });

  it("normalizes the trailing slash Vite's base always carries", () => {
    vi.stubEnv("BASE_URL", "/z3/");
    expect(appBasePath()).toBe("/z3");
  });

  it("tolerates a base without a trailing slash", () => {
    vi.stubEnv("BASE_URL", "/z3");
    expect(appBasePath()).toBe("/z3");
  });
});

describe("appBasePathHref", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the router basepath form", () => {
    vi.stubEnv("BASE_URL", "/");
    expect(appBasePathHref()).toBe("/");
    vi.stubEnv("BASE_URL", "/z3/");
    expect(appBasePathHref()).toBe("/z3/");
  });
});
