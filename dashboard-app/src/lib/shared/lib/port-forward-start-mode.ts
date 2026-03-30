export type PortForwardStartMode = "start-only" | "start-and-open";

export function requestPortForwardStartMode(remotePort: number): PortForwardStartMode | null {
  if (typeof window === "undefined") return "start-only";
  if (typeof window.prompt !== "function") return "start-only";
  let answer: string | null = null;
  try {
    answer = window.prompt(
      `Remote port: ${remotePort}\nChoose start mode:\n1 - Create Port Forward only\n2 - Create Port Forward + Open Web`,
      "2",
    );
  } catch {
    return "start-only";
  }
  if (answer === null) return null;
  const normalized = answer.trim();
  if (normalized === "1") return "start-only";
  if (normalized === "2") return "start-and-open";
  return null;
}
