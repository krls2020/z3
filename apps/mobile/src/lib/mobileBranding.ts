export type MobileStageLabel = "Alpha" | "Dev" | "Nightly";

export const MOBILE_APP_NAME = "Zerops Code";
export const MOBILE_AUTH_CLIENT_LABEL = `${MOBILE_APP_NAME} Mobile`;

export function resolveMobileStageLabel(appVariant: unknown): MobileStageLabel {
  if (appVariant === "development") return "Dev";
  if (appVariant === "preview") return "Nightly";
  return "Alpha";
}
