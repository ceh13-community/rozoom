import { load as parse } from "js-yaml";
import { describe, expect, it } from "vitest";
import { caDataFromForm, normalizeCaCertToBase64 } from "./ca-normalize";
import { generateTokenKubeconfig } from "./direct-credentials-kubeconfig";
import { TlsBlockedError } from "./tls-gate";

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

describe("normalizeCaCertToBase64 on awkward pastes", () => {
  const LONG_BODY = "A".repeat(100);
  const WRAPPED = `-----BEGIN CERTIFICATE-----\n${"A".repeat(64)}\n${"A".repeat(36)}\n-----END CERTIFICATE-----`;

  it.each([
    [
      "line breaks turned into spaces",
      `-----BEGIN CERTIFICATE----- ${LONG_BODY} -----END CERTIFICATE-----`,
    ],
    ["line breaks dropped", `-----BEGIN CERTIFICATE-----${LONG_BODY}-----END CERTIFICATE-----`],
    [
      "spaces inside the body",
      `-----BEGIN CERTIFICATE----- ${"A".repeat(64)} ${"A".repeat(36)} -----END CERTIFICATE-----`,
    ],
  ])("restores a PEM with %s", (_name, flat) => {
    expect(normalizeCaCertToBase64(flat)).toMatchObject({ ok: true, data: btoa(WRAPPED) });
  });

  it("restores every certificate of a flattened chain", () => {
    const flat = `${PEM_SINGLE} ${PEM_SINGLE}`.replace(/\n/g, " ");
    const result = normalizeCaCertToBase64(flat);
    if (!result.ok) throw new Error(result.reason);
    expect(atob(result.data).match(/-----BEGIN CERTIFICATE-----\n/g)).toHaveLength(2);
    expect(atob(result.data).match(/\n-----END CERTIFICATE-----/g)).toHaveLength(2);
  });

  it("joins wrapped base64 into one line", () => {
    const encoded = btoa(PEM_SINGLE);
    const wrapped = encoded.replace(/(.{20})/g, "$1\n");
    expect(normalizeCaCertToBase64(wrapped)).toMatchObject({ ok: true, data: encoded });
  });

  it("refuses a PEM with characters outside Latin-1 instead of throwing", () => {
    expect(normalizeCaCertToBase64(`${PEM_SINGLE}\u2028`.replace("MIIB", "M\u2028IB")).ok).toBe(
      false,
    );
  });
});

describe("caDataFromForm", () => {
  it("turns a pasted PEM into the base64 a generator accepts", () => {
    const caData = caDataFromForm(PEM_SINGLE);
    expect(caData).toBe(btoa(PEM_SINGLE));
    const config = parse(
      generateTokenKubeconfig({
        clusterName: "prod",
        serverUrl: "https://api.example.com:6443",
        caData,
        token: "t0ken",
      }),
    ) as { clusters: Array<{ cluster: Record<string, unknown> }> };
    expect(config.clusters[0].cluster["certificate-authority-data"]).toBe(btoa(PEM_SINGLE));
  });

  it("is undefined for an empty field", () => {
    expect(caDataFromForm("  \n ")).toBeUndefined();
  });

  it("refuses anything that is not a certificate, with the reason", () => {
    expect(() => caDataFromForm("not a certificate")).toThrow(TlsBlockedError);
    expect(() => caDataFromForm("not a certificate")).toThrow(/PEM certificate/);
  });
});
