export function buildIncidentFilename(namespace: string, name: string, timestamp = new Date()) {
  const normalizedTimestamp = timestamp.toISOString().replace(/[:.]/g, "-");
  return `pod-incident-${namespace}-${name}-${normalizedTimestamp}.md`;
}

export function buildYamlFilename(
  kind: string,
  namespace: string,
  name: string,
  timestamp = new Date(),
) {
  const normalizedTimestamp = timestamp.toISOString().replace(/[:.]/g, "-");
  return `${kind}-${namespace}-${name}-${normalizedTimestamp}.yaml`;
}
