import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getTelemetryConsent,
  isTelemetryEnabled,
  needsConsentPrompt,
  setTelemetryConsent,
} from "./consent";

const CONSENT_KEY = "rozoom.telemetry_consent";

function setDoNotTrack(value: string | undefined): void {
  Object.defineProperty(window.navigator, "doNotTrack", {
    value,
    configurable: true,
  });
}

describe("telemetry consent (opt-in)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setDoNotTrack(undefined);
  });

  afterEach(() => {
    setDoNotTrack(undefined);
  });

  it("defaults to undecided with telemetry off and the prompt due", () => {
    expect(getTelemetryConsent()).toBe("undecided");
    expect(isTelemetryEnabled()).toBe(false);
    expect(needsConsentPrompt()).toBe(true);
  });

  it("enables telemetry only after explicit grant", () => {
    setTelemetryConsent("granted");
    expect(getTelemetryConsent()).toBe("granted");
    expect(isTelemetryEnabled()).toBe(true);
    expect(needsConsentPrompt()).toBe(false);
  });

  it("keeps telemetry off and never re-prompts after denial", () => {
    setTelemetryConsent("denied");
    expect(getTelemetryConsent()).toBe("denied");
    expect(isTelemetryEnabled()).toBe(false);
    expect(needsConsentPrompt()).toBe(false);
  });

  it("treats unknown stored values as undecided", () => {
    window.localStorage.setItem(CONSENT_KEY, "true");
    expect(getTelemetryConsent()).toBe("undecided");
    expect(isTelemetryEnabled()).toBe(false);
    expect(needsConsentPrompt()).toBe(true);
  });

  it("honours Do Not Track even when consent was granted", () => {
    setTelemetryConsent("granted");
    setDoNotTrack("1");
    expect(isTelemetryEnabled()).toBe(false);
  });

  it("does not prompt under Do Not Track", () => {
    setDoNotTrack("1");
    expect(needsConsentPrompt()).toBe(false);
  });
});
