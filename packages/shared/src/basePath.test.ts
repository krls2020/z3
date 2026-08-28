import { describe, expect, it } from "vite-plus/test";

import {
  joinBasePath,
  normalizeBasePath,
  readBasePath,
  socketUrlFromWsBaseUrl,
  stripBasePath,
  withBasePath,
} from "./basePath.ts";

describe("normalizeBasePath", () => {
  it("collapses every spelling of the root to an empty prefix", () => {
    expect(normalizeBasePath(undefined)).toBe("");
    expect(normalizeBasePath("")).toBe("");
    expect(normalizeBasePath("   ")).toBe("");
    expect(normalizeBasePath("/")).toBe("");
    expect(normalizeBasePath("//")).toBe("");
  });

  it("normalizes a prefix to a leading slash and no trailing slash", () => {
    expect(normalizeBasePath("z3")).toBe("/z3");
    expect(normalizeBasePath("/z3")).toBe("/z3");
    expect(normalizeBasePath("/z3/")).toBe("/z3");
    expect(normalizeBasePath("  /z3/  ")).toBe("/z3");
    expect(normalizeBasePath("//z3//")).toBe("/z3");
    expect(normalizeBasePath("/a/b/")).toBe("/a/b");
  });
});

describe("joinBasePath", () => {
  it("joins a prefix and a route path without doubling slashes", () => {
    expect(joinBasePath("/z3", "/api/auth/session")).toBe("/z3/api/auth/session");
    expect(joinBasePath("/z3", "api/auth/session")).toBe("/z3/api/auth/session");
    expect(joinBasePath("", "/api/auth/session")).toBe("/api/auth/session");
    expect(joinBasePath("/z3/", "/ws")).toBe("/z3/ws");
  });

  it("keeps the prefix itself when the route path is the root", () => {
    expect(joinBasePath("/z3", "/")).toBe("/z3/");
    expect(joinBasePath("", "/")).toBe("/");
  });
});

describe("withBasePath", () => {
  it("joins a route onto a base URL that carries a path prefix", () => {
    expect(withBasePath("https://host.example/z3/", "/api/auth/session")).toBe(
      "https://host.example/z3/api/auth/session",
    );
    expect(withBasePath("https://host.example/z3", "/.well-known/t3/environment")).toBe(
      "https://host.example/z3/.well-known/t3/environment",
    );
  });

  it("behaves like a plain replace when the base URL has no prefix", () => {
    expect(withBasePath("https://host.example/", "/oauth/token")).toBe(
      "https://host.example/oauth/token",
    );
    expect(withBasePath("https://host.example", "/oauth/token")).toBe(
      "https://host.example/oauth/token",
    );
  });

  it("drops any query and fragment carried by the base URL", () => {
    expect(withBasePath("https://host.example/z3/?a=1#frag", "/api/auth/session")).toBe(
      "https://host.example/z3/api/auth/session",
    );
  });
});

describe("socketUrlFromWsBaseUrl", () => {
  it("appends the socket route under the prefix", () => {
    expect(socketUrlFromWsBaseUrl("wss://host.example/z3/").toString()).toBe(
      "wss://host.example/z3/ws",
    );
    expect(socketUrlFromWsBaseUrl("wss://host.example/z3").toString()).toBe(
      "wss://host.example/z3/ws",
    );
  });

  it("appends the socket route at the root", () => {
    expect(socketUrlFromWsBaseUrl("wss://host.example/").toString()).toBe("wss://host.example/ws");
    expect(socketUrlFromWsBaseUrl("ws://127.0.0.1:3777").toString()).toBe("ws://127.0.0.1:3777/ws");
  });

  it("does not double an explicit socket path", () => {
    expect(socketUrlFromWsBaseUrl("wss://host.example/z3/ws").toString()).toBe(
      "wss://host.example/z3/ws",
    );
    expect(socketUrlFromWsBaseUrl("wss://host.example/ws").toString()).toBe(
      "wss://host.example/ws",
    );
  });
});

describe("readBasePath", () => {
  it("reads the prefix a base URL carries", () => {
    expect(readBasePath("https://host.example/z3/")).toBe("/z3");
    expect(readBasePath("https://host.example/")).toBe("");
    expect(readBasePath("wss://host.example/a/b")).toBe("/a/b");
  });
});

describe("stripBasePath", () => {
  it("removes the prefix from a request path", () => {
    expect(stripBasePath("/z3", "/z3/api/auth/session")).toBe("/api/auth/session");
    expect(stripBasePath("/z3", "/z3/")).toBe("/");
    expect(stripBasePath("/z3", "/z3")).toBe("/");
  });

  it("leaves a path that does not carry the prefix untouched", () => {
    expect(stripBasePath("/z3", "/api/auth/session")).toBe("/api/auth/session");
    expect(stripBasePath("", "/api/auth/session")).toBe("/api/auth/session");
  });

  it("does not treat a shared leading substring as the prefix", () => {
    expect(stripBasePath("/z3", "/z3x/api")).toBe("/z3x/api");
  });

  it("preserves the query string", () => {
    expect(stripBasePath("/z3", "/z3/ws?wsTicket=abc")).toBe("/ws?wsTicket=abc");
  });
});
