<!--
  ActionNotificationBar - unified notification display for action results.

  Replaces per-page actionMessage/actionError/actionNotice patterns
  with a single consistent component.

  Usage:
    <ActionNotificationBar {notification} onDismiss={() => notification = null} />
-->
<script lang="ts">
  import X from "@lucide/svelte/icons/x";
  import CheckCircle from "@lucide/svelte/icons/check-circle";
  import AlertCircle from "@lucide/svelte/icons/alert-circle";
  import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
  import InfoIcon from "@lucide/svelte/icons/info";

  export type NotificationType = "success" | "error" | "warning" | "info";

  export type ActionNotification = {
    type: NotificationType;
    message: string;
    detail?: string;
    autoDismissMs?: number;
  } | null;

  interface Props {
    notification: ActionNotification;
    onDismiss: () => void;
  }

  const { notification, onDismiss }: Props = $props();

  const styles: Record<
    NotificationType,
    { border: string; bg: string; text: string; icon: typeof CheckCircle }
  > = {
    success: {
      border: "border-emerald-400/40",
      bg: "bg-emerald-100/20 dark:bg-emerald-500/10",
      text: "text-emerald-900 dark:text-emerald-200",
      icon: CheckCircle,
    },
    error: {
      border: "border-rose-400/40",
      bg: "bg-rose-100/20 dark:bg-rose-500/10",
      text: "text-rose-900 dark:text-rose-200",
      icon: AlertCircle,
    },
    warning: {
      border: "border-amber-400/40",
      bg: "bg-amber-100/20 dark:bg-amber-500/10",
      text: "text-amber-900 dark:text-amber-200",
      icon: AlertTriangle,
    },
    info: {
      border: "border-sky-400/40",
      bg: "bg-sky-100/20 dark:bg-sky-500/10",
      text: "text-sky-900 dark:text-sky-200",
      icon: InfoIcon,
    },
  };

  $effect(() => {
    if (!notification?.autoDismissMs) return;
    const timer = setTimeout(onDismiss, notification.autoDismissMs);
    return () => clearTimeout(timer);
  });
</script>

{#if notification}
  {@const style = styles[notification.type]}
  {@const Icon = style.icon}
  <div
    class="mb-3 flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm {style.border} {style.bg} {style.text}"
    role="alert"
  >
    <Icon class="mt-0.5 h-4 w-4 shrink-0" />
    <div class="flex-1 min-w-0">
      <div>{notification.message}</div>
      {#if notification.detail}
        <div class="mt-0.5 text-xs opacity-80">{notification.detail}</div>
      {/if}
    </div>
    <button
      type="button"
      class="shrink-0 rounded p-0.5 transition hover:opacity-70"
      aria-label="Dismiss notification"
      onclick={onDismiss}
    >
      <X class="h-3.5 w-3.5" />
    </button>
  </div>
{/if}
