export interface HumanizedRestartReason {
  title: string;
  hint: string;
  category: "memory" | "backoff" | "exit" | "probe" | "image" | "normal" | "node" | "unknown";
  severity: "critical" | "high" | "medium" | "low" | "info";
}

export function humanizeRestartReason(reason: string): HumanizedRestartReason {
  const r = (reason || "").trim();
  const lower = r.toLowerCase();

  if (lower === "oomkilled" || lower.includes("oom")) {
    return {
      title: "Container exceeded memory limit (OOMKilled)",
      hint: "The kernel OOM-killer terminated the container because it hit `resources.limits.memory`. Increase the limit if justified by the workload, or fix a memory leak / unbounded cache. Check container_memory_working_set_bytes trend before raising limits.",
      category: "memory",
      severity: "high",
    };
  }

  if (lower === "crashloopbackoff") {
    return {
      title: "Kubelet is backing off between restarts",
      hint: "The container repeatedly exits and kubelet applies exponential backoff (10s -> 5m cap). Read --previous logs to see the fatal error; common causes: wrong command/args, missing env/secret, failing init, bad image entrypoint.",
      category: "backoff",
      severity: "critical",
    };
  }

  if (lower === "error") {
    return {
      title: "Container exited with non-zero code",
      hint: "Exit code != 0 and != 137 (OOM). Check --previous logs and `kubectl describe pod` for the exit code. Common: panic, assertion, missing file/env.",
      category: "exit",
      severity: "high",
    };
  }

  if (lower === "completed") {
    return {
      title: "Container completed normally",
      hint: "Exit code 0. Normal for Job / Init / CronJob containers. Not a failure - may indicate you are looking at a short-lived workload rather than a long-running service.",
      category: "normal",
      severity: "info",
    };
  }

  if (
    lower === "errimagepull" ||
    lower === "imagepullbackoff" ||
    lower === "invalidimagename" ||
    lower === "createcontainererror" ||
    lower === "createcontainerconfigerror"
  ) {
    return {
      title: "Container could not be created from image",
      hint: "Node cannot pull the image or cannot create the container. Check image name, registry credentials (imagePullSecrets), and node egress. `kubectl describe pod` shows the exact pull error.",
      category: "image",
      severity: "high",
    };
  }

  if (lower === "containerstatusunknown" || lower === "unknown") {
    return {
      title: "Kubelet lost track of container state",
      hint: "Usually a node-level problem (kubelet restart, CRI runtime hiccup, disk pressure). Check kubelet logs, node Ready condition, and recent events on the node.",
      category: "node",
      severity: "medium",
    };
  }

  if (lower === "deadlineexceeded") {
    return {
      title: "Container killed because Job deadline was exceeded",
      hint: "Job spec `activeDeadlineSeconds` elapsed. Either raise the deadline or speed up the job (split, parallelize, tune resources).",
      category: "exit",
      severity: "medium",
    };
  }

  if (lower === "preemptionbykubescheduler" || lower === "preempted" || lower === "preempting") {
    return {
      title: "Pod was preempted by a higher-priority workload",
      hint: "Scheduler evicted this pod to free resources for a higher PriorityClass. Increase the pod's priority, add resource headroom, or reduce high-priority workload footprint.",
      category: "node",
      severity: "medium",
    };
  }

  if (lower === "evicted") {
    return {
      title: "Pod was evicted by node pressure",
      hint: "Usually DiskPressure / MemoryPressure on the node. Check node conditions and kubelet logs. Add resource requests/limits, or address underlying node pressure.",
      category: "node",
      severity: "high",
    };
  }

  if (lower.includes("shutdown") || lower.includes("nodelost")) {
    return {
      title: "Pod restarted due to node shutdown or loss",
      hint: "The node was drained, shut down, or lost cluster connectivity. Not a pod-level issue. Check node upgrades and health.",
      category: "node",
      severity: "low",
    };
  }

  if (lower.includes("liveness") || lower.includes("probe")) {
    return {
      title: "Liveness probe failed",
      hint: "Pod restarted because liveness probe returned a failure more than `failureThreshold` times. Common misconfig: probe too aggressive, wrong path/port, pod too slow to boot (use initialDelaySeconds or startupProbe).",
      category: "probe",
      severity: "medium",
    };
  }

  if (!r) {
    return {
      title: "No reason reported",
      hint: "Kubelet did not populate a terminated reason. Check the pod's lastState and recent events for more context.",
      category: "unknown",
      severity: "low",
    };
  }

  return {
    title: r,
    hint: `Uncommon restart reason. Check container logs with --previous and pod events for context.`,
    category: "unknown",
    severity: "medium",
  };
}
