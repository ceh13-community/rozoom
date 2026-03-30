import { handleErrorWithSentry } from "@sentry/sveltekit";
import * as Sentry from "@sentry/sveltekit";
import { dev } from "$app/environment";
import { getSentryDsn, getSentryEnvironment, shouldInitSentry } from "$shared/config/sentry";
import { initRuntimeLogBridge } from "$shared/lib/runtime-log-bridge";

if (shouldInitSentry(dev)) {
  const dsn = getSentryDsn();
  if (!dsn) {
    throw new Error("Sentry DSN must be defined when Sentry initialization is enabled.");
  }
  Sentry.init({
    dsn,
    environment: getSentryEnvironment(),
    tracesSampleRate: 1.0,
  });
}

initRuntimeLogBridge();
// If you have a custom error handler, pass it to `handleErrorWithSentry`
export const handleError = handleErrorWithSentry();
