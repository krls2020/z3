import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ZeropsPanelPlaceholder } from "./ZeropsPanel";

/**
 * The map is absent for two different reasons and they must not share a
 * sentence. The panel's tab is persisted per thread, so a reload renders this
 * surface before the first snapshot arrives — and "not a Zerops project" then
 * is a confident lie about the very project the user is looking at, told for
 * the second or so before the feed answers.
 */
describe("ZeropsPanelPlaceholder", () => {
  it("says it is still reading while the first snapshot is in flight", () => {
    const html = renderToStaticMarkup(<ZeropsPanelPlaceholder waiting />);

    expect(html).toContain("Reading the project");
    expect(html).not.toContain("not a Zerops project");
  });

  it("says there is no Zerops here only once the feed has answered", () => {
    const html = renderToStaticMarkup(<ZeropsPanelPlaceholder waiting={false} />);

    expect(html).toContain("This environment is not a Zerops project.");
    expect(html).not.toContain("Reading the project");
  });
});
