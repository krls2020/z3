// @effect-diagnostics nodeBuiltinImport:off
/**
 * Claude replay: drives the real, ported `makeClaudeAdapter`
 * (apps/server/src/provider/Layers/ClaudeAdapter.ts) through its existing
 * `options.createQuery` test seam — the same seam
 * `ClaudeAdapter.test.ts`'s `FakeClaudeQuery` plugs into, and the exact
 * mechanism its "handles AskUserQuestion via
 * user-input.requested/resolved lifecycle" test (ClaudeAdapter.test.ts:4511)
 * exercises. No production code is changed or exported for this: the
 * adapter's shape already returns `respondToUserInput`/`respondToRequest`,
 * and `createQuery`'s captured `options` already carries the
 * `canUseTool`/`onUserDialog` callbacks the adapter registers
 * (ClaudeAdapter.ts:4330-4331).
 *
 * A fixture's `message` lines are pushed onto a fake SDK message iterator
 * (ReplayClaudeQuery, a minimal from-scratch equivalent of the test file's
 * FakeClaudeQuery — that class lives in a .test.ts and isn't exported, so
 * it can't be imported without touching ported-zone files). A `control`
 * line invokes the named callback directly and, once the adapter emits the
 * matching request event, resolves it the way a real client would — via
 * `respondToUserInput`/`respondToRequest` — before continuing to the next
 * line.
 *
 * Only `canUseTool` control lines are implemented (the required proof is
 * the AskUserQuestion round trip). A fixture with an `onUserDialog` control
 * line throws naming the gap rather than silently mis-replaying it.
 */
import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import type {
  CanUseTool,
  Options as ClaudeQueryOptions,
  PermissionMode,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  ApprovalRequestId,
  ClaudeSettings,
  ProviderDriverKind,
  type ProviderRuntimeEvent,
  ThreadId,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  makeClaudeAdapter,
  type ClaudeAdapterLiveOptions,
} from "../../provider/Layers/ClaudeAdapter.ts";

import type { Fixture, FixtureControlLine } from "./types.ts";

const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);

const REPLAY_THREAD_ID = ThreadId.make("spi-replay-claude-thread");
const REPLAY_TURN_INPUT = "spi replay turn";

/**
 * Minimal from-scratch equivalent of ClaudeAdapter.test.ts's FakeClaudeQuery
 * (not exported from that .test.ts file, so it can't be imported here).
 * Implements just enough of the SDK's query surface for `makeClaudeAdapter`
 * to run against: an AsyncIterable the adapter pulls SDKMessages from, fed
 * by `emit`.
 */
class ReplayClaudeQuery implements AsyncIterable<SDKMessage> {
  private readonly queue: Array<SDKMessage> = [];
  private readonly waiters: Array<(result: IteratorResult<SDKMessage>) => void> = [];
  private done = false;

