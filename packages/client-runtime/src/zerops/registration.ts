/**
 * Signing up for Zerops from inside Zerops Code.
 *
 * The body is built by a pure function so the two decisions in it — whether a
 * pool project is claimed, and whether a captcha token rides along — are
 * pinned by tests rather than buried in a component.
 */

export interface ZeropsRegistrationInput {
  readonly email: string;
  readonly password: string;
  readonly fullName: string;
  readonly organizationName: string;
  /**
   * Asks the platform to hand this brand-new account a pre-provisioned project
   * from the zcp pool. Undocumented but accepted; the response's `zcpClaimed`
   * says whether one was actually given.
   */
  readonly claimZcpPool?: boolean;
  /**
   * Cloudflare Turnstile token. The API does not require the field at its
   * validation layer, so the widget stays behind a build flag; when the flag is
   * off nothing is sent, and the key is never invented client-side.
   */
  readonly turnstileToken?: string;
}

export interface ZeropsRegistrationBody {
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly accountName: string;
  readonly languageId: string;
  readonly claimZcpPool: boolean;
  readonly token?: string;
}

export function buildZeropsRegistrationBody(
  input: ZeropsRegistrationInput,
): ZeropsRegistrationBody {
  return {
    email: input.email.trim(),
    // Never trimmed: a leading or trailing space is a legitimate part of a
    // password, and silently dropping it locks the account out.
    password: input.password,
    name: input.fullName.trim(),
    accountName: input.organizationName.trim(),
    languageId: "en",
    claimZcpPool: input.claimZcpPool ?? true,
    ...(input.turnstileToken ? { token: input.turnstileToken } : {}),
  };
}
