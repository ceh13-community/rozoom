import { describe, expect, it } from "vitest";

import { describeExpiry, parseClientCertNotAfter, parseJwtExpiry } from "./expiry-state";

/** Fixed reference clock so every duration assertion is deterministic. */
const NOW = Date.UTC(2026, 5, 23, 12, 0, 0); // 2026-06-23T12:00:00Z

/** Build a JWT-shaped token whose payload carries `exp` (seconds since epoch). */
function jwtWithExp(expSeconds: number): string {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ exp: expSeconds, sub: "rozoom" }));
  return `${header}.${payload}.sig`;
}

// Real self-signed X.509 cert, notAfter = 2036-06-20T07:19:53Z (UTCTime form).
const CERT_DER_BASE64 =
  "MIIDDTCCAfWgAwIBAgIUbpUPa4sxCe8/3jxFEx+nIWUUkHIwDQYJKoZIhvcNAQELBQAwFjEUMBIGA1UEAwwLcm96b29tLXRlc3QwHhcNMjYwNjIzMDcxOTUzWhcNMzYwNjIwMDcxOTUzWjAWMRQwEgYDVQQDDAtyb3pvb20tdGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAN+DRnZvLoRL165x9H19LWqUqVXETtMMlO9mjByWIjrJLEUH8MJxnPEtD8wB05hWbskX7Zx15w4bYhdhrzBDLsg7iPSDsB6g5v92rAs/60duZ47Tq1x3kNyjIvWHRF3YusN08XFuOv16pwYd8Y+/dvofuq6+Gr2kdAUh8r6YVcYj8dGHgmgxivAToLYvQtWUTDHp0NGPZEuiwwMZJII4kwUalPSA4bq4twMjuBC35nlTt5YchNfEzFoZ4j+BSbC4LmT1snyqHe9kqZulLuS0RJD+OZLwCj5iMhMIq/a7h/Kvy1MH8sldlQxClNl/ZKvoHFa5Sn1B0pX70BtWkb9C5CsCAwEAAaNTMFEwHQYDVR0OBBYEFBobUnxTozNZd084P98wmDVjzNApMB8GA1UdIwQYMBaAFBobUnxTozNZd084P98wmDVjzNApMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBALjMsbq/x5ELf2Q7BSTaR40bRLMb6lmZbuFL2OipLJGjhDe7E2W7XZPByMdqF04WfU1XUEJ2WFqcAM4ca1qeWNYjoUtPx3miXUSi/AwnylnxgesYoEnm2Y9snUY9AurqO2KRonpiyO43Ee4X3Uo7yBbBOMKjJwbPXFdR3zF3+V8iDafi4IOHd5U1oekQwJUrFNrFqsfPRISoxvFc+lm0O6kmT5S5/87RLzUA047YbQnISeGqOUz2r0FY0eXcuYPeR9cYWytce6MjUTvK9qo8W7neaDO8YVzaG4uo8quzH3JgFLj1pStYq9KPl7rKQNuIf6JGqvyM1TPWuw/+8N6vDTE=";
const CERT_NOT_AFTER = "2036-06-20T07:19:53.000Z";

describe("parseJwtExpiry", () => {
  it("extracts the exp claim from a JWT", () => {
    const expSeconds = Math.floor(Date.UTC(2026, 5, 24, 12, 0, 0) / 1000);
    expect(parseJwtExpiry(jwtWithExp(expSeconds))?.toISOString()).toBe("2026-06-24T12:00:00.000Z");
  });

  it("returns null for opaque (non-JWT) tokens", () => {
    expect(parseJwtExpiry("sha256~abcdef")).toBeNull();
  });

  it("returns null for a JWT without an exp claim", () => {
    const noExp = `${btoa(JSON.stringify({ alg: "none" }))}.${btoa(JSON.stringify({ sub: "x" }))}.sig`;
    expect(parseJwtExpiry(noExp)).toBeNull();
  });

  it("returns null for empty / missing input", () => {
    expect(parseJwtExpiry("")).toBeNull();
    expect(parseJwtExpiry(null)).toBeNull();
    expect(parseJwtExpiry(undefined)).toBeNull();
  });
});

describe("parseClientCertNotAfter", () => {
  it("extracts notAfter from a base64 DER certificate", () => {
    expect(parseClientCertNotAfter(CERT_DER_BASE64)?.toISOString()).toBe(CERT_NOT_AFTER);
  });

  it("extracts notAfter from a PEM-armored certificate", () => {
    const pem = `-----BEGIN CERTIFICATE-----\n${CERT_DER_BASE64}\n-----END CERTIFICATE-----\n`;
    expect(parseClientCertNotAfter(pem)?.toISOString()).toBe(CERT_NOT_AFTER);
  });

  it("returns null for non-certificate input", () => {
    expect(parseClientCertNotAfter("not a cert")).toBeNull();
    expect(parseClientCertNotAfter(btoa("hello world"))).toBeNull();
    expect(parseClientCertNotAfter("")).toBeNull();
    expect(parseClientCertNotAfter(null)).toBeNull();
  });
});

describe("describeExpiry", () => {
  it("reports no-expiry for a null expiry", () => {
    expect(describeExpiry(null, NOW)).toEqual({
      status: "no-expiry",
      label: "No expiry",
      expiresAt: null,
      hoursRemaining: null,
    });
  });

  it("reports a far-future expiry as valid in days", () => {
    const state = describeExpiry(new Date(NOW + 5 * 24 * 60 * 60 * 1000), NOW);
    expect(state.status).toBe("valid");
    expect(state.label).toBe("Expires in 5 days");
    expect(state.hoursRemaining).toBe(120);
  });

  it("flags a credential inside the warn window as expiring-soon", () => {
    const state = describeExpiry(new Date(NOW + 3 * 60 * 60 * 1000), NOW);
    expect(state.status).toBe("expiring-soon");
    expect(state.label).toBe("Expires in 3 hours");
  });

  it("reports an already-expired credential with how long ago", () => {
    const state = describeExpiry(new Date(NOW - 2 * 60 * 60 * 1000), NOW);
    expect(state.status).toBe("expired");
    expect(state.label).toBe("Expired 2 hours ago");
    expect(state.hoursRemaining).toBe(-2);
  });

  it("uses minutes for sub-hour windows", () => {
    expect(describeExpiry(new Date(NOW + 30 * 60 * 1000), NOW).label).toBe("Expires in 30 minutes");
  });

  it("respects a custom warn-within window", () => {
    const expiresAt = new Date(NOW + 10 * 60 * 60 * 1000);
    expect(describeExpiry(expiresAt, NOW, 4).status).toBe("valid");
    expect(describeExpiry(expiresAt, NOW, 12).status).toBe("expiring-soon");
  });
});
