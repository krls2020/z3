import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  ZEROPS_GUI_REGISTRATION_URL,
  ZeropsLandingShell,
  ZeropsRegisterForm,
  ZeropsRegistrationUnavailable,
  ZeropsSignInForm,
  ZeropsTotpForm,
} from "./ZeropsLandingShell";

const noop = () => undefined;

describe("ZeropsLandingShell", () => {
  it("always offers a way to upstream's manual connect flow", () => {
    const markup = renderToStaticMarkup(
      <ZeropsLandingShell title="Zerops Code" description="Sign in" onManualConnect={noop}>
        <ZeropsSignInForm busy={false} error={null} onSubmit={noop} onSwitchToRegister={noop} />
      </ZeropsLandingShell>,
    );

    expect(markup).toContain("Connect a backend manually");
  });

  it("asks for an email and a password, and offers sign-up", () => {
    const markup = renderToStaticMarkup(
      <ZeropsSignInForm busy={false} error={null} onSubmit={noop} onSwitchToRegister={noop} />,
    );

    expect(markup).toContain('name="email"');
    expect(markup).toContain('type="password"');
    expect(markup).toContain("Create one");
  });

  it("renders the captcha the platform demands, and blocks submit until it answers", () => {
    const pending = renderToStaticMarkup(
      <ZeropsRegisterForm
        busy={false}
        error={null}
        captcha={<div data-testid="turnstile" />}
        captchaPending
        onSubmit={noop}
        onSwitchToSignIn={noop}
      />,
    );
    expect(pending).toContain("turnstile");
    // The attribute, not the Tailwind `disabled:` class prefixes.
    expect(pending).toContain('disabled=""');

    const solved = renderToStaticMarkup(
      <ZeropsRegisterForm
        busy={false}
        error={null}
        captcha={<div data-testid="turnstile" />}
        captchaPending={false}
        onSubmit={noop}
        onSwitchToSignIn={noop}
      />,
    );
    expect(solved).not.toContain('disabled=""');
  });

  it("collects the four fields registration needs", () => {
    const markup = renderToStaticMarkup(
      <ZeropsRegisterForm
        busy={false}
        error={null}
        captcha={null}
        captchaPending={false}
        onSubmit={noop}
        onSwitchToSignIn={noop}
      />,
    );

    for (const field of ["fullName", "organizationName", "email", "password"]) {
      expect(markup).toContain(`name="${field}"`);
    }
  });

  it("shows an error where the user is looking and disables submit while busy", () => {
    const markup = renderToStaticMarkup(
      <ZeropsTotpForm busy error="The two-factor code was not accepted." onSubmit={noop} />,
    );

    expect(markup).toContain("The two-factor code was not accepted.");
    expect(markup).toContain('disabled=""');
  });
});

describe("ZeropsRegistrationUnavailable", () => {
  it("sends the user to the Zerops sign-up that the captcha does allow, with the pool claim", () => {
    const markup = renderToStaticMarkup(
      <ZeropsRegistrationUnavailable reason="Domain not authorized (110200)" onSignIn={noop} />,
    );

    expect(ZEROPS_GUI_REGISTRATION_URL).toBe("https://app.zerops.io/registration?zcp=true");
    expect(markup).toContain(ZEROPS_GUI_REGISTRATION_URL.replace(/&/g, "&amp;"));
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer"');
  });

  it("names why registration cannot happen here, and offers the way back in", () => {
    const markup = renderToStaticMarkup(
      <ZeropsRegistrationUnavailable reason="Domain not authorized (110200)" onSignIn={noop} />,
    );

    expect(markup).toContain("Domain not authorized (110200)");
    // Signing up elsewhere is only useful if the flow continues here.
    expect(markup).toMatch(/sign in/i);
  });
});
