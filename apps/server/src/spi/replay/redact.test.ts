import { assert, describe, it } from "vite-plus/test";

import { REDACTED_CREATED_AT, redact } from "./redact.ts";

describe("redact", () => {
  it("replaces eventId with a stable per-array sequence id", () => {
    const events = [
      { eventId: "11111111-1111-1111-1111-111111111111", type: "session.started" },
      { eventId: "22222222-2222-2222-2222-222222222222", type: "session.configured" },
    ];

    const result = redact(events);

    assert.equal(result[0]?.eventId, "evt-0");
    assert.equal(result[1]?.eventId, "evt-1");
  });

  it("leaves an event with no eventId field untouched by that rule", () => {
    const result = redact([{ type: "session.started" }]);
    assert.equal("eventId" in (result[0] ?? {}), false);
  });

  it("replaces createdAt with a fixed placeholder", () => {
    const events = [{ eventId: "e1", createdAt: "2026-08-28T12:34:56.789Z" }];
    const result = redact(events);
    assert.equal(result[0]?.createdAt, REDACTED_CREATED_AT);
  });

  it("rewrites an exact path match at the top level", () => {
    const events = [{ eventId: "e1", cwd: "/Users/dev/project" }];
    const result = redact(events, {
      paths: [{ path: "/Users/dev/project", placeholder: "<CWD>" }],
    });
    assert.equal(result[0]?.cwd, "<CWD>");
  });

  it("rewrites a path prefix nested arbitrarily deep in the payload", () => {
    const events = [
      {
        eventId: "e1",
        payload: {
          data: {
            files: ["/Users/dev/project/src/index.ts", "/Users/dev/project/README.md"],
          },
        },
      },
    ];
    const result = redact(events, {
      paths: [{ path: "/Users/dev/project", placeholder: "<CWD>" }],
    });
    assert.deepEqual((result[0]?.payload as { data: { files: unknown } })?.data.files, [
      "<CWD>/src/index.ts",
      "<CWD>/README.md",
    ]);
  });

  it("prefers the longest matching path rule (cwd nested under home)", () => {
    const events = [{ eventId: "e1", path: "/Users/dev/project/file.ts" }];
    const result = redact(events, {
      paths: [
        { path: "/Users/dev", placeholder: "<HOME>" },
        { path: "/Users/dev/project", placeholder: "<CWD>" },
      ],
    });
    assert.equal(result[0]?.path, "<CWD>/file.ts");
  });

  it("does not touch a string that merely contains a path as a substring, not a path segment", () => {
    const events = [{ eventId: "e1", note: "/Users/dev/projectile" }];
    const result = redact(events, {
      paths: [{ path: "/Users/dev/project", placeholder: "<CWD>" }],
    });
    assert.equal(result[0]?.note, "/Users/dev/projectile");
  });

  it("is a pure function: does not mutate the input array or its objects", () => {
    const original = { eventId: "e1", createdAt: "2026-01-01T00:00:00.000Z", nested: { a: 1 } };
    const events = [original];
    redact(events, { paths: [] });
    assert.equal(original.eventId, "e1");
    assert.equal(original.createdAt, "2026-01-01T00:00:00.000Z");
  });
});
