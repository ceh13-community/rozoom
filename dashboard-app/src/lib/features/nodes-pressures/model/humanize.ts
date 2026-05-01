export interface HumanizedNodeCondition {
  title: string;
  hint: string;
  category: "memory" | "disk" | "pid" | "network" | "ready" | "unknown";
}

/**
 * Humanize a node condition (type + current status, optional reason/message).
 * Only called for conditions that indicate a problem.
 */
export function humanizeNodeCondition(
  type: string,
  status: string,
  reason?: string,
  message?: string,
): HumanizedNodeCondition {
  const t = type.toLowerCase();
  const msg = (message ?? "").toLowerCase();
  const rsn = (reason ?? "").toLowerCase();

  if (t === "memorypressure" && status === "True") {
    return {
      title: "Kubelet reports memory pressure",
      hint: "Available memory dropped below the kubelet eviction threshold (default memory.available<100Mi or memory.available<5%). Kubelet will start evicting BestEffort/Burstable pods, then Guaranteed. Check `kubectl top node`, pod memory requests vs actual usage, and drop in-memory caches.",
      category: "memory",
    };
  }

  if (t === "diskpressure" && status === "True") {
    return {
      title: "Kubelet reports disk pressure",
      hint: "Free inodes < 5% or free space < 10% on the node filesystem (default nodefs/imagefs thresholds). Kubelet will start GC on unused images and then evict pods. Clean up: `docker system prune`, remove old logs under `/var/log`, or expand the node disk.",
      category: "disk",
    };
  }

  if (t === "pidpressure" && status === "True") {
    return {
      title: "Kubelet reports PID pressure",
      hint: "Available PIDs are running low on the node. Typically caused by runaway process creation (shell loops, zombie spawning). Identify the offender: `ps -eLf | awk '{print $1}' | sort | uniq -c | sort -rn | head`.",
      category: "pid",
    };
  }

  if (t === "networkunavailable" && status === "True") {
    return {
      title: "Node network is unavailable",
      hint: "CNI plugin has not configured node networking. Pods cannot route traffic. Check CNI DaemonSet (Calico/Cilium/Flannel) logs, kubelet logs, and node network config (bridge, routes).",
      category: "network",
    };
  }

  if (t === "ready" && status !== "True") {
    if (rsn === "kubeletnotready" || msg.includes("kubelet")) {
      return {
        title: "Kubelet is not ready",
        hint: "The kubelet reported a reason that prevents it from serving workloads (missing PLEG, container runtime down, certificate expired). Check kubelet logs: `journalctl -u kubelet -n 200`.",
        category: "ready",
      };
    }
    if (msg.includes("pleg") || rsn.includes("pleg")) {
      return {
        title: "Container runtime (PLEG) is unhealthy",
        hint: "Pod Lifecycle Event Generator reports stale. Usually means containerd/docker is under heavy load or hit a bug. Inspect container-runtime logs and node load average.",
        category: "ready",
      };
    }
    return {
      title: "Node is NotReady",
      hint: "Control plane has not received a heartbeat from this node recently, or kubelet reported NotReady. Check kubelet logs, CNI, and network path between node and API server.",
      category: "ready",
    };
  }

  return {
    title: `${type} = ${status}`,
    hint: reason
      ? `Reason: ${reason}. ${message ?? ""}`.trim()
      : (message ?? "Non-standard condition."),
    category: "unknown",
  };
}

export const TAINT_EFFECTS: Record<string, { label: string; hint: string }> = {
  NoSchedule: {
    label: "NoSchedule",
    hint: "New pods cannot be scheduled here unless they tolerate this taint. Existing pods stay.",
  },
  NoExecute: {
    label: "NoExecute",
    hint: "New pods cannot schedule AND existing pods without the matching toleration are evicted.",
  },
  PreferNoSchedule: {
    label: "PreferNoSchedule",
    hint: "Scheduler will try to avoid this node but is not forbidden.",
  },
};
