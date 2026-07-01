import { beforeEach, describe, expect, it } from "vitest";
import {
  getLocalScanConsent,
  hasLocalScanConsent,
  needsLocalScanConsent,
  setLocalScanConsent,
  LOCAL_SCAN_PRIVACY_NOTE,
} from "./local-consent";

describe("local-scan consent (opt-in)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to undecided with scanning off and the prompt due", () => {
    expect(getLocalScanConsent()).toBe("undecided");
    expect(hasLocalScanConsent()).toBe(false);
    expect(needsLocalScanConsent()).toBe(true);
  });

  it("allows scanning only after explicit grant", () => {
    setLocalScanConsent(true);
    expect(getLocalScanConsent()).toBe("granted");
    expect(hasLocalScanConsent()).toBe(true);
    expect(needsLocalScanConsent()).toBe(false);
  });

  it("records a refusal and never auto-scans", () => {
    setLocalScanConsent(false);
    expect(getLocalScanConsent()).toBe("denied");
    expect(hasLocalScanConsent()).toBe(false);
    expect(needsLocalScanConsent()).toBe(false);
  });

  it("lets the user change their mind", () => {
    setLocalScanConsent(true);
    setLocalScanConsent(false);
    expect(hasLocalScanConsent()).toBe(false);
    setLocalScanConsent(true);
    expect(hasLocalScanConsent()).toBe(true);
  });

  it("states the scan is read-only in the privacy note", () => {
    expect(LOCAL_SCAN_PRIVACY_NOTE.toLowerCase()).toContain("read-only");
  });
});
