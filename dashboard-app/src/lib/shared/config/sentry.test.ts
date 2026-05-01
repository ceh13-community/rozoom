import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "$env/dynamic/public";

vi.mock("$env/dynamic/public", () => ({
  env: {
    PUBLIC_SENTRY_DSN: undefined,
    PUBLIC_SENTRY_ENVIRONMENT: undefined,
    PUBLIC_SENTRY_ENABLE_IN_DEV: undefined,
  },
}));

import {
  getSentryDsn,
  getSentryEnvironment,
  shouldEnableSentryInDev,
  shouldInitSentry,
} from "./sentry";

const publicEnv = env as Record<string, string | undefined>;

describe("sentry config", () => {
  afterEach(() => {
    publicEnv.PUBLIC_SENTRY_DSN = undefined;
    publicEnv.PUBLIC_SENTRY_ENVIRONMENT = undefined;
    publicEnv.PUBLIC_SENTRY_ENABLE_IN_DEV = undefined;
  });

  it("treats blank DSN as disabled", () => {
    publicEnv.PUBLIC_SENTRY_DSN = "   ";

    expect(getSentryDsn()).toBeNull();
    expect(shouldInitSentry(false)).toBe(false);
  });

  it("does not initialize Sentry in dev by default", () => {
    publicEnv.PUBLIC_SENTRY_DSN = "https://public@example.ingest.sentry.io/1";
    publicEnv.PUBLIC_SENTRY_ENABLE_IN_DEV = "false";

    expect(shouldEnableSentryInDev()).toBe(false);
    expect(shouldInitSentry(true)).toBe(false);
  });

  it("allows explicit Sentry enablement in dev", () => {
    publicEnv.PUBLIC_SENTRY_DSN = "https://public@example.ingest.sentry.io/1";
    publicEnv.PUBLIC_SENTRY_ENABLE_IN_DEV = "true";

    expect(shouldEnableSentryInDev()).toBe(true);
    expect(shouldInitSentry(true)).toBe(true);
  });

  it("leaves the environment unset when no public environment is configured", () => {
    publicEnv.PUBLIC_SENTRY_ENVIRONMENT = "";
    expect(getSentryEnvironment()).toBeUndefined();

    publicEnv.PUBLIC_SENTRY_ENVIRONMENT = undefined;
    expect(getSentryEnvironment()).toBeUndefined();

    publicEnv.PUBLIC_SENTRY_ENVIRONMENT = "staging";
    expect(getSentryEnvironment()).toBe("staging");
  });
});
