import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

const storeGet = vi.fn();
const storeSet = vi.fn();
const storeSave = vi.fn();

vi.mock("$shared/store", () => ({
  storeManager: {
    getStore: vi.fn(() =>
      Promise.resolve({
        get: storeGet,
        set: storeSet,
        save: storeSave,
      }),
    ),
  },
}));

// Import after vi.mock so the module under test sees the mock.
import { disabledPlugins, loadPluginState } from "./feature-flags";
import { BUILTIN_PLUGINS } from "./registry";

function defaultDisabledIds(): Set<string> {
  return new Set(
    BUILTIN_PLUGINS.filter((p) => p.defaultDisabled && p.tier !== "core").map((p) => p.id),
  );
}

describe("loadPluginState - default-disabled bootstrap", () => {
  beforeEach(() => {
    storeGet.mockReset();
    storeSet.mockReset();
    storeSave.mockReset();
    disabledPlugins.set(new Set());
  });

  it("seeds disabled set from manifest defaults on first run (no stored key)", async () => {
    storeGet.mockResolvedValue(null);

    await loadPluginState();

    const expected = defaultDisabledIds();
    expect(expected.size).toBeGreaterThan(0); // sanity - registry has some defaults
    expect(get(disabledPlugins)).toEqual(expected);
  });

  it("persists the seed so later loads read the user's stored state", async () => {
    storeGet.mockResolvedValue(null);

    await loadPluginState();

    const expected = defaultDisabledIds();
    expect(storeSet).toHaveBeenCalledWith(
      expect.stringMatching(/./),
      expect.arrayContaining([...expected]),
    );
    expect(storeSave).toHaveBeenCalled();
  });

  it("respects existing empty array once the user is on the current version", async () => {
    // stored at current version AND empty = user explicitly re-enabled all.
    storeGet.mockImplementation((key: string) => {
      if (key === "disabledPlugins") return Promise.resolve([]);
      if (key === "pluginPrefsVersion") return Promise.resolve(2);
      return Promise.resolve(null);
    });

    await loadPluginState();

    expect(get(disabledPlugins)).toEqual(new Set());
    expect(storeSet).not.toHaveBeenCalled();
  });

  it("respects a non-empty stored list verbatim on current version", async () => {
    storeGet.mockImplementation((key: string) => {
      if (key === "disabledPlugins") return Promise.resolve(["security-suite"]);
      if (key === "pluginPrefsVersion") return Promise.resolve(2);
      return Promise.resolve(null);
    });

    await loadPluginState();

    expect(get(disabledPlugins)).toEqual(new Set(["security-suite"]));
    expect(storeSet).not.toHaveBeenCalled();
  });

  it("never marks core plugins as default-disabled", async () => {
    storeGet.mockResolvedValue(null);

    await loadPluginState();

    const disabled = get(disabledPlugins);
    const coreIds = BUILTIN_PLUGINS.filter((p) => p.tier === "core").map((p) => p.id);
    for (const id of coreIds) {
      expect(disabled.has(id)).toBe(false);
    }
  });

  it("v1 -> v2 migration: unions manifest defaults into existing user state", async () => {
    // Existing user on v1 had explicitly enabled everything (empty disabled).
    // Stored version missing = treated as v1.
    storeGet.mockImplementation((key: string) => {
      if (key === "disabledPlugins") return Promise.resolve([]);
      if (key === "pluginPrefsVersion") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    await loadPluginState();

    // After migration, the 6 default-disabled plugins must be in the set,
    // even though the user's pre-migration disabled list was empty.
    const disabled = get(disabledPlugins);
    for (const id of defaultDisabledIds()) {
      expect(disabled.has(id), `${id} should be disabled after v2 migration`).toBe(true);
    }
  });

  it("v1 -> v2 migration persists the new state and version", async () => {
    storeGet.mockImplementation((key: string) => {
      if (key === "disabledPlugins") return Promise.resolve([]);
      if (key === "pluginPrefsVersion") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    await loadPluginState();

    const writes = storeSet.mock.calls;
    expect(writes.some(([k]) => k === "pluginPrefsVersion")).toBe(true);
    expect(writes.some(([k]) => k === "disabledPlugins")).toBe(true);
  });

  it("v1 -> v2 migration preserves existing disables", async () => {
    // User had explicitly disabled something that is NOT in defaultDisabled
    // (alerts-hub). Migration must keep that and only ADD the new defaults.
    storeGet.mockImplementation((key: string) => {
      if (key === "disabledPlugins") return Promise.resolve(["alerts-hub"]);
      if (key === "pluginPrefsVersion") return Promise.resolve(null);
      return Promise.resolve(null);
    });

    await loadPluginState();

    const disabled = get(disabledPlugins);
    expect(disabled.has("alerts-hub")).toBe(true);
    for (const id of defaultDisabledIds()) {
      expect(disabled.has(id)).toBe(true);
    }
  });

  it("current-version users are not re-migrated", async () => {
    storeGet.mockImplementation((key: string) => {
      if (key === "disabledPlugins") return Promise.resolve(["alerts-hub"]);
      if (key === "pluginPrefsVersion") return Promise.resolve(2);
      return Promise.resolve(null);
    });

    await loadPluginState();

    // User's exact stored state wins, no new ids added.
    expect(get(disabledPlugins)).toEqual(new Set(["alerts-hub"]));
    expect(storeSet).not.toHaveBeenCalled();
  });

  it("only disables plugins with no cluster-card-linked pages", async () => {
    storeGet.mockResolvedValue(null);
    await loadPluginState();
    const disabled = get(disabledPlugins);

    // Cluster card (cluster-info-card.svelte) links these pages; their
    // owning plugins must stay enabled so the card buttons keep working.
    const cardLinkedPages = [
      "alertshub",
      "armorhub",
      "backupaudit",
      "compliancehub",
      "cronjobshealth",
      "deprecationscan",
      "trivyhub",
      "versionaudit",
    ];
    for (const pageId of cardLinkedPages) {
      const owner = BUILTIN_PLUGINS.find((p) =>
        (p.provides.workloadPages ?? []).some((pg) => pg.id === pageId),
      );
      expect(owner, `page ${pageId} should have an owning plugin`).toBeDefined();
      if (owner) {
        expect(
          disabled.has(owner.id),
          `cluster-card plugin ${owner.id} (owns ${pageId}) should stay enabled`,
        ).toBe(false);
      }
    }
  });
});
