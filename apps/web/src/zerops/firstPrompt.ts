/**
 * The first thing said in a newly connected Zerops environment.
 *
 * zcp only introduces itself once a conversation exists, so a freshly
 * connected project would otherwise open on an empty thread with no sign that
 * anything is there. This composes one opening message — exactly once per
 * environment, and only for environments reached through the Zerops door: a
 * manually paired backend is somebody else's setup and must not be written
 * into.
 */

export const ZEROPS_FIRST_PROMPT_STORAGE_KEY = "zerops-code.first-prompt.v1";

/** Which registered environments were reached through the Zerops door. */
export const ZEROPS_ENVIRONMENTS_STORAGE_KEY = "zerops-code.zerops-environments.v1";

export const ZEROPS_ONBOARDING_PROMPT =
  "I just opened Zerops Code on this project. Introduce yourself, tell me what is running here, and what we could do next.";

/** How the environment came to be registered. */
export type ZeropsConnectionOrigin = "zerops-identity" | "pairing";

export function shouldComposeFirstPrompt(input: {
  readonly environmentId: string;
  readonly alreadyComposed: ReadonlyArray<string>;
  readonly connectedVia: ZeropsConnectionOrigin;
}): boolean {
  // A manually paired environment is not ours to open a conversation in.
  if (input.connectedVia !== "zerops-identity") return false;
  if (!input.environmentId) return false;
  return !input.alreadyComposed.includes(input.environmentId);
}

export function withFirstPromptComposed(
  alreadyComposed: ReadonlyArray<string>,
  environmentId: string,
): ReadonlyArray<string> {
  return alreadyComposed.includes(environmentId)
    ? alreadyComposed
    : [...alreadyComposed, environmentId];
}

/** Parses the marker list, treating anything unexpected as "nothing composed yet". */
export function parseFirstPromptMarkers(raw: string | null): ReadonlyArray<string> {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string" && value.length > 0);
  } catch {
    return [];
  }
}

export function readFirstPromptMarkers(): ReadonlyArray<string> {
  return readStringList(ZEROPS_FIRST_PROMPT_STORAGE_KEY);
}

export function rememberFirstPromptComposed(environmentId: string): void {
  // Worst case the record is lost and the prompt is composed again, which is a
  // filled-in composer, not a sent message.
  appendStringList(ZEROPS_FIRST_PROMPT_STORAGE_KEY, environmentId);
}

function readStringList(key: string): ReadonlyArray<string> {
  try {
    return parseFirstPromptMarkers(window.localStorage.getItem(key));
  } catch {
    return [];
  }
}

function appendStringList(key: string, value: string): void {
  try {
    const next = withFirstPromptComposed(readStringList(key), value);
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // See above: losing the record only costs a second composed prompt.
  }
}

/** Records that this environment came from the Zerops door, not from pairing. */
export function rememberZeropsEnvironment(environmentId: string): void {
  appendStringList(ZEROPS_ENVIRONMENTS_STORAGE_KEY, environmentId);
}

export function connectionOriginFor(environmentId: string): ZeropsConnectionOrigin {
  return readStringList(ZEROPS_ENVIRONMENTS_STORAGE_KEY).includes(environmentId)
    ? "zerops-identity"
    : "pairing";
}
