import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { ChatAttachment } from "@t3tools/contracts";

import { OpenCodeRuntime, type OpenCodeRuntimeShape } from "../provider/opencodeRuntime.ts";
import {
  openCodeRuntimeCapability,
  openCodeRuntimeErrorDetail,
  parseOpenCodeModelSlug,
  toOpenCodeFileParts,
} from "./openCodeRuntime.ts";

const unusedMember = () => Effect.die("not used by OpenCodeRuntimeCapability's contract test");

const makeFakeShape = (): OpenCodeRuntimeShape => ({
  startOpenCodeServerProcess: (input) =>
    Effect.succeed({
      url: `http://127.0.0.1:4300?binaryPath=${input.binaryPath}`,
      exitCode: Effect.never,
    }),
  connectToOpenCodeServer: unusedMember,
  runOpenCodeCommand: unusedMember,
  createOpenCodeSdkClient: (input) => ({ __fakeBaseUrl: input.baseUrl }) as never,
  loadOpenCodeInventory: unusedMember,
  loadInventoryFromCli: unusedMember,
});

describe("openCodeRuntimeCapability", () => {
  it.effect(
    "narrows the driver's runtime service to just the two members textGeneration uses",
    () =>
      Effect.gen(function* () {
        const capability = yield* openCodeRuntimeCapability.pipe(
          Effect.provideService(OpenCodeRuntime, makeFakeShape()),
        );

        const server = yield* capability
          .startOpenCodeServerProcess({ binaryPath: "/usr/local/bin/opencode" })
          .pipe(Effect.scoped);
        expect(server.url).toBe("http://127.0.0.1:4300?binaryPath=/usr/local/bin/opencode");

        const client = capability.createOpenCodeSdkClient({
          baseUrl: "http://127.0.0.1:4300",
          directory: "/tmp/project",
        });
        expect(client).toEqual({ __fakeBaseUrl: "http://127.0.0.1:4300" });
      }),
  );
});

describe("openCodeRuntimeErrorDetail", () => {
  it("extracts a plain Error's message", () => {
    expect(openCodeRuntimeErrorDetail(new Error("boom"))).toBe("boom");
  });
});

describe("parseOpenCodeModelSlug", () => {
  it("parses a provider/model slug and rejects a malformed one", () => {
    expect(parseOpenCodeModelSlug("openai/gpt-5")).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
    });
    expect(parseOpenCodeModelSlug("not-a-slug")).toBeNull();
    expect(parseOpenCodeModelSlug(undefined)).toBeNull();
  });
});

describe("toOpenCodeFileParts", () => {
  it("keeps native-eligible image attachments and resolves their file:// URL", () => {
    const attachment: ChatAttachment = {
      type: "image",
      id: "attachment-1",
      name: "screenshot.png",
      mimeType: "image/png",
      sizeBytes: 1024,
    };

    const parts = toOpenCodeFileParts({
      attachments: [attachment],
      resolveAttachmentPath: () => "/tmp/attachments/screenshot.png",
    });

    expect(parts).toEqual([
      {
        type: "file",
        mime: "image/png",
        filename: "screenshot.png",
        url: "file:///tmp/attachments/screenshot.png",
      },
    ]);
  });

  it("drops an attachment the resolver can't locate on disk", () => {
    const attachment: ChatAttachment = {
      type: "image",
      id: "attachment-2",
      name: "gone.png",
      mimeType: "image/png",
      sizeBytes: 1024,
    };

    expect(
      toOpenCodeFileParts({ attachments: [attachment], resolveAttachmentPath: () => null }),
    ).toEqual([]);
  });
});
