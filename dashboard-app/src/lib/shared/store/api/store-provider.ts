type StoreValue = string | number | boolean | Record<string, unknown> | unknown[];

type StoreLike = {
  get: (key: string) => Promise<StoreValue | null>;
  set: (key: string, value: StoreValue) => Promise<void>;
  save: () => Promise<void>;
  clear: () => Promise<void>;
};

type StoreSnapshot = Record<string, StoreValue>;

class FallbackStore implements StoreLike {
  private data: StoreSnapshot = {};

  constructor(private readonly fileName: string) {
    this.data = this.readSnapshot();
  }

  private storageKey() {
    return `tauri-store-fallback:${this.fileName}`;
  }

  private readSnapshot(): StoreSnapshot {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(this.storageKey());
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as StoreSnapshot) : {};
    } catch {
      return {};
    }
  }

  private persistSnapshot() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(this.storageKey(), JSON.stringify(this.data));
    } catch {
      // ignore storage errors in browser fallback mode
    }
  }

  get(key: string): Promise<StoreValue | null> {
    return Promise.resolve(this.data[key] ?? null);
  }

  set(key: string, value: StoreValue): Promise<void> {
    this.data[key] = value;
    return Promise.resolve();
  }

  save(): Promise<void> {
    this.persistSnapshot();
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.data = {};
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(this.storageKey());
      } catch {
        // ignore storage errors in browser fallback mode
      }
    }
    return Promise.resolve();
  }
}

class TauriStoreManager {
  private stores: Map<string, StoreLike> = new Map();
  private initPromises: Map<string, Promise<StoreLike>> = new Map();

  private async loadTauriStore(fileName: string): Promise<StoreLike | null> {
    try {
      const tauriStore = await import("@tauri-apps/plugin-store");
      const store = await tauriStore.load(fileName);
      return store as unknown as StoreLike;
    } catch {
      return null;
    }
  }

  async getStore(fileName: string): Promise<StoreLike> {
    const existing = this.stores.get(fileName);
    if (existing) {
      return existing;
    }

    let promise = this.initPromises.get(fileName);
    if (!promise) {
      promise = (async () => {
        const tauriStore = await this.loadTauriStore(fileName);
        if (tauriStore) return tauriStore;
        return new FallbackStore(fileName);
      })();
      this.initPromises.set(fileName, promise);
    }

    const store = await promise;
    this.stores.set(fileName, store);
    this.initPromises.delete(fileName);

    return store;
  }

  async clearStore(fileName: string): Promise<void> {
    const store = this.stores.get(fileName);
    if (store) {
      await store.clear();
    }
  }

  reset(fileName?: string): void {
    if (fileName) {
      this.stores.delete(fileName);
      this.initPromises.delete(fileName);
    } else {
      this.stores.clear();
      this.initPromises.clear();
    }
  }
}

export const storeManager = new TauriStoreManager();
