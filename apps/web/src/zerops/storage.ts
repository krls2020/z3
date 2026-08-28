import type { ZeropsStorageAdapter } from "@t3tools/client-runtime/zerops";

/**
 * `localStorage` behind the runtime's async storage contract, so the web and
 * mobile clients share one Zerops auth model. Every access is guarded: a
 * browser with site data blocked throws on `localStorage` itself, and a
 * signed-out UI is a better answer there than a blank screen.
 */
export const browserZeropsStorage: ZeropsStorageAdapter = {
  get: (key) => {
    try {
      return Promise.resolve(window.localStorage.getItem(key));
    } catch {
      return Promise.resolve(null);
    }
  },
  set: (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Nothing to recover: the session simply does not survive a reload.
    }
    return Promise.resolve();
  },
  remove: (key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Same.
    }
    return Promise.resolve();
  },
};
