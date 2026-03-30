/**
 * Smart Restart Prediction (#3)
 *
 * Based on restart timestamps, predicts likelihood and estimated time of next crash.
 */

export type RestartPrediction = {
  podName: string;
  namespace: string;
  restartCount: number;
  avgIntervalMs: number;
  predictedNextMs: number | null;
  confidence: "high" | "medium" | "low" | "insufficient";
  riskLabel: string;
};

export function predictRestarts(
  pods: Array<{
    name: string;
    namespace: string;
    restartCount: number;
    lastRestartAt: string | null;
    previousRestartAt: string | null;
    createdAt: string;
  }>,
): RestartPrediction[] {
  const now = Date.now();
  return pods
    .filter((p) => p.restartCount >= 2)
    .map((p) => {
      const lastTs = p.lastRestartAt ? new Date(p.lastRestartAt).getTime() : 0;
      const prevTs = p.previousRestartAt ? new Date(p.previousRestartAt).getTime() : 0;
      const createdTs = new Date(p.createdAt).getTime();
      const ageMs = now - createdTs;

      let avgIntervalMs = 0;
      let confidence: RestartPrediction["confidence"] = "insufficient";
      let predictedNextMs: number | null = null;

      if (lastTs > 0 && prevTs > 0 && lastTs > prevTs) {
        avgIntervalMs = lastTs - prevTs;
        confidence = p.restartCount >= 5 ? "high" : p.restartCount >= 3 ? "medium" : "low";
        predictedNextMs = lastTs + avgIntervalMs;
      } else if (p.restartCount >= 2 && ageMs > 0) {
        avgIntervalMs = Math.round(ageMs / p.restartCount);
        confidence = p.restartCount >= 5 ? "medium" : "low";
        predictedNextMs = now + avgIntervalMs;
      }

      const minutesUntil = predictedNextMs
        ? Math.max(0, Math.round((predictedNextMs - now) / 60000))
        : null;
      const riskLabel =
        minutesUntil === null
          ? "Unknown"
          : minutesUntil <= 5
            ? "Imminent"
            : minutesUntil <= 30
              ? "Soon"
              : minutesUntil <= 120
                ? "Moderate"
                : "Low";

      return {
        podName: p.name,
        namespace: p.namespace,
        restartCount: p.restartCount,
        avgIntervalMs,
        predictedNextMs,
        confidence,
        riskLabel,
      };
    })
    .sort((a, b) => (a.predictedNextMs ?? Infinity) - (b.predictedNextMs ?? Infinity));
}
