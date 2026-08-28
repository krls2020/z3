/**
 * Cloudflare Turnstile behind one build flag.
 *
 * The Zerops API does not require a captcha token at its validation layer, so
 * the widget ships off: with no site key configured nothing is loaded, nothing
 * is rendered, and the registration body carries no `token` field. Setting
 * `VITE_ZEROPS_TURNSTILE_SITE_KEY` is the whole switch.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

export const ZEROPS_TURNSTILE_SITE_KEY =
  import.meta.env.VITE_ZEROPS_TURNSTILE_SITE_KEY?.trim() ?? "";

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  readonly render: (
    element: HTMLElement,
    options: {
      readonly sitekey: string;
      readonly callback: (token: string) => void;
      readonly "error-callback"?: () => void;
      readonly "expired-callback"?: () => void;
    },
  ) => string;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.addEventListener("load", () => {
      resolve();
    });
    script.addEventListener("error", () => {
      scriptPromise = null;
      reject(new Error("Could not load the captcha."));
    });
    document.head.append(script);
  });
  return scriptPromise;
}

/**
 * `enabled` is false and `widget` is null unless a site key is configured, so
 * a caller renders `{widget}` unconditionally and gets nothing when the flag
 * is off.
 */
export function useZeropsTurnstile(siteKey: string = ZEROPS_TURNSTILE_SITE_KEY): {
  readonly enabled: boolean;
  readonly token: string | null;
  readonly widget: ReactNode | null;
} {
  const [token, setToken] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    void loadTurnstileScript()
      .then(() => {
        const container = containerRef.current;
        if (cancelled || !container || !window.turnstile) return;
        window.turnstile.render(container, {
          sitekey: siteKey,
          callback: (issued) => {
            setToken(issued);
          },
          "error-callback": () => {
            setToken(null);
          },
          "expired-callback": () => {
            setToken(null);
          },
        });
      })
      .catch(() => {
        // A captcha that will not load must not block the form: the API does
        // not demand the field, so the submit falls back to sending none.
        setToken(null);
      });
    return () => {
      cancelled = true;
    };
  }, [siteKey]);

  return {
    enabled: siteKey.length > 0,
    token,
    widget: siteKey ? <div ref={containerRef} data-zerops-turnstile /> : null,
  };
}
