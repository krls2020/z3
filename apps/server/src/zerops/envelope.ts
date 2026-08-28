/**
 * Reads zcp's `workflow.StateEnvelope` back out of a tool result's text.
 *
 * The envelope rides inside the text as a trailing fenced block rather than in
 * MCP's `structuredContent`, because Claude Code replaces the model-facing tool
 * result with `structuredContent` when it is present — which would strip every
 * atom of guidance the result renders (measured live; `../z3/docs/internals/
 * zerops/verified.md`, section "S6 PROVE"). Both Claude Code and Codex forward
 * the text verbatim.
 *
 * This is the TypeScript mirror of zcp's `workflow.ExtractEnvelope`
 * (`internal/workflow/envelope_wire.go`); the contract it implements is
 * `docs/spec-z3.md` §1.2. Keep the two in step — the sharp edges below are
 * deliberate, not incidental.
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ZeropsStateEnvelope } from "@t3tools/contracts";

/**
 * The info string of the fenced block. Two words on purpose: `json` keeps the
 * block highlighted and ignorable for a human reader, `zcp-envelope` is the
 * selector a machine reducer matches on.
 */
export const ZEROPS_ENVELOPE_FENCE = "json zcp-envelope";

const OPEN_FENCE = `\`\`\`${ZEROPS_ENVELOPE_FENCE}`;
const CLOSE_FENCE = "```";

/** Trailing horizontal whitespace, `\r` included — a CRLF result must still match. */
const trimLineEnd = (line: string): string => line.replace(/[ \t\r]+$/, "");

const isAtLineStart = (text: string, index: number): boolean =>
  index === 0 || text[index - 1] === "\n";

/** True when nothing but horizontal whitespace follows `index` on its line. */
const isRestOfLineBlank = (text: string, index: number): boolean => {
  const newline = text.indexOf("\n", index);
  const lineEnd = newline < 0 ? text.length : newline;
  return trimLineEnd(text.slice(index, lineEnd)) === "";
};

/**
 * Offset of the last line that consists solely of the opening fence, searching
 * within `text` up to `limit`, or -1.
 *
 * The match is line-anchored: a fence MENTIONED mid-line — prose describing
 * this very format, which agent-facing guidance does — is text, not structure.
 */
const findLastFenceOpen = (text: string, limit: number): number => {
  let from = Math.min(limit, text.length) - OPEN_FENCE.length;
  while (from >= 0) {
    const index = text.lastIndexOf(OPEN_FENCE, from);
    if (index < 0) {
      return -1;
    }
    if (isAtLineStart(text, index) && isRestOfLineBlank(text, index + OPEN_FENCE.length)) {
      return index;
    }
    from = index - 1;
  }
  return -1;
};

/** The trimmed body of the block opening at `openIndex`, or undefined when it never closes. */
const readBlockBody = (text: string, openIndex: number): string | undefined => {
  const newline = text.indexOf("\n", openIndex);
  if (newline < 0) {
    return undefined;
  }
  const bodyStart = newline + 1;

  let position = bodyStart;
  while (position <= text.length) {
    const nextNewline = text.indexOf("\n", position);
    const lineEnd = nextNewline < 0 ? text.length : nextNewline;
    if (trimLineEnd(text.slice(position, lineEnd)) === CLOSE_FENCE) {
      return text.slice(bodyStart, position).trim();
    }
    if (nextNewline < 0) {
      break;
    }
    position = nextNewline + 1;
  }
  return undefined;
};

/**
 * The body of the last COMPLETE envelope block in `text`, or undefined.
 *
 * "Last complete" carries the reducer rule: a transcript may concatenate
 * several tool results and the newest state is the last block. An unterminated
 * block — a truncated stream — is not state, so the scan continues backwards
 * past it. Whether the body parses is not decided here (see
 * {@link extractZeropsEnvelope}).
 */
export const extractZeropsEnvelopeBlock = (text: string): string | undefined => {
  let limit = text.length;
  for (;;) {
    const openIndex = findLastFenceOpen(text, limit);
    if (openIndex < 0) {
      return undefined;
    }
    const body = readBlockBody(text, openIndex);
    if (body !== undefined) {
      return body;
    }
    limit = openIndex;
  }
};

const decodeEnvelope = Schema.decodeUnknownOption(ZeropsStateEnvelope);

/** Decodes a block body into an envelope, or undefined when it is not one. */
export const decodeZeropsEnvelope = (body: string): ZeropsStateEnvelope | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  return Option.getOrUndefined(decodeEnvelope(parsed));
};

/**
 * The envelope carried by a tool result's text, or undefined when it carries
 * none the reducer can trust.
 *
 * A malformed body is IGNORED, and deliberately does not fall back to an
 * earlier block: the caller keeps the state it already has. Adopting an older
 * envelope because the newest one was corrupt would move the client's lifecycle
 * strip backwards, which is worse than not moving it at all.
 */
export const extractZeropsEnvelope = (text: string): ZeropsStateEnvelope | undefined => {
  const body = extractZeropsEnvelopeBlock(text);
  return body === undefined ? undefined : decodeZeropsEnvelope(body);
};
