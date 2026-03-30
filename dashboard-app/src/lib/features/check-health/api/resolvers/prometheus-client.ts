import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { startPortForward, stopPortForward } from "$shared/api/port-forward";
import { discoverPrometheusService, type PrometheusTarget } from "$shared/api/discover-prometheus";

type PromQuerySuccess = {
  status: "success";
  data: {
    resultType: "vector" | "matrix" | "scalar" | "string";
    result: Array<{
      metric: Record<string, string>;
      value?: [number, string];
      values?: Array<[number, string]>;
    }>;
  };
};

type PromQueryError = { status: "error"; error: string; errorType?: string; warnings?: string[] };

type PromQueryResponse = PromQuerySuccess | PromQueryError;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHttpReady(
  url: string,
  options: {
    maxAttempts?: number;
    delayMs?: number;
  } = {},
): Promise<void> {
  const { maxAttempts = 20, delayMs = 300 } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await tauriFetch(url, { method: "HEAD" });
      if (response.ok) {
        return;
      }
    } catch (err) {
      lastError = err;
    }

    if (attempt === maxAttempts) {
      throw new Error(`Server on ${url} did not become ready after ${maxAttempts} attempts`, {
        cause: lastError,
      });
    }

    await sleep(delayMs);
  }
}

export class PrometheusClient {
  private readonly clusterId: string;
  private target: PrometheusTarget | null = null;

  constructor(clusterId: string) {
    this.clusterId = clusterId;
  }

  async discover(): Promise<PrometheusTarget | null> {
    const t = await discoverPrometheusService(this.clusterId);
    this.target = t;

    return t;
  }

  async queryInstant(query: string): Promise<PromQuerySuccess["data"]["result"]> {
    const t = this.target ?? (await this.discover());

    if (!t) throw new Error("Prometheus service not found");

    const localPort = 19090 + Math.floor(Math.random() * 500);
    const uniqueKey = `prom-${this.clusterId}-${t.namespace}-${t.name}-${localPort}`;

    try {
      const pf = await startPortForward({
        namespace: t.namespace,
        resource: `svc/${t.name}`,
        localPort,
        remotePort: t.port,
        clusterId: this.clusterId,
        uniqueKey,
      });

      if (!pf.success) throw new Error(pf.error || "Port-forward failed");

      await waitHttpReady(`http://127.0.0.1:${localPort}/-/ready`);

      const url = `http://127.0.0.1:${localPort}/api/v1/query?query=${encodeURIComponent(query)}`;
      const r = await tauriFetch(url, { method: "GET" });

      if (!r.ok) throw new Error(`Prometheus query HTTP ${r.status}`);

      const json = (await r.json()) as PromQueryResponse;
      if (json.status !== "success") throw new Error(json.error);

      return json.data.result;
    } finally {
      await stopPortForward(uniqueKey).catch(() => undefined);
    }
  }
}