  emit(message: SDKMessage): void {
    if (this.done) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ done: false, value: message });
      return;
    }
    this.queue.push(message);
  }

  readonly setModel = async (_model?: string): Promise<void> => {};
  readonly setPermissionMode = async (_mode: PermissionMode): Promise<void> => {};
  readonly setMaxThinkingTokens = async (_maxThinkingTokens: number | null): Promise<void> => {};

  readonly close = (): void => {
    this.done = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ done: true, value: undefined });
    }
  };

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: () => {
        if (this.queue.length > 0) {
          return Promise.resolve({ done: false, value: this.queue.shift() as SDKMessage });
        }
        if (this.done) {
          return Promise.resolve({ done: true, value: undefined });
        }
        return new Promise((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}

/** Collects every emitted event and lets callers await the next one matching a predicate. */
function makeEventCollector() {
  const events: Array<ProviderRuntimeEvent> = [];
  const waiters: Array<{
    readonly predicate: (event: ProviderRuntimeEvent) => boolean;
    readonly deferred: Deferred.Deferred<ProviderRuntimeEvent>;
  }> = [];

  const offer = (event: ProviderRuntimeEvent): Effect.Effect<void> => {
    events.push(event);
    const matchIndex = waiters.findIndex((waiter) => waiter.predicate(event));
    if (matchIndex === -1) {
      return Effect.void;
    }
    const [waiter] = waiters.splice(matchIndex, 1);
    return Deferred.succeed(waiter!.deferred, event).pipe(Effect.asVoid);
  };

  const waitFor = (
    predicate: (event: ProviderRuntimeEvent) => boolean,
  ): Effect.Effect<ProviderRuntimeEvent> =>
    Effect.gen(function* () {
      const existing = events.find(predicate);
      if (existing) return existing;
      const deferred = yield* Deferred.make<ProviderRuntimeEvent>();
      waiters.push({ predicate, deferred });
      return yield* Deferred.await(deferred);
    });

  return { events, offer, waitFor };
}

interface ClaudeUserInputAnswer {
  readonly kind: "userInput";
  readonly answers: Record<string, string>;
}

interface ClaudeApprovalAnswer {
  readonly kind: "approval";
  readonly decision: "accept" | "acceptForSession" | "decline" | "cancel";
}

/**
 * Runs a fixture's message/control lines against a fresh Claude adapter
 * instance and returns every `ProviderRuntimeEvent` it emitted, in order.
 */
export async function replayClaude(fixture: Fixture): Promise<ReadonlyArray<ProviderRuntimeEvent>> {
  const claudeConfig = decodeClaudeSettings({});
  const query = new ReplayClaudeQuery();
  let createInput:
    | { readonly prompt: AsyncIterable<SDKUserMessage>; readonly options: ClaudeQueryOptions }
    | undefined;

  const adapterOptions: ClaudeAdapterLiveOptions = {
    createQuery: (input) => {
      createInput = input;
      return query;
    },
  };

  const program = Effect.gen(function* () {
    const adapter = yield* makeClaudeAdapter(claudeConfig, adapterOptions);
    const collector = makeEventCollector();
    yield* Stream.runForEach(adapter.streamEvents, collector.offer).pipe(Effect.forkScoped);

    yield* adapter.startSession({
      threadId: REPLAY_THREAD_ID,
      provider: ProviderDriverKind.make("claudeAgent"),
      runtimeMode: "full-access",
    });

    if (!createInput) {
      return yield* Effect.die(new Error("createQuery was never invoked by startSession"));
    }
    const options = createInput.options;

    yield* adapter.sendTurn({
      threadId: REPLAY_THREAD_ID,
      input: REPLAY_TURN_INPUT,
      attachments: [],
    });

    const applyControlLine = (line: FixtureControlLine) =>
      Effect.gen(function* () {
        if (line.name !== "canUseTool") {
          return yield* Effect.die(
            new Error(
              `replayClaude does not implement control line "${line.name}" yet (only "canUseTool" is proven) — see claudeReplay.ts`,
            ),
          );
        }

        const canUseTool = options.canUseTool as CanUseTool | undefined;
        if (!canUseTool) {
          return yield* Effect.die(new Error("createQuery options carried no canUseTool callback"));
        }

        const args = line.args as {
          readonly toolName: string;
          readonly toolInput: Record<string, unknown>;
          readonly toolUseID?: string;
        };

        const resultPromise = canUseTool(args.toolName, args.toolInput, {
          signal: new AbortController().signal,
          toolUseID: args.toolUseID ?? "spi-replay-tool-use",
        });

        const requested = yield* collector.waitFor(
          (event) => event.type === "user-input.requested" || event.type === "request.opened",
        );

        if (requested.type === "user-input.requested") {
          const answer = line.answer as ClaudeUserInputAnswer;
          if (answer.kind !== "userInput") {
            return yield* Effect.die(
              new Error(
                'fixture answer.kind must be "userInput" to resolve a user-input.requested event',
              ),
            );
          }
          yield* adapter.respondToUserInput(
            REPLAY_THREAD_ID,
            ApprovalRequestId.make(String(requested.requestId)),
            answer.answers,
          );
        } else {
          const answer = line.answer as ClaudeApprovalAnswer;
          if (answer.kind !== "approval") {
            return yield* Effect.die(
              new Error('fixture answer.kind must be "approval" to resolve a request.opened event'),
            );
          }
          yield* adapter.respondToRequest(
            REPLAY_THREAD_ID,
            ApprovalRequestId.make(String(requested.requestId)),
            answer.decision,
          );
        }

        // Awaiting the SDK-facing promise proves the round trip completes
        // ("the turn continues"): it only resolves after the adapter's
        // resolved event has been offered.
        yield* Effect.promise(() => resultPromise);
        yield* Effect.yieldNow;
      });

    for (const line of fixture.lines) {
      if (line.kind === "message") {
        query.emit(line.message as SDKMessage);
        yield* Effect.yieldNow;
        continue;
      }
      yield* applyControlLine(line);
    }

    // Let the collector fiber drain anything still in flight.
    yield* Effect.yieldNow;
    yield* Effect.yieldNow;

    return collector.events;
  });

  const testLayer = Layer.mergeAll(
    ServerConfig.layerTest(NodeOS.tmpdir(), NodeOS.tmpdir()),
    ServerSettingsService.layerTest(),
  ).pipe(Layer.provideMerge(NodeServices.layer));

  return Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(testLayer)));
}
