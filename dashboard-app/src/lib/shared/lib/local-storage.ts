type JsonRecord = Record<string, unknown>;

export function readJsonFromStorage<T extends JsonRecord>(
  key: string,
  options: {
    fallback: T;
    migrateFromKeys?: string[];
    validate?: (value: unknown) => value is T;
  },
): T {
  if (typeof window === "undefined") return options.fallback;

  const candidateKeys = [key, ...(options.migrateFromKeys ?? [])];
  for (const candidate of candidateKeys) {
    try {
      const raw = window.localStorage.getItem(candidate);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (options.validate && !options.validate(parsed)) continue;
      if (candidate !== key) {
        writeJsonToStorage(key, parsed as JsonRecord);
        window.localStorage.removeItem(candidate);
      }
      return parsed as T;
    } catch {
      // ignore malformed storage value and continue fallback chain
    }
  }

  return options.fallback;
}

export function writeJsonToStorage(key: string, value: JsonRecord): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
}

export function removeStorageKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore storage failures
  }
}
