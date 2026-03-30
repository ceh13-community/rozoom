# Automated QA

ROZOOM uses a layered testing strategy to catch bugs at different levels.

## Test layers

### Layer 1: Unit & contract tests (vitest)

Fast, isolated tests for business logic, formatters, parsers, and component contracts.

```bash
pnpm test              # Watch mode
pnpm vitest run        # Single run (CI)
pnpm test:coverage     # With coverage report
```

**Coverage**: 436 test files, 2000+ test cases.

### Layer 2: Visual regression (Playwright)

Captures screenshots of key pages and compares against baseline images. Catches unintended visual changes - layout shifts, missing elements, broken styles.

```bash
pnpm test:e2e:visual                # Run visual regression tests
pnpm test:e2e:update-snapshots      # Update baseline screenshots after intentional changes
```

**Pages tested**: dashboard, cluster manager, overview, pods, deployments, helm catalog, metrics sources, nodes.

**How it works**:

1. First run creates baseline screenshots in `e2e/visual-regression.spec.ts-snapshots/`
2. Subsequent runs compare against baselines
3. Fails if pixel diff exceeds 2-3% threshold
4. Run `--update-snapshots` after intentional UI changes

### Layer 3: Critical user journeys (Playwright)

End-to-end tests that simulate real user workflows using seeded localStorage (no live cluster needed).

```bash
pnpm test:e2e:journeys
```

**Journeys tested**:

1. Dashboard loads and shows cluster cards
2. Navigate into cluster and see overview
3. Navigate between workload pages via sidebar
4. Workspace layout switching (1/2/3 panes)
5. Pin and unpin a page (with toast feedback)
6. Helm catalog renders charts with categories
7. Search and filter clusters

### Layer 4: Chaos & stress tests (Playwright)

Existing E2E tests for edge cases and performance under load.

```bash
pnpm test:e2e          # Run ALL E2E tests including chaos/stress
```

**Tests include**: network jitter, cache fallback, cluster switching, rapid toggle, render stress (50/100 cards), soak tests, multi-namespace spikes.

### Layer 5: Live smoke tests (manual, with real cluster)

Browser-driven smoke checks against a live Kubernetes cluster. Requires `kubectl` access.

```bash
pnpm qa:fixtures:apply          # Deploy test workloads to cluster
pnpm qa:live:pods               # Smoke test pods page
pnpm qa:live:workloads          # Smoke test all workload pages
pnpm qa:live:nodes-status       # Smoke test nodes
pnpm qa:live:workbench-parity   # Verify workbench consistency
```

## CI integration

All layers except live smoke tests run automatically on every PR:

| Job         | Trigger      | Timeout | Tests              |
| ----------- | ------------ | ------- | ------------------ |
| `pr_checks` | PR open/sync | 20 min  | Unit tests + build |
| `e2e_smoke` | PR open/sync | 30 min  | All Playwright E2E |

Failed E2E tests upload:

- Playwright HTML report
- Screenshots on failure
- Video on failure
- Trace on first retry

## Adding new tests

### New visual regression page

Add to `e2e/visual-regression.spec.ts`:

```typescript
{ workload: "newpage", name: "new-page" }
```

### New user journey

Add to `e2e/critical-user-journeys.spec.ts`:

```typescript
test("N. description of journey", async ({ page }) => {
  await page.goto(`/dashboard/clusters/${CLUSTER_ID}?workload=...`);
  await expect(page.getByText("Expected content")).toBeVisible();
});
```

### New live smoke test

Add to `qa/live/`:

```javascript
// my-feature-smoke.mjs
import { chromium } from "playwright";
// ... browser-driven checks against live cluster
```

## Playwright configuration

- **Viewport**: 1440x900 (standard desktop)
- **Color scheme**: dark (matches ROZOOM default)
- **Browser**: Chromium
- **Retries**: 1 (with trace on retry)
- **Artifacts**: screenshots, video, trace on failure
- **Screenshot diff threshold**: 2% pixel ratio
