/**
 * Cloudflare Turnstile on the Zerops sign-up form.
 *
 * The platform enforces it: a complete `POST /registration` with no `token` is
 * refused with `cloudflareCaptchaVerificationFailed`. So the widget is always
 * rendered — there is no captcha-less path to design for.
 *
 * The site key belongs to Zerops and only renders on hostnames Zerops has
 * allowed. On any other origin the widget reports `110200 Domain not
 * authorized` and no token ever exists, which is why "unavailable" is a state
 * the UI has to show rather than an error to swallow: the fix is Zerops adding
 * the hostname, and until then the user signs up on app.zerops.io and comes
 * back here to sign in.
 */

import { useEffect, useState, type ReactNode } from "react";

/** Zerops' own site key, the one its GUI uses. Overridable per deployment. */
export const DEFAULT_ZEROPS_TURNSTILE_SITE_KEY = "0x4AAAAAABkfI4SNvJav8428";

export const ZEROPS_TURNSTILE_SITE_KEY =
  import.meta.env.VITE_ZEROPS_TURNSTILE_SITE_KEY?.trim() || DEFAULT_ZEROPS_TURNSTILE_SITE_KEY;

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Cloudflare sets `window.turnstile` a beat after the script element's `load`
 * event, so reading the global there races and reports a working captcha as
 * missing. `onload=` is the documented handshake; this is the name it calls.
 */
const SCRIPT_READY_CALLBACK = "onZeropsTurnstileLoad";

const NOT_LOADED = "The captcha could not be loaded";

/** Cloudflare's code for a site key that does not allow this hostname. */
export const TURNSTILE_DOMAIN_NOT_AUTHORIZED = "110200";

/** Turns a Cloudflare error code into something worth putting on a screen. */
export function describeTurnstileError(code: string): string {
  if (code === TURNSTILE_DOMAIN_NOT_AUTHORIZED) {
    return `Domain not authorized (${TURNSTILE_DOMAIN_NOT_AUTHORIZED})`;
  }
  return code ? `Captcha error (${code})` : NOT_LOADED;
}

export type TurnstileState =
  | { readonly status: "pending"; readonly token: null; readonly reason: null }
  | { readonly status: "ready"; readonly token: string; readonly reason: null }
  | { readonly status: "unavailable"; readonly token: null; readonly reason: string };

interface TurnstileApi {
  readonly render: (
    element: HTMLElement,
    options: {
      readonly sitekey: string;
      readonly callback: (token: string) => void;
      readonly "error-callback"?: (code: string) => void;
      readonly "expired-callback"?: () => void;
    },
  ) => string;
  readonly remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    (window as unknown as Record<string, unknown>)[SCRIPT_READY_CALLBACK] = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error(NOT_LOADED));
    };
    const script = document.createElement("script");
    script.src = `${SCRIPT_URL}&onload=${SCRIPT_READY_CALLBACK}`;
    script.async = true;
    script.addEventListener("error", () => {
      scriptPromise = null;
      reject(new Error(NOT_LOADED));
    });
    document.head.append(script);
  });
  return scriptPromise;
}

const PENDING: TurnstileState = { status: "pending", token: null, reason: null };

export function useZeropsTurnstile(siteKey: string = ZEROPS_TURNSTILE_SITE_KEY): {
  readonly state: TurnstileState;
  readonly widget: ReactNode;
} {
  const [state, setState] = useState<TurnstileState>(PENDING);
  // A callback ref, not `useRef`: the widget is only in the tree while the
  // sign-up form is showing, and an effect that ran before it was mounted
  // would report a perfectly good captcha as unavailable.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!container) return;
    let cancelled = false;
    // Kept so the widget can be torn down when the form is replaced — without
    // it Cloudflare warns that it cannot find a widget it still tracks.
    let widgetId: string | null = null;
    let api: TurnstileApi | null = null;
    void loadTurnstile()
      .then((turnstile) => {
        if (cancelled) return;
        api = turnstile;
        widgetId = turnstile.render(container, {
          sitekey: siteKey,
          callback: (token) => {
            if (!cancelled) setState({ status: "ready", token, reason: null });
          },
          "error-callback": (code) => {
            if (!cancelled) {
              setState({
                status: "unavailable",
                token: null,
                reason: describeTurnstileError(code),
              });
            }
          },
          "expired-callback": () => {
            if (!cancelled) setState(PENDING);
          },
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setState({
          status: "unavailable",
          token: null,
          reason: cause instanceof Error ? cause.message : NOT_LOADED,
        });
      });
    return () => {
      cancelled = true;
      if (api && widgetId) api.remove(widgetId);
    };
  }, [siteKey, container]);

  return { state, widget: <div ref={setContainer} data-zerops-turnstile /> };
}
