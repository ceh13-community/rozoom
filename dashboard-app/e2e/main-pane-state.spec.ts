import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import ts from "typescript";

// The main-pane log line measures layout and hit testing, which jsdom does not have, so
// its measurement runs here in a real browser against a page shaped like the dashboard:
// a fixed sidebar, a scrolling main pane, a page container full of rows.

const source = readFileSync(
  fileURLToPath(new URL("../src/lib/shared/lib/main-pane-state.ts", import.meta.url)),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const ROW_TEXT = "payments-api-764bb667b8";
const rows = Array.from(
  { length: 80 },
  (_, index) =>
    `<div style="height:28px;border-bottom:1px solid #333;background:rgb(24,26,31)">${ROW_TEXT}-${index}</div>`,
).join("");

const PAGE = `<!doctype html>
<html><body style="margin:0;background:rgb(7,8,10);color:#ddd;font:14px sans-serif">
<aside style="position:fixed;left:0;top:0;width:240px;height:100vh">Clusters</aside>
<main id="pane" style="position:fixed;left:240px;top:0;right:0;bottom:0;overflow-y:auto;padding:16px">
  <div id="page"><h1 style="margin:0;padding:40px 0">Pods</h1>${rows}</div>
</main>
</body></html>`;

type Measured = {
  elements: number;
  text: number;
  invisible: number;
  hits: number;
  covered: number;
  blank: boolean;
  line: string;
};

async function openPane(page: Page) {
  await page.setContent(PAGE);
  await page.addScriptTag({
    content: `window.__mainPaneState = (() => { const exports = {}; ${compiled}\nreturn exports; })();`,
  });
}

async function measure(page: Page): Promise<Measured> {
  return page.evaluate(() => {
    type Api = {
      describeMainPane: (main: HTMLElement) => Omit<Measured, "blank" | "line">;
      looksBlank: (state: unknown) => boolean;
      formatMainPaneLine: (state: unknown, route: string, trigger: string) => string;
    };
    const api = (window as unknown as { __mainPaneState: Api }).__mainPaneState;
    const pane = document.getElementById("pane");
    if (!pane) throw new Error("no pane");
    const state = api.describeMainPane(pane);
    return {
      ...state,
      blank: api.looksBlank(state),
      line: api.formatMainPaneLine(state, "/dashboard", "navigate"),
    };
  });
}

// A layer outside the pane, like the sheet overlay (fixed, z-index above the app) or a toast.
async function addLayer(page: Page, css: string) {
  await page.evaluate((value) => {
    const layer = document.createElement("div");
    layer.setAttribute("style", `position:fixed;z-index:190;background:rgba(0,0,0,0.5);${value}`);
    document.body.appendChild(layer);
  }, css);
}

async function stylePage(page: Page, css: string) {
  await page.evaluate((value) => {
    document.getElementById("page")?.setAttribute("style", value);
  }, css);
}

test.describe("main pane log line", () => {
  test.beforeEach(async ({ page }) => {
    await openPane(page);
  });

  test("a pane showing rows is not blank", async ({ page }) => {
    const state = await measure(page);
    expect(state.text).toBeGreaterThan(0);
    expect(state.hits).toBe(25);
    expect(state.invisible).toBe(0);
    expect(state.blank).toBe(false);
  });

  test("keeps page text out of the line", async ({ page }) => {
    const { line } = await measure(page);
    expect(line).not.toContain(ROW_TEXT);
    expect(line).not.toContain("Pods");
    expect(line).toMatch(/ hits=25\/25 /);
  });

  // The case the old line got wrong: every element still in the DOM, so a DOM count and
  // textContent looked healthy while the user saw an empty pane.
  test("a page container with display none is blank though its DOM is all there", async ({
    page,
  }) => {
    await stylePage(page, "display:none");
    const state = await measure(page);
    expect(state.elements).toBeGreaterThan(80);
    expect(state.text).toBe(0);
    expect(state.hits).toBe(0);
    expect(state.blank).toBe(true);
  });

  test.describe("content in the DOM but not shown", () => {
    for (const [name, css] of [
      ["clipped to zero height", "height:0;overflow:hidden"],
      ["moved out of the pane", "transform:translateY(-5000px)"],
      ["clipped by clip-path", "clip-path:inset(50%)"],
    ] as const) {
      test(name, async ({ page }) => {
        await stylePage(page, css);
        const state = await measure(page);
        expect(state.elements).toBeGreaterThan(80);
        expect(state.hits).toBe(0);
        expect(state.blank).toBe(true);
      });
    }

    test("transparent", async ({ page }) => {
      await stylePage(page, "opacity:0");
      const state = await measure(page);
      expect(state.invisible).toBe(1);
      expect(state.text).toBe(0);
      expect(state.blank).toBe(true);
    });

    // Small blocks stay under the size limit of `invisible`; their text must still not
    // count as readable. Seen live on the short empty-state page.
    test("transparent in small blocks", async ({ page }) => {
      await page.evaluate(() => {
        const pane = document.getElementById("pane");
        if (pane) {
          pane.innerHTML =
            '<h2 style="opacity:0">Clusters</h2><div style="opacity:0;width:300px">None yet</div>';
        }
      });
      const state = await measure(page);
      expect(state.invisible).toBe(0);
      expect(state.text).toBe(0);
      expect(state.blank).toBe(true);
    });
  });

  test("a wrapper painted in the background colour counts as nothing", async ({ page }) => {
    await page.evaluate(() => {
      const pane = document.getElementById("pane");
      if (pane) pane.innerHTML = '<div style="height:100%;background:rgb(7,8,10)"></div>';
    });
    const state = await measure(page);
    expect(state.hits).toBe(0);
    expect(state.text).toBe(0);
    expect(state.blank).toBe(true);
  });

  test.describe("layers over the pane", () => {
    test("a modal sheet over the whole pane is not a blank pane", async ({ page }) => {
      await addLayer(page, "inset:0");
      const state = await measure(page);
      expect(state.covered).toBe(25);
      expect(state.hits).toBe(0);
      expect(state.blank).toBe(false);
      expect(state.line).toMatch(/ covered=25\/25 /);
    });

    test("a toast in one corner does not hide clipped content", async ({ page }) => {
      await stylePage(page, "height:0;overflow:hidden");
      await addLayer(page, "right:0;bottom:0;width:320px;height:200px");
      const state = await measure(page);
      expect(state.covered).toBeGreaterThan(0);
      expect(state.covered).toBeLessThan(25);
      expect(state.hits).toBe(0);
      expect(state.blank).toBe(true);
    });
  });

  test("a pane scrolled to the middle of a long list counts what is in view", async ({ page }) => {
    await page.evaluate(() => {
      const pane = document.getElementById("pane");
      if (pane) pane.scrollTop = 1200;
    });
    const state = await measure(page);
    expect(state.text).toBeGreaterThan(0);
    expect(state.hits).toBe(25);
    expect(state.blank).toBe(false);
  });
});
