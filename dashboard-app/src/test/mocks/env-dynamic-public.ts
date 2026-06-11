/**
 * Vitest stand-in for SvelteKit's `$env/dynamic/public`, which requires the
 * kit runtime to be initialised and throws when imported under vitest.
 * Tests that care about specific values can mutate this object directly.
 */
export const env: Record<string, string | undefined> = {};
