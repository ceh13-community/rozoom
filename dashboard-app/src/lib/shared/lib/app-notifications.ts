import { writable, derived } from "svelte/store";

export type AppNotificationSeverity = "critical" | "warning" | "info";

export type AppNotificationCategory = "certificate" | "backup" | "cluster" | "general";

export interface AppNotification {
  id: string;
  severity: AppNotificationSeverity;
  category: AppNotificationCategory;
  title: string;
  detail?: string;
  clusterId?: string;
  clusterName?: string;
  createdAt: number;
  readAt?: number;
  dismissedAt?: number;
  dedupeKey?: string;
}

const notifications = writable<AppNotification[]>([]);

export const appNotifications = derived(notifications, (list) =>
  list.filter((n) => !n.dismissedAt).sort((a, b) => b.createdAt - a.createdAt),
);

export const unreadNotifications = derived(appNotifications, (list) =>
  list.filter((n) => !n.readAt),
);

export const unreadCount = derived(unreadNotifications, (list) => list.length);

export const appNotificationCount = derived(appNotifications, (list) => list.length);

export const appNotificationsBySeverity = derived(appNotifications, (list) => ({
  critical: list.filter((n) => n.severity === "critical"),
  warning: list.filter((n) => n.severity === "warning"),
  info: list.filter((n) => n.severity === "info"),
}));

let nextId = 1;

export function pushNotification(notification: Omit<AppNotification, "id" | "createdAt">): string {
  const id = `notif-${nextId++}`;

  notifications.update((list) => {
    if (notification.dedupeKey) {
      const existing = list.find((n) => n.dedupeKey === notification.dedupeKey && !n.dismissedAt);
      if (existing) {
        return list.map((n) =>
          n.id === existing.id
            ? { ...n, ...notification, id: n.id, createdAt: Date.now(), readAt: undefined }
            : n,
        );
      }
    }

    return [...list, { ...notification, id, createdAt: Date.now() }];
  });

  return id;
}

export function markAsRead(id: string) {
  notifications.update((list) =>
    list.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: Date.now() } : n)),
  );
}

export function markAllAsRead() {
  const now = Date.now();
  notifications.update((list) =>
    list.map((n) => (!n.dismissedAt && !n.readAt ? { ...n, readAt: now } : n)),
  );
}

export function dismissNotification(id: string) {
  notifications.update((list) =>
    list.map((n) => (n.id === id ? { ...n, dismissedAt: Date.now() } : n)),
  );
}

export function dismissAllNotifications() {
  const now = Date.now();
  notifications.update((list) => list.map((n) => (n.dismissedAt ? n : { ...n, dismissedAt: now })));
}

export function clearDismissedNotifications() {
  notifications.update((list) => list.filter((n) => !n.dismissedAt));
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export { formatTimeAgo };

export function pushCertificateNotification(params: {
  clusterId: string;
  clusterName: string;
  certName: string;
  daysLeft: number;
  status: "warning" | "critical";
}) {
  const severity = params.status;
  const title =
    params.daysLeft <= 0
      ? `Certificate "${params.certName}" has expired`
      : `Certificate "${params.certName}" expires in ${params.daysLeft} day(s)`;

  pushNotification({
    severity,
    category: "certificate",
    title,
    detail: `Cluster: ${params.clusterName}`,
    clusterId: params.clusterId,
    clusterName: params.clusterName,
    dedupeKey: `cert:${params.clusterId}:${params.certName}`,
  });
}
