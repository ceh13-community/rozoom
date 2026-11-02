import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";

vi.mock("$shared/api/in-app-browser", () => ({
  openExternalUrl: vi.fn(() => Promise.resolve()),
}));

import { openExternalUrl } from "$shared/api/in-app-browser";
import PrivacyPolicyLink from "./privacy-policy-link.svelte";
import TelemetryConsentDescription from "./telemetry-consent-description.svelte";
import {
  CONSENT_PROMPT_DESCRIPTION,
  PRIVACY_POLICY_LABEL,
  PRIVACY_POLICY_URL,
} from "./telemetry-copy";

describe("privacy-policy-link", () => {
  it("is a real hyperlink with the spec label pointing at the privacy notice", () => {
    const { getByRole } = render(PrivacyPolicyLink);
    const link = getByRole("link", { name: PRIVACY_POLICY_LABEL });
    expect(link).toHaveAttribute("href", PRIVACY_POLICY_URL);
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("opens the notice in the system browser instead of navigating the webview", async () => {
    const { getByRole } = render(PrivacyPolicyLink);
    // dispatchEvent returns false when a handler called preventDefault().
    const notCancelled = await fireEvent.click(getByRole("link"));
    expect(notCancelled).toBe(false);
    expect(openExternalUrl).toHaveBeenCalledWith(PRIVACY_POLICY_URL);
  });
});

describe("telemetry-consent-description", () => {
  it("shows the processor and region in one line with the link beside the text", () => {
    const { container, getByRole } = render(TelemetryConsentDescription);
    expect(container.textContent?.replace(/\s+/g, " ").trim()).toBe(
      `${CONSENT_PROMPT_DESCRIPTION} ${PRIVACY_POLICY_LABEL}`,
    );
    expect(getByRole("link", { name: PRIVACY_POLICY_LABEL })).toHaveAttribute(
      "href",
      PRIVACY_POLICY_URL,
    );
    // Single inline element: the link must not be pushed into its own paragraph.
    expect(container.querySelectorAll("p, div, br").length).toBe(0);
  });
});
