/**
 * Which landing the chat index shows. Extracted from the route so the one
 * decision it makes is pinned by a test: the Zerops onboarding replaces the
 * hosted-static empty state, and nothing else.
 */

export type ChatIndexView = "zerops-onboarding" | "draft-landing";

export function resolveChatIndexView(input: {
  readonly authGateStatus: string;
  readonly environmentCount: number;
}): ChatIndexView {
  // Only the hosted static client with nothing connected yet: a self-hosted
  // client, or one that already has an environment, keeps upstream's flow.
  return input.authGateStatus === "hosted-static" && input.environmentCount === 0
    ? "zerops-onboarding"
    : "draft-landing";
}
