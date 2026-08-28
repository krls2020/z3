/**
 * Mobile's Zerops API surface — the shared client lives in
 * `@t3tools/client-runtime/zerops`; this file only supplies the one thing
 * that's genuinely mobile-specific, an Expo build-time base URL override.
 */
import { DEFAULT_ZEROPS_API_BASE } from "@t3tools/client-runtime/zerops";

export * from "@t3tools/client-runtime/zerops";

export const ZEROPS_API_BASE = (
  process.env.EXPO_PUBLIC_ZEROPS_API_URL ?? DEFAULT_ZEROPS_API_BASE
).replace(/\/+$/, "");
