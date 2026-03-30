/**
 * Action Notification Helpers
 *
 * Standard factory functions for creating typed notifications.
 * Replaces per-page actionMessage/actionError string patterns.
 *
 * Usage:
 *   let notification = $state<ActionNotification>(null);
 *   notification = notifySuccess("Deleted 3 pods.");
 *   notification = notifyError("Failed to scale.", error.message);
 */

export type NotificationType = "success" | "error" | "warning" | "info";

export type ActionNotification = {
  type: NotificationType;
  message: string;
  detail?: string;
  autoDismissMs?: number;
} | null;

const DEFAULT_SUCCESS_DISMISS_MS = 5000;
const DEFAULT_INFO_DISMISS_MS = 4000;

export function notifySuccess(message: string, detail?: string): ActionNotification {
  return { type: "success", message, detail, autoDismissMs: DEFAULT_SUCCESS_DISMISS_MS };
}

export function notifyError(message: string, detail?: string): ActionNotification {
  return { type: "error", message, detail };
}

export function notifyWarning(message: string, detail?: string): ActionNotification {
  return { type: "warning", message, detail };
}

export function notifyInfo(message: string, detail?: string): ActionNotification {
  return { type: "info", message, detail, autoDismissMs: DEFAULT_INFO_DISMISS_MS };
}

/**
 * Convert legacy actionMessage/actionError pair to ActionNotification.
 * Useful for gradual migration.
 */
export function fromLegacyAction(
  actionMessage: string | null,
  actionError: string | null,
): ActionNotification {
  if (actionError) return notifyError(actionError);
  if (actionMessage) return notifySuccess(actionMessage);
  return null;
}

/**
 * Convert Helm-style actionNotice to ActionNotification.
 */
export function fromActionNotice(
  notice: { type: "success" | "error"; text: string } | null,
): ActionNotification {
  if (!notice) return null;
  return notice.type === "error" ? notifyError(notice.text) : notifySuccess(notice.text);
}
