import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ProcessRunner from "../processRunner.ts";
import * as ZeropsCli from "./ZeropsCli.ts";

const liveDependencies = Layer.mergeAll(
  ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer)),
  NodeServices.layer,
);

type CliService = ZeropsCli.ZeropsCli["Service"];
type CliEffect = ReturnType<typeof ZeropsCli.make>;

/** A stand-in for the `zcp` binary: `node -e <script>` ignores the studio args. */
const stub = (script: string): CliEffect =>
  ZeropsCli.make({ command: process.execPath, baseArgs: ["-e", script], cwd: process.cwd() });

const missingBinary = (): CliEffect =>
  ZeropsCli.make({
    command: "definitely-not-a-real-binary-zcp",
    baseArgs: [],
    cwd: process.cwd(),
  });

const topologyDocument = JSON.stringify({
  project: { id: "proj-1", name: "z3-eval", status: "ACTIVE" },
  services: [
    {
      hostname: "kanbandev",
      serviceId: "svc-1",
      type: "nodejs@22",
      status: "ACTIVE",
      adoptionState: "adopted",
      isInfrastructure: false,
      mountPath: "/var/www/kanbandev",
    },
  ],
});

/** The document as a JS string literal the `node -e` stub can print back. */
const topologyDocumentLiteral = JSON.stringify(topologyDocument);

const run = <A, E>(cli: CliEffect, use: (cli: CliService) => Effect.Effect<A, E>) =>
  cli.pipe(Effect.flatMap(use), Effect.provide(liveDependencies));

describe("ZeropsCli.readTopology", () => {
  it.effect("parses the document the CLI prints on stdout", () =>
    Effect.gen(function* () {
      const topology = yield* run(
        stub(`process.stdout.write(${topologyDocumentLiteral})`),
        (cli) => cli.readTopology,
      );
      expect(topology.project.name).toBe("z3-eval");
      expect(topology.services[0]?.hostname).toBe("kanbandev");
      expect(topology.services[0]?.mounted).toBe(true);
    }),
  );

  it.effect("reports a missing binary as not-found, distinct from a failure", () =>
    Effect.gen(function* () {
      const error = yield* run(missingBinary(), (cli) => Effect.flip(cli.readTopology));
      // A non-Zerops environment must switch the feed off silently; a zcp that
      // is present but failing must keep retrying. Conflating them would either
      // spam errors forever or give up on a transient auth blip.
      expect(error._tag).toBe("ZeropsCliNotFound");
    }),
  );

  it.effect("reports a non-zero exit as a failure carrying the diagnostic", () =>
    Effect.gen(function* () {
      const error = yield* run(
        stub(`process.stderr.write("auth: token expired\\n"); process.exit(1)`),
        (cli) => Effect.flip(cli.readTopology),
      );
      expect(error._tag).toBe("ZeropsCliFailed");
      expect(String((error as { reason?: string }).reason)).toContain("auth: token expired");
    }),
  );

  it.effect("reports unreadable stdout as a failure, not as an empty project", () =>
    Effect.gen(function* () {
      const error = yield* run(
        stub(`process.stdout.write("zcp: something went sideways")`),
        (cli) => Effect.flip(cli.readTopology),
      );
      expect(error._tag).toBe("ZeropsCliFailed");
    }),
  );
});

describe("ZeropsCli.markAgentOAuth", () => {
  it.effect("parses the result the CLI prints on stdout", () =>
    Effect.gen(function* () {
      const result = yield* run(
        stub(
          `process.stdout.write('{"ok":true,"agent":"claude-code","key":"ZCP_AGENT_OAUTH_CLAUDE_CODE","changed":true}')`,
        ),
        (cli) => cli.markAgentOAuth("claude-code"),
      );
      expect(result).toEqual({
        key: "ZCP_AGENT_OAUTH_CLAUDE_CODE",
        changed: true,
        migrated: false,
      });
    }),
  );

  it.effect("reports a missing binary as not-found, distinct from a failure", () =>
    Effect.gen(function* () {
      const error = yield* run(missingBinary(), (cli) => Effect.flip(cli.markAgentOAuth("codex")));
      expect(error._tag).toBe("ZeropsCliNotFound");
    }),
  );

  it.effect("reports a non-zero exit as a failure carrying the diagnostic", () =>
    Effect.gen(function* () {
      const error = yield* run(
        stub(
          `process.stderr.write("agent mark-oauth: not inside a Zerops container\\n"); process.exit(1)`,
        ),
        (cli) => Effect.flip(cli.markAgentOAuth("codex")),
      );
      expect(error._tag).toBe("ZeropsCliFailed");
      expect(String((error as { reason?: string }).reason)).toContain(
        "not inside a Zerops container",
      );
    }),
  );

  it.effect("reports unreadable stdout as a failure", () =>
    Effect.gen(function* () {
      const error = yield* run(
        stub(`process.stdout.write("zcp: something went sideways")`),
        (cli) => Effect.flip(cli.markAgentOAuth("codex")),
      );
      expect(error._tag).toBe("ZeropsCliFailed");
    }),
  );
});

describe("ZeropsCli.watchDoorbell", () => {
  it.effect("delivers NDJSON events until the child exits", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<Array<string>>([]);
      yield* run(
        stub(
          `const w=(t)=>process.stdout.write(JSON.stringify({type:t})+"\\n");` +
            `w("connected");w("topology-changed");process.exit(0)`,
        ),
        (cli) => cli.watchDoorbell((event) => Ref.update(seen, (all) => [...all, event.type])),
      );
      expect(yield* Ref.get(seen)).toEqual(["connected", "topology-changed"]);
    }),
  );

  it.effect("keeps the child's stdin open so the watcher is not cancelled at spawn", () =>
    Effect.gen(function* () {
      // `zcp studio watch` exits when its parent closes stdin
      // (`cmd/zcp/studio.go:302-305`), so the spawn must keep stdin an open
      // pipe. The stub reports which happened: it emits `disconnected` if stdin
      // reached EOF before it finished, `topology-changed` if it stayed open.
      // The test itself waits on the child exiting, not on a clock.
      const seen = yield* Ref.make<Array<string>>([]);
      yield* run(
        stub(
          `let ended=false;process.stdin.on("end",()=>{ended=true});` +
            `const w=(t)=>process.stdout.write(JSON.stringify({type:t})+"\\n");` +
            `w("connected");` +
            `setTimeout(()=>{w(ended?"disconnected":"topology-changed");process.exit(0)},50)`,
        ),
        (cli) => cli.watchDoorbell((event) => Ref.update(seen, (all) => [...all, event.type])),
      );
      expect(yield* Ref.get(seen)).toEqual(["connected", "topology-changed"]);
    }),
  );

  it.effect("ignores a line that is not a doorbell event", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<Array<string>>([]);
      yield* run(
        stub(
          `process.stdout.write("not json\\n");` +
            `process.stdout.write(JSON.stringify({noType:true})+"\\n");` +
            `process.stdout.write(JSON.stringify({type:"connected"})+"\\n");` +
            `process.exit(0)`,
        ),
        (cli) => cli.watchDoorbell((event) => Ref.update(seen, (all) => [...all, event.type])),
      );
      expect(yield* Ref.get(seen)).toEqual(["connected"]);
    }),
  );

  it.effect("reports a missing binary as not-found", () =>
    Effect.gen(function* () {
      const error = yield* run(missingBinary(), (cli) =>
        Effect.flip(cli.watchDoorbell(() => Effect.void)),
      );
      expect(error._tag).toBe("ZeropsCliNotFound");
    }),
  );
});
