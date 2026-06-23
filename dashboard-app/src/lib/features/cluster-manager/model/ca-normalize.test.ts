import { describe, expect, it } from "vitest";
import { normalizeCaCertToBase64 } from "./ca-normalize";

const PEM_SINGLE = `-----BEGIN CERTIFICATE-----
MIIBezCCASGgAwIBAgIUAexample1example2example3example4example5ex
ample6example7example8example9example0exampleAexampleBexampleC
-----END CERTIFICATE-----`;

const PEM_CHAIN = `${PEM_SINGLE}
-----BEGIN CERTIFICATE-----
MIIBfTCCASOgAwIBAgIUBexample1example2example3example4example5ex
ample6example7example8example9example0exampleAexampleBexampleD
-----END CERTIFICATE-----`;

function decode(b64: string): string {
  return atob(b64);
}

describe("normalizeCaCertToBase64", () => {
  it("base64-encodes a raw PEM certificate", () => {
    const result = normalizeCaCertToBase64(PEM_SINGLE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wasAlreadyEncoded).toBe(false);
    expect(decode(result.data)).toContain("BEGIN CERTIFICATE");
    expect(decode(result.data)).toContain("END CERTIFICATE");
  });

  it("is idempotent: already-base64 PEM is returned unchanged", () => {
    const encodedOnce = normalizeCaCertToBase64(PEM_SINGLE);
    expect(encodedOnce.ok).toBe(true);
    if (!encodedOnce.ok) return;

    const encodedTwice = normalizeCaCertToBase64(encodedOnce.data);
    expect(encodedTwice.ok).toBe(true);
    if (!encodedTwice.ok) return;

    expect(encodedTwice.wasAlreadyEncoded).toBe(true);
    expect(encodedTwice.data).toBe(encodedOnce.data);
  });

  it("trims surrounding whitespace before encoding", () => {
    const padded = `\n   ${PEM_SINGLE}\n\n  `;
    const result = normalizeCaCertToBase64(padded);
    const clean = normalizeCaCertToBase64(PEM_SINGLE);
    expect(result.ok).toBe(true);
    expect(clean.ok).toBe(true);
    if (!result.ok || !clean.ok) return;
    expect(result.data).toBe(clean.data);
  });

  it("encodes a full certificate chain as a single blob", () => {
    const result = normalizeCaCertToBase64(PEM_CHAIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const decoded = decode(result.data);
    expect(decoded.match(/BEGIN CERTIFICATE/g)?.length).toBe(2);
  });

  it("rejects empty input", () => {
    expect(normalizeCaCertToBase64("").ok).toBe(false);
    expect(normalizeCaCertToBase64("   \n  ").ok).toBe(false);
  });

  it("rejects input that is neither PEM nor base64-encoded PEM", () => {
    const result = normalizeCaCertToBase64("this is not a certificate");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/PEM|certificate/i);
  });

  it("rejects base64 that does not decode to a PEM certificate", () => {
    const notACert = btoa("just some plain text, validly base64 but not a cert");
    const result = normalizeCaCertToBase64(notACert);
    expect(result.ok).toBe(false);
  });
});
