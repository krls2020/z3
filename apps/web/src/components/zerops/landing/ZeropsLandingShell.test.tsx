import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  ZeropsLandingShell,
  ZeropsRegisterForm,
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

  it("renders no captcha at all while the Turnstile flag is off", () => {
    const off = renderToStaticMarkup(
      <ZeropsRegisterForm
        busy={false}
        error={null}
        captcha={null}
        onSubmit={noop}
        onSwitchToSignIn={noop}
      />,
    );
    expect(off).not.toContain("turnstile");

    const on = renderToStaticMarkup(
      <ZeropsRegisterForm
        busy={false}
        error={null}
        captcha={<div data-testid="turnstile" />}
        onSubmit={noop}
        onSwitchToSignIn={noop}
      />,
    );
    expect(on).toContain("turnstile");
  });

  it("collects the four fields registration needs", () => {
    const markup = renderToStaticMarkup(
      <ZeropsRegisterForm
        busy={false}
        error={null}
        captcha={null}
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
    expect(markup).toContain("disabled");
  });
});
