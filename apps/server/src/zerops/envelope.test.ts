import { describe, expect, it } from "@effect/vitest";

import {
  ZEROPS_ENVELOPE_FENCE,
  decodeZeropsEnvelope,
  extractZeropsEnvelope,
  extractZeropsEnvelopeBlock,
} from "./envelope.ts";

/**
 * The wire shape zcp's `workflow.AppendEnvelope` produces: markdown, a blank
 * line, then a three-line fenced block whose body is compact single-line JSON.
 * Contract: zcp `docs/spec-z3.md` §1.1, reference `internal/workflow/envelope_wire.go`.
 */
const block = (body: string): string => `\`\`\`${ZEROPS_ENVELOPE_FENCE}\n${body}\n\`\`\`\n`;

const envelopeJson = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    phase: "develop-active",
    environment: "container",
    selfService: { hostname: "zcp" },
    project: { id: "proj-1", name: "z3-eval" },
    services: [
      {
        hostname: "apidev",
        typeVersion: "nodejs@22",
        runtimeClass: "dynamic",
        status: "ACTIVE",
        bootstrapped: true,
        deployed: true,
        mode: "standard",
        closeDeployMode: "auto",
        gitPushState: "configured",
        remoteUrl: "https://github.com/acme/api",
        stageHostname: "apistage",
        setupName: "api",
        stageSetupName: "apistage",
      },
      {
        hostname: "db",
        typeVersion: "postgresql@16",
        runtimeClass: "managed",
        status: "ACTIVE",
        bootstrapped: true,
      },
    ],
    workSession: {
      intent: "add health endpoint",
      services: ["apidev"],
      roles: { apidev: "required" },
      createdAt: "2026-08-28T12:00:00Z",
      deploys: {
        apidev: [{ at: "2026-08-28T12:00:00Z", success: true, iteration: 1, setup: "api" }],
      },
      verifies: {
        apidev: [{ at: "2026-08-28T12:00:00Z", success: true, iteration: 1, summary: "healthy" }],
      },
    },
    bootstrap: { route: "classic", step: "provision", intent: "node api with postgres" },
    generated: "2026-08-28T12:00:00Z",
    ...overrides,
  });

const resultText = (overrides?: Record<string, unknown>): string =>
  `## Status\n\nPhase: develop-active\n\n${block(envelopeJson(overrides))}`;

describe("extractZeropsEnvelopeBlock", () => {
  it("finds the body of a well-formed trailing block", () => {
    const body = envelopeJson();
    expect(extractZeropsEnvelopeBlock(resultText())).toBe(body);
  });

  it("returns the LAST complete block — a transcript may concatenate results", () => {
    const text = `${block(envelopeJson({ phase: "idle" }))}\nsecond result\n\n${block(
      envelopeJson({ phase: "develop-active" }),
    )}`;
    expect(extractZeropsEnvelopeBlock(text)).toContain('"phase":"develop-active"');
  });

  it("skips an unterminated trailing block and keeps scanning backwards", () => {
    const truncated = `\`\`\`${ZEROPS_ENVELOPE_FENCE}\n{"phase":"truncated"`;
    const text = `${block(envelopeJson({ phase: "idle" }))}\nmore\n\n${truncated}`;
    expect(extractZeropsEnvelopeBlock(text)).toContain('"phase":"idle"');
  });

  it("tolerates trailing whitespace and CRLF around the fences", () => {
    const text = [
      "intro",
      "",
      `\`\`\`${ZEROPS_ENVELOPE_FENCE}  `,
      envelopeJson(),
      "```  ",
      "",
    ].join("\r\n");
    expect(extractZeropsEnvelopeBlock(text)).toBe(envelopeJson());
  });

  it.each([
    ["empty", ""],
    ["plain markdown", "## Status\n\nPhase: idle\n"],
    ["a different fenced block", '```json\n{"phase":"idle"}\n```\n'],
    [
      "an unterminated block on its own",
      `text\n\n\`\`\`${ZEROPS_ENVELOPE_FENCE}\n{"phase":"idle"}\n`,
    ],
    ["the fence mentioned mid-line", `the block is \`\`\`${ZEROPS_ENVELOPE_FENCE} shaped\n`],
    [
      "the fence with trailing prose on its line",
      `\`\`\`${ZEROPS_ENVELOPE_FENCE} extra\n{}\n\`\`\`\n`,
    ],
  ])("returns undefined for %s", (_label, text) => {
    expect(extractZeropsEnvelopeBlock(text)).toBeUndefined();
  });
});

