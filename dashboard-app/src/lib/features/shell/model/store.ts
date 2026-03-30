import { writable } from "svelte/store";
import type { PodItem } from "$shared/model/clusters";

export type ShellWindowState = {
  id: string;
  clusterId: string;
  targetPod: Partial<PodItem> | null;
  podSessionMode?: "exec" | "attach";
  initialCommand?: string;
  sessionLabel?: string;
  targetNamespace?: string;
  openedAt?: number;
  cleanupPod?: {
    name: string;
    namespace: string;
  };
  sessionKind?: "debug-shell" | "debug-describe" | "pod-debug";
};

export const shellModalState = writable<ShellWindowState[]>([]);

function buildWindowId(clusterId: string, targetPod: Partial<PodItem> | null) {
  const podId = targetPod?.metadata?.uid || targetPod?.metadata?.name || "debug";
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${clusterId}:${podId}:${Date.now()}:${suffix}`;
}

export function openShellModal(clusterId: string) {
  if (!clusterId) return;
  shellModalState.update((items) => [
    ...items,
    {
      id: buildWindowId(clusterId, null),
      clusterId,
      targetPod: null,
      openedAt: Date.now(),
      sessionKind: "debug-shell",
    },
  ]);
}

export function openDebugDescribeModal(
  clusterId: string,
  options: {
    initialCommand: string;
    sessionLabel: string;
    targetNamespace?: string;
  },
) {
  if (!clusterId) return;
  shellModalState.update((items) => [
    ...items,
    {
      id: buildWindowId(clusterId, null),
      clusterId,
      targetPod: null,
      initialCommand: options.initialCommand,
      sessionLabel: options.sessionLabel,
      targetNamespace: options.targetNamespace,
      openedAt: Date.now(),
      sessionKind: "debug-describe",
    },
  ]);
}

export function openPodShellModal(clusterId: string, pod: Partial<PodItem>) {
  if (!clusterId) return;
  shellModalState.update((items) => [
    ...items,
    {
      id: buildWindowId(clusterId, pod),
      clusterId,
      targetPod: pod,
      openedAt: Date.now(),
      podSessionMode: "exec",
    },
  ]);
}

export function openPodDebugShellModal(
  clusterId: string,
  pod: Partial<PodItem>,
  options: {
    cleanupPod: {
      name: string;
      namespace: string;
    };
    sessionLabel?: string;
  },
) {
  if (!clusterId) return;
  shellModalState.update((items) => [
    ...items,
    {
      id: buildWindowId(clusterId, pod),
      clusterId,
      targetPod: pod,
      openedAt: Date.now(),
      podSessionMode: "exec",
      cleanupPod: options.cleanupPod,
      sessionLabel: options.sessionLabel,
      sessionKind: "pod-debug",
    },
  ]);
}

export function openPodAttachModal(clusterId: string, pod: Partial<PodItem>) {
  if (!clusterId) return;
  shellModalState.update((items) => [
    ...items,
    {
      id: buildWindowId(clusterId, pod),
      clusterId,
      targetPod: pod,
      openedAt: Date.now(),
      podSessionMode: "attach",
    },
  ]);
}

export function closeShellModal(windowId: string) {
  if (!windowId) return;
  shellModalState.update((items) => items.filter((item) => item.id !== windowId));
}

export function closeAllShellModals() {
  shellModalState.set([]);
}

export function focusShellModal(windowId: string) {
  if (!windowId) return;
  shellModalState.update((items) => {
    const index = items.findIndex((item) => item.id === windowId);
    if (index === -1 || index === items.length - 1) return items;
    const next = [...items];
    const [picked] = next.splice(index, 1);
    next.push(picked);
    return next;
  });
}
