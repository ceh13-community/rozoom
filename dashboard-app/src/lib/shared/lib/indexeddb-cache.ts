const DB_NAME = "dashboard-cache-v1";
const DB_VERSION = 1;
const STORE_NAME = "kv";

type PersistedValue = {
  value: unknown;
  updatedAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Failed to open IndexedDB"));
    };
  });
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  runner: (store: IDBObjectStore) => Promise<T>,
) {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB is unavailable");
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, mode);
  const store = tx.objectStore(STORE_NAME);
  return runner(store);
}

export async function putIndexedCache(key: string, value: unknown): Promise<void> {
  await withStore("readwrite", async (store) => {
    await new Promise<void>((resolve, reject) => {
      const request = store.put({ value, updatedAt: Date.now() } as PersistedValue, key);
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        reject(request.error ?? new Error("Failed to put IndexedDB value"));
      };
    });
  });
}

type IndexedCacheTrimOptions = {
  prefix: string;
  maxEntries: number;
};

async function listIndexedCacheEntriesByPrefix(
  store: IDBObjectStore,
  prefix: string,
): Promise<Array<{ key: string; updatedAt: number }>> {
  return new Promise((resolve, reject) => {
    const entries: Array<{ key: string; updatedAt: number }> = [];
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(entries);
        return;
      }
      const rawKey = cursor.key;
      if (typeof rawKey !== "string") {
        cursor.continue();
        return;
      }
      const key = rawKey;
      if (key.startsWith(prefix)) {
        const value = cursor.value as PersistedValue | undefined;
        const updatedAt = value?.updatedAt ?? 0;
        entries.push({
          key,
          updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
        });
      }
      cursor.continue();
    };
    request.onerror = () => {
      reject(request.error ?? new Error("Failed to list IndexedDB entries"));
    };
  });
}

async function trimIndexedCacheByPrefix(
  store: IDBObjectStore,
  options: IndexedCacheTrimOptions,
): Promise<void> {
  const maxEntries = Math.max(0, Math.floor(options.maxEntries));
  if (!options.prefix || maxEntries <= 0) return;
  const entries = await listIndexedCacheEntriesByPrefix(store, options.prefix);
  if (entries.length <= maxEntries) return;
  entries.sort((left, right) => left.updatedAt - right.updatedAt);
  const toDelete = entries.slice(0, entries.length - maxEntries);
  for (const entry of toDelete) {
    await new Promise<void>((resolve, reject) => {
      const request = store.delete(entry.key);
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        reject(request.error ?? new Error("Failed to delete IndexedDB value"));
      };
    });
  }
}

export async function putIndexedCacheWithPrefixLimit(
  key: string,
  value: unknown,
  options: IndexedCacheTrimOptions,
): Promise<void> {
  await withStore("readwrite", async (store) => {
    await new Promise<void>((resolve, reject) => {
      const request = store.put({ value, updatedAt: Date.now() } as PersistedValue, key);
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        reject(request.error ?? new Error("Failed to put IndexedDB value"));
      };
    });
    await trimIndexedCacheByPrefix(store, options);
  });
}

export async function getIndexedCache<T>(key: string): Promise<T | null> {
  return withStore("readonly", async (store) => {
    return new Promise<T | null>((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => {
        const result = request.result as PersistedValue | undefined;
        resolve((result?.value as T | undefined) ?? null);
      };
      request.onerror = () => {
        reject(request.error ?? new Error("Failed to read IndexedDB value"));
      };
    });
  });
}

export async function deleteIndexedCache(key: string): Promise<void> {
  await withStore("readwrite", async (store) => {
    await new Promise<void>((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        reject(request.error ?? new Error("Failed to delete IndexedDB value"));
      };
    });
  });
}
