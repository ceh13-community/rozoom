import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const appLog = vi.fn();
vi.mock("./tauri-runtime", () => ({
  safeAppLog: (level: string, message: string) => {
    appLog(level, message);
    return Promise.resolve();
  },
}));

import {
  FOLLOW_WINDOW_MS,
  finishKubectlMutation,
  logBlockedKubectlMutation,
  normalizeKind,
  noteClusterEvent,
  resetActionLogForTests,
  startKubectlMutation,
  summarizeKubectlMutation,
} from "./action-log";

const lines = () => appLog.mock.calls.map(([, message]) => message as string);

const podEvent = (type: string, name: string, namespace = "shop") => ({
  clusterId: "c1",
  kind: "pod",
  payload: { type, object: { metadata: { name, namespace } } },
});

describe("summarizeKubectlMutation", () => {
  it("keeps verb, kind, names, namespace and harmless flags", () => {
    expect(
      summarizeKubectlMutation(["delete", "pod", "web-1", "web-2", "-n", "shop", "--wait=false"]),
    ).toMatchObject({
      text: "delete pod web-1 web-2 -n shop --wait=false",
      verb: "delete",
      kind: "pod",
      names: ["web-1", "web-2"],
      namespace: "shop",
    });
    expect(
      summarizeKubectlMutation(["rollout", "restart", "daemonset/agent", "--namespace", "ops"]),
    ).toMatchObject({ text: "rollout restart daemonset agent -n ops", kind: "daemonset" });
    expect(
      summarizeKubectlMutation(["scale", "deploy", "api", "--namespace=shop", "--replicas=3"]).text,
    ).toBe("scale deployment api -n shop --replicas=3");
  });

  it("leaves out patches, literals and key=value pairs", () => {
    expect(
      summarizeKubectlMutation([
        "patch",
        "deployment",
        "api",
        "-n",
        "shop",
        "-p",
        '{"spec":{"template":{"spec":{"containers":[{"name":"a","env":[{"name":"TOKEN","value":"s3cret"}]}]}}}}',
      ]).text,
    ).toBe("patch deployment api -n shop -p");
    expect(
      summarizeKubectlMutation(["set", "env", "deployment/api", "TOKEN=s3cret", "-n", "shop"]).text,
    ).toBe("set env deployment api -n shop");
    expect(
      summarizeKubectlMutation(["create", "secret", "generic", "db", "--from-literal=pw=s3cret"])
        .text,
    ).toBe("create secret generic db --from-literal");
    expect(
      summarizeKubectlMutation(["label", "pod", "web-1", "tier=gold", "--overwrite"]).text,
    ).toBe("label pod web-1 --overwrite");
  });
});

describe("values of flags the log does not know", () => {
  it("never logs them, only the flag name", () => {
    const text = summarizeKubectlMutation([
      "create",
      "secret",
      "docker-registry",
      "regcred",
      "--docker-password",
      "hunter2",
      "--docker-username",
      "me",
      "-n",
      "shop",
    ]).text;
    expect(text).toBe(
      "create secret docker-registry regcred -n shop --docker-password --docker-username",
    );
    expect(text).not.toContain("hunter2");
  });

  it("does not take a flag value for a kind or a name", () => {
    expect(summarizeKubectlMutation(["delete", "--cascade", "orphan", "deploy", "web"]).text).toBe(
      "delete deployment web --cascade=orphan",
    );
  });

  it("reads every kind/name target", () => {
    expect(summarizeKubectlMutation(["delete", "pod/a", "service/b", "-n", "shop"])).toMatchObject({
      text: "delete pod a service/b -n shop",
      targets: [
        { kind: "pod", name: "a" },
        { kind: "service", name: "b" },
      ],
    });
  });
});

describe("normalizeKind", () => {
  it.each([
    ["po", "pod"],
    ["pods", "pod"],
    ["deploy", "deployment"],
    ["deployments.apps", "deployment"],
    ["ingress", "ingress"],
    ["ingresses", "ingress"],
    ["networkpolicies", "networkpolicy"],
    ["priorityclasses", "priorityclass"],
    ["configmaps", "configmap"],
    ["cm", "configmap"],
  ])("%s -> %s", (raw, kind) => {
    expect(normalizeKind(raw)).toBe(kind);
  });
});

