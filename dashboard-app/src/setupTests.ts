import "@testing-library/jest-dom";
import { vi } from "vitest";

// Node 22.4+ exposes an experimental global WebStorage (`localStorage` /
// `sessionStorage`) that is unusable unless Node is started with
// --localstorage-file, and as of the Node 26 LTS that global is present by
// default. Under vitest's jsdom environment `window` is the global object, so
// the unusable native storage shadows jsdom's and `window.localStorage` reads
// as undefined, breaking every test that touches it. Install a spec-shaped
// in-memory Storage whenever no usable one is present. On Node 22/24 jsdom
// already provides a working Storage, so this is a no-op there.
function ensureStorage(name: "localStorage" | "sessionStorage"): void {
  let current: unknown;
  try {
    current = (globalThis as Record<string, unknown>)[name];
  } catch {
    current = undefined;
  }
  if (
    current &&
    typeof current === "object" &&
    typeof (current as { clear?: unknown }).clear === "function"
  ) {
    return;
  }
  const store = new Map<string, string>();
  const storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
  };
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: storage,
  });
}
ensureStorage("localStorage");
ensureStorage("sessionStorage");

Element.prototype.scrollIntoView = vi.fn();

vi.mock("@/lib/shared/api/kubectl-proxy");
vi.mock("@/lib/shared");
vi.mock("@sentry/sveltekit");
