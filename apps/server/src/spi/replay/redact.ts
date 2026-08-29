/**
 * Redaction for SPI replay goldens.
 *
 * A golden file must be stable across replays and across machines. Two
 * kinds of noise stand between a raw `ProviderRuntimeEvent[]` and a stable
 * golden:
 *
 * - Non-determinism the driver itself introduces: `eventId` is a freshly
 *   generated UUID per event, `createdAt` is wall-clock time.
 * - Environment specifics: absolute paths (HOME, cwd) that differ machine
 *   to machine but carry no signal about normalization correctness.
 *
 * `redact` is a pure function over already-produced events — it never talks
 * to the driver or the filesystem — so its rules are exhaustively testable
 * in isolation (see redact.test.ts).
 */

export const REDACTED_CREATED_AT = "1970-01-01T00:00:00.000Z";

/** A path to rewrite, and what to rewrite it to. */
export interface RedactPathRule {
  readonly path: string;
  readonly placeholder: string;
}

export interface RedactOptions {
  readonly paths?: ReadonlyArray<RedactPathRule>;
}

function redactString(value: string, pathRulesLongestFirst: ReadonlyArray<RedactPathRule>): string {
  for (const rule of pathRulesLongestFirst) {
    if (value === rule.path) {
      return rule.placeholder;
    }
    if (value.startsWith(`${rule.path}/`)) {
      return rule.placeholder + value.slice(rule.path.length);
    }
  }
  return value;
}

function redactValue(
  value: unknown,
  pathRulesLongestFirst: ReadonlyArray<RedactPathRule>,
): unknown {
  if (typeof value === "string") {
    return redactString(value, pathRulesLongestFirst);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, pathRulesLongestFirst));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactValue(entry, pathRulesLongestFirst);
    }
    return out;
  }
  return value;
}

/**
 * Redacts a list of already-produced normalized events. Rewrites `eventId`
 * to a stable per-array sequence id (`evt-<index>`) when the field is
 * present, `createdAt` to a fixed placeholder when present, and any string
 * value equal to (or path-prefixed by) one of `paths` to its placeholder —
 * checked longest-path-first so a `cwd` nested under `home` redacts to
 * `<CWD>`, never `<HOME>/...`. Never mutates its input.
 */
export function redact(
  events: ReadonlyArray<Record<string, unknown>>,
  options?: RedactOptions,
): ReadonlyArray<Record<string, unknown>> {
  const pathRulesLongestFirst = [...(options?.paths ?? [])].sort(
    (a, b) => b.path.length - a.path.length,
  );

  return events.map((event, index) => {
    const withPathsRedacted = redactValue(event, pathRulesLongestFirst) as Record<string, unknown>;
    return {
      ...withPathsRedacted,
      ...("eventId" in event ? { eventId: `evt-${index}` } : {}),
      ...("createdAt" in event ? { createdAt: REDACTED_CREATED_AT } : {}),
    };
  });
}
