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

export function shouldScrubSentry(dev: boolean) {
  const force = isTruthy(
    typeof env.PUBLIC_SENTRY_FORCE_SCRUB === "string" ? env.PUBLIC_SENTRY_FORCE_SCRUB : undefined,
  );
  const disable = isTruthy(
    typeof env.PUBLIC_SENTRY_DISABLE_SCRUB === "string"
      ? env.PUBLIC_SENTRY_DISABLE_SCRUB
      : undefined,
  );
  if (disable) return false;
  if (force) return true;
  return !dev;
}
