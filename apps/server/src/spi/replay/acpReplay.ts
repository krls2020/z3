// @effect-diagnostics nodeBuiltinImport:off
/**
 * ACP baseline replay (Cursor, Grok): unlike Claude/Codex there is no
 * static wire capture to replay from — these drivers speak the Agent
 * Client Protocol over a real child process, and the ported test suite's
 * own way of pinning that behavior deterministically is
 * `apps/server/scripts/acp-mock-agent.ts`, a scripted ACP peer driven by
 * `T3_ACP_EMIT_*`/`T3_ACP_HANG_*` env vars (see CursorAdapter.test.ts,
 * GrokAdapter.test.ts). This module reuses that exact mock, undriven by
 * any extra env var, to record the same deterministic "hello" baseline
 * both ported test suites already assert on (fixed mock session id
 * "mock-session-1", fixed assistant reply "hello from mock") — through
 * the real, unmodified `makeCursorAdapter`/`makeGrokAdapter`, no fake
 * layer standing in for ACP itself.
 *
 * There being no static fixture to replay, `recordCursorBaseline`/
 * `recordGrokBaseline` run the whole scenario live each time — the
 * "fixture" for these two drivers is the mock script + this fixed
 * scenario (documented in their meta.json), not a `.jsonl` file.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CursorSettings,
  GrokSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import { makeCursorAdapter } from "../../provider/Layers/CursorAdapter.ts";
import { makeGrokAdapter } from "../../provider/Layers/GrokAdapter.ts";

const decodeCursorSettings = Schema.decodeSync(CursorSettings);
const decodeGrokSettings = Schema.decodeSync(GrokSettings);

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");
const mockAgentCommand = process.execPath;

async function makeMockAgentWrapper(): Promise<string> {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "spi-acp-mock-"));
  const wrapperPath = NodePath.join(dir, "fake-agent.sh");
  const script = `#!/bin/sh\nexec ${JSON.stringify(mockAgentCommand)} ${JSON.stringify(mockAgentPath)} "$@"\n`;
  await NodeFSP.writeFile(wrapperPath, script, "utf8");
  await NodeFSP.chmod(wrapperPath, 0o755);
  return wrapperPath;
}

const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "spi-acp-replay-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

/** Runs `adapter` through the fixed "hello" baseline and returns every event up to and including turn.completed. */
function runBaseline<EStart, ESend, EStop>(
  adapter: {
    readonly streamEvents: Stream.Stream<ProviderRuntimeEvent, never>;
    readonly startSession: (input: {
      readonly threadId: ThreadId;
      readonly provider: ReturnType<typeof ProviderDriverKind.make>;
      readonly cwd: string;
      readonly runtimeMode: "full-access";
      readonly modelSelection: { readonly instanceId: ProviderInstanceId; readonly model: string };
    }) => Effect.Effect<unknown, EStart>;
    readonly sendTurn: (input: {
      readonly threadId: ThreadId;
      readonly input: string;
      readonly attachments: ReadonlyArray<never>;
    }) => Effect.Effect<unknown, ESend>;
    readonly stopSession: (threadId: ThreadId) => Effect.Effect<unknown, EStop>;
  },
  input: {
    readonly threadId: ThreadId;
    readonly provider: ReturnType<typeof ProviderDriverKind.make>;
    readonly model: string;
    readonly turnInput: string;
  },
): Effect.Effect<ReadonlyArray<ProviderRuntimeEvent>, EStart | ESend | EStop> {
  return Effect.gen(function* () {
    const events: Array<ProviderRuntimeEvent> = [];
    const turnCompleted = yield* Deferred.make<void>();

    const collectorFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
      Effect.sync(() => {
        events.push(event);
      }).pipe(
        Effect.andThen(
          event.type === "turn.completed"
            ? Deferred.succeed(turnCompleted, undefined)
            : Effect.void,
        ),
      ),
    ).pipe(Effect.forkChild);

    yield* adapter.startSession({
      threadId: input.threadId,
      provider: input.provider,
      cwd: process.cwd(),
      runtimeMode: "full-access",
      modelSelection: {
        instanceId: ProviderInstanceId.make(String(input.provider)),
        model: input.model,
      },
    });

    yield* adapter.sendTurn({
      threadId: input.threadId,
      input: input.turnInput,
      attachments: [],
    });

    yield* Deferred.await(turnCompleted);
    // A trailing event (e.g. Cursor's item.completed for the assistant
    // message) can arrive slightly after turn.completed rather than before
    // it — give the stream a short quiescence window before cutting it off,
    // so the baseline captures the full deterministic sequence regardless
    // of exactly where turn.completed lands in it.
    yield* Effect.sleep("500 millis");
    yield* Fiber.interrupt(collectorFiber);
    yield* adapter.stopSession(input.threadId);

    return events;
  });
}

export async function recordCursorBaseline(): Promise<ReadonlyArray<ProviderRuntimeEvent>> {
  const wrapperPath = await makeMockAgentWrapper();
  const cursorConfig = decodeCursorSettings({ binaryPath: wrapperPath });

  const program = Effect.gen(function* () {
    const adapter = yield* makeCursorAdapter(cursorConfig);
    return yield* runBaseline(adapter, {
      threadId: ThreadId.make("spi-replay-cursor-thread"),
      provider: ProviderDriverKind.make("cursor"),
      model: "default",
      turnInput: "hello mock",
    });
  });

  return Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(testLayer)));
}

export async function recordGrokBaseline(): Promise<ReadonlyArray<ProviderRuntimeEvent>> {
  const wrapperPath = await makeMockAgentWrapper();
  const grokConfig = decodeGrokSettings({ binaryPath: wrapperPath });

  const program = Effect.gen(function* () {
    const adapter = yield* makeGrokAdapter(grokConfig);
    return yield* runBaseline(adapter, {
      threadId: ThreadId.make("spi-replay-grok-thread"),
      provider: ProviderDriverKind.make("grok"),
      model: "grok-mock-alt",
      turnInput: "hello grok",
    });
  });

  return Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(testLayer)));
}
