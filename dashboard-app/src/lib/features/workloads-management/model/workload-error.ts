export type WorkloadErrorCode =
  | "KUBECTL_UNAVAILABLE"
  | "ACCESS_DENIED"
  | "RESOURCE_NOT_FOUND"
  | "VALIDATION_FAILED"
  | "UNKNOWN";

export type WorkloadError = {
  code: WorkloadErrorCode;
  message: string;
  retryable: boolean;
  details?: string;
};

function normalizeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return String(error);
  }
  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string") return maybeMessage;
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown error";
    }
  }
  return "Unknown error";
}

export function toWorkloadError(error: unknown): WorkloadError {
  const text = normalizeUnknownError(error);
  const normalized = text.toLowerCase();
  if (normalized.includes("forbidden") || normalized.includes("permission")) {
    return { code: "ACCESS_DENIED", message: text, retryable: false };
  }
  if (normalized.includes("not found")) {
    return { code: "RESOURCE_NOT_FOUND", message: text, retryable: false };
  }
  if (normalized.includes("validation")) {
    return { code: "VALIDATION_FAILED", message: text, retryable: false };
  }
  if (normalized.includes("kubectl")) {
    return { code: "KUBECTL_UNAVAILABLE", message: text, retryable: true };
  }
  return { code: "UNKNOWN", message: text, retryable: true };
}
