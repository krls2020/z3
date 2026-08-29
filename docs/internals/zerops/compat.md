# SPI compatibility matrix

One row per port: the ported upstream SHA against the CLI/SDK/Effect versions and fixture set the
SPI was proven against at that point. A new row lands with every port (`spi.md` §8, porting
checklist step 5) — never edited in place; a later row supersedes an earlier one.

| #   | Date       | Ported upstream SHA                                                    | Claude CLI              | Claude Agent SDK | Codex CLI                               | Effect                                           | Fixture set                                                                                                                                                          | Goldens/driver                                            | Notes     |
| --- | ---------- | ---------------------------------------------------------------------- | ----------------------- | ---------------- | --------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------- |
| 0   | 2026-08-29 | `f94a0d646` (`upstream-base-2026-08-28`, freeze SHA — `imported.lock`) | `2.1.251` (Claude Code) | `0.3.250`        | `0.150.1` on the rig, **not logged in** | `4.0.0-beta.103` (`pnpm-workspace.yaml` catalog) | claude: `plain-text-turn`, `turn-abort-error`, `user-input-requested`, `zerops-workflow-envelope`; codex: `multi-agent-wire`; cursor/grok/opencode: `hello-baseline` | claude 4, codex 1, cursor 1, grok 1, opencode 1 (8 total) | See below |

## Row 0 notes

- **Claude**: all 4 fixtures are real recordings from `z3-eval`'s `zcp` service, captured
  2026-08-29 with the CLI/SDK versions above and model `claude-opus-5[1m]`
  (`fixtures/claude/*.meta.json`).
- **Codex**: `multi-agent-wire` is not a recording from this rig — Codex is not logged in on
  `z3-eval`. It is `apps/server/src/provider/testFixtures/codexMultiAgentWire.json` (an existing
  upstream ported-zone test fixture, itself a real wire capture) converted once to the SPI JSONL
  format; its own `meta.json` records `codex-cli 0.145.0`, the version that capture was made
  with — **not** the rig's installed `0.150.1`. Treat the Codex column as "rig has 0.150.1
  installed, unverified against a live session" until a logged-in capture replaces this row.
- **Cursor/Grok/OpenCode**: no CLI/SDK version applies — these three goldens are not wire
  captures. Cursor and Grok replay `apps/server/scripts/acp-mock-agent.ts` (a scripted ACP peer)
  through the real, unmodified `makeCursorAdapter`/`makeGrokAdapter`; OpenCode replays a canned
  SSE sequence through the real `makeOpenCodeAdapter` against a minimal test double of
  `OpenCodeRuntime`. All three are `synthetic: true` — see `spi.md` §7.
- **Effect**: the workspace-wide `effect` catalog version; every `@effect/*` package pins to the
  same catalog entry (`pnpm-workspace.yaml`).