describe("action lines", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    appLog.mockClear();
    resetActionLogForTests();
  });

  afterEach(() => {
    resetActionLogForTests();
    vi.useRealTimers();
  });

  it("logs the command with result and duration", () => {
    const started = startKubectlMutation(["delete", "pod", "web-1", "-n", "shop"], "c1", 1_000);
    finishKubectlMutation(started, { code: 0 }, 1_812);
    expect(appLog).toHaveBeenCalledWith(
      "info",
      "[action] kubectl delete pod web-1 -n shop cluster=c1 result=ok duration=812ms",
    );

    const failed = startKubectlMutation(["scale", "deployment", "api", "--replicas=0"], "c1", 0);
    finishKubectlMutation(
      failed,
      { code: 1, stderr: 'Error from server (NotFound): deployments "api" not found\nmore' },
      40,
    );
    expect(appLog).toHaveBeenLastCalledWith(
      "warn",
      '[action] kubectl scale deployment api --replicas=0 cluster=c1 result=failed code=1 duration=40ms error="Error from server (NotFound): deployments "api" not found"',
    );
  });

  it("logs a write the read-only guard refused", () => {
    logBlockedKubectlMutation(["delete", "pod", "web-1"], "c1", "Cluster is read-only.");
    expect(appLog).toHaveBeenCalledWith(
      "warn",
      '[action] kubectl delete pod web-1 cluster=c1 result=blocked reason="Cluster is read-only."',
    );
  });

  it("logs when the list got the delete, also before kubectl has exited", () => {
    const started = startKubectlMutation(["delete", "pod", "web-1", "-n", "shop"], "c1", 1_000);
    noteClusterEvent(podEvent("MODIFIED", "web-1"), 1_300);
    finishKubectlMutation(started, { code: 0 }, 1_400);
    noteClusterEvent(podEvent("MODIFIED", "web-1"), 5_000);
    noteClusterEvent(podEvent("DELETED", "web-1"), 31_000);
    expect(lines()).toEqual([
      "[action] pod shop/web-1: list got MODIFIED 300ms after delete started",
      "[action] kubectl delete pod web-1 -n shop cluster=c1 result=ok duration=400ms",
      "[action] pod shop/web-1: removed from the list 30000ms after delete started",
    ]);
    vi.advanceTimersByTime(FOLLOW_WINDOW_MS);
    expect(lines()).toHaveLength(3);
  });

  it("follows a scale to the first list update, matching short kind names", () => {
    startKubectlMutation(["scale", "deploy", "api", "-n", "shop", "--replicas=3"], "c1", 0);
    noteClusterEvent({ ...podEvent("MODIFIED", "api"), kind: "pod" }, 10);
    noteClusterEvent(
      { clusterId: "c1", kind: "deployment", payload: podEvent("MODIFIED", "api").payload },
      250,
    );
    noteClusterEvent(
      { clusterId: "c1", kind: "deployment", payload: podEvent("MODIFIED", "api").payload },
      900,
    );
    expect(lines()).toEqual([
      "[action] deployment shop/api: list got MODIFIED 250ms after scale started",
    ]);
  });

  it("ignores another namespace and another cluster", () => {
    startKubectlMutation(["delete", "pod", "web-1", "-n", "shop"], "c1", 0);
    noteClusterEvent(podEvent("DELETED", "web-1", "other"), 10);
    noteClusterEvent({ ...podEvent("DELETED", "web-1"), clusterId: "c2" }, 10);
    expect(lines()).toEqual([]);
  });

  it("says when no open list saw the change, and drops the follow of a failed command", () => {
    startKubectlMutation(["rollout", "restart", "deployment/api", "-n", "shop"], "c1", 0);
    const failed = startKubectlMutation(["delete", "pod", "gone", "-n", "shop"], "c1", 0);
    finishKubectlMutation(failed, { code: 1, stderr: "not found" }, 5);
    appLog.mockClear();
    vi.advanceTimersByTime(FOLLOW_WINDOW_MS);
    expect(lines()).toEqual([
      "[action] deployment shop/api: no update in the open lists within 120s after rollout restart started (no watched list, a polled list, or the change is still running)",
    ]);
  });

  it("follows each target of a command with its own kind", () => {
    startKubectlMutation(["delete", "pod/a", "pod/b", "-n", "shop"], "c1", 0);
    noteClusterEvent(podEvent("DELETED", "b"), 40);
    noteClusterEvent(podEvent("DELETED", "a"), 50);
    expect(lines()).toEqual([
      "[action] pod shop/b: removed from the list 40ms after delete started",
      "[action] pod shop/a: removed from the list 50ms after delete started",
    ]);
  });

  it("writes a line for a command that never finished, and keeps following it", () => {
    const started = startKubectlMutation(["delete", "pod", "web-1", "-n", "shop"], "c1", 0);
    finishKubectlMutation(started, { code: null, stderr: "AbortError: aborted" }, 30);
    noteClusterEvent(podEvent("DELETED", "web-1"), 900);
    expect(lines()).toEqual([
      '[action] kubectl delete pod web-1 -n shop cluster=c1 result=interrupted duration=30ms error="AbortError: aborted"',
      "[action] pod shop/web-1: removed from the list 900ms after delete started",
    ]);
  });

  it("reads the event inside a configuration list payload", () => {
    startKubectlMutation(["delete", "configmap", "settings", "-n", "shop"], "c1", 0);
    noteClusterEvent(
      {
        clusterId: "c1",
        kind: "configuration",
        payload: { workloadType: "configmaps", event: podEvent("DELETED", "settings").payload },
      },
      120,
    );
    expect(lines()).toEqual([
      "[action] configmap shop/settings: removed from the list 120ms after delete started",
    ]);
  });
});
