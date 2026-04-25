import { sequence } from "@sveltejs/kit/hooks";
import { handleErrorWithSentry, sentryHandle } from "@sentry/sveltekit";
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

    ignoreErrors: [...HMR_ERROR_PATTERNS],
    denyUrls: [...HMR_URL_PATTERNS],

    ...(scrub
      ? {
          beforeSend: scrubErrorEvent,
          beforeBreadcrumb: scrubBreadcrumb,
        }
      : {}),

    // uncomment the line below to enable Spotlight (https://spotlightjs.com)
    // spotlight: import.meta.env.DEV,
  });
}
// If you have custom handlers, make sure to place them after `sentryHandle()` in the `sequence` function.
export const handle = sequence(sentryHandle());

// If you have a custom error handler, pass it to `handleErrorWithSentry`
export const handleError = handleErrorWithSentry();
