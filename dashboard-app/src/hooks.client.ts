import { handleErrorWithSentry } from "@sentry/sveltekit";
import * as Sentry from "@sentry/sveltekit";
import { dev } from "$app/environment";
import {
  getSentryDsn,
  getSentryEnvironment,
  shouldInitSentry,
  shouldScrubSentry,
} from "$shared/config/sentry";
import { scrubErrorEvent, scrubBreadcrumb } from "$shared/config/sentry-scrub";
import { HMR_ERROR_PATTERNS, HMR_URL_PATTERNS } from "$shared/config/sentry-filters";
import { initRuntimeLogBridge } from "$shared/lib/runtime-log-bridge";

if (shouldInitSentry(dev)) {
  const dsn = getSentryDsn();
  if (!dsn) {
    throw new Error("Sentry DSN must be defined when Sentry initialization is enabled.");
  }
  const scrub = shouldScrubSentry(dev);
  Sentry.init({
    dsn,
    environment: getSentryEnvironment(),
    tracesSampleRate: 1.0,
    // Filters stay on in both dev and prod: prod should never hit these
    // patterns anyway, and carrying them avoids env-specific drift.
    ignoreErrors: [...HMR_ERROR_PATTERNS],
    denyUrls: [...HMR_URL_PATTERNS],
    ...(scrub
      ? {
          beforeSend: scrubErrorEvent,
          beforeBreadcrumb: scrubBreadcrumb,
        }
      : {}),
  });
}

initRuntimeLogBridge();
// If you have a custom error handler, pass it to `handleErrorWithSentry`
export const handleError = handleErrorWithSentry();
