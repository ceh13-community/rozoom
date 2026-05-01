import { expect, test } from "@playwright/test";

test.describe("Fleet screen", () => {
  test("shows cluster list on load", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Fleet" })).toBeVisible();
    await expect(page.getByText("prod-eu-west-1")).toBeVisible();
    await expect(page.getByText("dev-digitalocean")).toBeVisible();
  });

  test("search filters clusters", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("Search clusters...").fill("hetzner");
    await expect(page.getByText("prod-hetzner-fsn1")).toBeVisible();
    await expect(page.getByText("prod-eu-west-1")).not.toBeVisible();
  });

  test("clicking cluster navigates to detail", async ({ page }) => {
    await page.goto("/");
    await page.getByText("prod-eu-west-1").click();
    await expect(page.getByText("Health Score")).toBeVisible();
    await expect(page.getByText("92")).toBeVisible();
  });
});

test.describe("Cluster detail", () => {
  test("shows workloads and stats", async ({ page }) => {
    await page.goto("/cluster/prod-eu");
    await expect(page.getByText("prod-eu-west-1")).toBeVisible();
    await expect(page.getByText("api-gateway")).toBeVisible();
    await expect(page.getByText("Nodes")).toBeVisible();
  });

  test("back button returns to fleet", async ({ page }) => {
    await page.goto("/cluster/prod-eu");
    await page.getByText("Fleet").first().click();
    await expect(page.getByRole("heading", { name: "Fleet" })).toBeVisible();
  });
});

test.describe("Alerts screen", () => {
  test("shows alerts list", async ({ page }) => {
    await page.goto("/alerts");
    await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();
    await expect(page.getByText("CrashLoopBackOff")).toBeVisible();
    await expect(page.getByText("Certificate Expiring")).toBeVisible();
  });
});

test.describe("Settings screen", () => {
  test("shows theme toggle and cycles themes", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    // Default is dark
    await expect(page.getByText("Dark")).toBeVisible();

    // Cycle to k9s
    await page.getByText("Dark").click();
    await expect(page.getByText("K9s")).toBeVisible();

    // Cycle to light
    await page.getByText("K9s").click();
    await expect(page.getByText("Light")).toBeVisible();
  });
});

test.describe("Navigation", () => {
  test("tab bar navigates between screens", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Fleet" })).toBeVisible();

    await page.getByRole("link", { name: "Alerts" }).click();
    await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();

    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    await page.getByRole("link", { name: "Fleet" }).click();
    await expect(page.getByRole("heading", { name: "Fleet" })).toBeVisible();
  });
});