describe("decodeZeropsEnvelope", () => {
  it("decodes a full envelope", () => {
    const envelope = decodeZeropsEnvelope(envelopeJson());
    expect(envelope?.phase).toBe("develop-active");
    expect(envelope?.project.name).toBe("z3-eval");
    expect(envelope?.services.map((service) => service.hostname)).toEqual(["apidev", "db"]);
    expect(envelope?.workSession?.intent).toBe("add health endpoint");
    expect(envelope?.workSession?.deploys?.apidev?.[0]?.success).toBe(true);
    expect(envelope?.bootstrap?.route).toBe("classic");
  });

  it("accepts a phase this build has never heard of", () => {
    // zcp added `launch-production-active` after the client shipped; a literal
    // union here would blank the whole strip instead of one field.
    const envelope = decodeZeropsEnvelope(envelopeJson({ phase: "some-future-phase" }));
    expect(envelope?.phase).toBe("some-future-phase");
  });

  it("ignores unknown fields, at the top level and inside a service", () => {
    const raw = JSON.parse(envelopeJson()) as Record<string, unknown>;
    raw.futureField = { anything: true };
    (raw.services as Array<Record<string, unknown>>)[0]!.futureServiceField = 42;
    const envelope = decodeZeropsEnvelope(JSON.stringify(raw));
    expect(envelope?.services).toHaveLength(2);
    expect(envelope?.services[0]?.hostname).toBe("apidev");
  });

  it("drops a service it cannot decode rather than failing the envelope", () => {
    const raw = JSON.parse(envelopeJson()) as Record<string, unknown>;
    (raw.services as Array<unknown>).push({ hostname: 17 });
    const envelope = decodeZeropsEnvelope(JSON.stringify(raw));
    expect(envelope?.services.map((service) => service.hostname)).toEqual(["apidev", "db"]);
  });

  it.each([
    ["not JSON", "not json"],
    ["JSON that is not an object", "[1,2,3]"],
    ["an object missing required fields", '{"phase":"idle"}'],
  ])("returns undefined for %s", (_label, body) => {
    expect(decodeZeropsEnvelope(body)).toBeUndefined();
  });
});

describe("extractZeropsEnvelope", () => {
  it("reads the envelope out of a rendered tool result", () => {
    expect(extractZeropsEnvelope(resultText())?.phase).toBe("develop-active");
  });

  it("does NOT fall back to an earlier block when the last one is malformed", () => {
    // Mirrors `workflow.ExtractEnvelope`: an unparseable last *complete* block
    // means the reducer keeps its previous state. Silently adopting an older
    // envelope would move the strip backwards.
    const text = `${block(envelopeJson({ phase: "idle" }))}\n\n${block("not json")}`;
    expect(extractZeropsEnvelope(text)).toBeUndefined();
  });

  it.each([
    ["no block at all", "## Status\n\nPhase: idle\n"],
    ["a malformed block", `text\n\n${"```"}${ZEROPS_ENVELOPE_FENCE}\nnot json\n${"```"}\n`],
    ["an unterminated block", `text\n\n${"```"}${ZEROPS_ENVELOPE_FENCE}\n{"phase":"idle"}\n`],
  ])("returns undefined for %s", (_label, text) => {
    expect(extractZeropsEnvelope(text)).toBeUndefined();
  });
});
