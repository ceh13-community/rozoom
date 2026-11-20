import { resolveKubeconfigPath, spawnCli } from "$shared/api/cli";
import type { PodItem } from "$shared/model/clusters";
import {
  buildPodAttachArgs,
  buildPodOutputFollowArgs,
  containerUsesTty,
  isAttachBannerLine,
} from "$widgets/datalists/ui/pods-list/pod-shell";

export type PodOutputStream = {
  /** True when the output comes from the container log because the container has a tty. */
  viaLog: boolean;
  stop: () => Promise<void>;
};

type StartArgs = {
  clusterId: string;
  pod: Partial<PodItem>;
  container?: string;
  onLine: (line: string) => void;
  /** Called once when kubectl exits by itself; not after stop(). */
  onEnd: (code: number | null) => void;
};

function exitCode(event: unknown): number | null {
  if (typeof event === "object" && event !== null && "code" in event) {
    const code = (event as { code: unknown }).code;
    return typeof code === "number" ? code : null;
  }
  return null;
}

/** Streams what the main process of the container prints, read-only, until stop(). */
export async function startPodOutputStream({
  clusterId,
  pod,
  container,
  onLine,
  onEnd,
}: StartArgs): Promise<PodOutputStream> {
  const viaLog = containerUsesTty(pod, container);
  const kubeconfigPath = await resolveKubeconfigPath(clusterId);
  const args = [
    ...(viaLog ? buildPodOutputFollowArgs(pod, container) : buildPodAttachArgs(pod, container)),
    "--kubeconfig",
    kubeconfigPath,
  ];
  let finished = false;
  const finish = (code: number | null) => {
    if (finished) return;
    finished = true;
    onEnd(code);
  };
  const emit = (chunk: string) => {
    const line = chunk.replace(/\r?\n$/, "");
    if (!isAttachBannerLine(line)) onLine(line);
  };
  const { child } = await spawnCli("kubectl", args, {
    onStdoutLine: emit,
    onStderrLine: emit,
    onClose: (event) => {
      finish(exitCode(event));
    },
    onError: () => {
      finish(null);
    },
  });
  return {
    viaLog,
    stop: async () => {
      finished = true;
      await child.kill().catch(() => undefined);
    },
  };
}
