import { json, type RequestHandler } from "@sveltejs/kit";
import { resolvePodCpuMemWithTrace } from "$features/check-health/api/resolvers/pod-cpu-mem-resolver";

export const GET: RequestHandler = async ({ url }) => {
  const clusterId = url.searchParams.get("clusterId")?.trim() ?? "";
  if (!clusterId) {
    return json({ error: "clusterId is required" }, { status: 400 });
  }

  try {
    const resolved = await resolvePodCpuMemWithTrace(clusterId);
    const items = [...resolved.byKey.entries()].map(([key, value]) => {
      const [namespace = "default", name = ""] = key.split("/");
      return {
        namespace,
        name,
        cpu: value.cpu,
        memory: value.memory,
        cpuMillicores: value.cpuMillicores,
        memoryBytes: value.memoryBytes,
      };
    });
    return json({ items });
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "Failed to resolve pod metrics",
      },
      { status: 503 },
    );
  }
};
