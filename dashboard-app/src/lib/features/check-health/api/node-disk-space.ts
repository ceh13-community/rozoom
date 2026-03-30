import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { startPortForward, stopPortForward } from "$shared/api/port-forward";
import { discoverNodeExporterPodForNode } from "$shared/api/discover-node-exporter";
import { kubectlRawFront } from "$shared/api/kubectl-proxy";

export interface DiskInfo {
  mountpoint: string;
  device: string;
  fstype: string;
  availableBytes: number;
  availableGiB: number;
  success: boolean;
  error?: string;
}

type KubeletSummary = {
  node?: {
    fs?: {
      availableBytes?: number;
      available?: { bytes?: number };
      available_bytes?: number;
      availableByte?: number;
    };
  };
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHttpReady(port: number, retries = 14) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await tauriFetch(`http://127.0.0.1:${port}/metrics`, { method: "GET" });
      if (r.ok) return;
    } catch {
      // ignore
    }
    await sleep(250);
  }
  throw new Error("Port-forward did not become ready");
}

function parseNodeExporterAvailBytes(
  metricsText: string,
  mountpointFilter: string,
): DiskInfo | null {
  const targetMetric = "node_filesystem_avail_bytes";
  const lines = metricsText.split("\n");

  let best: DiskInfo | null = null;

  for (const line of lines) {
    if (!line.startsWith(targetMetric)) continue;

    const match = line.match(
      /node_filesystem_avail_bytes\{[^}]*device="([^"]+)"[^}]*fstype="([^"]+)"[^}]*mountpoint="([^"]+)"[^}]*\}\s+([0-9.e+-]+)/,
    );
    if (!match) continue;

    const [, device, fstype, mountpoint, valueStr] = match;
    const value = Number.parseFloat(valueStr);
    if (!Number.isFinite(value)) continue;

    const info: DiskInfo = {
      mountpoint,
      device,
      fstype,
      availableBytes: value,
      availableGiB: Number((value / 1024 / 1024 / 1024).toFixed(2)),
      success: true,
    };

    if (mountpoint === mountpointFilter) return info;
    if (!best) best = info;
  }

  return best;
}

function pickAvailableBytes(summary: KubeletSummary): number | null {
  const fs = summary.node?.fs;
  if (!fs) return null;

  const v =
    fs.availableBytes ?? fs.available?.bytes ?? fs.available_bytes ?? fs.availableByte ?? null;

  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Disk resolver chain:
 * 1) node-exporter (per-node pod) via port-forward
 * 2) kubelet summary (/stats/summary) via apiserver proxy
 * 3) prometheus (placeholder, optional)
 */
export async function getNodeAvailableDiskSpace(
  clusterId: string,
  nodeName: string,
  mountpointFilter: string = "/",
): Promise<DiskInfo> {
  // 1) node-exporter (best)
  const ne = await discoverNodeExporterPodForNode(clusterId, nodeName);

  if (ne) {
    const localPort = 19100 + Math.floor(Math.random() * 2000); // avoid collisions
    const uniqueKey = `node-exporter-${clusterId}-${nodeName}-${localPort}`;

    try {
      const pf = await startPortForward({
        namespace: ne.namespace,
        resource: `pod/${ne.podName}`,
        localPort,
        remotePort: 9100,
        clusterId,
        uniqueKey,
      });

      if (!pf.success) {
        throw new Error(pf.error || "Could not start port-forward");
      }

      await waitForHttpReady(localPort);

      const metricsResponse = await tauriFetch(`http://127.0.0.1:${localPort}/metrics`, {
        method: "GET",
      });

      if (!metricsResponse.ok) {
        throw new Error(`node-exporter /metrics status: ${metricsResponse.status}`);
      }

      const text = await metricsResponse.text();
      const parsed = parseNodeExporterAvailBytes(text, mountpointFilter);

      if (parsed) return parsed;

      return {
        mountpoint: mountpointFilter,
        device: "",
        fstype: "",
        availableBytes: 0,
        availableGiB: 0,
        success: false,
        error: `node_filesystem_avail_bytes not found for mountpoint ${mountpointFilter}`,
      };
    } catch {
      // continue to kubelet fallback
    } finally {
      await stopPortForward(uniqueKey).catch(() => undefined);
    }
  }

  // 2) kubelet summary fallback
  try {
    const { output, errors } = await kubectlRawFront(
      `get --raw /api/v1/nodes/${nodeName}/proxy/stats/summary`,
      { clusterId },
    );
    if (errors.length > 0) throw new Error(errors);

    const data = JSON.parse(output) as KubeletSummary;
    const availableBytes = pickAvailableBytes(data);

    if (availableBytes !== null) {
      return {
        mountpoint: mountpointFilter,
        device: "",
        fstype: "",
        availableBytes,
        availableGiB: Number((availableBytes / 1024 / 1024 / 1024).toFixed(2)),
        success: true,
        error: "From kubelet summary (node.fs)",
      };
    }
  } catch {
    // ignore
  }

  // 3) prometheus fallback (optional)
  return {
    mountpoint: mountpointFilter,
    device: "",
    fstype: "",
    availableBytes: 0,
    availableGiB: 0,
    success: false,
    error: "N/A",
  };
}
