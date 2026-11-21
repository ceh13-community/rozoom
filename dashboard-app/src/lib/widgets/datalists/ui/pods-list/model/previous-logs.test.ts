import { describe, expect, it } from "vitest";
import type { ContainerStatus, PodItem } from "$shared/model/clusters";
import { previousLogsAvailability } from "./previous-logs";

function status(name: string, restartCount: number, terminated = restartCount > 0) {
  return {
    name,
    ready: true,
    restartCount,
    state: { running: { startedAt: "2026-11-21T10:00:00Z" } },
    lastState: terminated ? { terminated: { exitCode: 1, message: "", reason: "Error" } } : {},
  } as ContainerStatus;
}

function pod(...statuses: ContainerStatus[]) {
  return { status: { phase: "Running", containerStatuses: statuses } } as Partial<PodItem>;
}

describe("previousLogsAvailability", () => {
  it("is off with a hint when the container never restarted", () => {
    expect(previousLogsAvailability(pod(status("web", 0)), "web")).toEqual({
      available: false,
      hint: "No previous logs: container web has not restarted.",
    });
  });

  it("is on when the selected container restarted", () => {
    expect(previousLogsAvailability(pod(status("web", 2), status("side", 0)), "web")).toEqual({
      available: true,
      hint: "",
    });
  });

  it("counts a terminated last state even when the restart count was reset", () => {
    expect(previousLogsAvailability(pod(status("web", 0, true)), "web").available).toBe(true);
  });

  it("needs every container to have restarted for all containers", () => {
    expect(previousLogsAvailability(pod(status("web", 1), status("side", 3)), "__all__")).toEqual({
      available: true,
      hint: "",
    });
    expect(previousLogsAvailability(pod(status("web", 1), status("side", 0)), "__all__")).toEqual({
      available: false,
      hint: "Only web restarted. Pick that container to see its previous logs.",
    });
    expect(previousLogsAvailability(pod(status("web", 0)), "")).toEqual({
      available: false,
      hint: "No previous logs: no container in this pod has restarted.",
    });
  });

  it("is off for a pod whose containers have not started yet", () => {
    expect(previousLogsAvailability(pod(), "web").available).toBe(false);
  });

  it("leaves the choice to the user when the pod is unknown", () => {
    expect(previousLogsAvailability(null, "web")).toEqual({ available: true, hint: "" });
  });
});
