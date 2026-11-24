export type SilenceDraft = {
  alertname: string;
  namespace: string;
  durationHours: number;
  author: string;
  comment: string;
  extraMatchers: { name: string; value: string }[];
};

/**
 * One POSIX shell word in single quotes. A ' inside closes the quote, adds an
 * escaped quote and reopens it, so nothing in the value runs as a command.
 */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The curl command the Alerts panel offers to copy. Every value in the payload
 * can come from the cluster (an event reason, alert labels), so the payload is
 * quoted as one shell word before the user pastes it into a terminal.
 */
export function buildSilenceCurlCommand(draft: SilenceDraft, now: Date = new Date()): string {
  const matchers = [
    { name: "alertname", value: draft.alertname, isRegex: false },
    ...(draft.namespace ? [{ name: "namespace", value: draft.namespace, isRegex: false }] : []),
    ...draft.extraMatchers
      .filter((m) => m.name && m.value)
      .map((m) => ({ name: m.name, value: m.value, isRegex: false })),
  ];
  const endsAt = new Date(now.getTime() + draft.durationHours * 60 * 60 * 1000).toISOString();
  const payload = {
    matchers,
    startsAt: now.toISOString(),
    endsAt,
    createdBy: draft.author,
    comment: draft.comment,
  };
  return [
    "# Port-forward Alertmanager first:",
    "# kubectl port-forward -n monitoring svc/alertmanager 9093:9093",
    "",
    `curl -X POST http://localhost:9093/api/v2/silences \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d ${shellSingleQuote(JSON.stringify(payload))}`,
  ].join("\n");
}
