import { sequence } from "@sveltejs/kit/hooks";
import { handleErrorWithSentry, sentryHandle } from "@sentry/sveltekit";
import * as Sentry from "@sentry/sveltekit";
import { dev } from "$app/environment";
import { getSentryDsn, getSentryEnvironment, shouldInitSentry } from "$shared/config/sentry";

if (shouldInitSentry(dev)) {
  const dsn = getSentryDsn();
  if (!dsn) {
    throw new Error("Sentry DSN must be defined when Sentry initialization is enabled.");
  }
  Sentry.init({
    dsn,
    environment: getSentryEnvironment(),

    tracesSampleRate: 1.0,

    // uncomment the line below to enable Spotlight (https://spotlightjs.com)
    // spotlight: import.meta.env.DEV,
  });
}
// If you have custom handlers, make sure to place them after `sentryHandle()` in the `sequence` function.
export const handle = sequence(sentryHandle());

// If you have a custom error handler, pass it to `handleErrorWithSentry`
export const handleError = handleErrorWithSentry();
