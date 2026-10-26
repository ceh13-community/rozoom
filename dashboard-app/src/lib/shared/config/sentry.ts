import { env } from "$env/dynamic/public";

function normalizeDsn(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeValue(value: string | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isTruthy(value: string | undefined) {
  return value === "true" || value === "1";
}

export function getSentryDsn() {
  const { PUBLIC_SENTRY_DSN } = env;
  return typeof PUBLIC_SENTRY_DSN === "string" ? normalizeDsn(PUBLIC_SENTRY_DSN) : null;
}

export function getSentryEnvironment() {
  const environment =
    typeof env.PUBLIC_SENTRY_ENVIRONMENT === "string" ? env.PUBLIC_SENTRY_ENVIRONMENT : undefined;
  return normalizeValue(environment) ?? undefined;
}

export function shouldEnableSentryInDev() {
  const enabled =
    typeof env.PUBLIC_SENTRY_ENABLE_IN_DEV === "string"
      ? env.PUBLIC_SENTRY_ENABLE_IN_DEV
      : undefined;
  return isTruthy(enabled);
}

export function shouldInitSentry(dev: boolean) {
  const hasDsn = getSentryDsn() !== null;
  return hasDsn && (!dev || shouldEnableSentryInDev());
}

/**
 * Whether to apply the credential scrubber (beforeSend / beforeBreadcrumb).
 *
 * Scrubbing is ON by default in every mode, including dev: a dev build
 * pointed at a real cluster must not leak kubeconfig paths or
 * Authorization headers to Sentry just because nobody set an env var.
 *
 * The only way to see raw payloads is the explicit opt-out:
 *   PUBLIC_SENTRY_DISABLE_SCRUB - disable scrubber (short-lived local
 *                                 debugging against throwaway clusters only)
 */
export function shouldScrubSentry() {
  const disable = isTruthy(
    typeof env.PUBLIC_SENTRY_DISABLE_SCRUB === "string"
      ? env.PUBLIC_SENTRY_DISABLE_SCRUB
      : undefined,
  );
  return !disable;
}
