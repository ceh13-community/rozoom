import { expect, test } from "@playwright/test";

test.describe("workloads/configuration smoke", () => {
  test("opens cluster workloads page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/(dashboard|tauri|sveltekit)/i);
  });

  test("preserves query in URL for deep-link search", async ({ page }) => {
    await page.goto("/?q=status%3Aerror");
    await expect(page.url()).toContain("q=status%3Aerror");
  });

  test("opens Network and Storage deep links", async ({ page }) => {
    await page.goto("/?workload=globaltriage");
    await expect(page.url()).toContain("workload=globaltriage");

    await page.goto("/?workload=services");
    await expect(page.url()).toContain("workload=services");

    await page.goto("/?workload=endpoints");
    await expect(page.url()).toContain("workload=endpoints");

    await page.goto("/?workload=ingressclasses");
    await expect(page.url()).toContain("workload=ingressclasses");

    await page.goto("/?workload=portforwarding");
    await expect(page.url()).toContain("workload=portforwarding");

    await page.goto("/?workload=serviceaccounts");
    await expect(page.url()).toContain("workload=serviceaccounts");

    await page.goto("/?workload=accessreviews");
    await expect(page.url()).toContain("workload=accessreviews");

    await page.goto("/?workload=customresourcedefinitions");
    await expect(page.url()).toContain("workload=customresourcedefinitions");

    await page.goto("/?workload=storageclasses");
    await expect(page.url()).toContain("workload=storageclasses");
  });

  test("opens details and YAML editor when rows are available", async ({ page }) => {
    await page.goto("/?workload=services");
    const rows = page.locator("tbody tr");
    if ((await rows.count()) === 0) return;

    const firstNameCellButton = rows.first().locator("td").nth(2).locator("text=/./").first();
    await firstNameCellButton.click();
    await expect(page.getByText("Properties")).toBeVisible();

    const editYamlButton = page.getByRole("button", { name: /Edit .* YAML/i });
    if ((await editYamlButton.count()) === 0) return;
    await editYamlButton.click();
    await expect(page.getByText("Fullscreen")).toBeVisible();
  });
});
