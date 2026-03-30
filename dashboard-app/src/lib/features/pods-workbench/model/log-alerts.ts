export type LogAlertKind = "oom_killed" | "crash_loop_back_off" | "timeout" | "connection_refused";

export type LogAlertSummary = {
  kind: LogAlertKind;
  label: string;
  count: number;
  firstLine: number;
};

type LogAlertRule = {
  kind: LogAlertKind;
  label: string;
  pattern: RegExp;
};

const ALERT_RULES: readonly LogAlertRule[] = [
  { kind: "oom_killed", label: "OOMKilled", pattern: /\boomkilled\b/i },
  { kind: "crash_loop_back_off", label: "CrashLoopBackOff", pattern: /\bcrashloopbackoff\b/i },
  { kind: "timeout", label: "Timeout", pattern: /\b(timed?\s*out|timeout)\b/i },
  { kind: "connection_refused", label: "Connection refused", pattern: /\bconnection refused\b/i },
];

export function summarizeLogAlerts(logs: string): LogAlertSummary[] {
  if (!logs) return [];
  const lines = logs.replace(/\r\n/g, "\n").split("\n");
  const counters = new Map<LogAlertKind, { count: number; firstLine: number }>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;

    for (const rule of ALERT_RULES) {
      if (!rule.pattern.test(line)) continue;
      const existing = counters.get(rule.kind);
      if (existing) {
        existing.count += 1;
      } else {
        counters.set(rule.kind, { count: 1, firstLine: index + 1 });
      }
    }
  }

  return ALERT_RULES.map((rule) => {
    const hit = counters.get(rule.kind);
    if (!hit) return null;
    return {
      kind: rule.kind,
      label: rule.label,
      count: hit.count,
      firstLine: hit.firstLine,
    };
  }).filter((item): item is LogAlertSummary => Boolean(item));
}
