// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off
// @effect-diagnostics globalTimers:off
// Exercises watchWithFallback's own plain-Node behavior directly — see that
// module's header comment for why it deliberately bypasses Effect's
// FileSystem.watch.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { watchWithFallback } from "./ZeropsAgentAuthWatcher.ts";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "z3-agent-auth-watcher-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const waitFor = async (predicate: () => boolean, timeoutMs = 2000): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

/**
 * Polls for `predicate`, firing `nudge()` once if it hasn't happened by
 * `nudgeAfterMs`. A single fs write's "change" notification can be delayed
 * or dropped entirely under system load — macOS FSEvents coalescing is not
 * fully deterministic — so this gives the watcher a second, distinctly
 * payloaded event to react to well before giving up, rather than trusting
 * one write alone against a longer fixed wait.
 */
const waitForWithNudge = async (
  predicate: () => boolean,
  nudge: () => void,
  { nudgeAfterMs = 1500, timeoutMs = 5000 }: { nudgeAfterMs?: number; timeoutMs?: number } = {},
): Promise<void> => {
  const start = Date.now();
  let nudged = false;
  while (!predicate()) {
    const elapsed = Date.now() - start;
    if (!nudged && elapsed >= nudgeAfterMs) {
      nudge();
      nudged = true;
    }
    if (elapsed > timeoutMs) {
      throw new Error("waitForWithNudge: timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe("watchWithFallback", () => {
  it("fires when the target file already exists and changes", async () => {
    const target = path.join(root, "auth.json");
    fs.writeFileSync(target, "{}");
    let fired = 0;
    const handle = watchWithFallback(target, root, () => {
      fired += 1;
    });
    try {
      fs.writeFileSync(target, '{"changed":true}');
      await waitForWithNudge(
        () => fired > 0,
        () => fs.writeFileSync(target, '{"changed":true,"nudge":true}'),
      );
      expect(fired).toBeGreaterThan(0);
    } finally {
      handle.dispose();
    }
  });

  it("tolerates a missing target directory, firing once it is created", async () => {
    const dir = path.join(root, ".codex");
    const target = path.join(dir, "auth.json");
    let fired = 0;
    const handle = watchWithFallback(dir, root, () => {
      fired += 1;
    });
    try {
      // dir does not exist yet — the fallback watch (root) must catch its creation.
      fs.mkdirSync(dir);
      fs.writeFileSync(target, "{}");
      await waitFor(() => fired > 0);
      expect(fired).toBeGreaterThan(0);
    } finally {
      handle.dispose();
    }
  });

  it("keeps reporting changes to the target after it re-attaches", async () => {
    const dir = path.join(root, ".codex");
    let fired = 0;
    const handle = watchWithFallback(dir, root, () => {
      fired += 1;
    });
    try {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "auth.json"), "{}");
      await waitFor(() => fired > 0);
      const afterAttach = fired;

      fs.writeFileSync(path.join(dir, "auth.json"), '{"again":true}');
      await waitFor(() => fired > afterAttach);
      expect(fired).toBeGreaterThan(afterAttach);
    } finally {
      handle.dispose();
    }
  });

  it("gives up quietly when the fallback directory itself does not exist", async () => {
    const dir = path.join(root, "missing-parent", "also-missing");
    const fallback = path.join(root, "missing-parent");
    let fired = 0;
    const handle = watchWithFallback(dir, fallback, () => {
      fired += 1;
    });
    // No throw, no crash — just never fires.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fired).toBe(0);
    handle.dispose();
  });

  it("stops firing after dispose", async () => {
    const target = path.join(root, "auth.json");
    fs.writeFileSync(target, "{}");
    let fired = 0;
    const handle = watchWithFallback(target, root, () => {
      fired += 1;
    });
    handle.dispose();
    fs.writeFileSync(target, '{"changed":true}');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fired).toBe(0);
  });
});
