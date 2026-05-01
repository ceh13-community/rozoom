import { describe, expect, it, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  appNotifications,
  appNotificationCount,
  unreadCount,
  pushNotification,
  pushCertificateNotification,
  markAsRead,
  markAllAsRead,
  dismissNotification,
  dismissAllNotifications,
  clearDismissedNotifications,
  formatTimeAgo,
} from "./app-notifications";

describe("app-notifications", () => {
  beforeEach(() => {
    dismissAllNotifications();
    clearDismissedNotifications();
  });

  it("pushes and reads notifications", () => {
    pushNotification({
      severity: "warning",
      category: "certificate",
      title: "Test warning",
    });

    const list = get(appNotifications);
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Test warning");
    expect(get(appNotificationCount)).toBe(1);
  });

  it("deduplicates by dedupeKey", () => {
    pushNotification({
      severity: "warning",
      category: "certificate",
      title: "First",
      dedupeKey: "cert:a:b",
    });
    pushNotification({
      severity: "critical",
      category: "certificate",
      title: "Updated",
      dedupeKey: "cert:a:b",
    });

    const list = get(appNotifications);
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Updated");
    expect(list[0].severity).toBe("critical");
  });

  it("dismisses individual notification", () => {
    const id = pushNotification({
      severity: "info",
      category: "general",
      title: "Dismiss me",
    });

    dismissNotification(id);
    expect(get(appNotificationCount)).toBe(0);
  });

  it("dismisses all notifications", () => {
    pushNotification({ severity: "info", category: "general", title: "A" });
    pushNotification({ severity: "warning", category: "general", title: "B" });

    dismissAllNotifications();
    expect(get(appNotificationCount)).toBe(0);
  });

  it("pushes certificate notification with correct title", () => {
    pushCertificateNotification({
      clusterId: "c1",
      clusterName: "prod",
      certName: "apiserver",
      daysLeft: 15,
      status: "warning",
    });

    const list = get(appNotifications);
    expect(list).toHaveLength(1);
    expect(list[0].title).toContain("apiserver");
    expect(list[0].title).toContain("15 day(s)");
    expect(list[0].severity).toBe("warning");
    expect(list[0].category).toBe("certificate");
  });

  it("pushes expired certificate notification", () => {
    pushCertificateNotification({
      clusterId: "c1",
      clusterName: "prod",
      certName: "etcd",
      daysLeft: 0,
      status: "critical",
    });

    const list = get(appNotifications);
    expect(list[0].title).toContain("expired");
    expect(list[0].severity).toBe("critical");
  });

  it("tracks read/unread state", () => {
    const id = pushNotification({
      severity: "warning",
      category: "certificate",
      title: "Unread notification",
    });

    expect(get(unreadCount)).toBe(1);

    markAsRead(id);
    expect(get(unreadCount)).toBe(0);
    expect(get(appNotificationCount)).toBe(1);
  });

  it("marks all as read", () => {
    pushNotification({ severity: "info", category: "general", title: "A" });
    pushNotification({ severity: "warning", category: "general", title: "B" });

    expect(get(unreadCount)).toBe(2);

    markAllAsRead();
    expect(get(unreadCount)).toBe(0);
    expect(get(appNotificationCount)).toBe(2);
  });

  it("deduped notification resets read state", () => {
    pushNotification({
      severity: "warning",
      category: "certificate",
      title: "First",
      dedupeKey: "test:key",
    });
    const list1 = get(appNotifications);
    markAsRead(list1[0].id);
    expect(get(unreadCount)).toBe(0);

    pushNotification({
      severity: "critical",
      category: "certificate",
      title: "Updated",
      dedupeKey: "test:key",
    });
    expect(get(unreadCount)).toBe(1);
  });

  it("formats time ago", () => {
    expect(formatTimeAgo(Date.now())).toBe("just now");
    expect(formatTimeAgo(Date.now() - 5 * 60 * 1000)).toBe("5m ago");
    expect(formatTimeAgo(Date.now() - 3 * 60 * 60 * 1000)).toBe("3h ago");
    expect(formatTimeAgo(Date.now() - 2 * 24 * 60 * 60 * 1000)).toBe("2d ago");
  });
});
